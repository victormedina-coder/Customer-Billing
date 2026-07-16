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
import { mxDayBounds, previousMxYearMonth } from '../src/domain/shared/MxCalendar'

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
