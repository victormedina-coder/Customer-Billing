/**
 * Tests de FacturamaGlobalStamping (adapter del puerto GlobalInvoiceStamping,
 * Paso 4). Mismo patrón que facturama-client.test.ts: fetch mockeado +
 * vi.resetModules() para reimportar el módulo con env/config limpios en cada
 * test (evita contaminación del cache en memoria de getExpeditionPlace).
 *
 * FACTURAMA_EXPEDITION_PLACE se estabea como override explícito para no
 * depender de una segunda llamada de red (GET /TaxEntity) — ese mecanismo ya
 * está cubierto por los tests de facturamaClient/FacturamaInvoiceService.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { EmitGlobalInvoicePayload } from '../src/domain/global/ports/GlobalInvoiceStamping'
import type { MonthlyOrder } from '../src/domain/global/ports/MonthlyOrderSource'
import type { Order } from '../src/domain/orders/Order'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const FAKE_USER = 'testuser'
const FAKE_PASS = 'testpass'

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    orderNumber: '#1001',
    createdAt: '2026-06-15T12:00:00Z',
    currency: 'MXN',
    subtotal: 100,
    taxAmount: 16,
    total: 116,
    discountAmount: 0,
    shippingAmount: 0,
    lines: [{ description: 'Sombrero', quantity: 1, unitPrice: 116, taxRate: 0.16, taxObject: '02', discount: 0, productCode: 'SKU-1' }],
    customerEmail: 'cliente@example.com',
    alreadyInvoiced: false,
    storeName: 'tienda-ariat',
    refundedAmount: 0,
    financialStatus: 'PAID',
    sourceIdentifier: 'dev-1-1000',
    ...overrides,
  }
}

function makePayload(overrides: Partial<EmitGlobalInvoicePayload> = {}): EmitGlobalInvoicePayload {
  const orders: MonthlyOrder[] = overrides.orders ?? [{ order: makeOrder(), payments: [] }]
  return {
    storeName: 'tienda-ariat',
    periodYear: 2026,
    periodMonth: 6,
    paymentBucket: 'credito',
    itemCount: orders.length,
    orders,
    ...overrides,
  }
}

async function importAdapter() {
  vi.resetModules()
  return import('../src/infrastructure/facturama/FacturamaGlobalStamping')
}

describe('FacturamaGlobalStamping.emitirGlobal', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('FACTURAMA_USER', FAKE_USER)
    vi.stubEnv('FACTURAMA_PASS', FAKE_PASS)
    vi.stubEnv('FACTURAMA_ENV', 'sandbox')
    vi.stubEnv('FACTURAMA_EXPEDITION_PLACE', '26015')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('éxito: extrae facturamaId/uuidCfdi de la respuesta y llama a POST /3/cfdis', async () => {
    const { FacturamaGlobalStamping } = await importAdapter()
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        Id: 'GLOBAL-FACT-001',
        Complement: { TaxStamp: { Uuid: 'GLOBAL-UUID-001' } },
      })
    )

    const adapter = new FacturamaGlobalStamping()
    const result = await adapter.emitirGlobal(makePayload())

    expect(result).toEqual({ facturamaId: 'GLOBAL-FACT-001', uuidCfdi: 'GLOBAL-UUID-001' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/3/cfdis')
    expect(init.method).toBe('POST')
  })

  it('el body enviado es el payload global: GlobalInformation presente, sin OrderNumber', async () => {
    const { FacturamaGlobalStamping } = await importAdapter()
    fetchMock.mockResolvedValueOnce(jsonResponse({ Id: 'X', Complement: { TaxStamp: { Uuid: 'Y' } } }))

    const adapter = new FacturamaGlobalStamping()
    await adapter.emitirGlobal(makePayload({ paymentBucket: 'debito' }))

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.GlobalInformation).toEqual({ Periodicity: '04', Months: '06', Year: '2026' })
    expect(body.PaymentForm).toBe('28') // debito
    expect(body).not.toHaveProperty('OrderNumber')
    expect(body.Items).toHaveLength(1)
    expect(body.Receiver.Rfc).toBe('XAXX010101000')
  })

  it('un Item por cada pedido sobreviviente del chunk', async () => {
    const { FacturamaGlobalStamping } = await importAdapter()
    fetchMock.mockResolvedValueOnce(jsonResponse({ Id: 'X', Complement: { TaxStamp: { Uuid: 'Y' } } }))

    const orders: MonthlyOrder[] = [
      { order: makeOrder({ id: 'o1', orderNumber: '#1' }), payments: [] },
      { order: makeOrder({ id: 'o2', orderNumber: '#2' }), payments: [] },
    ]
    const adapter = new FacturamaGlobalStamping()
    await adapter.emitirGlobal(makePayload({ orders, itemCount: 2 }))

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.Items).toHaveLength(2)
  })

  it('fallo de validación (400 con Message) se propaga con statusCode', async () => {
    const { FacturamaGlobalStamping } = await importAdapter()
    fetchMock.mockResolvedValueOnce(jsonResponse({ Message: 'RFC de receptor no válido' }, 400))

    const adapter = new FacturamaGlobalStamping()
    await expect(adapter.emitirGlobal(makePayload())).rejects.toMatchObject({
      message: 'RFC de receptor no válido',
      statusCode: 400,
    })
  })

  it('fallo de red se propaga tal cual (sin envolver)', async () => {
    const { FacturamaGlobalStamping } = await importAdapter()
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))

    const adapter = new FacturamaGlobalStamping()
    await expect(adapter.emitirGlobal(makePayload())).rejects.toThrow('fetch failed')
  })

  it('periodDay presente → reconstruye un periodo DIARIO (Periodicity 01, mismo Months/Year del día)', async () => {
    const { FacturamaGlobalStamping } = await importAdapter()
    fetchMock.mockResolvedValueOnce(jsonResponse({ Id: 'X', Complement: { TaxStamp: { Uuid: 'Y' } } }))

    const adapter = new FacturamaGlobalStamping()
    await adapter.emitirGlobal(makePayload({ periodDay: 15 }))

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.GlobalInformation).toEqual({ Periodicity: '01', Months: '06', Year: '2026' })
  })

  it('periodDay ausente → sigue reconstruyendo un periodo MENSUAL (Periodicity 04, comportamiento intacto)', async () => {
    const { FacturamaGlobalStamping } = await importAdapter()
    fetchMock.mockResolvedValueOnce(jsonResponse({ Id: 'X', Complement: { TaxStamp: { Uuid: 'Y' } } }))

    const adapter = new FacturamaGlobalStamping()
    await adapter.emitirGlobal(makePayload())

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.GlobalInformation.Periodicity).toBe('04')
  })

  it('el body NO manda Folio: Facturama lo asigna e incrementa por Serie', async () => {
    const { FacturamaGlobalStamping } = await importAdapter()
    fetchMock.mockResolvedValueOnce(jsonResponse({ Id: 'X', Complement: { TaxStamp: { Uuid: 'Y' } } }))

    const adapter = new FacturamaGlobalStamping()
    await adapter.emitirGlobal(makePayload())

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).not.toHaveProperty('Folio')
  })

  it('el body lleva la Serie de la marca cuando storeName es una clave de marca', async () => {
    const { FacturamaGlobalStamping } = await importAdapter()
    fetchMock.mockResolvedValueOnce(jsonResponse({ Id: 'X', Complement: { TaxStamp: { Uuid: 'Y' } } }))

    const adapter = new FacturamaGlobalStamping()
    await adapter.emitirGlobal(makePayload({ storeName: 'western-brothers' }))

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body)).Serie).toBe('WB')
  })
})

describe('FacturamaGlobalStamping.emitirGlobal — serieFolio de la respuesta', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('FACTURAMA_USER', FAKE_USER)
    vi.stubEnv('FACTURAMA_PASS', FAKE_PASS)
    vi.stubEnv('FACTURAMA_ENV', 'sandbox')
    vi.stubEnv('FACTURAMA_EXPEDITION_PLACE', '26015')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('Series + Folio de la respuesta se componen como "SERIE-FOLIO"', async () => {
    const { FacturamaGlobalStamping } = await importAdapter()
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ Id: 'X', Series: 'GDL1', Folio: '7461', Complement: { TaxStamp: { Uuid: 'Y' } } })
    )

    const adapter = new FacturamaGlobalStamping()
    const result = await adapter.emitirGlobal(makePayload())

    expect(result.serieFolio).toBe('GDL1-7461')
  })

  it('solo Folio (sin Series) → se usa el folio a secas', async () => {
    const { FacturamaGlobalStamping } = await importAdapter()
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ Id: 'X', Folio: '7461', Complement: { TaxStamp: { Uuid: 'Y' } } })
    )

    const adapter = new FacturamaGlobalStamping()
    const result = await adapter.emitirGlobal(makePayload())

    expect(result.serieFolio).toBe('7461')
  })

  it('respuesta sin Series ni Folio → serieFolio undefined (nunca cadena vacía)', async () => {
    const { FacturamaGlobalStamping } = await importAdapter()
    fetchMock.mockResolvedValueOnce(jsonResponse({ Id: 'X', Complement: { TaxStamp: { Uuid: 'Y' } } }))

    const adapter = new FacturamaGlobalStamping()
    const result = await adapter.emitirGlobal(makePayload())

    expect(result.serieFolio).toBeUndefined()
  })
})
