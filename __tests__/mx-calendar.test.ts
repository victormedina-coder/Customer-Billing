/**
 * Tests de previousMxYearMonth (src/domain/shared/MxCalendar.ts).
 *
 * Cubre el caso de borde que motivó la función: el mes anterior SIEMPRE se
 * calcula sobre el calendario de México, no el de UTC. Cerca de la
 * medianoche UTC, ambos calendarios pueden estar en días (y meses)
 * distintos — un cálculo ingenuo en UTC daría un mes adelantado respecto al
 * que realmente corresponde en MX.
 */

import { describe, it, expect } from 'vitest'
import {
  currentMxYearMonth,
  mxDayBounds,
  mxMonthInvoiceCutoff,
  previousMxDay,
  previousMxYearMonth,
} from '../src/domain/shared/MxCalendar'

describe('mxDayBounds', () => {
  it('día normal (15-jun-2026): from = 00:00 MX, to = 23:59:59.999 MX del mismo día', () => {
    const { from, to } = mxDayBounds(2026, 6, 15)
    // 00:00 MX = 06:00 UTC (MX es UTC-6 fijo, sin DST desde 2022)
    expect(from.toISOString()).toBe('2026-06-15T06:00:00.000Z')
    // 23:59:59.999 MX del 15-jun = 05:59:59.999 UTC del 16-jun
    expect(to.toISOString()).toBe('2026-06-16T05:59:59.999Z')
  })

  it('primer día del mes (1-jun-2026)', () => {
    const { from, to } = mxDayBounds(2026, 6, 1)
    expect(from.toISOString()).toBe('2026-06-01T06:00:00.000Z')
    expect(to.toISOString()).toBe('2026-06-02T05:59:59.999Z')
  })

  it('último día del mes (30-jun-2026): to cruza al 1 de julio en UTC pero el día MX sigue siendo 30', () => {
    const { from, to } = mxDayBounds(2026, 6, 30)
    expect(from.toISOString()).toBe('2026-06-30T06:00:00.000Z')
    expect(to.toISOString()).toBe('2026-07-01T05:59:59.999Z')
  })

  it('fin de año (31-dic-2026): to cruza al 1 de enero de 2027', () => {
    const { from, to } = mxDayBounds(2026, 12, 31)
    expect(from.toISOString()).toBe('2026-12-31T06:00:00.000Z')
    expect(to.toISOString()).toBe('2027-01-01T05:59:59.999Z')
  })

  it('29-feb bisiesto (2028)', () => {
    const { from, to } = mxDayBounds(2028, 2, 29)
    expect(from.toISOString()).toBe('2028-02-29T06:00:00.000Z')
    expect(to.toISOString()).toBe('2028-03-01T05:59:59.999Z')
  })

  it('from y to son consistentes: to > from y el rango dura ~24h', () => {
    const { from, to } = mxDayBounds(2026, 6, 15)
    const durationMs = to.getTime() - from.getTime()
    expect(durationMs).toBe(24 * 60 * 60 * 1000 - 1)
  })
})

describe('previousMxYearMonth', () => {
  it('mes normal: julio → junio (mismo año)', () => {
    // 15-jul-2026 12:00 MX = 18:00 UTC
    const result = previousMxYearMonth(new Date('2026-07-15T18:00:00.000Z'))
    expect(result).toEqual({ year: 2026, month: 6 })
  })

  it('enero → diciembre del año anterior', () => {
    // 15-ene-2026 12:00 MX = 18:00 UTC
    const result = previousMxYearMonth(new Date('2026-01-15T18:00:00.000Z'))
    expect(result).toEqual({ year: 2025, month: 12 })
  })

  it('borde de TZ: 1-ago 05:30 UTC todavía es 31-jul en MX → mes anterior es JUNIO, no julio', () => {
    // Un cálculo ingenuo en UTC leería "agosto" como mes actual y respondería
    // julio. El calendario MX real todavía marca julio (31-jul 23:30 MX), así
    // que el mes anterior correcto es junio.
    const result = previousMxYearMonth(new Date('2026-08-01T05:30:00.000Z'))
    expect(result).toEqual({ year: 2026, month: 6 })
  })

  it('justo después del borde (06:00:00.000 UTC = 00:00 MX del 1-ago): el mes MX ya es agosto, mes anterior julio', () => {
    const result = previousMxYearMonth(new Date('2026-08-01T06:00:00.000Z'))
    expect(result).toEqual({ year: 2026, month: 7 })
  })
})

describe('currentMxYearMonth (R4)', () => {
  it('mes normal: dentro de julio en MX → julio', () => {
    const result = currentMxYearMonth(new Date('2026-07-15T18:00:00.000Z'))
    expect(result).toEqual({ year: 2026, month: 7 })
  })

  it('cerca de medianoche UTC: 1-ago 05:30 UTC todavía es 31-jul en MX → mes en curso es JULIO', () => {
    const result = currentMxYearMonth(new Date('2026-08-01T05:30:00.000Z'))
    expect(result).toEqual({ year: 2026, month: 7 })
  })

  it('justo después del borde (06:00:00.000 UTC = 00:00 MX del 1-ago): mes en curso ya es agosto', () => {
    const result = currentMxYearMonth(new Date('2026-08-01T06:00:00.000Z'))
    expect(result).toEqual({ year: 2026, month: 8 })
  })
})

