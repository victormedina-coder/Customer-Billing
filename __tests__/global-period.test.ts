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

describe('createGlobalPeriod — rangeMx (VENTANA RODANTE anclada al corte, finanzas 2026-07-24)', () => {
  // El corte por defecto son las 21:00 MX = 03:00 UTC del día siguiente
  // (MX es UTC-6 fijo, sin DST desde 2022).
  it('junio 2026: from = corte de MAYO (31-may 21:00 MX), to = corte de junio − 1ms', () => {
    const { from, to } = createGlobalPeriod(2026, 6).rangeMx()
    expect(from.toISOString()).toBe('2026-06-01T03:00:00.000Z') // 31-may 21:00 MX
    expect(to.toISOString()).toBe('2026-07-01T02:59:59.999Z')   // 30-jun 20:59:59.999 MX
  })

  it('febrero bisiesto (2028): el corte cae el 29 de febrero', () => {
    const { to } = createGlobalPeriod(2028, 2).rangeMx()
    expect(to.toISOString()).toBe('2028-03-01T02:59:59.999Z')
  })

  it('febrero no bisiesto (2026): el corte cae el 28 de febrero', () => {
    const { to } = createGlobalPeriod(2026, 2).rangeMx()
    expect(to.toISOString()).toBe('2026-03-01T02:59:59.999Z')
  })

  it('diciembre → enero: el corte de diciembre cruza al año siguiente', () => {
    const { from, to } = createGlobalPeriod(2026, 12).rangeMx()
    expect(from.toISOString()).toBe('2026-12-01T03:00:00.000Z') // 30-nov 21:00 MX
    expect(to.toISOString()).toBe('2027-01-01T02:59:59.999Z')   // 31-dic 20:59:59.999 MX
  })

  it('enero: el `from` retrocede al corte de DICIEMBRE del año anterior', () => {
    const { from } = createGlobalPeriod(2026, 1).rangeMx()
    expect(from.toISOString()).toBe('2026-01-01T03:00:00.000Z') // 31-dic-2025 21:00 MX
  })

  it('INVARIANTE: periodos consecutivos EMBONAN — sin hueco ni traslape', () => {
    const junio = createGlobalPeriod(2026, 6).rangeMx()
    const julio = createGlobalPeriod(2026, 7).rangeMx()
    const agosto = createGlobalPeriod(2026, 8).rangeMx()

    expect(julio.from.getTime()).toBe(junio.to.getTime() + 1)
    expect(agosto.from.getTime()).toBe(julio.to.getTime() + 1)
  })

  it('el ticket post-corte del último día del mes cae en la global del mes SIGUIENTE', () => {
    // Caso real: venta POS del 31-jul-2026 a las 22:48 MX (= 1-ago 04:48 UTC).
    // Es la venta que con el rango de mes calendario no entraba en NINGUNA global.
    const ticket = new Date('2026-08-01T04:48:00.000Z')
    const julio = createGlobalPeriod(2026, 7).rangeMx()
    const agosto = createGlobalPeriod(2026, 8).rangeMx()

    expect(ticket > julio.to).toBe(true)
    expect(ticket >= agosto.from && ticket <= agosto.to).toBe(true)
  })

  it('la hora de corte es inyectable: con corte a las 23:00 la frontera se recorre 2 h', () => {
    const { from, to } = createGlobalPeriod(2026, 6, 23).rangeMx()
    expect(from.toISOString()).toBe('2026-06-01T05:00:00.000Z') // 31-may 23:00 MX
    expect(to.toISOString()).toBe('2026-07-01T04:59:59.999Z')   // 30-jun 22:59:59.999 MX
  })

  it('from y to son consistentes: to > from', () => {
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

describe('createDailyGlobalPeriod — rangeMx (ventana rodante de 24 h entre cortes)', () => {
  it('15-jun-2026: from = corte del día 14 (21:00 MX), to = corte del día 15 − 1ms', () => {
    const { from, to } = createDailyGlobalPeriod(2026, 6, 15).rangeMx()
    expect(from.toISOString()).toBe('2026-06-15T03:00:00.000Z') // 14-jun 21:00 MX
    expect(to.toISOString()).toBe('2026-06-16T02:59:59.999Z')   // 15-jun 20:59:59.999 MX
  })

  it('día 1: el `from` retrocede al corte del último día del mes ANTERIOR', () => {
    const { from, to } = createDailyGlobalPeriod(2026, 7, 1).rangeMx()
    expect(from.toISOString()).toBe('2026-07-01T03:00:00.000Z') // 30-jun 21:00 MX
    expect(to.toISOString()).toBe('2026-07-02T02:59:59.999Z')   // 1-jul 20:59:59.999 MX
  })

  it('INVARIANTE: días consecutivos EMBONAN — sin hueco ni traslape', () => {
    const dia22 = createDailyGlobalPeriod(2026, 7, 22).rangeMx()
    const dia23 = createDailyGlobalPeriod(2026, 7, 23).rangeMx()
    expect(dia23.from.getTime()).toBe(dia22.to.getTime() + 1)
  })

  it('el rango es de un solo día, NO del mes completo (a diferencia del mensual)', () => {
    const daily = createDailyGlobalPeriod(2026, 6, 15).rangeMx()
    const monthly = createGlobalPeriod(2026, 6).rangeMx()
    expect(daily.to.getTime() - daily.from.getTime()).toBeLessThan(monthly.to.getTime() - monthly.from.getTime())
  })
})
