/**
 * GlobalPeriod — Value Object de dominio puro.
 *
 * Representa el periodo (año, mes[, día]) de un CFDI global. El cálculo de
 * límites en zona MX reutiliza el shared kernel MxCalendar (la misma
 * mecánica que usa InvoiceWindowPolicy) — ver src/domain/shared/MxCalendar.ts.
 *
 * `day` es opcional: `undefined` = periodo MENSUAL (`createGlobalPeriod`,
 * periodicityCode '04'); presente = periodo DIARIO (`createDailyGlobalPeriod`,
 * periodicityCode '01'). Se prefirió un campo opcional + segunda fábrica
 * sobre una unión discriminada (Monthly | Daily) para no forzar narrowing en
 * los ~150 call sites/tests mensuales existentes — ambos periodos comparten
 * la misma interfaz y `createGlobalPeriod` queda intacta (ver plan de diseño
 * D1, ~/.claude/memorias/portal-facturacion_periodicidad_plan.md).
 */

import { mxDayBounds, mxMonthBounds } from '../shared/MxCalendar'

export interface GlobalPeriod {
  readonly year: number
  readonly month: number
  /** Día del periodo diario; `undefined` en un periodo mensual. */
  readonly day?: number
  /**
   * Rango [from, to] en zona America/Mexico_City: el mes calendario completo
   * (mensual) o el día calendario (diario).
   */
  rangeMx(): { from: Date; to: Date }
  /** Clave SAT c_Periodicidad: '04' = Mensual, '01' = Diario. */
  periodicityCode(): '01' | '04'
  /** Mes en formato SAT de 2 dígitos, '01'..'12'. */
  monthsCode(): string
  /** Año como string, ej. "2026". */
  yearString(): string
}

function validateYear(year: number): void {
  if (!Number.isInteger(year) || year < 1970 || year > 9999) {
    throw new Error(`GlobalPeriod: year inválido (${year})`)
  }
}

function validateMonth(month: number): void {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`GlobalPeriod: month inválido (${month}), debe ser 1..12`)
  }
}

/**
 * Construye un GlobalPeriod MENSUAL validado. `month` es 1-indexed (1 = enero).
 * Conservada INTACTA (misma firma/comportamiento) para no romper los call
 * sites y tests mensuales existentes.
 */
export function createGlobalPeriod(year: number, month: number): GlobalPeriod {
  validateYear(year)
  validateMonth(month)

  return {
    year,
    month,
    day: undefined,
    rangeMx: () => mxMonthBounds(year, month),
    periodicityCode: () => '04',
    monthsCode: () => String(month).padStart(2, '0'),
    yearString: () => String(year),
  }
}

/**
 * Construye un GlobalPeriod DIARIO validado. `month`/`day` son 1-indexed.
 * SAT (Anexo 20 / c_Periodicidad '01'): el día NO se codifica en
 * `GlobalInformation` — solo viajan `Periodicity`, `Months` (mes del día) y
 * `Year`; el día específico queda implícito en `FechaEmision` del CFDI.
 */
export function createDailyGlobalPeriod(year: number, month: number, day: number): GlobalPeriod {
  validateYear(year)
  validateMonth(month)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth) {
    throw new Error(`GlobalPeriod: day inválido (${day}) para ${year}-${String(month).padStart(2, '0')}, debe ser 1..${daysInMonth}`)
  }

  return {
    year,
    month,
    day,
    rangeMx: () => mxDayBounds(year, month, day),
    periodicityCode: () => '01',
    monthsCode: () => String(month).padStart(2, '0'),
    yearString: () => String(year),
  }
}
