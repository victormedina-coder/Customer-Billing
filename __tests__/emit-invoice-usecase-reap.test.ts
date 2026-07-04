/**
 * EmitInvoiceUseCase — reap-lazy de filas 'pending' huérfanas.
 *
 * Ver docs/08-plan-pre-deploy.md §4 (diseño aprobado). Testea el use case
 * directamente (sin pasar por el route handler) para poder inyectar el
 * reloj y controlar el TTL con precisión.
 *
 * Casos cubiertos:
 * 1. pending vieja (> TTL) → se reapea y el insert se reintenta → timbra OK.
 * 2. pending reciente (<= TTL) → ALREADY_INVOICED, sin reap.
 * 3. emitted → ALREADY_INVOICED, reap ni se intenta (createInvoice no choca... en
 *    este caso el choque del UNIQUE ya representa 'emitted', reapIfStalePending
 *    debe devolver false y no reintentar el insert).
 * 4. stamped_unconfirmed → nunca se reapea (reapIfStalePending simula el
 *    comportamiento real del repo: no toca ese status).
 * 5. carrera: dos reaps casi simultáneos — el segundo reintento de insert
 *    vuelve a chocar → ALREADY_INVOICED limpio, sin lanzar.
 * 6. updateInvoiceStamp falla tras timbrar con éxito → la fila se marca
 *    'stamped_unconfirmed' (no queda 'pending' reapeable).
 */

import { describe, it, expect, vi } from 'vitest'
import { EmitInvoiceUseCase } from '../src/application/invoice/EmitInvoiceUseCase'
import type {
  EmitInvoiceDeps,
  EmitInvoiceRepo,
  EmitOrderSource,
} from '../src/application/invoice/EmitInvoiceUseCase'
import type { NormalizedOrderWithPayment } from '../src/domain/orders/Order'
import type { EmitResult, InvoiceStampingService } from '../src/domain/invoicing/ports/InvoiceStampingService'

const ORDER_ID   = 'gid://shopify/Order/reap-test-1'
const STORE_NAME = 'Tienda Ariat Nogales'

