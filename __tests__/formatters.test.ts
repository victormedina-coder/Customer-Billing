import { describe, it, expect } from 'vitest'
import {
  calcInvoiceBreakdown,
  calcSubtotal,
  calcIva,
  formatMXN,
  round2,
} from '../app/(portal)/_lib/formatters'

describe('calcInvoiceBreakdown', () => {
  it('caso real pedido 5-1086: total=480, tax=66.21, discount=320', () => {
    const result = calcInvoiceBreakdown({ total: 480, tax: 66.21, discount: 320 })
    expect(result.subtotalSinIVA).toBeCloseTo(689.66, 2)
    expect(result.descuento).toBeCloseTo(275.87, 2)
    expect(result.iva).toBeCloseTo(66.21, 2)
    expect(result.total).toBeCloseTo(480, 2)
  })

  it('sin descuento con tax: total=116, tax=16', () => {
    const result = calcInvoiceBreakdown({ total: 116, tax: 16 })
    expect(result.subtotalSinIVA).toBeCloseTo(100, 2)
    expect(result.descuento).toBe(0)
    expect(result.iva).toBeCloseTo(16, 2)
    expect(result.total).toBe(116)
  })

  it('sin tax ni discount (modo mock/demo): total=100', () => {
    const result = calcInvoiceBreakdown({ total: 100 })
    expect(result.iva).toBeCloseTo(13.79, 2)
    expect(result.descuento).toBe(0)
    expect(result.subtotalSinIVA + result.iva).toBeCloseTo(result.total, 1)
  })

  it('descuento cero explícito: total=200, tax=27.59, discount=0', () => {
    const result = calcInvoiceBreakdown({ total: 200, tax: 27.59, discount: 0 })
    expect(result.descuento).toBe(0)
  })
})

describe('round2', () => {
  it('round2(1.005) → 1 (IEEE 754: 1.005*100 = 100.4999... → Math.round = 100)', () => {
    // En IEEE 754, 1.005 no tiene representación exacta; 1.005*100 = 100.49999...
    // por lo que Math.round devuelve 100, no 101. El comportamiento real es 1.00.
    expect(round2(1.005)).toBe(1)
  })
  it('round2(1.234) → 1.23', () => {
    expect(round2(1.234)).toBe(1.23)
  })
  it('round2(0) → 0', () => {
    expect(round2(0)).toBe(0)
  })
})

describe('formatMXN', () => {
  it("formatMXN(1234.56) contiene '1,234.56' y símbolo '$'", () => {
    const result = formatMXN(1234.56)
    expect(result).toContain('1,234.56')
    expect(result).toContain('$')
  })
})

describe('calcSubtotal y calcIva (funciones auxiliares)', () => {
  it('calcSubtotal(116) ≈ 100', () => {
    expect(calcSubtotal(116)).toBeCloseTo(100, 2)
  })
  it('calcIva(116) ≈ 16', () => {
    expect(calcIva(116)).toBeCloseTo(16, 2)
  })
})
