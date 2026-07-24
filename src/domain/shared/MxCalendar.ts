/**
 * MxCalendar — utilidades de calendario puras para zona horaria de México.
 *
 * Shared kernel de dominio: extraído de InvoiceWindowPolicy para que
 * cualquier VO/policy que necesite límites de mes en zona MX (ej.
 * GlobalPeriod, facturación global mensual) use la MISMA mecánica en
 * lugar de reimplementarla (DRY).
 *
 * Zona horaria:
 *   México abolió el horario de verano (DST) a partir del 30 de octubre de 2022.
 *   Desde entonces America/Mexico_City es UTC-6 fijo (CST permanente).
 *   Sin embargo, NO hardcodeamos -6 como offset literal: usamos Intl.DateTimeFormat
 *   con la IANA tz "America/Mexico_City" para que el motor V8 aplique las reglas
 *   históricas correctas. Si en el futuro el gobierno revertiese el cambio, el
 *   runtime lo manejaría sin tocar este código.
 */

export const MX_TZ = 'America/Mexico_City'

/**
 * Devuelve { year, month } (1-indexed) del instante `date` en zona MX.
 * Usa Intl para respetar las reglas históricas de la zona sin hardcodear UTC-6.
 */
export function getMxYearMonth(date: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MX_TZ,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(date)

  const year = Number(parts.find((p) => p.type === 'year')?.value ?? 0)
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? 0)
  return { year, month }
}

/**
 * Retorna el offset de America/Mexico_City en milisegundos para el instante dado.
 * Offset = localMX - UTC → negativo para UTC-6 (-21_600_000 ms).
 */
export function getMxOffsetMs(utcDate: Date): number {
  // Formateamos el instante en zona MX y en UTC para calcular la diferencia.
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(utcDate)

  const parse = (s: string): number => {
    // Formato: "MM/DD/YYYY, HH:MM:SS"
    const [datePart, timePart] = s.split(', ')
    const [mm, dd, yyyy] = datePart.split('/')
    const [hh, min, sec] = timePart.split(':')
    return Date.UTC(+yyyy, +mm - 1, +dd, +hh, +min, +sec)
  }

  const mxMs = parse(fmt(MX_TZ))
  const utcMs = parse(fmt('UTC'))
  return mxMs - utcMs // negativo para UTC-6
}

/**
 * Retorna el instante UTC que corresponde al primer segundo (00:00:00.000 MX)
 * del día `day` del mes `month` (1-indexed) del año `year`, en zona horaria
 * de México.
 *
 * Estrategia (sin dependencias externas): construimos el día como si fuera
 * medianoche UTC y ajustamos por la diferencia de offset entre UTC y MX en
 * ese punto. `mxMonthStart` es el caso `day=1` de esta misma función (DRY).
 */
export function mxDayStart(year: number, month: number, day: number): Date {
  const naiveUtcMs = Date.UTC(year, month - 1, day) // día dado, 00:00 UTC
  const offsetMs = getMxOffsetMs(new Date(naiveUtcMs))
  // El instante real de "00:00 MX" = naiveUTC - offsetMX
  // (si MX es UTC-6, offsetMs = -6*3600*1000, restamos negativo → sumamos 6h)
  return new Date(naiveUtcMs - offsetMs)
}

/**
 * Retorna el instante UTC que corresponde al primer segundo (00:00:00.000 MX)
 * del mes `month` (1-indexed) del año `year`, en zona horaria de México.
 * Reexpresado como caso `day=1` de `mxDayStart` (DRY) — la firma pública no
 * cambia.
 */
export function mxMonthStart(year: number, month: number): Date {
  return mxDayStart(year, month, 1)
}

/**
 * Límites [from, to] del día `day`/`month`/`year` en zona MX: `from` =
 * primer instante del día (00:00:00.000 MX), `to` = último instante del día
 * (el ms inmediatamente anterior al inicio del día siguiente). Usa
 * `Date.UTC` con día fuera de rango (ej. día 32) para que JS normalice al
 * mes siguiente — misma técnica que `mxMonthBounds` con el mes.
 */
export function mxDayBounds(year: number, month: number, day: number): { from: Date; to: Date } {
  const from = mxDayStart(year, month, day)
  const to = new Date(mxDayStart(year, month, day + 1).getTime() - 1)
  return { from, to }
}

