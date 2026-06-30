/**
 * Tests del cliente HTTP de Shopify (lib/shopify/client.ts y lib/order-source/shopify.ts)
 *
 * Cubre:
 *   getShopifyToken:
 *     - token estático: devuelve el token sin llamar a fetch
 *     - token estático sin configurar: lanza
 *     - OAuth: obtiene token nuevo con form-urlencoded y lo cachea
 *     - OAuth: reutiliza token cacheado (no llama fetch de nuevo)
 *     - OAuth: lanza si respuesta no es OK
 *     - OAuth: lanza si la respuesta no tiene access_token
 *     - OAuth: lanza si fetch falla con error de red
 *
 *   shopifyGraphQL:
 *     - incluye X-Shopify-Access-Token en el header
 *     - devuelve data en éxito
 *     - lanza en error HTTP
 *     - lanza en errores GraphQL (body.errors)
 *     - lanza cuando data === null
 *     - lanza en error de red
 *     - con auth=static no llama al endpoint OAuth
 *
 *   ShopifyOrderSource.findOrder (fan-out + filtro sourceIdentifier):
 *     - devuelve null cuando ninguna marca tiene el folio (0 matches)
 *     - devuelve el pedido normalizado cuando una marca tiene el folio
 *     - coincidencia exacta: sourceIdentifier === folio
 *     - coincidencia de cola: sourceIdentifier termina en "-{folio}"
 *     - normaliza el folio: trim + quitar '#' + uppercase
 *     - tolera fallos parciales (una marca falla, otra responde)
 *     - lanza cuando todas las tiendas fallan
 *     - lanza cuando no hay marcas configuradas
 *     - usa fallback sin comillas cuando primera query no produce match
 *     - >1 matches → devuelve el primero y emite warn (no lanza)
 *     - normaliza los campos del pedido (totales, líneas, descuentos)
 *     - usa label de la marca como storeName cuando physicalLocation es null
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

function tokenResponse(access_token: string, expires_in = 86400): Response {
  return jsonResponse({ access_token, expires_in })
}

function gqlOrderResponse(orders: unknown[] = []): Response {
  return jsonResponse({
    data: {
      orders: {
        edges: orders.map((node) => ({ node })),
      },
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures de configuración de marca
// ─────────────────────────────────────────────────────────────────────────────

const STATIC_BRAND_CFG = {
  key:         'ariat'  as const,
  label:       'Ariat',
  storeDomain: 'ariat.myshopify.com',
  auth:        'static' as const,
  token:       'shpat_test_token',
}

const OAUTH_BRAND_CFG = {
  key:          'stetson' as const,
  label:        'Stetson',
  storeDomain:  'stetson.myshopify.com',
  auth:         'oauth'   as const,
  clientId:     'client-id-stetson',
  clientSecret: 'client-secret-stetson',
}

/** Pedido Shopify mínimo para pruebas */
function makeShopifyOrder(overrides: {
  sourceIdentifier?: string | null
  id?:               string
  name?:             string
  physicalLocation?: { name: string } | null
  lineItems?:        unknown[]
} = {}) {
  return {
    id:             overrides.id             ?? 'gid://shopify/Order/12345',
    name:           overrides.name           ?? '#45371',
    createdAt:      '2026-06-01T10:00:00Z',
    currencyCode:   'MXN',
    email:          'cliente@example.com',
    sourceName:     'pos',
    sourceIdentifier: overrides.sourceIdentifier !== undefined
      ? overrides.sourceIdentifier
      : null,
    displayFinancialStatus: 'PAID',
    totalRefundedSet:     { shopMoney: { amount: '0.00',   currencyCode: 'MXN' } },
    subtotalPriceSet:     { shopMoney: { amount: '100.00', currencyCode: 'MXN' } },
    totalTaxSet:          { shopMoney: { amount: '16.00',  currencyCode: 'MXN' } },
    totalPriceSet:        { shopMoney: { amount: '116.00', currencyCode: 'MXN' } },
    totalDiscountsSet:    { shopMoney: { amount: '0.00',   currencyCode: 'MXN' } },
    totalShippingPriceSet:{ shopMoney: { amount: '0.00',   currencyCode: 'MXN' } },
    lineItems: {
      edges: (overrides.lineItems ?? [
        {
          title:    'Sombrero Stetson',
          quantity: 1,
          sku:      'STT-001',
          originalUnitPriceSet:  { shopMoney: { amount: '100.00', currencyCode: 'MXN' } },
          discountedUnitPriceSet:{ shopMoney: { amount: '100.00', currencyCode: 'MXN' } },
          taxLines: [{ rate: 0.16 }],
        },
      ]).map((item: unknown) => ({ node: item })),
    },
    paymentGatewayNames: ['cash'],
    physicalLocation: overrides.physicalLocation !== undefined
      ? overrides.physicalLocation
      : { name: 'Sucursal Nogales' },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock a nivel de módulo para lib/shopify/brands
// Permite controlar listConfiguredBrands() por test a través de vi.mocked()
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../lib/shopify/brands', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/shopify/brands')>()
  return {
    ...original,
    listConfiguredBrands: vi.fn(() => [STATIC_BRAND_CFG]),
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Helper para reconfigurar las marcas disponibles por test
// ─────────────────────────────────────────────────────────────────────────────

async function setBrands(brands: typeof STATIC_BRAND_CFG[]) {
  const brandsModule = await import('../lib/shopify/brands')
  vi.mocked(brandsModule.listConfiguredBrands).mockReturnValue(brands as never)
}

// ═════════════════════════════════════════════════════════════════════════════
// getShopifyToken — auth estático
// ═════════════════════════════════════════════════════════════════════════════

describe('getShopifyToken — static auth', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('devuelve el token estático sin llamar a fetch', async () => {
    const { getShopifyToken } = await import('../lib/shopify/client')

    const token = await getShopifyToken(STATIC_BRAND_CFG)
    expect(token).toBe('shpat_test_token')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lanza si auth=static pero token no está configurado', async () => {
    const { getShopifyToken } = await import('../lib/shopify/client')

    await expect(
      getShopifyToken({ ...STATIC_BRAND_CFG, token: undefined })
    ).rejects.toThrow(/Token estático no configurado/)
  })

  it('lanza si auth=oauth pero sin clientId/clientSecret', async () => {
    const { getShopifyToken } = await import('../lib/shopify/client')

    await expect(
      getShopifyToken({ ...OAUTH_BRAND_CFG, clientId: undefined })
    ).rejects.toThrow(/CLIENT_ID o CLIENT_SECRET/)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// getShopifyToken — OAuth flow
// Nota: cada test usa resetModules para limpiar el caché de tokens OAuth
// ═════════════════════════════════════════════════════════════════════════════

describe('getShopifyToken — OAuth flow', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('llama al endpoint OAuth con form-urlencoded y devuelve el access_token', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('oauth-token-abc'))
    const { getShopifyToken } = await import('../lib/shopify/client')

    const token = await getShopifyToken(OAUTH_BRAND_CFG)
    expect(token).toBe('oauth-token-abc')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('stetson.myshopify.com')
    expect(url).toContain('/admin/oauth/access_token')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded'
    )
    expect(init.method).toBe('POST')
    const bodyStr = String(init.body)
    expect(bodyStr).toContain('grant_type=client_credentials')
    expect(bodyStr).toContain('client_id=client-id-stetson')
  })

  it('reutiliza el token cacheado cuando no ha expirado', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('cached-token', 86400))
    const { getShopifyToken } = await import('../lib/shopify/client')

    const t1 = await getShopifyToken(OAUTH_BRAND_CFG)
    const t2 = await getShopifyToken(OAUTH_BRAND_CFG)

    expect(t1).toBe('cached-token')
    expect(t2).toBe('cached-token')
    // Solo una llamada — el segundo usa el caché
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('lanza si la respuesta de token no es OK', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
    const { getShopifyToken } = await import('../lib/shopify/client')

    await expect(getShopifyToken(OAUTH_BRAND_CFG)).rejects.toThrow(/rechazó el token/)
  })

  it('lanza si la respuesta de token no tiene access_token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ token_type: 'Bearer' }))
    const { getShopifyToken } = await import('../lib/shopify/client')

    await expect(getShopifyToken(OAUTH_BRAND_CFG)).rejects.toThrow(/sin access_token/)
  })

  it('lanza con mensaje de red cuando fetch falla al pedir el token', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('ECONNREFUSED'))
    const { getShopifyToken } = await import('../lib/shopify/client')

    await expect(getShopifyToken(OAUTH_BRAND_CFG)).rejects.toThrow(/Error de red al obtener token OAuth/)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// shopifyGraphQL
// ═════════════════════════════════════════════════════════════════════════════

describe('shopifyGraphQL', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('incluye X-Shopify-Access-Token en el header de la request GraphQL', async () => {
    // fetch#1: token OAuth; fetch#2: query GraphQL
    fetchMock.mockResolvedValueOnce(tokenResponse('gql-token'))
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { orders: { edges: [] } } }))

    const { shopifyGraphQL } = await import('../lib/shopify/client')

    await shopifyGraphQL(OAUTH_BRAND_CFG, '{ orders { edges { node { id } } } }')

    const [, gqlInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect((gqlInit.headers as Record<string, string>)['X-Shopify-Access-Token']).toBe('gql-token')
  })

  it('devuelve el objeto data de la respuesta en éxito', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('tok'))
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { foo: 'bar' } }))

    const { shopifyGraphQL } = await import('../lib/shopify/client')
    const result = await shopifyGraphQL<{ foo: string }>(OAUTH_BRAND_CFG, '{ foo }')

    expect(result).toEqual({ foo: 'bar' })
  })

  it('lanza cuando la respuesta HTTP no es OK', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('tok'))
    fetchMock.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))

    const { shopifyGraphQL } = await import('../lib/shopify/client')

    await expect(shopifyGraphQL(OAUTH_BRAND_CFG, '{ foo }')).rejects.toThrow(/GraphQL HTTP 403/)
  })

  it('lanza cuando el body tiene errors en la respuesta', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('tok'))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ errors: [{ message: 'Field does not exist' }] })
    )

    const { shopifyGraphQL } = await import('../lib/shopify/client')

    await expect(shopifyGraphQL(OAUTH_BRAND_CFG, '{ badField }')).rejects.toThrow(
      /GraphQL error.*Field does not exist/
    )
  })

  it('lanza cuando data es null', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('tok'))
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: null }))

    const { shopifyGraphQL } = await import('../lib/shopify/client')

    await expect(shopifyGraphQL(OAUTH_BRAND_CFG, '{ orders }')).rejects.toThrow(/data=null/)
  })

  it('lanza en error de red durante la query GraphQL', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('tok'))
    fetchMock.mockRejectedValueOnce(new TypeError('connection reset'))

    const { shopifyGraphQL } = await import('../lib/shopify/client')

    await expect(shopifyGraphQL(OAUTH_BRAND_CFG, '{ orders }')).rejects.toThrow(
      /Error de red en GraphQL/
    )
  })

  it('con auth=static usa el token directamente (NO llama al endpoint OAuth)', async () => {
    // Solo una llamada a fetch (la GraphQL), sin el paso de token OAuth
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { result: 42 } }))

    const { shopifyGraphQL } = await import('../lib/shopify/client')
    const result = await shopifyGraphQL<{ result: number }>(STATIC_BRAND_CFG, '{ result }')

    expect(result).toEqual({ result: 42 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['X-Shopify-Access-Token']).toBe(
      'shpat_test_token'
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// ShopifyOrderSource.findOrder — fan-out + filtro sourceIdentifier
// ═════════════════════════════════════════════════════════════════════════════

describe('ShopifyOrderSource.findOrder', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    // Por defecto: una marca estática configurada
    await setBrands([STATIC_BRAND_CFG])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('devuelve null cuando la tienda responde sin pedidos (0 matches)', async () => {
    // Dos queries a la misma tienda (quoted + unquoted), ambas sin resultados.
    // IMPORTANTE: usar mockResolvedValueOnce para cada llamada — una misma instancia
    // de Response no puede leerse dos veces (stream de body ya consumido).
    fetchMock
      .mockResolvedValueOnce(gqlOrderResponse([]))  // primera query (quoted)
      .mockResolvedValueOnce(gqlOrderResponse([]))  // segunda query (unquoted fallback)

    const { ShopifyOrderSource } = await import('../lib/order-source/shopify')
    const source = new ShopifyOrderSource()

    const result = await source.findOrder({ orderNumber: '15-5333', verifier: '' })
    expect(result).toBeNull()
  })

  it('devuelve el pedido cuando el sourceIdentifier termina en "-{folio}"', async () => {
    const order = makeShopifyOrder({ sourceIdentifier: '61103865937-15-5333' })
    fetchMock.mockResolvedValueOnce(gqlOrderResponse([order]))

    const { ShopifyOrderSource } = await import('../lib/order-source/shopify')
    const result = await new ShopifyOrderSource().findOrder({ orderNumber: '15-5333', verifier: '' })

    expect(result).not.toBeNull()
    expect(result!.orderNumber).toBe('#45371')
    expect(result!.storeName).toBe('Sucursal Nogales')
  })

  it('coincidencia exacta: sourceIdentifier === folio completo', async () => {
    const order = makeShopifyOrder({ sourceIdentifier: '15-5333' })
    fetchMock.mockResolvedValueOnce(gqlOrderResponse([order]))

    const { ShopifyOrderSource } = await import('../lib/order-source/shopify')
    const result = await new ShopifyOrderSource().findOrder({ orderNumber: '15-5333', verifier: '' })

    expect(result).not.toBeNull()
  })

  it('normaliza el folio: trim + quitar # + uppercase', async () => {
    const order = makeShopifyOrder({ sourceIdentifier: '61103865937-15-5333' })
    fetchMock.mockResolvedValueOnce(gqlOrderResponse([order]))

    const { ShopifyOrderSource } = await import('../lib/order-source/shopify')
    // El cliente pasa '  #15-5333  ' — debe normalizarse a '15-5333'
    const result = await new ShopifyOrderSource().findOrder({
      orderNumber: '  #15-5333  ',
      verifier:    '',
    })

    expect(result).not.toBeNull()
  })

  it('usa el label de la marca como storeName cuando physicalLocation es null', async () => {
    const order = makeShopifyOrder({
      sourceIdentifier: 'dev-15-5333',
      physicalLocation: null,
    })
    fetchMock.mockResolvedValueOnce(gqlOrderResponse([order]))

    const { ShopifyOrderSource } = await import('../lib/order-source/shopify')
    const result = await new ShopifyOrderSource().findOrder({ orderNumber: '15-5333', verifier: '' })

    expect(result?.storeName).toBe(STATIC_BRAND_CFG.label)
  })

  it('tolera fallos parciales: una marca falla, la otra responde → devuelve el pedido', async () => {
    await setBrands([STATIC_BRAND_CFG, STATIC_BRAND_CFG])

    const order = makeShopifyOrder({ sourceIdentifier: 'dev-15-5333' })
    fetchMock
      .mockResolvedValueOnce(gqlOrderResponse([order]))   // Marca 1 → match
      .mockRejectedValueOnce(new TypeError('connection refused')) // Marca 2 → falla

    const { ShopifyOrderSource } = await import('../lib/order-source/shopify')
    const result = await new ShopifyOrderSource().findOrder({ orderNumber: '15-5333', verifier: '' })

    expect(result).not.toBeNull()
  })

  it('lanza cuando TODAS las tiendas fallan', async () => {
    await setBrands([STATIC_BRAND_CFG, STATIC_BRAND_CFG])
    fetchMock.mockRejectedValue(new TypeError('connection refused'))

    const { ShopifyOrderSource } = await import('../lib/order-source/shopify')

    await expect(
      new ShopifyOrderSource().findOrder({ orderNumber: '99-9999', verifier: '' })
    ).rejects.toThrow(/Todas las tiendas configuradas fallaron/)
  })

  it('lanza cuando no hay marcas configuradas', async () => {
    await setBrands([])

    const { ShopifyOrderSource } = await import('../lib/order-source/shopify')

    await expect(
      new ShopifyOrderSource().findOrder({ orderNumber: '15-5333', verifier: '' })
    ).rejects.toThrow(/No hay ninguna marca Shopify configurada/)
  })

  it('usa la segunda query (sin comillas) cuando la primera no produce match', async () => {
    const order = makeShopifyOrder({ sourceIdentifier: 'dev-15-5333' })
    fetchMock
      .mockResolvedValueOnce(gqlOrderResponse([]))    // primera query: sin match
      .mockResolvedValueOnce(gqlOrderResponse([order])) // segunda query: con match

    const { ShopifyOrderSource } = await import('../lib/order-source/shopify')
    const result = await new ShopifyOrderSource().findOrder({ orderNumber: '15-5333', verifier: '' })

    expect(result).not.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('>1 matches (folio en más de una tienda) → devuelve el primero, emite warn', async () => {
    await setBrands([STATIC_BRAND_CFG, STATIC_BRAND_CFG])

    const order1 = makeShopifyOrder({ id: 'gid://Order/1', sourceIdentifier: 'dev-15-5333' })
    const order2 = makeShopifyOrder({ id: 'gid://Order/2', sourceIdentifier: 'dev-15-5333' })

    fetchMock
      .mockResolvedValueOnce(gqlOrderResponse([order1])) // Marca 1 → match
      .mockResolvedValueOnce(gqlOrderResponse([order2])) // Marca 2 → match también

    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { ShopifyOrderSource } = await import('../lib/order-source/shopify')
    const result = await new ShopifyOrderSource().findOrder({ orderNumber: '15-5333', verifier: '' })

    expect(result).not.toBeNull()
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('más de una tienda'))

    consoleWarn.mockRestore()
  })

  it('normaliza correctamente los campos del pedido (totales, líneas, descuentos)', async () => {
    const order = makeShopifyOrder({
      sourceIdentifier: 'dev-FOLIO-42',
      lineItems: [
        {
          title:    'Producto Test',
          quantity: 2,
          sku:      'TEST-SKU',
          originalUnitPriceSet:  { shopMoney: { amount: '50.00', currencyCode: 'MXN' } },
          discountedUnitPriceSet:{ shopMoney: { amount: '45.00', currencyCode: 'MXN' } },
          taxLines: [{ rate: 0.16 }],
        },
      ],
    })
    fetchMock.mockResolvedValueOnce(gqlOrderResponse([order]))

    const { ShopifyOrderSource } = await import('../lib/order-source/shopify')
    const result = await new ShopifyOrderSource().findOrder({ orderNumber: 'FOLIO-42', verifier: '' })

    expect(result).not.toBeNull()
    expect(result!.total).toBe(116)
    expect(result!.lines).toHaveLength(1)
    expect(result!.lines[0].description).toBe('Producto Test')
    expect(result!.lines[0].quantity).toBe(2)
    expect(result!.lines[0].unitPrice).toBe(50)
    expect(result!.lines[0].discount).toBe(5) // 50 - 45 = 5 por unidad
    expect(result!.lines[0].unitPriceIncludesTax).toBe(true)
  })
})
