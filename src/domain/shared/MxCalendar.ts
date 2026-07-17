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
 * generaliza `getMxYearMonth` agregando el día. Privada: solo la usa
 * `previousMxDay` (ver nota de scaffolding abajo).
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
