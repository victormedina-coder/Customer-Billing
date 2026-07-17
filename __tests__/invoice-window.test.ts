import { describe, it, expect, afterEach, vi } from 'vitest'
import { isPortalWindowOpen, isWithinInvoiceWindow } from '../src/domain/eligibility/InvoiceWindowPolicy'

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

// ── Corte 21:00 MX del último día del mes (R3, decisión de contabilidad 2026-07-16) ──
// Julio 2026 tiene 31 días: cutoff = 31-jul 21:00 MX = 01-ago 03:00 UTC (ver
// mx-calendar.test.ts → mxMonthInvoiceCutoff).
describe('isWithinInvoiceWindow — corte 21:00 MX del último día del mes', () => {
  const TICKET_MID_JULY = '2026-07-15T12:00:00Z'
  const JUST_BEFORE_CUTOFF = new Date('2026-08-01T02:59:00.000Z') // 31-jul 20:59 MX
  const AT_CUTOFF = new Date('2026-08-01T03:00:00.000Z') // 31-jul 21:00 MX
  const AFTER_CUTOFF = new Date('2026-08-01T03:00:01.000Z') // 31-jul 21:00:01 MX

  it('un instante ANTES del corte (20:59 MX) → el ticket del mes es elegible', () => {
    expect(isWithinInvoiceWindow(TICKET_MID_JULY, JUST_BEFORE_CUTOFF)).toBe(true)
  })

  it('EN el corte exacto (21:00 MX) → el mismo ticket YA NO es elegible (ventana cerrada)', () => {
    expect(isWithinInvoiceWindow(TICKET_MID_JULY, AT_CUTOFF)).toBe(false)
  })

  it('DESPUÉS del corte (21:00:01 MX) → sigue sin ser elegible', () => {
    expect(isWithinInvoiceWindow(TICKET_MID_JULY, AFTER_CUTOFF)).toBe(false)
  })

  it('primeros días del mes SIGUIENTE → la ventana vuelve a abrir para el mes nuevo', () => {
    const earlyAugust = new Date('2026-08-02T18:00:00Z') // 2-ago 12:00 MX
    const ticketEarlyAugust = '2026-08-01T12:00:00Z'
    expect(isWithinInvoiceWindow(ticketEarlyAugust, earlyAugust)).toBe(true)
    // El ticket viejo de julio sigue sin ser elegible (mes distinto, no por el corte).
    expect(isWithinInvoiceWindow(TICKET_MID_JULY, earlyAugust)).toBe(false)
  })

  it('meses de distinta duración (28/29/30/31 días) respetan su propio último día como corte', () => {
    // Junio 2026 tiene 30 días: cutoff = 30-jun 21:00 MX = 01-jul 03:00 UTC.
    const juneTicket = '2026-06-15T12:00:00Z'
    expect(isWithinInvoiceWindow(juneTicket, new Date('2026-07-01T02:59:00.000Z'))).toBe(true)
    expect(isWithinInvoiceWindow(juneTicket, new Date('2026-07-01T03:00:00.000Z'))).toBe(false)

    // Febrero bisiesto 2028 (29 días): cutoff = 29-feb 21:00 MX = 01-mar 03:00 UTC.
    const febTicket = '2028-02-15T12:00:00Z'
    expect(isWithinInvoiceWindow(febTicket, new Date('2028-03-01T02:59:00.000Z'))).toBe(true)
    expect(isWithinInvoiceWindow(febTicket, new Date('2028-03-01T03:00:00.000Z'))).toBe(false)
  })
})

describe('isPortalWindowOpen (R3 — flag "ventana cerrada para TODOS", lo consume el frontend)', () => {
  it('antes del corte del mes en curso → true (ventana abierta)', () => {
    expect(isPortalWindowOpen(new Date('2026-08-01T02:59:00.000Z'))).toBe(true)
  })

  it('en el corte exacto → false (ventana cerrada)', () => {
    expect(isPortalWindowOpen(new Date('2026-08-01T03:00:00.000Z'))).toBe(false)
  })

  it('después del corte → false', () => {
    expect(isPortalWindowOpen(new Date('2026-08-01T03:00:01.000Z'))).toBe(false)
  })

  it('primeros días del mes siguiente → true (nueva ventana abierta)', () => {
    expect(isPortalWindowOpen(new Date('2026-08-02T18:00:00Z'))).toBe(true)
  })

  it('sin argumento usa la fecha real (no lanza)', () => {
    expect(() => isPortalWindowOpen()).not.toThrow()
  })

  it('comparte el MISMO cutoff que isWithinInvoiceWindow (no pueden desincronizarse)', () => {
    const atCutoff = new Date('2026-08-01T03:00:00.000Z')
    expect(isPortalWindowOpen(atCutoff)).toBe(false)
    expect(isWithinInvoiceWindow('2026-07-15T12:00:00Z', atCutoff)).toBe(false)

    const justBefore = new Date('2026-08-01T02:59:59.999Z')
    expect(isPortalWindowOpen(justBefore)).toBe(true)
    expect(isWithinInvoiceWindow('2026-07-15T12:00:00Z', justBefore)).toBe(true)
  })
})

describe('INVOICE_WINDOW_CUTOFF_HOUR (override por env)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('sin override → default 21:00 MX (comportamiento ya cubierto arriba)', async () => {
    vi.resetModules()
    const { isPortalWindowOpen: freshIsPortalWindowOpen } = await import('../src/domain/eligibility/InvoiceWindowPolicy')
    expect(freshIsPortalWindowOpen(new Date('2026-08-01T02:59:00.000Z'))).toBe(true)
    expect(freshIsPortalWindowOpen(new Date('2026-08-01T03:00:00.000Z'))).toBe(false)
  })

  it('con INVOICE_WINDOW_CUTOFF_HOUR=18 → el corte se mueve a las 18:00 MX', async () => {
    vi.stubEnv('INVOICE_WINDOW_CUTOFF_HOUR', '18')
    vi.resetModules()
    const { isPortalWindowOpen: freshIsPortalWindowOpen } = await import('../src/domain/eligibility/InvoiceWindowPolicy')

    // 30-jun 18:00 MX = 01-jul 00:00 UTC.
    expect(freshIsPortalWindowOpen(new Date('2026-06-30T23:59:00.000Z'))).toBe(true)
    expect(freshIsPortalWindowOpen(new Date('2026-07-01T00:00:00.000Z'))).toBe(false)
  })

  it('valor inválido (no numérico) → cae al default 21', async () => {
    vi.stubEnv('INVOICE_WINDOW_CUTOFF_HOUR', 'not-a-number')
    vi.resetModules()
    const { isPortalWindowOpen: freshIsPortalWindowOpen } = await import('../src/domain/eligibility/InvoiceWindowPolicy')

    expect(freshIsPortalWindowOpen(new Date('2026-08-01T02:59:00.000Z'))).toBe(true)
    expect(freshIsPortalWindowOpen(new Date('2026-08-01T03:00:00.000Z'))).toBe(false)
  })

  it('valor fuera de rango (25) → cae al default 21', async () => {
    vi.stubEnv('INVOICE_WINDOW_CUTOFF_HOUR', '25')
    vi.resetModules()
    const { isPortalWindowOpen: freshIsPortalWindowOpen } = await import('../src/domain/eligibility/InvoiceWindowPolicy')

    expect(freshIsPortalWindowOpen(new Date('2026-08-01T03:00:00.000Z'))).toBe(false)
  })
})
