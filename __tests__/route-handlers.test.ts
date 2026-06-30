/**
 * Tests de integración de los route handlers (Paso 0 — red de seguridad).
 *
 * Estrategia: vi.mock de todos los puertos externos + vi.mocked().mockImplementation()
 * en cada test para controlar el comportamiento. Los handlers se importan una vez
 * (los vi.mock ya están en su lugar antes del import).
 *
 * Estos tests clavitan el COMPORTAMIENTO ACTUAL de cada handler:
 *   - mapa error → código HTTP
 *   - envelope de error: { error: { code, message } }
 *   - envelope de éxito
 *
 * Handlers cubiertos:
 *   1. POST /api/invoice/emit
 *   2. POST /api/invoice/lookup
 *   3. POST /api/invoice/resend
 *   4. GET  /api/invoice/download/[invoiceId]/[format]
 *   5. POST /api/fiscal/validate
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NormalizedOrderWithPayment } from '../lib/shopify/mapper'
import type { InvoiceRow } from '../lib/db/invoice-repository'
import type { EmitResult } from '../lib/invoice-service/types'

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const VALID_ORDER: NormalizedOrderWithPayment = {
  id:               'gid://shopify/Order/12345',
  orderNumber:      '#45371',
  createdAt:        new Date().toISOString(),
  currency:         'MXN',
  subtotal:         100,
  taxAmount:        16,
  total:            116,
  discountAmount:   0,
  shippingAmount:   0,
  lines: [{
    description:          'Sombrero',
    quantity:             1,
    unitPrice:            100,
    unitPriceIncludesTax: true,
    discount:             0,
    productCode:          'STT-001',
  }],
  customerEmail:    'cliente@example.com',
  alreadyInvoiced:  false,
  storeName:        'Tienda Ariat Nogales',
  refundedAmount:   0,
  financialStatus:  'PAID',
  paymentGatewayNames: ['cash'],
}

const VALID_FISCAL = {
  rfc:    'EKU9003173C9',
  razon:  'ESCUELA KEMPER URGATE',
  regimen:'601',
  cp:     '26015',
  uso:    'G01',
  email:  'cliente@example.com',
}

const FAKE_EMIT_RESULT: EmitResult = {
  facturamaId: 'FACT-ABC-123',
  uuid:        'UUID-12345678-1234-1234-1234-123456789012',
  serieFolio:  'GR-100001',
  fecha:       '01/06/2026 10:30',
  sello:       'sello-base64-fake',
  emisor:      { rfc: 'XAXX010101000', nombre: 'EMISOR DEMO', regimen: '601' },
}

function makeInvoiceRow(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id:          overrides.id          ?? 'handler-invoice-id',
    orderId:     overrides.orderId     ?? 'gid://shopify/Order/12345',
    orderNumber: overrides.orderNumber ?? '#45371',
    storeName:   overrides.storeName   ?? 'Tienda Ariat Nogales',
    facturamaId: overrides.facturamaId !== undefined ? overrides.facturamaId : 'FACT-ABC-123',
    uuidCfdi:    overrides.uuidCfdi    !== undefined ? overrides.uuidCfdi    : 'UUID-OK',
    rfcReceptor: overrides.rfcReceptor ?? 'EKU9003173C9',
    razonSocial: overrides.razonSocial ?? 'ESCUELA KEMPER URGATE',
    email:       overrides.email       !== undefined ? overrides.email        : 'cliente@example.com',
    status:      overrides.status      ?? 'emitted',
    invoiceType: overrides.invoiceType ?? 'individual',
    paymentType: overrides.paymentType ?? null,
    createdAt:   overrides.createdAt   ?? new Date(),
    cancelledAt: overrides.cancelledAt ?? null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// vi.mock — módulos externos reemplazados con vi.fn()
// Se reconfigura con vi.mocked().mockImplementation() en cada test
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../lib/rate-limit', () => ({
  rateLimit:   vi.fn(async () => ({ allowed: true, remaining: 10, retryAfter: 0 })),
  getClientIp: vi.fn(() => 'test-ip'),
  RATE_LIMITS: {
    lookup:   { max: 20, windowSec: 60 },
    emit:     { max: 5,  windowSec: 60 },
    fiscal:   { max: 15, windowSec: 60 },
    resend:   { max: 5,  windowSec: 60 },
    download: { max: 40, windowSec: 60 },
    // Segundo factor: rate limit por folio para validación de monto
    validate: { max: 5,  windowSec: 900 },
  },
}))

vi.mock('../lib/order-source', async () => ({
  getOrderSource: vi.fn(() => ({ findOrder: vi.fn(async () => VALID_ORDER) })),
}))

vi.mock('../lib/db/invoice-repository', async () => ({
  isAlreadyInvoiced:  vi.fn(async () => false),
  createInvoice:      vi.fn(async () => ({ created: true, invoice: makeInvoiceRow() })),
  updateInvoiceStamp: vi.fn(async () => makeInvoiceRow()),
  deleteById:         vi.fn(async () => {}),
  findById:           vi.fn(async () => makeInvoiceRow()),
}))

vi.mock('../lib/invoice-service', async () => ({
  getInvoiceService: vi.fn(() => ({
    emitir:       vi.fn(async () => FAKE_EMIT_RESULT),
    enviarCorreo: vi.fn(async () => {}),
    descargar:    vi.fn(async () => Buffer.from('fake-pdf')),
    obtener:      vi.fn(async () => ({})),
    cancelar:     vi.fn(async () => {}),
  })),
}))

vi.mock('../lib/invoice-service/facturama-client', async () => ({
  validarRfc:      vi.fn(async () => true),
  validarReceptor: vi.fn(async () => ({
    Rfc: 'EKU9003173C9', ExistRfc: true, MatchName: true,
    MatchZipCode: true, MatchFiscalRegime: true,
  })),
}))

vi.mock('../lib/log-redact', () => ({
  maskEmail: vi.fn((e: string) => e),
  maskRfc:   vi.fn((r: string) => r),
}))

// ─────────────────────────────────────────────────────────────────────────────
// Referencias a los módulos mockeados para reconfigurarlo en cada test
// ─────────────────────────────────────────────────────────────────────────────

let dbRepo:         typeof import('../lib/db/invoice-repository')
let orderSrcMod:    typeof import('../lib/order-source')
let invoiceSvcMod:  typeof import('../lib/invoice-service')
let facturaMod:     typeof import('../lib/invoice-service/facturama-client')

// ─────────────────────────────────────────────────────────────────────────────
// Handlers — importados después de los vi.mock
// ─────────────────────────────────────────────────────────────────────────────

let emitHandler:     typeof import('../app/api/invoice/emit/route')['POST']
let lookupHandler:   typeof import('../app/api/invoice/lookup/route')['POST']
let resendHandler:   typeof import('../app/api/invoice/resend/route')['POST']
let downloadHandler: typeof import('../app/api/invoice/download/[invoiceId]/[format]/route')['GET']
let validateHandler: typeof import('../app/api/fiscal/validate/route')['POST']

beforeEach(async () => {
  // Deshabilitar el mock de emit para que los tests de negocio validen el flujo real.
  // El .env del proyecto tiene EMIT_MOCK=true (modo dev), pero en tests necesitamos
  // el flujo completo salvo el test específico que verifica el comportamiento del mock.
  vi.stubEnv('EMIT_MOCK', 'false')

  // Importar referencias a módulos mockeados
  dbRepo        = await import('../lib/db/invoice-repository')
  orderSrcMod   = await import('../lib/order-source')
  invoiceSvcMod = await import('../lib/invoice-service')
  facturaMod    = await import('../lib/invoice-service/facturama-client')

  // Importar handlers
  const [emitMod, lookupMod, resendMod, downloadMod, validateMod] = await Promise.all([
    import('../app/api/invoice/emit/route'),
    import('../app/api/invoice/lookup/route'),
    import('../app/api/invoice/resend/route'),
    import('../app/api/invoice/download/[invoiceId]/[format]/route'),
    import('../app/api/fiscal/validate/route'),
  ])
  emitHandler     = emitMod.POST
  lookupHandler   = lookupMod.POST
  resendHandler   = resendMod.POST
  downloadHandler = downloadMod.GET
  validateHandler = validateMod.POST

  // Restaurar comportamiento por defecto (flujo feliz)
  vi.mocked(orderSrcMod.getOrderSource).mockReturnValue({
    findOrder: vi.fn(async () => VALID_ORDER),
  })
  vi.mocked(dbRepo.isAlreadyInvoiced).mockImplementation(async () => false)
  vi.mocked(dbRepo.createInvoice).mockImplementation(async () => ({
    created: true as const,
    invoice: makeInvoiceRow(),
  }))
  vi.mocked(dbRepo.updateInvoiceStamp).mockImplementation(async () => makeInvoiceRow())
  vi.mocked(dbRepo.deleteById).mockImplementation(async () => {})
  vi.mocked(dbRepo.findById).mockImplementation(async () => makeInvoiceRow())
  vi.mocked(invoiceSvcMod.getInvoiceService).mockReturnValue({
    emitir:       vi.fn(async () => FAKE_EMIT_RESULT),
    enviarCorreo: vi.fn(async () => {}),
    descargar:    vi.fn(async () => Buffer.from('fake-pdf')),
    obtener:      vi.fn(async () => ({})),
    cancelar:     vi.fn(async () => {}),
  })
  vi.mocked(facturaMod.validarRfc).mockImplementation(async () => true)
  vi.mocked(facturaMod.validarReceptor).mockImplementation(async () => ({
    Rfc: 'EKU9003173C9', ExistRfc: true, MatchName: true,
    MatchZipCode: true, MatchFiscalRegime: true,
  }))
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makePostRequest(body: unknown, url = 'http://localhost/api/test'): Request {
  return new Request(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

/** Configura el findOrder dentro del stub de getOrderSource */
function mockFindOrder(impl: () => Promise<NormalizedOrderWithPayment | null>) {
  vi.mocked(orderSrcMod.getOrderSource).mockReturnValue({
    findOrder: vi.fn(impl),
  })
}