/**
 * Límites [from, to] del mes calendario `month`/`year` en zona MX:
 * `from` = primer instante del mes (00:00:00.000 MX), `to` = último instante
 * del mes (el ms inmediatamente anterior al inicio del mes siguiente).
 */
export function mxMonthBounds(year: number, month: number): { from: Date; to: Date } {
  const from = mxMonthStart(year, month)
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  const to = new Date(mxMonthStart(nextYear, nextMonth).getTime() - 1)
  return { from, to }
}

/**
 * Retorna el instante UTC del CORTE de facturación del mes `month`/`year` en
 * zona MX: `cutoffHour` horas del ÚLTIMO día del mes (default 21:00 MX,
 * decisión de contabilidad 2026-07-16 — ver plan de diseño R2/R3, corte
 * mensual a las 21:00 porque las tiendas POS no venden después de esa hora).
 *
 * DRY sobre `mxMonthStart`: el corte es "medianoche del mes SIGUIENTE menos
 * (24 − cutoffHour) horas" — evita reimplementar el cálculo de fin de mes
 * (bisiestos, diciembre→enero) que `mxMonthStart`/`mxMonthBounds` ya
 * resuelven. Como México es UTC-6 fijo (sin DST desde 2022), restar horas
 * exactas a un instante UTC siempre aterriza en el mismo punto de reloj MX
 * sin ambigüedad de huso horario.
 */
export function mxMonthInvoiceCutoff(year: number, month: number, cutoffHour: number = DEFAULT_INVOICE_CUTOFF_HOUR): Date {
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  const hoursBeforeNextMidnight = 24 - cutoffHour
  return new Date(mxMonthStart(nextYear, nextMonth).getTime() - hoursBeforeNextMidnight * 60 * 60 * 1000)
}

/**
 * Análogo DIARIO de `mxMonthInvoiceCutoff`: instante UTC del corte del día
 * `day`/`month`/`year` — `cutoffHour` horas de ESE día en zona MX.
 *
 * Misma técnica que el mensual (medianoche del día SIGUIENTE menos
 * `24 − cutoffHour` horas) para reusar la normalización de `mxDayStart`: un
 * `day + 1` fuera de rango lo resuelve `Date.UTC` (fin de mes, fin de año,
 * 29-feb) sin lógica de calendario adicional. Por la misma razón acepta
 * `day = 0`, que denota el último día del mes anterior.
 */
export function mxDayInvoiceCutoff(
  year: number,
  month: number,
  day: number,
  cutoffHour: number = DEFAULT_INVOICE_CUTOFF_HOUR,
): Date {
  const hoursBeforeNextMidnight = 24 - cutoffHour
  return new Date(mxDayStart(year, month, day + 1).getTime() - hoursBeforeNextMidnight * 60 * 60 * 1000)
}

/** Hora de corte por defecto (21:00 MX) — decisión de contabilidad 2026-07-16, ADR-009. */
export const DEFAULT_INVOICE_CUTOFF_HOUR = 21

/**
 * Hora (0-23, zona MX) del corte de facturación. **Fuente única de verdad**:
 * la consumen tanto `InvoiceWindowPolicy` (ventana del portal individual)
 * como `GlobalPeriod` (ventana rodante de la global). Override por env
 * `INVOICE_WINDOW_CUTOFF_HOUR`; un valor vacío, no numérico o fuera de 0-23
 * cae al default.
 *
 * Vive aquí y no en cada policy porque mover el corte es una decisión de
 * contabilidad que debe aplicarse en UN lugar: si la ventana individual
 * cerrara a las 23:00 y la global siguiera barriendo a las 21:00, los
 * pedidos de esas 2 horas quedarían fuera de ambas vías.
 *
 * ⚠️ Cadena vacía NO es 0: `INVOICE_WINDOW_CUTOFF_HOUR=` en el `.env` debe
 * caer al default, no a medianoche (que equivale a "sin corte"). Por eso el
 * guardia es `if (!raw)` y no `??` — ver el fallo del probe del 2026-07-23.
 */
