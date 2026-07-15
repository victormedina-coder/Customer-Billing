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
import { previousMxYearMonth } from '../src/domain/shared/MxCalendar'

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
