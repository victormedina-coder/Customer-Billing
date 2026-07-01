import { describe, it, expect } from 'vitest'
import { isWithinInvoiceWindow } from '../src/domain/eligibility/InvoiceWindowPolicy'

// now fijo: mediados de junio 2026 12:00 UTC (06:00 MX)
const NOW = new Date('2026-06-26T12:00:00Z')

// Inicio del mes en MX: 2026-06-01T00:00:00 MX = 2026-06-01T06:00:00Z (UTC-6)
const MX_MONTH_START = '2026-06-01T06:00:00Z'

describe('isWithinInvoiceWindow', () => {
  it('pedido el 15 de junio 2026 → true (dentro del mes)', () => {
    expect(isWithinInvoiceWindow('2026-06-15T10:00:00Z', NOW)).toBe(true)
  })

  it('pedido el 1 de junio 2026 a las 00:01 MX → true', () => {
    // 00:01 MX = 06:01 UTC
    expect(isWithinInvoiceWindow('2026-06-01T06:01:00Z', NOW)).toBe(true)
  })

  it('pedido el 31 de mayo 2026 (mes anterior) → false', () => {
    expect(isWithinInvoiceWindow('2026-05-31T23:59:59Z', NOW)).toBe(false)
  })

  it('pedido el 27 de junio 2026 (futuro) → false', () => {
    expect(isWithinInvoiceWindow('2026-06-27T00:00:00Z', NOW)).toBe(false)
  })

  it("fecha ISO inválida 'not-a-date' → false", () => {
    expect(isWithinInvoiceWindow('not-a-date', NOW)).toBe(false)
  })

  it('pedido exactamente en now → true (orderDate === now)', () => {
    expect(isWithinInvoiceWindow(NOW.toISOString(), NOW)).toBe(true)
  })

  it('inicio del mes exacto (boundary inclusivo) → true', () => {
    expect(isWithinInvoiceWindow(MX_MONTH_START, NOW)).toBe(true)
  })

  it('un segundo antes del inicio del mes → false', () => {
    expect(isWithinInvoiceWindow('2026-06-01T05:59:59Z', NOW)).toBe(false)
  })
})
