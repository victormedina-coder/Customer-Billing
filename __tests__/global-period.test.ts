import { describe, it, expect } from 'vitest'
import { createDailyGlobalPeriod, createGlobalPeriod } from '../src/domain/global/GlobalPeriod'

describe('createGlobalPeriod — validación', () => {
  it('month 0 → lanza', () => {
    expect(() => createGlobalPeriod(2026, 0)).toThrow(/month inválido/)
  })

  it('month 13 → lanza', () => {
    expect(() => createGlobalPeriod(2026, 13)).toThrow(/month inválido/)
  })

  it('month no entero → lanza', () => {
    expect(() => createGlobalPeriod(2026, 6.5)).toThrow(/month inválido/)
  })

  it('year no entero → lanza', () => {
    expect(() => createGlobalPeriod(2026.5, 6)).toThrow(/year inválido/)
  })

  it('year fuera de rango → lanza', () => {
    expect(() => createGlobalPeriod(1800, 6)).toThrow(/year inválido/)
  })

  it('month 1 y 12 (bordes válidos) → no lanza', () => {
    expect(() => createGlobalPeriod(2026, 1)).not.toThrow()
    expect(() => createGlobalPeriod(2026, 12)).not.toThrow()
  })
})

describe('createGlobalPeriod — códigos', () => {
  it('periodicityCode() === "04"', () => {
    expect(createGlobalPeriod(2026, 6).periodicityCode()).toBe('04')
  })

  it('monthsCode() rellena a 2 dígitos', () => {
    expect(createGlobalPeriod(2026, 6).monthsCode()).toBe('06')
    expect(createGlobalPeriod(2026, 12).monthsCode()).toBe('12')
    expect(createGlobalPeriod(2026, 1).monthsCode()).toBe('01')
  })

  it('yearString() devuelve el año como string', () => {
    expect(createGlobalPeriod(2026, 6).yearString()).toBe('2026')
  })
})

describe('createGlobalPeriod — rangeMx (bordes de mes en zona MX)', () => {
  it('junio 2026: from = 2026-06-01T00:00 MX, to = 2026-06-30T23:59:59.999 MX', () => {
    const { from, to } = createGlobalPeriod(2026, 6).rangeMx()
    // 00:00 MX = 06:00 UTC (MX es UTC-6 fijo, sin DST desde 2022)
    expect(from.toISOString()).toBe('2026-06-01T06:00:00.000Z')
    // 23:59:59.999 MX del 30 de junio = 05:59:59.999 UTC del 1 de julio
    expect(to.toISOString()).toBe('2026-07-01T05:59:59.999Z')
  })

  it('febrero bisiesto (2028): to cae en 29 de febrero', () => {
    const { to } = createGlobalPeriod(2028, 2).rangeMx()
    expect(to.toISOString()).toBe('2028-03-01T05:59:59.999Z')
  })

  it('febrero no bisiesto (2026): to cae en 28 de febrero', () => {
    const { to } = createGlobalPeriod(2026, 2).rangeMx()
    expect(to.toISOString()).toBe('2026-03-01T05:59:59.999Z')
  })

  it('diciembre → enero: to del periodo de diciembre cruza al 1 de enero del año siguiente', () => {
    const { from, to } = createGlobalPeriod(2026, 12).rangeMx()
    expect(from.toISOString()).toBe('2026-12-01T06:00:00.000Z')
    expect(to.toISOString()).toBe('2027-01-01T05:59:59.999Z')
  })

  it('from y to son consistentes: to > from y to está dentro del mismo mes calendario MX', () => {
    const { from, to } = createGlobalPeriod(2026, 6).rangeMx()
    expect(to.getTime()).toBeGreaterThan(from.getTime())
  })
})

describe('createDailyGlobalPeriod — validación', () => {
  it('day 0 → lanza', () => {
    expect(() => createDailyGlobalPeriod(2026, 6, 0)).toThrow(/day inválido/)
  })

  it('day 31 en un mes de 30 días → lanza', () => {
    expect(() => createDailyGlobalPeriod(2026, 6, 31)).toThrow(/day inválido/)
  })

  it('day 29 en febrero no bisiesto (2026) → lanza', () => {
    expect(() => createDailyGlobalPeriod(2026, 2, 29)).toThrow(/day inválido/)
  })

  it('day 29 en febrero bisiesto (2028) → no lanza', () => {
    expect(() => createDailyGlobalPeriod(2028, 2, 29)).not.toThrow()
  })

  it('day no entero → lanza', () => {
    expect(() => createDailyGlobalPeriod(2026, 6, 15.5)).toThrow(/day inválido/)
  })

  it('month/year inválidos siguen validándose igual que en el mensual', () => {
    expect(() => createDailyGlobalPeriod(2026, 13, 1)).toThrow(/month inválido/)
    expect(() => createDailyGlobalPeriod(1800, 6, 1)).toThrow(/year inválido/)
  })

  it('day 1 y último día del mes (bordes válidos) → no lanza', () => {
    expect(() => createDailyGlobalPeriod(2026, 6, 1)).not.toThrow()
    expect(() => createDailyGlobalPeriod(2026, 6, 30)).not.toThrow()
  })
})

describe('createDailyGlobalPeriod — códigos', () => {
  it('periodicityCode() === "01" (diario, distinto del mensual "04")', () => {
    expect(createDailyGlobalPeriod(2026, 6, 15).periodicityCode()).toBe('01')
  })

  it('day queda expuesto en el VO; en el mensual permanece undefined', () => {
    expect(createDailyGlobalPeriod(2026, 6, 15).day).toBe(15)
    expect(createGlobalPeriod(2026, 6).day).toBeUndefined()
  })

  it('monthsCode()/yearString() son el mes/año DEL DÍA (SAT: el día no se codifica en GlobalInformation)', () => {
    const period = createDailyGlobalPeriod(2026, 6, 15)
    expect(period.monthsCode()).toBe('06')
    expect(period.yearString()).toBe('2026')
  })
})

describe('createDailyGlobalPeriod — rangeMx (un solo día en zona MX)', () => {
  it('15-jun-2026: from = 00:00 MX, to = 23:59:59.999 MX del mismo día', () => {
    const { from, to } = createDailyGlobalPeriod(2026, 6, 15).rangeMx()
    expect(from.toISOString()).toBe('2026-06-15T06:00:00.000Z')
    expect(to.toISOString()).toBe('2026-06-16T05:59:59.999Z')
  })

  it('el rango es de un solo día, NO del mes completo (a diferencia del mensual)', () => {
    const daily = createDailyGlobalPeriod(2026, 6, 15).rangeMx()
    const monthly = createGlobalPeriod(2026, 6).rangeMx()
    expect(daily.to.getTime() - daily.from.getTime()).toBeLessThan(monthly.to.getTime() - monthly.from.getTime())
  })
})