export function resolveInvoiceCutoffHour(): number {
  const raw = process.env.INVOICE_WINDOW_CUTOFF_HOUR
  if (!raw) return DEFAULT_INVOICE_CUTOFF_HOUR
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : DEFAULT_INVOICE_CUTOFF_HOUR
}

/**
 * Retorna el año/mes MX (1-indexed) inmediatamente ANTERIOR al de `now`.
 *
 * Pensado para defaultear el periodo de la facturación global mensual cuando
 * un disparador automático (cron) llama al endpoint sin year/month
 * explícitos. El cálculo SIEMPRE parte del calendario de México, no de UTC:
 * cerca de la medianoche UTC (ej. 1-ago 05:30 UTC) el reloj MX todavía marca
 * el mes previo (31-jul 23:30 MX), así que "el mes anterior" debe seguir
 * siendo junio — un cálculo ingenuo en UTC habría dado julio, un mes
 * adelantado respecto al periodo que realmente corresponde facturar.
 */
export function previousMxYearMonth(now: Date): { year: number; month: number } {
  const { year, month } = getMxYearMonth(now)
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
}

/**
 * Retorna el año/mes MX (1-indexed) del instante `now` — el mes calendario
 * EN CURSO. Nombre explícito (alias de `getMxYearMonth`) para usarse junto a
 * `previousMxYearMonth`/`previousMxDay` en la resolución de periodos
 * relativos del endpoint de facturación global (R4 — modo
 * `relative: 'current-month'`).
 */
export function currentMxYearMonth(now: Date): { year: number; month: number } {
  return getMxYearMonth(now)
}

/**
 * Devuelve { year, month, day } (1-indexed) del instante `date` en zona MX —
 * generaliza `getMxYearMonth` agregando el día. Privada: solo la usan
 * `currentMxDay` y `previousMxDay` (ver nota de scaffolding abajo).
 */
function getMxYearMonthDay(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MX_TZ,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date)

  const year = Number(parts.find((p) => p.type === 'year')?.value ?? 0)
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? 0)
  const day = Number(parts.find((p) => p.type === 'day')?.value ?? 0)
  return { year, month, day }
}

/**
 * [DAILY-SCAFFOLDING] test-only, remover antes de producción (ver plan R5).
 * Exclusiva del modo `relative: 'yesterday'` del endpoint de facturación
 * global (bundle de periodicidad DIARIA, R1) — no la usa ningún otro flujo.
 * Al retirar el bundle diario, esta función y `getMxYearMonthDay` (su único
 * consumidor) se eliminan juntas sin tocar el resto de este archivo.
 *
 * Retorna el día MX (año/mes/día, 1-indexed) inmediatamente ANTERIOR al de
 * `now` — "ayer" en zona MX. Resta 24h exactas al instante UTC y lee los
 * componentes de calendario MX del resultado: como México es UTC-6 fijo
 * (sin DST desde 2022), restar 24h SIEMPRE cae en el día calendario MX
 * anterior sin importar la hora de `now`, así que los bordes de fin de
 * mes/año/29-feb se resuelven solos vía aritmética nativa de `Date` — no
 * hace falta lógica especial de calendario aquí.
 */
export function previousMxDay(now: Date): { year: number; month: number; day: number } {
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  return getMxYearMonthDay(yesterday)
}

/**
 * [DAILY-SCAFFOLDING] test-only, remover antes de producción (ver plan R5).
 * Exclusiva del modo `relative: 'today'` del endpoint de facturación global.
 *
 * Retorna el día MX (año/mes/día, 1-indexed) EN CURSO al instante `now` — "hoy"
 * en zona MX.
 *
 * Por qué existe además de `previousMxDay`: es el análogo diario EXACTO de
 * `currentMxYearMonth` (el modo mensual de producción). Con el cron a las 21:00
 * MX, `current-month` factura un mes que sigue ABIERTO 3 horas más; `today`
 * reproduce esa misma semántica a escala de día, para que el andamiaje diario
 * ejercite el mismo riesgo que la corrida mensual real (ADR-009) en vez de
 * facturar siempre periodos ya cerrados, que es lo que hace `yesterday`.
 */
export function currentMxDay(now: Date): { year: number; month: number; day: number } {
  return getMxYearMonthDay(now)
}
