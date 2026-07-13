/**
 * Tests de la orquestación del caso de uso Emit (Paso 0 — red de seguridad).
 *
 * Testa los INVARIANTES de negocio que hoy viven en el handler emit:
 *
 * 1. PATRÓN INSERT-FIRST:
 *    - createInvoice se llama antes de emitir()
 *    - quien pierde la carrera (created:false) → 409 sin llamar a emitir()
 *    - isAlreadyInvoiced=true → 409 sin llegar al INSERT
 *
 * 2. ROLLBACK EN FALLO DE TIMBRADO:
 *    - si emitir() lanza → deleteById(invoiceId) es llamado
 *    - si deleteById también falla → 503 de todas formas (error se loguea)
 *    - si emitir() tiene éxito → deleteById NO se llama
 *
 * 3. CORREO BEST-EFFORT:
 *    - enviarCorreo() falla → 200 de todas formas (CFDI ya timbrado)
 *    - updateInvoiceStamp() falla → 200 de todas formas
 *
 * 4. ORDEN DE VALIDACIONES (createInvoice no se llama hasta pasar todas):
 *    - ORDER_NOT_FOUND, FULLY_REFUNDED, DEADLINE_EXCEEDED, SHOPIFY_ERROR
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NormalizedOrderWithPayment } from '../src/domain/orders/Order'
import type { InvoiceRow } from '../src/infrastructure/db/invoice-repository'
import type { EmitResult } from '../src/domain/invoicing/ports/InvoiceStampingService'

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const ORDER_ID   = 'gid://shopify/Order/orch-test-1'
const STORE_NAME = 'Tienda Ariat Nogales'
const INVOICE_ID = 'orch-invoice-id-fixed'

const VALID_ORDER: NormalizedOrderWithPayment = {
  id:               ORDER_ID,
  orderNumber:      '#45371',
  createdAt:        new Date().toISOString(),
  currency:         'MXN',
  subtotal:         100,
  taxAmount:        16,
  total:            116,
  discountAmount:   0,
  shippingAmount:   0,
  lines: [{
    description:          'Sombrero Test',
    quantity:             1,
    unitPrice:            100,
    taxRate:              0.16,
    taxObject:            '02',
    discount:             0,
    productCode:          'TEST-001',
  }],
  customerEmail:    'cliente@example.com',
  alreadyInvoiced:  false,
  storeName:        STORE_NAME,
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

const EMIT_RESULT: EmitResult = {
  facturamaId: 'FACT-ORCH-001',
  uuid:        'UUID-ORCH-001',
  serieFolio:  'GR-200001',
  fecha:       '01/06/2026 10:30',
  sello:       'sello-orch-fake',
  emisor:      { rfc: 'XAXX010101000', nombre: 'EMISOR DEMO', regimen: '601' },
}

function makeInvoiceRow(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id:          overrides.id          ?? INVOICE_ID,
    orderId:     overrides.orderId     ?? ORDER_ID,
    orderNumber: overrides.orderNumber ?? '#45371',
    storeName:   overrides.storeName   ?? STORE_NAME,
    facturamaId: overrides.facturamaId !== undefined ? overrides.facturamaId : null,
    uuidCfdi:    overrides.uuidCfdi    ?? null,
    rfcReceptor: overrides.rfcReceptor ?? null,
    razonSocial: overrides.razonSocial ?? null,
    email:       overrides.email       ?? 'cliente@example.com',
    status:      overrides.status      ?? 'pending',
    invoiceType: overrides.invoiceType ?? 'individual',
    paymentType: overrides.paymentType ?? null,
    globalInvoiceId: overrides.globalInvoiceId ?? null,
    createdAt:   overrides.createdAt   ?? new Date(),
    cancelledAt: overrides.cancelledAt ?? null,
    privacyVersion: overrides.privacyVersion ?? null,
    termsVersion:   overrides.termsVersion   ?? null,
    consentAt:      overrides.consentAt      ?? null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// vi.mock — los módulos mockeados exponen vi.fn() que podemos controlar
// con vi.mocked(...).mockImplementation() en cada test
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../src/infrastructure/rate-limit', () => ({
  rateLimit:   vi.fn(async () => ({ allowed: true, remaining: 10, retryAfter: 0 })),
  getClientIp: vi.fn(() => 'test-ip'),
  RATE_LIMITS: {
    emit:     { max: 5, windowSec: 60 },
    validate: { max: 5, windowSec: 900 },
  },
}))

vi.mock('../src/composition/orderSource', async () => ({
  getOrderSource: vi.fn(() => ({ findOrder: vi.fn(async () => VALID_ORDER) })),
}))

vi.mock('../src/infrastructure/db/invoice-repository', async () => ({
  isAlreadyInvoiced:  vi.fn(async () => false),
  createInvoice:      vi.fn(async () => ({ created: true, invoice: makeInvoiceRow() })),
  updateInvoiceStamp: vi.fn(async () => makeInvoiceRow({ status: 'emitted' })),
  deleteById:         vi.fn(async () => {}),
  findById:           vi.fn(async () => null),
  reapIfStalePending: vi.fn(async () => false),
}))

vi.mock('../src/composition/invoiceService', async () => ({
  getInvoiceService: vi.fn(() => ({
    emitir:       vi.fn(async () => EMIT_RESULT),
    enviarCorreo: vi.fn(async () => {}),
  })),
}))

vi.mock('../src/infrastructure/observability/logRedact', () => ({
  maskEmail: vi.fn((e: string) => e),
  maskRfc:   vi.fn((r: string) => r),
}))

// ─────────────────────────────────────────────────────────────────────────────
// Setup: importar las factories de mocks y restaurar implementaciones por defecto
// ─────────────────────────────────────────────────────────────────────────────

let POST: (req: Request) => Promise<Response>

// Importamos los módulos mockeados para poder reconfigularlos por test
let dbRepo:          typeof import('../src/infrastructure/db/invoice-repository')
let orderSourceMod:  typeof import('../src/composition/orderSource')
let invoiceService:  typeof import('../src/composition/invoiceService')

beforeEach(async () => {
  // Deshabilitar mock de emit: el .env tiene EMIT_MOCK=true (modo dev),
  // pero estos tests deben ejercer el flujo de negocio real.
  vi.stubEnv('EMIT_MOCK', 'false')

  // Importar referencias a los módulos mockeados
  dbRepo          = await import('../src/infrastructure/db/invoice-repository')
  orderSourceMod  = await import('../src/composition/orderSource')
  invoiceService  = await import('../src/composition/invoiceService')

  // Restaurar mocks a comportamiento por defecto (flujo feliz)
  vi.mocked(orderSourceMod.getOrderSource).mockReturnValue({
    findOrder: vi.fn(async () => VALID_ORDER),
  })
  vi.mocked(dbRepo.isAlreadyInvoiced).mockImplementation(async () => false)
  vi.mocked(dbRepo.createInvoice).mockImplementation(async () => ({
    created: true as const,
    invoice: makeInvoiceRow(),
  }))
  vi.mocked(dbRepo.updateInvoiceStamp).mockImplementation(async () =>
    makeInvoiceRow({ status: 'emitted' })
  )
  vi.mocked(dbRepo.deleteById).mockImplementation(async () => {})
  vi.mocked(dbRepo.reapIfStalePending).mockImplementation(async () => false)
  vi.mocked(invoiceService.getInvoiceService).mockReturnValue({
    emitir:       vi.fn(async () => EMIT_RESULT),
    enviarCorreo: vi.fn(async () => {}),
    obtener:      vi.fn(async () => ({})),
    descargar:    vi.fn(async () => Buffer.from('')),
    cancelar:     vi.fn(async () => {}),
  })

  const mod = await import('../app/api/invoice/emit/route')
  POST = mod.POST as unknown as (req: Request) => Promise<Response>
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

const VALID_CONSENT = { acceptedPrivacy: true, acceptedTerms: true }

// amount: 116 coincide con VALID_ORDER.total = 116 para pasar la validación de monto
function makeEmitRequest(
  body: unknown = { folio: '15-5333', amount: 116, fiscal: VALID_FISCAL, consent: VALID_CONSENT }
): Request {
  return new Request('http://localhost/api/invoice/emit', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

// Helper: configura el findOrder dentro del stub de getOrderSource
function mockFindOrder(impl: () => Promise<NormalizedOrderWithPayment | null>) {
  vi.mocked(orderSourceMod.getOrderSource).mockReturnValue({
    findOrder: vi.fn(impl),
  })
}

// Helper: configura el emitir/enviarCorreo dentro del stub de getInvoiceService
function mockInvoiceService(overrides: {
  emitir?:        () => Promise<EmitResult>
  enviarCorreo?:  (facturamaId: string, email: string, opts?: { serieFolio?: string }) => Promise<void>
}) {
  vi.mocked(invoiceService.getInvoiceService).mockReturnValue({
    emitir:       vi.fn(overrides.emitir       ?? (async () => EMIT_RESULT)),
    enviarCorreo: vi.fn(overrides.enviarCorreo ?? (async () => {})),
    obtener:      vi.fn(async () => ({})),
    descargar:    vi.fn(async () => Buffer.from('')),
    cancelar:     vi.fn(async () => {}),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('orquestación emit — patrón insert-first', () => {
  it('flujo feliz: createInvoice es llamado antes de emitir()', async () => {
    const callOrder: string[] = []
    vi.mocked(dbRepo.createInvoice).mockImplementation(async () => {
      callOrder.push('createInvoice')
      return { created: true as const, invoice: makeInvoiceRow() }
    })
    mockInvoiceService({
      emitir: async () => {
        callOrder.push('emitir')
        return EMIT_RESULT
      },
    })

    const res = await POST(makeEmitRequest())
    expect(res.status).toBe(200)
    expect(callOrder).toEqual(['createInvoice', 'emitir'])
  })

  it('409 ALREADY_INVOICED cuando createInvoice devuelve created:false (carrera)', async () => {
    vi.mocked(dbRepo.createInvoice).mockImplementation(async () => ({
      created: false as const,
      reason: 'already_invoiced' as const,
    }))
    const emitFn = vi.fn()
    mockInvoiceService({ emitir: emitFn })

    const res = await POST(makeEmitRequest())

    expect(res.status).toBe(409)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('ALREADY_INVOICED')
    // CRÍTICO: quien pierde la carrera NO llama a emitir()
    expect(emitFn).not.toHaveBeenCalled()
  })

  it('409 ALREADY_INVOICED en el SELECT previo — createInvoice no se llama', async () => {
    vi.mocked(dbRepo.isAlreadyInvoiced).mockImplementation(async () => true)

    const res = await POST(makeEmitRequest())

    expect(res.status).toBe(409)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('ALREADY_INVOICED')
    expect(dbRepo.createInvoice).not.toHaveBeenCalled()
  })

  it('flujo feliz: updateInvoiceStamp se llama con facturamaId y uuid del timbrado', async () => {
    const stampArgs: unknown[][] = []
    vi.mocked(dbRepo.updateInvoiceStamp).mockImplementation(async (...args: unknown[]) => {
      stampArgs.push(args)
      return makeInvoiceRow({ status: 'emitted' })
    })

    await POST(makeEmitRequest())

    expect(stampArgs).toHaveLength(1)
    expect(stampArgs[0][0]).toBe(INVOICE_ID)
    expect(stampArgs[0][1]).toMatchObject({
      facturamaId: EMIT_RESULT.facturamaId,
      uuidCfdi:    EMIT_RESULT.uuid,
      status:      'emitted',
    })
  })

  it('flujo feliz: createInvoice recibe privacyVersion, termsVersion y consentAt poblados', async () => {
    const createArgs: unknown[] = []
    vi.mocked(dbRepo.createInvoice).mockImplementation(async (data: unknown) => {
      createArgs.push(data)
      return { created: true as const, invoice: makeInvoiceRow() }
    })

    await POST(makeEmitRequest())

    expect(createArgs).toHaveLength(1)
    expect(createArgs[0]).toMatchObject({
      privacyVersion: '2026-07-03',
      termsVersion: '2026-07-03',
    })
    expect((createArgs[0] as { consentAt: Date }).consentAt).toBeInstanceOf(Date)
  })
})

describe('orquestación emit — rollback en fallo de timbrado', () => {
  it('llama a deleteById(invoiceId) cuando emitir() lanza', async () => {
    mockInvoiceService({
      emitir: async () => { throw new Error('Facturama: RFC inválido') },
    })

    const res = await POST(makeEmitRequest())

    expect(res.status).toBe(503)
    expect(dbRepo.deleteById).toHaveBeenCalledWith(INVOICE_ID)
  })

  it('503 FACTURAMA_ERROR incluso si deleteById también falla', async () => {
    mockInvoiceService({
      emitir: async () => { throw new Error('Facturama error') },
    })
    vi.mocked(dbRepo.deleteById).mockImplementation(async () => {
      throw new Error('DB: connection reset')
    })

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(makeEmitRequest())

    expect(res.status).toBe(503)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('FACTURAMA_ERROR')

    const allMessages = consoleError.mock.calls.flat().map(String).join(' ')
    expect(allMessages).toMatch(/pendiente|pending|limpiar|clean/i)

    consoleError.mockRestore()
  })

  it('deleteById NO se llama cuando emitir() tiene éxito', async () => {
    await POST(makeEmitRequest())

    expect(dbRepo.deleteById).not.toHaveBeenCalled()
  })

  it('emitir() recibe el pedido y los datos fiscales correctos', async () => {
    const callArgs: unknown[][] = []
    mockInvoiceService({
      emitir: async (...args: unknown[]) => {
        callArgs.push(args)
        return EMIT_RESULT
      },
    })

    await POST(makeEmitRequest({ folio: '15-5333', amount: 116, fiscal: VALID_FISCAL, consent: VALID_CONSENT }))

    expect(callArgs).toHaveLength(1)
    expect(callArgs[0][0]).toMatchObject({
      order:  expect.objectContaining({ id: ORDER_ID }),
      fiscal: expect.objectContaining({ rfc: VALID_FISCAL.rfc }),
    })
  })
})

describe('orquestación emit — correo best-effort', () => {
  it('200 OK cuando enviarCorreo() lanza — el CFDI ya está timbrado', async () => {
    mockInvoiceService({
      enviarCorreo: async () => { throw new Error('SMTP timeout') },
    })

    const res = await POST(makeEmitRequest())

    expect(res.status).toBe(200)
    const body = await res.json() as { factura: unknown }
    expect(body.factura).toBeDefined()
  })

  it('enviarCorreo se llama con el facturamaId del timbrado y el email de fiscal', async () => {
    let capturedId    = ''
    let capturedEmail = ''
    mockInvoiceService({
      enviarCorreo: async (id: unknown, email: unknown) => {
        capturedId    = String(id)
        capturedEmail = String(email)
      },
    })

    await POST(makeEmitRequest({ folio: '15-5333', amount: 116, fiscal: VALID_FISCAL, consent: VALID_CONSENT }))

    expect(capturedId).toBe(EMIT_RESULT.facturamaId)
    expect(capturedEmail).toBe(VALID_FISCAL.email)
  })

  it('200 OK incluso cuando updateInvoiceStamp falla', async () => {
    vi.mocked(dbRepo.updateInvoiceStamp).mockImplementation(async () => {
      throw new Error('DB connection lost')
    })

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(makeEmitRequest())

    expect(res.status).toBe(200)
    const body = await res.json() as { factura: unknown }
    expect(body.factura).toBeDefined()

    const allMessages = consoleError.mock.calls.flat().map(String).join(' ')
    expect(allMessages).toMatch(/conciliar|actualizar|stamp/i)

    consoleError.mockRestore()
  })
})

describe('orquestación emit — orden de validaciones', () => {
  it('ORDER_NOT_FOUND: createInvoice NO se llama si el pedido no existe', async () => {
    mockFindOrder(async () => null)

    const res = await POST(makeEmitRequest())

    expect(res.status).toBe(404)
    expect(dbRepo.createInvoice).not.toHaveBeenCalled()
  })

  it('FULLY_REFUNDED: createInvoice NO se llama si el pedido está reembolsado', async () => {
    mockFindOrder(async () => ({ ...VALID_ORDER, refundedAmount: VALID_ORDER.total }))

    const res = await POST(makeEmitRequest())

    expect(res.status).toBe(409)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('FULLY_REFUNDED')
    expect(dbRepo.createInvoice).not.toHaveBeenCalled()
  })

  it('DEADLINE_EXCEEDED: createInvoice NO se llama si el pedido está fuera de la ventana', async () => {
    mockFindOrder(async () => ({
      ...VALID_ORDER,
      createdAt: new Date(
        new Date().getFullYear(),
        new Date().getMonth() - 1,
        15
      ).toISOString(),
    }))

    const res = await POST(makeEmitRequest())

    expect(res.status).toBe(422)
    expect(dbRepo.createInvoice).not.toHaveBeenCalled()
  })

  it('SHOPIFY_ERROR: createInvoice NO se llama si Shopify lanza', async () => {
    mockFindOrder(async () => { throw new Error('[shopify] todas fallaron') })

    const res = await POST(makeEmitRequest())

    expect(res.status).toBe(502)
    expect(dbRepo.createInvoice).not.toHaveBeenCalled()
  })

  it('el invoiceId de la respuesta coincide con el id de la fila creada', async () => {
    const expectedId = 'my-specific-invoice-id'
    vi.mocked(dbRepo.createInvoice).mockImplementation(async () => ({
      created: true as const,
      invoice: makeInvoiceRow({ id: expectedId }),
    }))

    const res = await POST(makeEmitRequest())

    expect(res.status).toBe(200)
    const body = await res.json() as { factura: { invoiceId: string } }
    expect(body.factura.invoiceId).toBe(expectedId)
  })
})

describe('orquestación emit — respuesta canónica', () => {
  it('envelope de éxito: { factura: { invoiceId, uuid, serieFolio, fecha, sello, emisor } }', async () => {
    const res = await POST(makeEmitRequest())

    expect(res.status).toBe(200)
    const body = await res.json() as {
      factura: {
        invoiceId:  string
        uuid:       string
        serieFolio: string
        fecha:      string
        sello:      string
        emisor:     { rfc: string; nombre: string; regimen: string }
      }
    }

    expect(body.factura.invoiceId).toBeTruthy()
    expect(body.factura.uuid).toBe(EMIT_RESULT.uuid)
    expect(body.factura.serieFolio).toBe(EMIT_RESULT.serieFolio)
    expect(body.factura.fecha).toBe(EMIT_RESULT.fecha)
    expect(body.factura.sello).toBe(EMIT_RESULT.sello)
    expect(body.factura.emisor.rfc).toBe(EMIT_RESULT.emisor.rfc)
  })
})

describe('orquestación emit — reap-lazy de filas pending huérfanas (docs/08-plan-pre-deploy.md §4)', () => {
  it('fila pending vieja: reapIfStalePending libera el cerrojo y el segundo createInvoice timbra normal', async () => {
    // Primer intento choca con el UNIQUE (fila huérfana existente); el reap la libera;
    // el segundo intento de createInvoice tiene éxito.
    let createInvoiceCalls = 0
    vi.mocked(dbRepo.createInvoice).mockImplementation(async () => {
      createInvoiceCalls += 1
      if (createInvoiceCalls === 1) {
        return { created: false as const, reason: 'already_invoiced' as const }
      }
      return { created: true as const, invoice: makeInvoiceRow() }
    })
    vi.mocked(dbRepo.reapIfStalePending).mockImplementation(async () => true)

    const res = await POST(makeEmitRequest())

    expect(res.status).toBe(200)
    const body = await res.json() as { factura: { invoiceId: string } }
    expect(body.factura.invoiceId).toBeTruthy()
    expect(dbRepo.reapIfStalePending).toHaveBeenCalledWith(
      ORDER_ID, STORE_NAME, expect.any(Number), expect.any(Date)
    )
    expect(createInvoiceCalls).toBe(2)
  })

  it('fila pending reciente: reapIfStalePending devuelve false → ALREADY_INVOICED sin reintentar el insert', async () => {
    let createInvoiceCalls = 0
    vi.mocked(dbRepo.createInvoice).mockImplementation(async () => {
      createInvoiceCalls += 1
      return { created: false as const, reason: 'already_invoiced' as const }
    })
    vi.mocked(dbRepo.reapIfStalePending).mockImplementation(async () => false)
    const emitFn = vi.fn()
    mockInvoiceService({ emitir: emitFn })

    const res = await POST(makeEmitRequest())

    expect(res.status).toBe(409)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('ALREADY_INVOICED')
    expect(createInvoiceCalls).toBe(1)
    expect(emitFn).not.toHaveBeenCalled()
  })

  it('fila emitted: nunca se reapea, siempre ALREADY_INVOICED', async () => {
    vi.mocked(dbRepo.createInvoice).mockImplementation(async () => ({
      created: false as const,
      reason: 'already_invoiced' as const,
    }))
    vi.mocked(dbRepo.reapIfStalePending).mockImplementation(async () => false)

    const res = await POST(makeEmitRequest())

    expect(res.status).toBe(409)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('ALREADY_INVOICED')
  })

  it('fila stamped_unconfirmed: nunca se reapea aunque sea vieja — no permite doble timbre', async () => {
    // reapIfStalePending es responsable de este invariante a nivel repo (nunca borra
    // algo que no sea 'pending'); aquí verificamos que el use case respeta `false`
    // devuelto por el repo y no reintenta el insert.
    let createInvoiceCalls = 0
    vi.mocked(dbRepo.createInvoice).mockImplementation(async () => {
      createInvoiceCalls += 1
      return { created: false as const, reason: 'already_invoiced' as const }
    })
    vi.mocked(dbRepo.reapIfStalePending).mockImplementation(async () => false)
    const emitFn = vi.fn()
    mockInvoiceService({ emitir: emitFn })

    const res = await POST(makeEmitRequest())

    expect(res.status).toBe(409)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('ALREADY_INVOICED')
    expect(createInvoiceCalls).toBe(1)
    expect(emitFn).not.toHaveBeenCalled()
  })

  it('carrera de dos reaps: el reintento de insert vuelve a chocar con UNIQUE → ALREADY_INVOICED limpio, sin lanzar', async () => {
    // El reap devuelve true (creyó liberar el cerrojo), pero otro request ganó la
    // carrera y ya reinsertó primero: el segundo createInvoice vuelve a chocar.
    let createInvoiceCalls = 0
    vi.mocked(dbRepo.createInvoice).mockImplementation(async () => {
      createInvoiceCalls += 1
      return { created: false as const, reason: 'already_invoiced' as const }
    })
    vi.mocked(dbRepo.reapIfStalePending).mockImplementation(async () => true)
    const emitFn = vi.fn()
    mockInvoiceService({ emitir: emitFn })

    const res = await POST(makeEmitRequest())

    expect(res.status).toBe(409)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('ALREADY_INVOICED')
    expect(createInvoiceCalls).toBe(2)
    expect(emitFn).not.toHaveBeenCalled()
  })
})

describe('orquestación emit — subcaso crítico: timbrado exitoso pero updateInvoiceStamp falla', () => {
  it('marca stamped_unconfirmed cuando el UPDATE a emitted falla tras timbrar con éxito', async () => {
    const stampCalls: Array<{ id: unknown; data: unknown }> = []
    vi.mocked(dbRepo.updateInvoiceStamp).mockImplementation(async (id: unknown, data: unknown) => {
      stampCalls.push({ id, data })
      const d = data as { status?: string }
      if (d.status === 'emitted') {
        throw new Error('DB connection lost')
      }
      return makeInvoiceRow({ status: 'stamped_unconfirmed' })
    })

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(makeEmitRequest())

    // El CFDI YA se timbró en Facturama — la respuesta al cliente sigue siendo 200.
    expect(res.status).toBe(200)

    expect(stampCalls).toHaveLength(2)
    expect(stampCalls[0].data).toMatchObject({ status: 'emitted' })
    expect(stampCalls[1].data).toMatchObject({
      status:      'stamped_unconfirmed',
      facturamaId: EMIT_RESULT.facturamaId,
      uuidCfdi:    EMIT_RESULT.uuid,
    })

    consoleError.mockRestore()
  })

  it('si también falla el marcado de stamped_unconfirmed, sigue respondiendo 200 y loguea para revisión manual', async () => {
    vi.mocked(dbRepo.updateInvoiceStamp).mockImplementation(async () => {
      throw new Error('DB connection lost')
    })

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(makeEmitRequest())

    expect(res.status).toBe(200)
    const allMessages = consoleError.mock.calls.flat().map(String).join(' ')
    expect(allMessages).toMatch(/stamped_unconfirmed|manual|conciliar/i)

    consoleError.mockRestore()
  })
})
