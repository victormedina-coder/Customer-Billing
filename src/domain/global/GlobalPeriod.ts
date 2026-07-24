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
 *
 * ─── VENTANA RODANTE (decisión de finanzas 2026-07-24) ───────────────────
 *
 * El periodo NO es el mes calendario: es la ventana que va del corte del
 * periodo anterior al corte de este periodo — p.ej. julio 2026 =
 * [30-jun 21:00 MX, 31-jul 21:00 MX).
 *
 * Por qué: el cron barre a las 21:00 del último día, así que los pedidos
 * creados DESPUÉS de esa hora no existían cuando corrió. Con un rango de mes
 * calendario esos tickets no entraban en la global de julio (ya se había
 * emitido) ni en la de agosto (`created_at` los ubica en julio) → quedaban
 * sin factura para siempre. Con la ventana rodante los periodos EMBONAN sin
 * hueco ni traslape, así que todo pedido cae en exactamente uno: el ticket
 * del 31-jul 22:48 entra en la global de agosto.
 *
 * Consecuencia aceptada por finanzas: ese CFDI reporta una operación de
 * julio dentro del global de agosto, y el cliente pierde la posibilidad de
 * autofacturarlo (la ventana individual cerró a las 21:00). Antes esto no
 * dolía porque la facturación se hacía a mano; la ventana rodante existe
 * para la operación automatizada.
 *
 * ⚠️ La frontera se ancla al instante PROGRAMADO del corte (21:00:00 MX),
 * nunca a `new Date()` de la ejecución: si el cron arrancara a las 21:04 y
 * enumerara "hasta ahora", la frontera se correría en cada corrida y
 * aparecerían huecos o traslapes en la costura.
 *
 * ⚠️ `rangeMx()` lo consumen DOS caminos —la enumeración de pedidos y el
 * filtro de exclusión de ya-facturados (`FacturamaInvoicedOrdersGateway`)—
 * y por eso la ventana vive aquí y no en el caso de uso: si ambos no usan
 * exactamente el mismo rango, la costura entre periodos duplica facturas.
 *
 * Los códigos SAT (`periodicityCode`, `monthsCode`, `yearString`) siguen
 * siendo los del mes CALENDARIO — la ventana rodante mueve qué pedidos
 * entran, no cómo se declara el periodo ante el SAT.
 */

import { mxDayInvoiceCutoff, mxMonthInvoiceCutoff, resolveInvoiceCutoffHour } from '../shared/MxCalendar'

export interface GlobalPeriod {
  readonly year: number
  readonly month: number
  /** Día del periodo diario; `undefined` en un periodo mensual. */
  readonly day?: number
  /**
   * Rango [from, to] en zona America/Mexico_City — **ventana RODANTE anclada
   * al corte**, no el mes/día calendario (ver el bloque VENTANA RODANTE en la
   * cabecera de este archivo).
   *
   * Mensual: [corte del mes anterior, corte de este mes).
   * Diario:  [corte del día anterior, corte de este día).
   *
   * `to` es INCLUSIVO (último ms antes del corte), consistente con el
   * contrato previo de `mxMonthBounds`/`mxDayBounds`.
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
export function createGlobalPeriod(
  year: number,
  month: number,
  cutoffHour: number = resolveInvoiceCutoffHour(),
): GlobalPeriod {
  validateYear(year)
  validateMonth(month)

  const previousMonth = month === 1 ? 12 : month - 1
  const previousYear = month === 1 ? year - 1 : year

  return {
    year,
    month,
    day: undefined,
    rangeMx: () => ({
      from: mxMonthInvoiceCutoff(previousYear, previousMonth, cutoffHour),
      to: new Date(mxMonthInvoiceCutoff(year, month, cutoffHour).getTime() - 1),
    }),
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
export function createDailyGlobalPeriod(
  year: number,
  month: number,
  day: number,
  cutoffHour: number = resolveInvoiceCutoffHour(),
): GlobalPeriod {
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
    rangeMx: () => ({
      from: mxDayInvoiceCutoff(year, month, day - 1, cutoffHour),
      to: new Date(mxDayInvoiceCutoff(year, month, day, cutoffHour).getTime() - 1),
    }),
    periodicityCode: () => '01',
    monthsCode: () => String(month).padStart(2, '0'),
    yearString: () => String(year),
  }
}
