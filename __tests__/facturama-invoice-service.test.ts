import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Order } from '../src/domain/orders/Order'
import type { FiscalInput } from '../src/domain/fiscal/FiscalInput'

const order: Order = {
  id: 'order-1', orderNumber: '#1001', createdAt: '2026-06-15T12:00:00Z',
  currency: 'MXN', subtotal: 100, taxAmount: 16, total: 116,
  discountAmount: 0, shippingAmount: 0,
  lines: [{ description: 'Sombrero', quantity: 1, unitPrice: 116, taxRate: 0.16, taxObject: '02', discount: 0, productCode: 'SKU-1' }],
  customerEmail: 'cliente@example.com', alreadyInvoiced: false,
  storeName: 'tienda-ariat', refundedAmount: 0, financialStatus: 'PAID',
}
const fiscal: FiscalInput = {
  rfc: 'EKU9003173C9', razon: 'ESCUELA KEMPER URGATE', regimen: '601',
  cp: '26015', uso: 'G01', email: 'cliente@example.com',
}

describe('FacturamaInvoiceService.emitir', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('FACTURAMA_USER', 'testuser')
    vi.stubEnv('FACTURAMA_PASS', 'testpass')
    vi.stubEnv('FACTURAMA_EXPEDITION_PLACE', '26015')
  })

  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it.each(['FACTURAMA_USER', 'FACTURAMA_PASS'] as const)('falta %s: falla en preparación sin llamar a Facturama', async (variable) => {
    vi.stubEnv(variable, '')
    vi.resetModules()
    const { FacturamaInvoiceService } = await import('../src/infrastructure/facturama/FacturamaInvoiceService')
    await expect(new FacturamaInvoiceService().emitir({ order, fiscal })).rejects.toMatchObject({
      name: 'StampPreparationError',
      cause: { message: 'Facturama no está configurado: faltan FACTURAMA_USER o FACTURAMA_PASS' },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
