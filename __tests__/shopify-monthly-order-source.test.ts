/**
 * Tests de ShopifyMonthlyOrderSource (adapter de enumeración mensual —
 * Paso 3 de Facturación Global Mensual).
 *
 * Cubre:
 *   - Paginación: 1ª página con hasNextPage:true → nextCursor correcto;
 *     página final (hasNextPage:false) → nextCursor: null; el cursor
 *     recibido se pasa como variable `after` en la siguiente llamada.
 *   - Filtrado de transacciones: SALE/CAPTURE + SUCCESS sobreviven;
 *     REFUND/VOID y FAILURE se descartan; montos numéricos parseados.
 *   - El rango de fechas (from/to) se serializa en la query string.
 *   - Error de red / HTTP / GraphQL → mismo mensaje que el adapter
 *     individual (propagado desde shopifyGraphQL, sin envoltura adicional).
 *   - Pedido sin transacciones → payments: [].
 *   - No usa el endpoint OAuth cuando la marca es de auth estático.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de respuestas fetch mock
// ─────────────────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function gqlOrdersInRangeResponse(
  orders: unknown[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null } = {
    hasNextPage: false,
    endCursor: null,
  }
): Response {
  return jsonResponse({
    data: {
      orders: {
        pageInfo,
        edges: orders.map((node) => ({ node })),
      },
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixture de marca (auth estático — evita el paso OAuth en los tests)
// ─────────────────────────────────────────────────────────────────────────────

const STATIC_BRAND_CFG = {
  key: 'ariat' as const,
  label: 'Ariat',
  storeDomain: 'ariat.myshopify.com',
  auth: 'static' as const,
  token: 'shpat_test_token',
}

vi.mock('../src/infrastructure/shopify/brands', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/infrastructure/shopify/brands')>()
  return {
    ...original,
    getBrandConfig: vi.fn(() => STATIC_BRAND_CFG),
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Fixture de pedido Shopify con transacciones
// ─────────────────────────────────────────────────────────────────────────────

function makeTransaction(overrides: {
  gateway?: string
  kind?: string
  status?: string
  amount?: string
} = {}) {
  return {
    gateway: overrides.gateway ?? 'cash',
    kind: overrides.kind ?? 'SALE',
    status: overrides.status ?? 'SUCCESS',
    amountSet: { shopMoney: { amount: overrides.amount ?? '100.00', currencyCode: 'MXN' } },
  }
}

function makeMonthlyShopifyOrder(overrides: {
  id?: string
  name?: string
  sourceIdentifier?: string | null
  transactions?: unknown[]
} = {}) {
  return {
    id: overrides.id ?? 'gid://shopify/Order/1',
    name: overrides.name ?? '#1001',
    createdAt: '2026-06-15T10:00:00Z',
    currencyCode: 'MXN',
    email: 'cliente@example.com',
    sourceName: 'pos',
    sourceIdentifier: overrides.sourceIdentifier !== undefined ? overrides.sourceIdentifier : 'dev-1001',
    displayFinancialStatus: 'PAID',
    totalRefundedSet: { shopMoney: { amount: '0.00', currencyCode: 'MXN' } },
    subtotalPriceSet: { shopMoney: { amount: '100.00', currencyCode: 'MXN' } },
    totalTaxSet: { shopMoney: { amount: '16.00', currencyCode: 'MXN' } },
    totalPriceSet: { shopMoney: { amount: '116.00', currencyCode: 'MXN' } },
    totalDiscountsSet: { shopMoney: { amount: '0.00', currencyCode: 'MXN' } },
    totalShippingPriceSet: { shopMoney: { amount: '0.00', currencyCode: 'MXN' } },
    lineItems: {
      edges: [
        {
          node: {
            title: 'Sombrero',
            quantity: 1,
            sku: 'SKU-1',
            originalUnitPriceSet: { shopMoney: { amount: '100.00', currencyCode: 'MXN' } },
            discountedUnitPriceSet: { shopMoney: { amount: '100.00', currencyCode: 'MXN' } },
            taxLines: [{ rate: 0.16 }],
          },
        },
      ],
    },
    paymentGatewayNames: ['cash'],
    physicalLocation: { name: 'Sucursal Nogales' },
    transactions: overrides.transactions ?? [makeTransaction()],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('ShopifyMonthlyOrderSource.listOrdersInRange', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  const FROM = new Date('2026-06-01T06:00:00.000Z')
  const TO = new Date('2026-07-01T05:59:59.999Z')

  it('primera página con hasNextPage:true → devuelve nextCursor = endCursor', async () => {
    const order = makeMonthlyShopifyOrder()
    fetchMock.mockResolvedValueOnce(
      gqlOrdersInRangeResponse([order], { hasNextPage: true, endCursor: 'cursor-abc' })
    )

    const { ShopifyMonthlyOrderSource } = await import(
      '../src/infrastructure/shopify/ShopifyMonthlyOrderSource'
    )
    const source = new ShopifyMonthlyOrderSource()

    const result = await source.listOrdersInRange({
      brandKey: 'ariat',
      from: FROM,
      to: TO,
      cursor: null,
    })

    expect(result.nextCursor).toBe('cursor-abc')
    expect(result.orders).toHaveLength(1)
  })

  it('página final con hasNextPage:false → nextCursor: null (aunque endCursor no sea null)', async () => {
    const order = makeMonthlyShopifyOrder()
    fetchMock.mockResolvedValueOnce(
      gqlOrdersInRangeResponse([order], { hasNextPage: false, endCursor: 'cursor-ignored' })
    )

    const { ShopifyMonthlyOrderSource } = await import(
      '../src/infrastructure/shopify/ShopifyMonthlyOrderSource'
    )
    const result = await new ShopifyMonthlyOrderSource().listOrdersInRange({
      brandKey: 'ariat',
      from: FROM,
      to: TO,
      cursor: 'cursor-abc',
    })

    expect(result.nextCursor).toBeNull()
  })

  it('pasa el cursor recibido como variable `after` de la query', async () => {
    fetchMock.mockResolvedValueOnce(gqlOrdersInRangeResponse([]))

    const { ShopifyMonthlyOrderSource } = await import(
      '../src/infrastructure/shopify/ShopifyMonthlyOrderSource'
    )
    await new ShopifyMonthlyOrderSource().listOrdersInRange({
      brandKey: 'ariat',
      from: FROM,
      to: TO,
      cursor: 'cursor-xyz',
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.variables.after).toBe('cursor-xyz')
    expect(body.variables.first).toBe(250)
  })

  it('primera página: cursor null se pasa como after: null', async () => {
    fetchMock.mockResolvedValueOnce(gqlOrdersInRangeResponse([]))

    const { ShopifyMonthlyOrderSource } = await import(
      '../src/infrastructure/shopify/ShopifyMonthlyOrderSource'
    )
    await new ShopifyMonthlyOrderSource().listOrdersInRange({
      brandKey: 'ariat',
      from: FROM,
      to: TO,
      cursor: null,
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.variables.after).toBeNull()
  })

  it('incluye el rango from/to (ISO) en la query string enviada a Shopify', async () => {
    fetchMock.mockResolvedValueOnce(gqlOrdersInRangeResponse([]))

    const { ShopifyMonthlyOrderSource } = await import(
      '../src/infrastructure/shopify/ShopifyMonthlyOrderSource'
    )
    await new ShopifyMonthlyOrderSource().listOrdersInRange({
      brandKey: 'ariat',
      from: FROM,
      to: TO,
      cursor: null,
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.variables.queryStr).toContain(FROM.toISOString())
    expect(body.variables.queryStr).toContain(TO.toISOString())
    expect(body.variables.queryStr).toContain('created_at:>=')
    expect(body.variables.queryStr).toContain('created_at:<=')
  })

  it('filtra transacciones: solo SALE/CAPTURE + SUCCESS sobreviven', async () => {
    const order = makeMonthlyShopifyOrder({
      transactions: [
        makeTransaction({ gateway: 'cash', kind: 'SALE', status: 'SUCCESS', amount: '60.00' }),
        makeTransaction({ gateway: 'bogus', kind: 'CAPTURE', status: 'SUCCESS', amount: '40.00' }),
        makeTransaction({ gateway: 'cash', kind: 'SALE', status: 'FAILURE', amount: '999.00' }),
        makeTransaction({ gateway: 'cash', kind: 'VOID', status: 'SUCCESS', amount: '999.00' }),
        makeTransaction({ gateway: 'cash', kind: 'REFUND', status: 'SUCCESS', amount: '999.00' }),
      ],
    })
    fetchMock.mockResolvedValueOnce(gqlOrdersInRangeResponse([order]))

    const { ShopifyMonthlyOrderSource } = await import(
      '../src/infrastructure/shopify/ShopifyMonthlyOrderSource'
    )
    const result = await new ShopifyMonthlyOrderSource().listOrdersInRange({
      brandKey: 'ariat',
      from: FROM,
      to: TO,
      cursor: null,
    })

    expect(result.orders).toHaveLength(1)
    expect(result.orders[0].payments).toEqual([
      { gateway: 'cash', amount: 60 },
      { gateway: 'bogus', amount: 40 },
    ])
  })

  it('filtrado es case-insensitive en kind/status', async () => {
    const order = makeMonthlyShopifyOrder({
      transactions: [
        makeTransaction({ gateway: 'cash', kind: 'sale', status: 'success', amount: '25.00' }),
      ],
    })
    fetchMock.mockResolvedValueOnce(gqlOrdersInRangeResponse([order]))

    const { ShopifyMonthlyOrderSource } = await import(
      '../src/infrastructure/shopify/ShopifyMonthlyOrderSource'
    )
    const result = await new ShopifyMonthlyOrderSource().listOrdersInRange({
      brandKey: 'ariat',
      from: FROM,
      to: TO,
      cursor: null,
    })

    expect(result.orders[0].payments).toEqual([{ gateway: 'cash', amount: 25 }])
  })

  it('pedido sin transacciones → payments: []', async () => {
    const order = makeMonthlyShopifyOrder({ transactions: [] })
    fetchMock.mockResolvedValueOnce(gqlOrdersInRangeResponse([order]))

    const { ShopifyMonthlyOrderSource } = await import(
      '../src/infrastructure/shopify/ShopifyMonthlyOrderSource'
    )
    const result = await new ShopifyMonthlyOrderSource().listOrdersInRange({
      brandKey: 'ariat',
      from: FROM,
      to: TO,
      cursor: null,
    })

    expect(result.orders[0].payments).toEqual([])
  })

  it('normaliza el pedido reutilizando la misma normalización que la búsqueda individual', async () => {
    const order = makeMonthlyShopifyOrder()
    fetchMock.mockResolvedValueOnce(gqlOrdersInRangeResponse([order]))

    const { ShopifyMonthlyOrderSource } = await import(
      '../src/infrastructure/shopify/ShopifyMonthlyOrderSource'
    )
    const result = await new ShopifyMonthlyOrderSource().listOrdersInRange({
      brandKey: 'ariat',
      from: FROM,
      to: TO,
      cursor: null,
    })

    const normalized = result.orders[0].order
    expect(normalized.orderNumber).toBe('#1001')
    expect(normalized.total).toBe(116)
    expect(normalized.lines).toHaveLength(1)
    expect(normalized.storeName).toBe('Sucursal Nogales')
    expect(normalized.sourceIdentifier).toBe('dev-1001')
  })

  it('múltiples pedidos en una página se normalizan todos', async () => {
    const order1 = makeMonthlyShopifyOrder({ id: 'gid://Order/1', name: '#1001' })
    const order2 = makeMonthlyShopifyOrder({ id: 'gid://Order/2', name: '#1002' })
    fetchMock.mockResolvedValueOnce(gqlOrdersInRangeResponse([order1, order2]))

    const { ShopifyMonthlyOrderSource } = await import(
      '../src/infrastructure/shopify/ShopifyMonthlyOrderSource'
    )
    const result = await new ShopifyMonthlyOrderSource().listOrdersInRange({
      brandKey: 'ariat',
      from: FROM,
      to: TO,
      cursor: null,
    })

    expect(result.orders).toHaveLength(2)
    expect(result.orders.map((o) => o.order.orderNumber)).toEqual(['#1001', '#1002'])
  })

  it('con auth=static usa el token directamente (NO llama al endpoint OAuth)', async () => {
    fetchMock.mockResolvedValueOnce(gqlOrdersInRangeResponse([]))

    const { ShopifyMonthlyOrderSource } = await import(
      '../src/infrastructure/shopify/ShopifyMonthlyOrderSource'
    )
    await new ShopifyMonthlyOrderSource().listOrdersInRange({
      brandKey: 'ariat',
      from: FROM,
      to: TO,
      cursor: null,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['X-Shopify-Access-Token']).toBe(
      'shpat_test_token'
    )
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Errores — mismo comportamiento que shopifyGraphQL (adapter individual)
  // ───────────────────────────────────────────────────────────────────────────

  it('error de red → mismo mensaje que el adapter individual (Error de red en GraphQL)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('ECONNRESET'))

    const { ShopifyMonthlyOrderSource } = await import(
      '../src/infrastructure/shopify/ShopifyMonthlyOrderSource'
    )
    await expect(
      new ShopifyMonthlyOrderSource().listOrdersInRange({
        brandKey: 'ariat',
        from: FROM,
        to: TO,
        cursor: null,
      })
    ).rejects.toThrow(/Error de red en GraphQL/)
  })

  it('error HTTP no-OK → mismo mensaje que el adapter individual (GraphQL HTTP <status>)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))

    const { ShopifyMonthlyOrderSource } = await import(
      '../src/infrastructure/shopify/ShopifyMonthlyOrderSource'
    )
    await expect(
      new ShopifyMonthlyOrderSource().listOrdersInRange({
        brandKey: 'ariat',
        from: FROM,
        to: TO,
        cursor: null,
      })
    ).rejects.toThrow(/GraphQL HTTP 403/)
  })

  it('errors[] en el body GraphQL → mismo mensaje que el adapter individual (GraphQL error)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ errors: [{ message: 'Throttled' }] })
    )

    const { ShopifyMonthlyOrderSource } = await import(
      '../src/infrastructure/shopify/ShopifyMonthlyOrderSource'
    )
    await expect(
      new ShopifyMonthlyOrderSource().listOrdersInRange({
        brandKey: 'ariat',
        from: FROM,
        to: TO,
        cursor: null,
      })
    ).rejects.toThrow(/GraphQL error.*Throttled/)
  })
})