const VALID_ORDER: NormalizedOrderWithPayment = {
  id:               ORDER_ID,
  orderNumber:      '#90001',
  createdAt:        new Date().toISOString(),
  currency:         'MXN',
  subtotal:         100,
  taxAmount:        16,
  total:            116,
  discountAmount:   0,
  shippingAmount:   0,
  lines: [{
    description:          'Producto Test',
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
  facturamaId: 'FACT-REAP-001',
  uuid:        'UUID-REAP-001',
  serieFolio:  'GR-300001',
  fecha:       '01/06/2026 10:30',
  sello:       'sello-reap-fake',
  emisor:      { rfc: 'XAXX010101000', nombre: 'EMISOR DEMO', regimen: '601' },
}

function makeOrderSource(order: NormalizedOrderWithPayment | null = VALID_ORDER): EmitOrderSource {
  return { findOrder: vi.fn(async () => order) }
}

function makeStamping(overrides: Partial<InvoiceStampingService> = {}): InvoiceStampingService {
  return {
    emitir:       vi.fn(async () => EMIT_RESULT),
    enviarCorreo: vi.fn(async () => {}),
    obtener:      vi.fn(async () => ({} as never)),
    descargar:    vi.fn(async () => Buffer.from('')),
    cancelar:     vi.fn(async () => {}),
    ...overrides,
  }
}

/**
 * Repo mock configurable: `createInvoiceResults` es una cola de resultados que
 * createInvoice devuelve en orden de llamada (permite simular: 1er intento
 * choca, 2do intento tras reap tiene éxito).
 */
function makeRepo(config: {
  isAlreadyInvoiced?: boolean
  createInvoiceResults: Array<{ created: true; invoice: { id: string } } | { created: false; reason: string }>
  reapIfStalePending?: (orderId: string, storeName: string, ttlMinutes: number, now: Date) => Promise<boolean>
  updateInvoiceStamp?: EmitInvoiceRepo['updateInvoiceStamp']
}): EmitInvoiceRepo & { createInvoice: ReturnType<typeof vi.fn>; reapIfStalePending: ReturnType<typeof vi.fn> } {
  const queue = [...config.createInvoiceResults]
  const createInvoice = vi.fn(async () => {
    const next = queue.shift()
    if (!next) throw new Error('createInvoiceResults queue exhausted')
    return next
  })
  const reapIfStalePending = vi.fn(config.reapIfStalePending ?? (async () => false))
  return {
    isAlreadyInvoiced: vi.fn(async () => config.isAlreadyInvoiced ?? false),
    createInvoice,
    updateInvoiceStamp: config.updateInvoiceStamp ?? vi.fn(async () => ({})),
    deleteById: vi.fn(async () => {}),
    reapIfStalePending,
  }
}

function makeDeps(overrides: Partial<EmitInvoiceDeps> & { repo: EmitInvoiceDeps['repo'] }): EmitInvoiceDeps {
  return {
    orderSource:  makeOrderSource(),
    stamping:     makeStamping(),
    refundPolicy: { isFullyRefunded: () => false },
    windowPolicy: { isWithinInvoiceWindow: () => true },
    ...overrides,
  }
}

const VALID_CONSENT = { acceptedPrivacy: true, acceptedTerms: true }

const INPUT = { folio: '15-9001', amount: 116, fiscal: VALID_FISCAL, consent: VALID_CONSENT }

describe('EmitInvoiceUseCase — reap-lazy de pending huérfanas', () => {
  it('pending vieja (> TTL): se reapea, el insert se reintenta y timbra OK', async () => {
    const repo = makeRepo({
      createInvoiceResults: [
        { created: false, reason: 'already_invoiced' }, // 1er intento choca
        { created: true, invoice: { id: 'new-invoice-id' } }, // reintento tras reap
      ],
      reapIfStalePending: async () => true, // vieja → se libera
    })
    const useCase = new EmitInvoiceUseCase(makeDeps({ repo, pendingTtlMinutes: 10, now: () => new Date() }))

    const result = await useCase.execute(INPUT)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.invoiceId).toBe('new-invoice-id')
    }
    expect(repo.createInvoice).toHaveBeenCalledTimes(2)
    expect(repo.reapIfStalePending).toHaveBeenCalledWith(ORDER_ID, STORE_NAME, 10, expect.any(Date))
  })

  it('pending reciente (<= TTL): ALREADY_INVOICED, sin segundo intento de insert', async () => {
    const repo = makeRepo({
      createInvoiceResults: [
        { created: false, reason: 'already_invoiced' },
      ],
      reapIfStalePending: async () => false, // reciente → no se libera
    })
    const useCase = new EmitInvoiceUseCase(makeDeps({ repo }))

    const result = await useCase.execute(INPUT)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('ALREADY_INVOICED')
    }
    expect(repo.createInvoice).toHaveBeenCalledTimes(1)
  })

  it('fila emitted: ALREADY_INVOICED, reapIfStalePending no libera nada', async () => {
    const repo = makeRepo({
      createInvoiceResults: [
        { created: false, reason: 'already_invoiced' },
      ],
      reapIfStalePending: async () => false, // status 'emitted' → repo nunca la toca
    })
    const useCase = new EmitInvoiceUseCase(makeDeps({ repo }))

    const result = await useCase.execute(INPUT)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('ALREADY_INVOICED')
    }
    expect(repo.createInvoice).toHaveBeenCalledTimes(1)
  })

  it('fila stamped_unconfirmed: nunca se reapea, ALREADY_INVOICED', async () => {
    const repo = makeRepo({
      createInvoiceResults: [
        { created: false, reason: 'already_invoiced' },
      ],
      // El repo real nunca borra 'stamped_unconfirmed' — simulamos ese contrato
      // devolviendo false incondicionalmente, sin importar la antigüedad.
      reapIfStalePending: async () => false,
    })
    const useCase = new EmitInvoiceUseCase(makeDeps({ repo, pendingTtlMinutes: 0, now: () => new Date(Date.now() + 999_999_999) }))

    const result = await useCase.execute(INPUT)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('ALREADY_INVOICED')
    }
    expect(repo.createInvoice).toHaveBeenCalledTimes(1)
  })

  it('carrera de dos reaps: el reintento de insert vuelve a chocar → ALREADY_INVOICED limpio', async () => {
    const repo = makeRepo({
      createInvoiceResults: [
        { created: false, reason: 'already_invoiced' }, // 1er intento choca
        { created: false, reason: 'already_invoiced' }, // reintento también choca (otro ganó la carrera)
      ],
      reapIfStalePending: async () => true, // esta instancia sí reapeó, pero perdió la carrera del reinsert
    })
    const useCase = new EmitInvoiceUseCase(makeDeps({ repo }))

    const result = await useCase.execute(INPUT)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('ALREADY_INVOICED')
    }
    expect(repo.createInvoice).toHaveBeenCalledTimes(2)
  })

  it('usa pendingTtlMinutes y now inyectados al llamar reapIfStalePending', async () => {
    const fixedNow = new Date('2026-01-01T00:00:00.000Z')
    const repo = makeRepo({
      createInvoiceResults: [
        { created: false, reason: 'already_invoiced' },
      ],
      reapIfStalePending: async () => false,
    })
    const useCase = new EmitInvoiceUseCase(makeDeps({ repo, pendingTtlMinutes: 25, now: () => fixedNow }))

    await useCase.execute(INPUT)

    expect(repo.reapIfStalePending).toHaveBeenCalledWith(ORDER_ID, STORE_NAME, 25, fixedNow)
  })
})

