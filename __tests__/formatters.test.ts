import { describe, it, expect } from 'vitest'
import { formatMXN, round2 } from '../app/(portal)/_lib/formatters'

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
