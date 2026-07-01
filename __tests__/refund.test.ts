import { describe, it, expect } from 'vitest'
import { isFullyRefunded } from '../src/domain/orders/RefundPolicy'

describe('isFullyRefunded', () => {
  it("financialStatus === 'REFUNDED' → true (con cualquier monto)", () => {
    expect(isFullyRefunded({ total: 100, refundedAmount: 50, financialStatus: 'REFUNDED' })).toBe(true)
  })

  it('refundedAmount > 0 y neto ≤ 0.005 → true (total=100, refunded=99.997)', () => {
    expect(isFullyRefunded({ total: 100, refundedAmount: 99.997, financialStatus: 'PARTIALLY_REFUNDED' })).toBe(true)
  })

  it('reembolso parcial con neto > 0.005 → false (neto=50)', () => {
    expect(isFullyRefunded({ total: 100, refundedAmount: 50, financialStatus: 'PARTIALLY_REFUNDED' })).toBe(false)
  })

  it('refundedAmount === 0, financialStatus PAID → false', () => {
    expect(isFullyRefunded({ total: 100, refundedAmount: 0, financialStatus: 'PAID' })).toBe(false)
  })

  it('refundedAmount === total exactamente → true', () => {
    expect(isFullyRefunded({ total: 200, refundedAmount: 200, financialStatus: 'PARTIALLY_REFUNDED' })).toBe(true)
  })

  it('PARTIALLY_REFUNDED con neto = 0.001 → true (< epsilon 0.005)', () => {
    expect(isFullyRefunded({ total: 100, refundedAmount: 99.999, financialStatus: 'PARTIALLY_REFUNDED' })).toBe(true)
  })

  it('PARTIALLY_REFUNDED con neto = 0.006 → false (> epsilon 0.005)', () => {
    expect(isFullyRefunded({ total: 100, refundedAmount: 99.994, financialStatus: 'PARTIALLY_REFUNDED' })).toBe(false)
  })
})
