/**
 * invoice-window.ts
 *
 * Regla fiscal: un pedido solo puede facturarse si su fecha de creación cae
 * dentro del mes calendario en curso, evaluado en zona horaria de México.
 *
 * Zona horaria:
 *   México abolió el horario de verano (DST) a partir del 30 de octubre de 2022.
 *   Desde entonces America/Mexico_City es UTC-6 fijo (CST permanente).
 *   Sin embargo, NO hardcodeamos -6 como offset literal: usamos Intl.DateTimeFormat
 *   con la IANA tz "America/Mexico_City" para que el motor V8 aplique las reglas
 *   históricas correctas. Si en el futuro el gobierno revertiese el cambio, el
 *   runtime lo manejaría sin tocar este código.
 *
 * TODO contador: confirmar corte/plazo exacto (mes en curso por ahora).
 *   Si el SAT o el negocio define un plazo distinto (ej. 5 días hábiles, mes
 *   siguiente hasta el día 3, etc.), ajustar la constante INVOICE_WINDOW_MODE
 *   y agregar el branch correspondiente en isWithinInvoiceWindow().
 *
 * La mecánica de cálculo de límites de mes en zona MX vive en
 * src/domain/shared/MxCalendar.ts (shared kernel) — la reutiliza también
 * GlobalPeriod (src/domain/global/) para la facturación global mensual.
 */

import { getMxYearMonth, mxMonthStart } from '../shared/MxCalendar'

/** Modos de ventana disponibles. Hoy solo se usa 'current-month'. */
type InvoiceWindowMode = 'current-month'

// Punto configurable: cambiar aquí (o leer de env) cuando el negocio defina
// un plazo distinto al mes calendario en curso.
const INVOICE_WINDOW_MODE: InvoiceWindowMode =
  (process.env.INVOICE_WINDOW_MODE as InvoiceWindowMode | undefined) ?? 'current-month'

/**
 * Retorna el instante UTC que corresponde al primer segundo del mes en curso
 * en zona horaria de México (00:00:00.000 MX = inicio del mes), a partir del
 * `now` de evaluación.
 */
function getMxMonthStart(now: Date): Date {
  const { year, month } = getMxYearMonth(now)
  return mxMonthStart(year, month)
}

/**
 * Determina si el pedido representado por `createdAtIso` puede facturarse
 * según la ventana de elegibilidad configurada.
 *
 * @param createdAtIso  Fecha ISO 8601 del pedido (ej. "2026-06-15T20:30:00Z").
 * @param now           Momento de evaluación; por defecto `new Date()`.
 *                      Se puede inyectar en tests para simular fechas.
 * @returns `true` si el pedido cae dentro de la ventana.
 */
export function isWithinInvoiceWindow(createdAtIso: string, now: Date = new Date()): boolean {
  const orderDate = new Date(createdAtIso)

  if (isNaN(orderDate.getTime())) {
    // createdAt malformado → conservador: denegar
    return false
  }

  if (INVOICE_WINDOW_MODE === 'current-month') {
    // Ventana: [inicio del mes en curso en MX, now]
    const monthStart = getMxMonthStart(now)
    return orderDate >= monthStart && orderDate <= now
  }

  // Modo desconocido → conservador: denegar
  return false
}
