import { describe, expect, it, vi } from 'vitest'
import { EmitInvoiceUseCase } from '../src/application/invoice/EmitInvoiceUseCase'
import type { EmitInvoiceRepo } from '../src/application/invoice/EmitInvoiceUseCase'
import type { NormalizedOrderWithPayment } from '../src/domain/orders/Order'
import type { EmitResult } from '../src/domain/invoicing/ports/InvoiceStampingService'

const order: NormalizedOrderWithPayment = {
  id: 'order-1', orderNumber: '#1', storeName: 'store-1', createdAt: '2026-10-01T00:00:00.000Z',
  currency: 'MXN', subtotal: 100, taxAmount: 16, total: 116, discountAmount: 0,
  shippingAmount: 0, lines: [], customerEmail: 'customer@example.com', alreadyInvoiced: false,
  refundedAmount: 0, financialStatus: 'PAID', paymentGatewayNames: ['cash'],
}
const input = {
  folio: '1', amount: 116,
  fiscal: { rfc: 'EKU9003173C9', razon: 'ESCUELA KEMPER URGATE', regimen: '601', cp: '26015', uso: 'G01', email: 'customer@example.com' },
  consent: { acceptedPrivacy: true, acceptedTerms: true },
}
const stamp: EmitResult = {
  facturamaId: 'fact-1', uuid: 'uuid-1', serieFolio: 'S-1', fecha: '2026-10-01', sello: 'sello',
  emisor: { rfc: 'XAXX010101000', nombre: 'Emisor', regimen: '601' },
}

function makeCase(status: string, reaped: boolean) {
  let insertCount = 0
  const repo: EmitInvoiceRepo = {
    findInvoiceStatus: vi.fn(async () => status),
    createInvoice: vi.fn(async () => {
      insertCount++
      return insertCount === 2 ? { created: true as const, invoice: { id: 'invoice-1' } } : { created: false as const, reason: 'already_invoiced' }
    }),
    reapIfStalePending: vi.fn(async () => reaped),
    updateInvoiceStamp: vi.fn(async () => ({})),
    deleteById: vi.fn(async () => {}),
  }
  const stamping = {
    emitir: vi.fn(async () => stamp), enviarCorreo: vi.fn(async () => {}),
    obtener: vi.fn(async () => ({} as never)), descargar: vi.fn(async () => Buffer.from('')),
    cancelar: vi.fn(async () => {}),
  }
  const useCase = new EmitInvoiceUseCase({
    repo, stamping, orderSource: { findOrder: async () => order },
    refundPolicy: { isFullyRefunded: () => false },
    windowPolicy: { isWithinInvoiceWindow: () => true },
    pendingTtlMinutes: 10, now: () => new Date('2026-10-01T00:20:00.000Z'),
  })
  return { useCase, repo, stamping }
}

describe('EmitInvoiceUseCase pre-check por estado', () => {
  it('pending individual vieja: llega al choque, reap y emite', async () => {
    const { useCase, repo, stamping } = makeCase('pending', true)
    const result = await useCase.execute(input)
    expect(result.ok).toBe(true)
    expect(repo.createInvoice).toHaveBeenCalledTimes(2)
    expect(repo.reapIfStalePending).toHaveBeenCalledWith('order-1', 'store-1', 10, new Date('2026-10-01T00:20:00.000Z'))
    expect(stamping.emitir).toHaveBeenCalledTimes(1)
  })

  it.each(['pending individual reciente', 'pending global'])(
    '%s: no se reapea y devuelve ALREADY_INVOICED', async () => {
      const { useCase, repo, stamping } = makeCase('pending', false)
      const result = await useCase.execute(input)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('ALREADY_INVOICED')
      expect(repo.createInvoice).toHaveBeenCalledTimes(1)
      expect(repo.reapIfStalePending).toHaveBeenCalledTimes(1)
      expect(stamping.emitir).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['emitted', 'ALREADY_INVOICED'],
    ['stamped_unconfirmed', 'INVOICE_UNCONFIRMED'],
  ])('%s: corta antes del INSERT con %s', async (status, code) => {
    const { useCase, repo, stamping } = makeCase(status, false)
    const result = await useCase.execute(input)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe(code)
    expect(repo.createInvoice).not.toHaveBeenCalled()
    expect(repo.reapIfStalePending).not.toHaveBeenCalled()
    expect(stamping.emitir).not.toHaveBeenCalled()
  })
})
