/**
 * GlobalPeriod — Value Object de dominio puro.
 *
 * Representa el periodo (año, mes) de un CFDI global mensual. El cálculo de
 * límites de mes en zona MX reutiliza el shared kernel MxCalendar (la misma
 * mecánica que usa InvoiceWindowPolicy) — ver src/domain/shared/MxCalendar.ts.
 */

import { mxMonthBounds } from '../shared/MxCalendar'

export interface GlobalPeriod {
  readonly year: number
  readonly month: number
  /** Rango [from, to] del mes calendario en zona America/Mexico_City. */
  rangeMx(): { from: Date; to: Date }
  /** Clave SAT c_Periodicidad para comprobante global: '04' = Mensual. */
  periodicityCode(): '04'
  /** Mes en formato SAT de 2 dígitos, '01'..'12'. */
  monthsCode(): string
  /** Año como string, ej. "2026". */
  yearString(): string
}

/**
 * Construye un GlobalPeriod validado. `month` es 1-indexed (1 = enero).
 */
export function createGlobalPeriod(year: number, month: number): GlobalPeriod {
  if (!Number.isInteger(year) || year < 1970 || year > 9999) {
    throw new Error(`GlobalPeriod: year inválido (${year})`)
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`GlobalPeriod: month inválido (${month}), debe ser 1..12`)
  }

  return {
    year,
    month,
    rangeMx: () => mxMonthBounds(year, month),
    periodicityCode: () => '04',
    monthsCode: () => String(month).padStart(2, '0'),
    yearString: () => String(year),
  }
}