describe('EmitInvoiceUseCase — stamped_unconfirmed tras timbrado exitoso', () => {
  it('si updateInvoiceStamp falla tras timbrar con éxito, se reintenta marcando stamped_unconfirmed', async () => {
    const updateCalls: Array<{ id: string; data: { status: string } }> = []
    const updateInvoiceStamp = vi.fn(async (id: string, data: { facturamaId: string; uuidCfdi: string; status: string }) => {
      updateCalls.push({ id, data })
      if (data.status === 'emitted') {
        throw new Error('DB connection lost')
      }
      return {}
    })
    const repo = makeRepo({
      createInvoiceResults: [{ created: true, invoice: { id: 'invoice-x' } }],
      updateInvoiceStamp,
    })
    const useCase = new EmitInvoiceUseCase(makeDeps({ repo }))

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await useCase.execute(INPUT)
    consoleError.mockRestore()

    // El CFDI ya se timbró exitosamente en Facturama — la respuesta sigue siendo ok
    // (best-effort, no tumbamos la respuesta al cliente).
    expect(result.ok).toBe(true)

    expect(updateCalls).toHaveLength(2)
    expect(updateCalls[0].data.status).toBe('emitted')
    expect(updateCalls[1].data.status).toBe('stamped_unconfirmed')
    expect(updateCalls[1].id).toBe('invoice-x')
  })

  it('updateInvoiceStamp exitoso (status emitted): NO se intenta marcar stamped_unconfirmed', async () => {
    const updateInvoiceStamp = vi.fn(async () => ({}))
    const repo = makeRepo({
      createInvoiceResults: [{ created: true, invoice: { id: 'invoice-y' } }],
      updateInvoiceStamp,
    })
    const useCase = new EmitInvoiceUseCase(makeDeps({ repo }))

    const result = await useCase.execute(INPUT)

    expect(result.ok).toBe(true)
    expect(updateInvoiceStamp).toHaveBeenCalledTimes(1)
    expect(updateInvoiceStamp).toHaveBeenCalledWith('invoice-y', expect.objectContaining({ status: 'emitted' }))
  })
})

describe('EmitInvoiceUseCase — consentimiento legal auditable', () => {
  it('createInvoice recibe privacyVersion, termsVersion y consentAt (reloj inyectado)', async () => {
    const fixedNow = new Date('2026-07-03T12:00:00.000Z')
    const repo = makeRepo({
      createInvoiceResults: [{ created: true, invoice: { id: 'invoice-consent' } }],
    })
    const useCase = new EmitInvoiceUseCase(makeDeps({ repo, now: () => fixedNow }))

    const result = await useCase.execute(INPUT)

    expect(result.ok).toBe(true)
    expect(repo.createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        privacyVersion: '2026-07-03',
        termsVersion: '2026-07-03',
        consentAt: fixedNow,
      })
    )
  })

  it('rechaza con VALIDATION_FAILED si acceptedPrivacy es false (defensa en profundidad, sin pasar por Zod)', async () => {
    const repo = makeRepo({ createInvoiceResults: [] })
    const useCase = new EmitInvoiceUseCase(makeDeps({ repo }))

    const result = await useCase.execute({
      ...INPUT,
      consent: { acceptedPrivacy: false, acceptedTerms: true },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED')
    }
    expect(repo.createInvoice).not.toHaveBeenCalled()
  })

  it('rechaza con VALIDATION_FAILED si acceptedTerms es false', async () => {
    const repo = makeRepo({ createInvoiceResults: [] })
    const useCase = new EmitInvoiceUseCase(makeDeps({ repo }))

    const result = await useCase.execute({
      ...INPUT,
      consent: { acceptedPrivacy: true, acceptedTerms: false },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED')
    }
    expect(repo.createInvoice).not.toHaveBeenCalled()
  })

  it('rechaza con VALIDATION_FAILED si ambos flags son false, sin llamar a orderSource', async () => {
    const repo = makeRepo({ createInvoiceResults: [] })
    const orderSource = makeOrderSource()
    const useCase = new EmitInvoiceUseCase(makeDeps({ repo, orderSource }))

    const result = await useCase.execute({
      ...INPUT,
      consent: { acceptedPrivacy: false, acceptedTerms: false },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED')
    }
    expect(orderSource.findOrder).not.toHaveBeenCalled()
  })
})
