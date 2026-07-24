/**
 * invoice-window.ts
 *
 * Regla fiscal: un pedido solo puede facturarse si su fecha de creación cae
 * dentro del mes calendario en curso, evaluado en zona horaria de México —
 * Y además la ventana debe seguir ABIERTA: cierra al CORTE de las 21:00 MX
 * del último día del mes (no a medianoche), decisión de contabilidad
 * 2026-07-16 (ver plan de diseño R2/R3). Las tiendas POS no venden después
 * de esa hora, así que el corte evita que un cliente autofacture a las 23:00
 * un ticket que la facturación GLOBAL ya barrió a las 21:00 (doble factura).
 *
 * Zona horaria:
 *   México abolió el horario de verano (DST) a partir del 30 de octubre de 2022.
 *   Desde entonces America/Mexico_City es UTC-6 fijo (CST permanente).
 *   Sin embargo, NO hardcodeamos -6 como offset literal: usamos Intl.DateTimeFormat
 *   con la IANA tz "America/Mexico_City" para que el motor V8 aplique las reglas
 *   históricas correctas. Si en el futuro el gobierno revertiese el cambio, el
 *   runtime lo manejaría sin tocar este código.
 *
 * TODO contador: RESUELTO (2026-07-16) — corte 21:00 MX del último día del
 *   mes en curso (antes: sin corte, ventana abierta hasta medianoche). Si el
 *   negocio define un plazo distinto en el futuro, ajustar la constante
 *   INVOICE_WINDOW_MODE y agregar el branch correspondiente en
 *   isWithinInvoiceWindow().
 *
 * La mecánica de cálculo de límites de mes en zona MX vive en
 * src/domain/shared/MxCalendar.ts (shared kernel) — la reutiliza también
 * GlobalPeriod (src/domain/global/) para la facturación global mensual.
 */

import { getMxYearMonth, mxMonthInvoiceCutoff, mxMonthStart, resolveInvoiceCutoffHour } from '../shared/MxCalendar'

/** Modos de ventana disponibles. Hoy solo se usa 'current-month'. */
type InvoiceWindowMode = 'current-month'

// Punto configurable: cambiar aquí (o leer de env) cuando el negocio defina
// un plazo distinto al mes calendario en curso.
const INVOICE_WINDOW_MODE: InvoiceWindowMode =
  (process.env.INVOICE_WINDOW_MODE as InvoiceWindowMode | undefined) ?? 'current-month'

/**
 * Hora (0-23, zona MX) del corte de facturación del último día del mes.
 *
 * La resolución vive en el shared kernel (`resolveInvoiceCutoffHour`) porque
 * la comparte con `GlobalPeriod`: la ventana del portal individual y la
 * ventana rodante de la global DEBEN cerrar a la misma hora, o los pedidos
 * de la franja intermedia quedan fuera de ambas vías (2026-07-24).
 */
const INVOICE_WINDOW_CUTOFF_HOUR: number = resolveInvoiceCutoffHour()

/**
 * Corte de facturación del mes EN CURSO respecto a `now` (zona MX). Único
 * punto de cálculo del cutoff — lo comparten `isWithinInvoiceWindow` (gate
 * por pedido) e `isPortalWindowOpen` (flag "cerrado para TODOS", R3 Paso
 * 3.3 — pantalla de bloqueo del frontend) para que nunca queden
 * desincronizados (DRY).
 */
function cutoffForNow(now: Date): Date {
  const { year, month } = getMxYearMonth(now)
  return mxMonthInvoiceCutoff(year, month, INVOICE_WINDOW_CUTOFF_HOUR)
}

/**
 * Determina si el pedido representado por `createdAtIso` puede facturarse
 * según la ventana de elegibilidad configurada.
 *
 * @param createdAtIso  Fecha ISO 8601 del pedido (ej. "2026-06-15T20:30:00Z").
 * @param now           Momento de evaluación; por defecto `new Date()`.
 *                      Se puede inyectar en tests para simular fechas.
 * @returns `true` si el pedido cae dentro de la ventana Y el corte del mes
 *          en curso todavía no pasó.
 */
export function isWithinInvoiceWindow(createdAtIso: string, now: Date = new Date()): boolean {
  const orderDate = new Date(createdAtIso)

  if (isNaN(orderDate.getTime())) {
    // createdAt malformado → conservador: denegar
    return false
  }

  if (INVOICE_WINDOW_MODE === 'current-month') {
    const { year, month } = getMxYearMonth(now)
    const monthStart = mxMonthStart(year, month)
    const cutoff = cutoffForNow(now)
    // Ventana: [inicio del mes en curso en MX, now], Y now todavía no llegó
    // al corte de las 21:00 MX del último día del mes.
    return orderDate >= monthStart && orderDate <= now && now < cutoff
  }

  // Modo desconocido → conservador: denegar
  return false
}

/**
 * Flag "ventana de facturación CERRADA PARA TODOS" (R3 — Paso 3.3, lo
 * consume el frontend para la pantalla de bloqueo). A diferencia de
 * `isWithinInvoiceWindow`, NO depende de ningún pedido en particular: solo
 * responde si el corte del mes en curso ya pasó respecto a `now`. Comparte
 * el MISMO cutoff que la policy individual (`cutoffForNow`) para que la
 * pantalla de bloqueo y el gate server nunca queden desincronizados.
 *
 * @param now  Momento de evaluación; por defecto `new Date()`. En el
 *             server component del portal, pasar `getEvaluationNow()`
 *             (src/infrastructure/time/getEvaluationNow.ts) — misma fuente
 *             de "ahora" que usa el resto del portal.
 * @returns `true` si la ventana del mes en curso SIGUE abierta (antes del corte).
 */
export function isPortalWindowOpen(now: Date = new Date()): boolean {
  return now < cutoffForNow(now)
}
