/**
 * Tests para normalizedOrderToTicket — verifica que formatDateTimeMX usa
 * la zona de México (America/Mexico_City) y NO la del servidor.
 * Los tests son deterministas independientemente de la TZ del proceso.
 */

import { describe, it, expect } from 'vitest'
import { normalizedOrderToTicket } from '../src/application/orders/orderToTicket'
import type { NormalizedOrderWithPayment } from '../src/domain/orders/Order'

/** Construye un NormalizedOrderWithPayment mínimo válido. */
function makeOrder(overrides: Partial<NormalizedOrderWithPayment> = {}): NormalizedOrderWithPayment {
  return {
    id: 'order-test-1',
    orderNumber: '5001',
    createdAt: '2026-06-15T12:00:00Z',
    currency: 'MXN',
    subtotal: 100,
    taxAmount: 16,
    total: 116,
    discountAmount: 0,
    shippingAmount: 0,
    lines: [
      {
        description: 'Producto de prueba',
        quantity: 1,
        unitPrice: 116,
        taxRate: 0.16,
        taxObject: '02',
        discount: 0,
        productCode: 'SKU-001',
      },
    ],
    customerEmail: 'cliente@test.com',
    alreadyInvoiced: false,
    storeName: 'Tienda Test',
    refundedAmount: 0,
    financialStatus: 'PAID',
    paymentGatewayNames: ['bogus'],
    ...overrides,
  }
}

describe('normalizedOrderToTicket — fecha y hora en zona México (M7)', () => {
  // UTC 02:30 → MX (UTC-6) → 14/Jun a las 20:30
  it('2026-06-15T02:30:00Z → fecha 14/06/2026, hora 20:30', () => {
    const order = makeOrder({ createdAt: '2026-06-15T02:30:00Z' })
    const ticket = normalizedOrderToTicket(order, '5001')
    expect(ticket.fecha).toBe('14/06/2026')
    expect(ticket.hora).toBe('20:30')
  })

  // UTC 18:05 → MX (UTC-6) → 15/Jun a las 12:05
  it('2026-06-15T18:05:00Z → fecha 15/06/2026, hora 12:05', () => {
    const order = makeOrder({ createdAt: '2026-06-15T18:05:00Z' })
    const ticket = normalizedOrderToTicket(order, '5001')
    expect(ticket.fecha).toBe('15/06/2026')
    expect(ticket.hora).toBe('12:05')
  })

  // createdAt inválido → fecha y hora vacíos (no revienta)
  it('createdAt inválido → fecha: "", hora: ""', () => {
    const order = makeOrder({ createdAt: 'no-date' })
    const ticket = normalizedOrderToTicket(order, '5001')
    expect(ticket.fecha).toBe('')
    expect(ticket.hora).toBe('')
  })
})

describe('normalizedOrderToTicket — campos básicos del ticket', () => {
  const order = makeOrder({ total: 116, orderNumber: '9999' })

  it('ticket.folio === displayFolio cuando se pasa', () => {
    const ticket = normalizedOrderToTicket(order, 'REC-12345')
    expect(ticket.folio).toBe('REC-12345')
  })

  it('ticket.folio === orderNumber cuando no se pasa displayFolio', () => {
    const ticket = normalizedOrderToTicket(order)
    expect(ticket.folio).toBe('9999')
  })

  it('ticket.total === order.total', () => {
    const ticket = normalizedOrderToTicket(order, '9999')
    expect(ticket.total).toBe(116)
  })
})