// [DAILY-SCAFFOLDING] test-only, remover junto con previousMxDay (ver plan R5).
describe('previousMxDay (R4 — exclusivo del modo relative:"yesterday", bundle diario)', () => {
  it('día normal: 16-jun-2026 12:00 MX → ayer es 15-jun-2026', () => {
    // 16-jun-2026 12:00 MX = 18:00 UTC
    const result = previousMxDay(new Date('2026-06-16T18:00:00.000Z'))
    expect(result).toEqual({ year: 2026, month: 6, day: 15 })
  })

  it('día 1 del mes: 1-jul-2026 12:00 MX → ayer cae en el ÚLTIMO día del mes previo (30-jun)', () => {
    const result = previousMxDay(new Date('2026-07-01T18:00:00.000Z'))
    expect(result).toEqual({ year: 2026, month: 6, day: 30 })
  })

  it('1-ene: 1-ene-2026 12:00 MX → ayer cae en 31-dic del año anterior', () => {
    const result = previousMxDay(new Date('2026-01-01T18:00:00.000Z'))
    expect(result).toEqual({ year: 2025, month: 12, day: 31 })
  })

  it('tras 29-feb bisiesto: 1-mar-2028 12:00 MX → ayer es 29-feb-2028', () => {
    const result = previousMxDay(new Date('2028-03-01T18:00:00.000Z'))
    expect(result).toEqual({ year: 2028, month: 2, day: 29 })
  })

  it('tras 28-feb no bisiesto: 1-mar-2026 12:00 MX → ayer es 28-feb-2026 (no hay 29)', () => {
    const result = previousMxDay(new Date('2026-03-01T18:00:00.000Z'))
    expect(result).toEqual({ year: 2026, month: 2, day: 28 })
  })

  it('borde de TZ: 1-ago 05:30 UTC todavía es 31-jul en MX → ayer es 30-jul, no 31', () => {
    const result = previousMxDay(new Date('2026-08-01T05:30:00.000Z'))
    expect(result).toEqual({ year: 2026, month: 7, day: 30 })
  })

  it('justo después del borde (06:00:00.000 UTC = 00:00 MX del 1-ago): ayer ya es 31-jul', () => {
    const result = previousMxDay(new Date('2026-08-01T06:00:00.000Z'))
    expect(result).toEqual({ year: 2026, month: 7, day: 31 })
  })
})

describe('mxMonthInvoiceCutoff (R3 — corte 21:00 MX del último día del mes)', () => {
  it('junio 2026 (30 días), default 21:00: cutoff = 30-jun 21:00 MX = 01-jul 03:00 UTC', () => {
    const cutoff = mxMonthInvoiceCutoff(2026, 6)
    expect(cutoff.toISOString()).toBe('2026-07-01T03:00:00.000Z')
  })

  it('julio 2026 (31 días), default 21:00: cutoff = 31-jul 21:00 MX = 01-ago 03:00 UTC', () => {
    const cutoff = mxMonthInvoiceCutoff(2026, 7)
    expect(cutoff.toISOString()).toBe('2026-08-01T03:00:00.000Z')
  })

  it('febrero no bisiesto (2026, 28 días): cutoff = 28-feb 21:00 MX = 01-mar 03:00 UTC', () => {
    const cutoff = mxMonthInvoiceCutoff(2026, 2)
    expect(cutoff.toISOString()).toBe('2026-03-01T03:00:00.000Z')
  })

  it('febrero bisiesto (2028, 29 días): cutoff = 29-feb 21:00 MX = 01-mar 03:00 UTC', () => {
    const cutoff = mxMonthInvoiceCutoff(2028, 2)
    expect(cutoff.toISOString()).toBe('2028-03-01T03:00:00.000Z')
  })

  it('diciembre (31 días) cruza al año siguiente: cutoff = 31-dic 21:00 MX = 01-ene 03:00 UTC del año +1', () => {
    const cutoff = mxMonthInvoiceCutoff(2026, 12)
    expect(cutoff.toISOString()).toBe('2027-01-01T03:00:00.000Z')
  })

  it('cutoffHour configurable: 18:00 MX en vez de 21:00', () => {
    const cutoff = mxMonthInvoiceCutoff(2026, 6, 18)
    // 30-jun 18:00 MX = 01-jul 00:00 UTC
    expect(cutoff.toISOString()).toBe('2026-07-01T00:00:00.000Z')
  })

  it('cutoffHour 0 (medianoche): cutoff = 00:00 MX del ÚLTIMO día del mes (no el inicio del mes siguiente)', () => {
    // 30-jun 00:00 MX = 30-jun 06:00 UTC — un día antes de mxMonthStart(2026, 7).
    const cutoff = mxMonthInvoiceCutoff(2026, 6, 0)
    expect(cutoff.toISOString()).toBe('2026-06-30T06:00:00.000Z')
  })
})