/** Configura emitir/enviarCorreo dentro del stub de getInvoiceService */
function mockInvoiceService(overrides: {
  emitir?:       () => Promise<EmitResult>
  enviarCorreo?: (...args: unknown[]) => Promise<void>
  descargar?:    (...args: unknown[]) => Promise<Buffer>
}) {
  vi.mocked(invoiceSvcMod.getInvoiceService).mockReturnValue({
    emitir:       vi.fn(overrides.emitir       ?? (async () => FAKE_EMIT_RESULT)),
    enviarCorreo: vi.fn(overrides.enviarCorreo ?? (async () => {})),
    descargar:    vi.fn(overrides.descargar    ?? (async () => Buffer.from('fake-pdf'))),
    obtener:      vi.fn(async () => ({})),
    cancelar:     vi.fn(async () => {}),
  })
}

async function parseJson(res: Response): Promise<unknown> {
  return res.json()
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. POST /api/invoice/emit
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/invoice/emit', () => {
  // amount: 116 coincide con VALID_ORDER.total = 116
  const validBody = { folio: '15-5333', amount: 116, fiscal: VALID_FISCAL }

  it('200 con envelope { factura } en flujo feliz', async () => {
    const req = makePostRequest(validBody)
    const res = await emitHandler(req as never)

    expect(res.status).toBe(200)
    const body = await parseJson(res) as { factura: EmitResult & { invoiceId: string } }
    expect(body.factura).toBeDefined()
    expect(body.factura.uuid).toBe(FAKE_EMIT_RESULT.uuid)
    expect(body.factura.serieFolio).toBe(FAKE_EMIT_RESULT.serieFolio)
    expect(body.factura.invoiceId).toBeTruthy()
  })

  it('400 FISCAL_INVALID cuando el body no pasa validación Zod', async () => {
    const req = makePostRequest({ folio: '15-5333', amount: 116, fiscal: { rfc: 'invalido' } })
    const res = await emitHandler(req as never)

    expect(res.status).toBe(400)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('FISCAL_INVALID')
  })

  it('400 INVALID_BODY cuando el body no es JSON', async () => {
    const req = new Request('http://localhost/api/invoice/emit', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    'not-json{{{',
    })
    const res = await emitHandler(req as never)

    expect(res.status).toBe(400)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('INVALID_BODY')
  })

  it('400 INVALID_FOLIO cuando folio es solo espacios', async () => {
    const req = makePostRequest({ folio: '   ', amount: 116, fiscal: VALID_FISCAL })
    const res = await emitHandler(req as never)

    expect(res.status).toBe(400)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('INVALID_FOLIO')
  })

  it('404 ORDER_NOT_FOUND cuando Shopify no encuentra el pedido', async () => {
    mockFindOrder(async () => null)

    const req = makePostRequest(validBody)
    const res = await emitHandler(req as never)

    expect(res.status).toBe(404)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('ORDER_NOT_FOUND')
  })

  it('409 ALREADY_INVOICED cuando isAlreadyInvoiced devuelve true', async () => {
    vi.mocked(dbRepo.isAlreadyInvoiced).mockImplementation(async () => true)

    const req = makePostRequest(validBody)
    const res = await emitHandler(req as never)

    expect(res.status).toBe(409)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('ALREADY_INVOICED')
  })

  it('409 ALREADY_INVOICED cuando createInvoice devuelve created:false (carrera)', async () => {
    vi.mocked(dbRepo.createInvoice).mockImplementation(async () => ({
      created: false as const,
      reason: 'already_invoiced' as const,
    }))

    const req = makePostRequest(validBody)
    const res = await emitHandler(req as never)

    expect(res.status).toBe(409)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('ALREADY_INVOICED')
  })

  it('409 FULLY_REFUNDED cuando el pedido está reembolsado en su totalidad', async () => {
    mockFindOrder(async () => ({
      ...VALID_ORDER,
      refundedAmount: VALID_ORDER.total,
      financialStatus: 'REFUNDED',
    }))

    const req = makePostRequest(validBody)
    const res = await emitHandler(req as never)

    expect(res.status).toBe(409)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('FULLY_REFUNDED')
  })

  it('422 DEADLINE_EXCEEDED cuando el pedido está fuera de la ventana (mes pasado)', async () => {
    mockFindOrder(async () => ({
      ...VALID_ORDER,
      createdAt: new Date(
        new Date().getFullYear(),
        new Date().getMonth() - 1,
        15
      ).toISOString(),
    }))

    const req = makePostRequest(validBody)
    const res = await emitHandler(req as never)

    expect(res.status).toBe(422)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('DEADLINE_EXCEEDED')
  })

  it('502 SHOPIFY_ERROR cuando getOrderSource().findOrder lanza', async () => {
    mockFindOrder(async () => { throw new Error('[shopify] Todas las tiendas fallaron') })

    const req = makePostRequest(validBody)
    const res = await emitHandler(req as never)

    expect(res.status).toBe(502)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('SHOPIFY_ERROR')
  })

  it('503 FACTURAMA_ERROR cuando emitir() lanza', async () => {
    mockInvoiceService({
      emitir: async () => { throw new Error('Facturama rechazó el CFDI') },
    })

    const req = makePostRequest(validBody)
    const res = await emitHandler(req as never)

    expect(res.status).toBe(503)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('FACTURAMA_ERROR')
  })

  it('200 OK incluso cuando enviarCorreo lanza (correo es best-effort)', async () => {
    mockInvoiceService({
      enviarCorreo: async () => { throw new Error('SMTP failure') },
    })

    const req = makePostRequest(validBody)
    const res = await emitHandler(req as never)

    expect(res.status).toBe(200)
    const body = await parseJson(res) as { factura: unknown }
    expect(body.factura).toBeDefined()
  })

  it('el envelope de error tiene la forma { error: { code, message } }', async () => {
    mockFindOrder(async () => null)

    const req = makePostRequest(validBody)
    const res = await emitHandler(req as never)
    const body = await parseJson(res) as { error: { code: string; message: string } }

    expect(body.error).toHaveProperty('code')
    expect(body.error).toHaveProperty('message')
    expect(typeof body.error.code).toBe('string')
    expect(typeof body.error.message).toBe('string')
  })

  it('EMIT_MOCK=true devuelve 200 con CFDI falso sin llamar a Shopify', async () => {
    vi.stubEnv('EMIT_MOCK', 'true')
    mockFindOrder(async () => { throw new Error('No debería llamarse') })

    const req = makePostRequest(validBody)
    const res = await emitHandler(req as never)

    expect(res.status).toBe(200)
    const body = await parseJson(res) as { factura: { uuid: string } }
    expect(body.factura.uuid).toBeTruthy()

    vi.unstubAllEnvs()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 2. POST /api/invoice/lookup
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/invoice/lookup', () => {
  // amount: 116 coincide con VALID_ORDER.total = 116
  const validLookupBody = { folio: '15-5333', amount: 116 }

  it('200 con envelope { ticket } en flujo feliz', async () => {
    const req = makePostRequest(validLookupBody)
    const res = await lookupHandler(req as never)

    expect(res.status).toBe(200)
    const body = await parseJson(res) as { ticket: unknown }
    expect(body.ticket).toBeDefined()
  })

  it('422 VALIDATION_FAILED cuando folio está vacío tras trim', async () => {
    // El handler devuelve el error genérico para no distinguir casos al atacante
    const req = makePostRequest({ folio: '   ', amount: 116 })
    const res = await lookupHandler(req as never)

    expect(res.status).toBe(422)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('VALIDATION_FAILED')
  })

  it('400 INVALID_BODY cuando el body no es JSON', async () => {
    const req = new Request('http://localhost/api/invoice/lookup', {
      method: 'POST',
      body:   'bad-json',
    })
    const res = await lookupHandler(req as never)

    expect(res.status).toBe(400)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('INVALID_BODY')
  })

  it('422 VALIDATION_FAILED cuando el amount está ausente', async () => {
    // Sin amount el Zod falla → error genérico (no distingue al atacante si falta folio o amount)
    const req = makePostRequest({ folio: '15-5333' })
    const res = await lookupHandler(req as never)

    expect(res.status).toBe(422)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('VALIDATION_FAILED')
  })

  it('422 VALIDATION_FAILED cuando source.findOrder devuelve null', async () => {
    // Ya no es 404 ORDER_NOT_FOUND: el error genérico impide enumerar folios
    mockFindOrder(async () => null)

    const req = makePostRequest({ folio: '99-9999', amount: 116 })
    const res = await lookupHandler(req as never)

    expect(res.status).toBe(422)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('VALIDATION_FAILED')
  })

  it('422 VALIDATION_FAILED cuando el monto no coincide con el pedido', async () => {
    // El monto enviado difiere del total real → mismo error que "folio no encontrado"
    const req = makePostRequest({ folio: '15-5333', amount: 999.99 })
    const res = await lookupHandler(req as never)

    expect(res.status).toBe(422)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('VALIDATION_FAILED')
  })

  it('el mensaje de VALIDATION_FAILED es idéntico para folio-no-encontrado y monto-incorrecto', async () => {
    // Garantiza que los dos casos son byte-idénticos (no distinguibles por el atacante)
    mockFindOrder(async () => null)
    const resNoOrder = await lookupHandler(
      makePostRequest({ folio: '99-9999', amount: 116 }) as never
    )
    const bodyNoOrder = await parseJson(resNoOrder) as { error: { code: string; message: string } }

    mockFindOrder(async () => VALID_ORDER)
    const resWrongAmt = await lookupHandler(
      makePostRequest({ folio: '15-5333', amount: 999 }) as never
    )
    const bodyWrongAmt = await parseJson(resWrongAmt) as { error: { code: string; message: string } }

    expect(resNoOrder.status).toBe(422)
    expect(resWrongAmt.status).toBe(422)
    expect(bodyNoOrder.error.code).toBe(bodyWrongAmt.error.code)
    expect(bodyNoOrder.error.message).toBe(bodyWrongAmt.error.message)
  })

  it('409 FULLY_REFUNDED cuando el pedido está reembolsado', async () => {
    mockFindOrder(async () => ({ ...VALID_ORDER, refundedAmount: VALID_ORDER.total }))

    const req = makePostRequest(validLookupBody)
    const res = await lookupHandler(req as never)

    expect(res.status).toBe(409)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('FULLY_REFUNDED')
  })

  it('409 ALREADY_INVOICED cuando el pedido ya tiene CFDI', async () => {
    vi.mocked(dbRepo.isAlreadyInvoiced).mockImplementation(async () => true)

    const req = makePostRequest(validLookupBody)
    const res = await lookupHandler(req as never)

    expect(res.status).toBe(409)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('ALREADY_INVOICED')
  })

  it('422 DEADLINE_EXCEEDED cuando pedido está fuera de la ventana', async () => {
    mockFindOrder(async () => ({
      ...VALID_ORDER,
      createdAt: new Date(
        new Date().getFullYear(),
        new Date().getMonth() - 1,
        15
      ).toISOString(),
    }))

    const req = makePostRequest(validLookupBody)
    const res = await lookupHandler(req as never)

    expect(res.status).toBe(422)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('DEADLINE_EXCEEDED')
  })

  it('502 SHOPIFY_ERROR cuando findOrder lanza', async () => {
    mockFindOrder(async () => { throw new Error('[shopify] todas fallaron') })

    const req = makePostRequest(validLookupBody)
    const res = await lookupHandler(req as never)

    expect(res.status).toBe(502)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('SHOPIFY_ERROR')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 3. POST /api/invoice/resend
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/invoice/resend', () => {
  const validInvoiceId = crypto.randomUUID()

  it('200 { ok: true } en flujo feliz', async () => {
    vi.mocked(dbRepo.findById).mockImplementation(async () => makeInvoiceRow({ id: validInvoiceId }))

    const req = makePostRequest({ invoiceId: validInvoiceId })
    const res = await resendHandler(req as never)

    expect(res.status).toBe(200)
    const body = await parseJson(res) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  it('400 INVALID_BODY cuando invoiceId no es UUID', async () => {
    const req = makePostRequest({ invoiceId: 'no-es-uuid' })
    const res = await resendHandler(req as never)

    expect(res.status).toBe(400)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('INVALID_BODY')
  })

  it('400 INVALID_BODY cuando el body no es JSON', async () => {
    const req = new Request('http://localhost/api/invoice/resend', {
      method: 'POST',
      body:   '{{invalid}}',
    })
    const res = await resendHandler(req as never)

    expect(res.status).toBe(400)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('INVALID_BODY')
  })

  it('404 NOT_FOUND cuando findById devuelve null', async () => {
    vi.mocked(dbRepo.findById).mockImplementation(async () => null)

    const req = makePostRequest({ invoiceId: validInvoiceId })
    const res = await resendHandler(req as never)

    expect(res.status).toBe(404)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('404 NOT_FOUND cuando la fila existe pero no tiene facturamaId', async () => {
    vi.mocked(dbRepo.findById).mockImplementation(async () => makeInvoiceRow({ facturamaId: null }))

    const req = makePostRequest({ invoiceId: validInvoiceId })
    const res = await resendHandler(req as never)

    expect(res.status).toBe(404)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('422 NO_EMAIL cuando la fila no tiene email guardado', async () => {
    vi.mocked(dbRepo.findById).mockImplementation(async () => makeInvoiceRow({ email: null }))

    const req = makePostRequest({ invoiceId: validInvoiceId })
    const res = await resendHandler(req as never)

    expect(res.status).toBe(422)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('NO_EMAIL')
  })

  it('503 EMAIL_ERROR cuando enviarCorreo lanza', async () => {
    vi.mocked(dbRepo.findById).mockImplementation(async () => makeInvoiceRow({ id: validInvoiceId }))
    mockInvoiceService({
      enviarCorreo: async () => { throw new Error('SMTP timeout') },
    })

    const req = makePostRequest({ invoiceId: validInvoiceId })
    const res = await resendHandler(req as never)

    expect(res.status).toBe(503)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('EMAIL_ERROR')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 4. GET /api/invoice/download/[invoiceId]/[format]
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/invoice/download/[invoiceId]/[format]', () => {
  const validId = crypto.randomUUID()

  async function callDownload(invoiceId: string, format: string) {
    const req = new Request(
      `http://localhost/api/invoice/download/${invoiceId}/${format}`,
      { method: 'GET' }
    )
    return downloadHandler(req as never, {
      params: Promise.resolve({ invoiceId, format }),
    })
  }

  it('200 con binario y headers correctos para PDF', async () => {
    const pdfContent = Buffer.from('%PDF-1.4 fake')
    mockInvoiceService({ descargar: async () => pdfContent })

    const res = await callDownload(validId, 'pdf')

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toContain('attachment')
    expect(res.headers.get('Content-Disposition')).toContain('.pdf')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('200 con Content-Type correcto para XML', async () => {
    const xmlContent = Buffer.from('<cfdi:Comprobante/>')
    mockInvoiceService({ descargar: async () => xmlContent })

    const res = await callDownload(validId, 'xml')

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/xml')
    expect(res.headers.get('Content-Disposition')).toContain('.xml')
  })

  it('400 INVALID_ID cuando invoiceId no es UUID', async () => {
    const res = await callDownload('not-a-uuid', 'pdf')

    expect(res.status).toBe(400)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('INVALID_ID')
  })

  it('400 FORMAT_INVALID cuando el formato no es pdf ni xml', async () => {
    const res = await callDownload(validId, 'doc')

    expect(res.status).toBe(400)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('FORMAT_INVALID')
  })

  it('404 NOT_FOUND cuando findById devuelve null', async () => {
    vi.mocked(dbRepo.findById).mockImplementation(async () => null)

    const res = await callDownload(validId, 'pdf')

    expect(res.status).toBe(404)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('404 NOT_FOUND cuando la fila no tiene facturamaId', async () => {
    vi.mocked(dbRepo.findById).mockImplementation(async () => makeInvoiceRow({ facturamaId: null }))

    const res = await callDownload(validId, 'pdf')

    expect(res.status).toBe(404)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('502 DOWNLOAD_ERROR cuando Facturama devuelve error 4xx', async () => {
    const err = Object.assign(new Error('Not found in Facturama'), { statusCode: 404 })
    mockInvoiceService({ descargar: async () => { throw err } })

    const res = await callDownload(validId, 'pdf')

    expect(res.status).toBe(502)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('DOWNLOAD_ERROR')
  })

  it('503 SERVICE_ERROR cuando descargar lanza sin statusCode', async () => {
    mockInvoiceService({ descargar: async () => { throw new Error('connection timeout') } })

    const res = await callDownload(validId, 'pdf')

    expect(res.status).toBe(503)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('SERVICE_ERROR')
  })

  it('el nombre de archivo en Content-Disposition no contiene separadores de ruta', async () => {
    // Si uuidCfdi contiene '/' → el regex del handler los debe eliminar
    vi.mocked(dbRepo.findById).mockImplementation(async () =>
      makeInvoiceRow({ uuidCfdi: 'UUID-1234/safe-name/test' })
    )

    const res = await callDownload(validId, 'pdf')

    const disposition = res.headers.get('Content-Disposition') ?? ''
    expect(disposition).not.toContain('/safe-name/')
    expect(disposition).toContain('attachment')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 5. POST /api/fiscal/validate
// Contrato nuevo: body { rfc, name, zipCode, fiscalRegime } requeridos.
// Respuesta de éxito: { valid: boolean } — sin granulares, sin modo.
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/fiscal/validate', () => {
  // Body completo válido para el flujo feliz
  const validFullBody = {
    rfc:          'EKU9003173C9',
    name:         'ESCUELA KEMPER URGATE',
    zipCode:      '26015',
    fiscalRegime: '601',
  }

  it('200 { valid: true } cuando todos los campos coinciden con el SAT', async () => {
    // validarReceptor ya devuelve todos los Match en true por defecto (beforeEach)
    const req = makePostRequest(validFullBody)
    const res = await validateHandler(req as never)

    expect(res.status).toBe(200)
    const body = await parseJson(res) as { valid: boolean }
    expect(body.valid).toBe(true)
    // No deben viajar granulares al cliente
    expect(body).not.toHaveProperty('existsRfc')
    expect(body).not.toHaveProperty('matchName')
    expect(body).not.toHaveProperty('matchZipCode')
    expect(body).not.toHaveProperty('matchFiscalRegime')
    expect(body).not.toHaveProperty('mode')
  })

  it('200 { valid: false } cuando algún campo no coincide (colapso server-side)', async () => {
    // Simula que el nombre no coincide: ExistRfc true pero MatchName false
    vi.mocked(facturaMod.validarReceptor).mockImplementation(async () => ({
      Rfc: 'EKU9003173C9', ExistRfc: true, MatchName: false,
      MatchZipCode: true, MatchFiscalRegime: true,
    }))

    const req = makePostRequest(validFullBody)
    const res = await validateHandler(req as never)

    expect(res.status).toBe(200)
    const body = await parseJson(res) as { valid: boolean }
    expect(body.valid).toBe(false)
    // El cliente NO sabe qué campo falló
    expect(body).not.toHaveProperty('matchName')
    expect(body).not.toHaveProperty('existsRfc')
  })

  it('200 { valid: false } cuando el RFC no existe en el SAT', async () => {
    vi.mocked(facturaMod.validarReceptor).mockImplementation(async () => ({
      Rfc: 'XAXX010101000', ExistRfc: false, MatchName: false,
      MatchZipCode: false, MatchFiscalRegime: false,
    }))

    const req = makePostRequest({ ...validFullBody, rfc: 'XAXX010101000' })
    const res = await validateHandler(req as never)

    expect(res.status).toBe(200)
    const body = await parseJson(res) as { valid: boolean }
    // No se revela si el RFC existe — solo el booleano colapsado
    expect(body.valid).toBe(false)
    expect(body).not.toHaveProperty('existsRfc')
  })

  it('400 INVALID_RFC cuando el RFC no pasa el formato Zod', async () => {
    const req = makePostRequest({ ...validFullBody, rfc: 'invalido' })
    const res = await validateHandler(req as never)

    expect(res.status).toBe(400)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('INVALID_RFC')
  })

  it('400 INVALID_BODY cuando faltan campos requeridos (solo rfc)', async () => {
    // El modo "status" (solo rfc) ya no existe — body incompleto → INVALID_BODY genérico
    const req = makePostRequest({ rfc: 'EKU9003173C9' })
    const res = await validateHandler(req as never)

    expect(res.status).toBe(400)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('INVALID_BODY')
  })

  it('400 INVALID_BODY cuando el body no es JSON', async () => {
    const req = new Request('http://localhost/api/fiscal/validate', {
      method: 'POST',
      body:   'bad{',
    })
    const res = await validateHandler(req as never)

    expect(res.status).toBe(400)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('INVALID_BODY')
  })

  it('400 INVALID_BODY cuando faltan name, zipCode y fiscalRegime', async () => {
    const req = makePostRequest({ rfc: 'EKU9003173C9', name: 'Solo nombre' })
    const res = await validateHandler(req as never)

    expect(res.status).toBe(400)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('INVALID_BODY')
  })

  it('503 FACTURAMA_ERROR cuando validarReceptor lanza', async () => {
    vi.mocked(facturaMod.validarReceptor).mockImplementation(async () => {
      throw new Error('SAT no responde')
    })

    const req = makePostRequest(validFullBody)
    const res = await validateHandler(req as never)

    expect(res.status).toBe(503)
    const body = await parseJson(res) as { error: { code: string } }
    expect(body.error.code).toBe('FACTURAMA_ERROR')
  })

  it('envelope de error tiene { error: { code, message } }', async () => {
    const req = makePostRequest({ rfc: 'invalido', name: 'x', zipCode: '00000', fiscalRegime: '601' })
    const res = await validateHandler(req as never)
    const body = await parseJson(res) as { error: { code: string; message: string } }

    expect(body.error).toHaveProperty('code')
    expect(body.error).toHaveProperty('message')
  })
})
