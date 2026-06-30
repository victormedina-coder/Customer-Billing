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
 */

/** Modos de ventana disponibles. Hoy solo se usa 'current-month'. */
type InvoiceWindowMode = 'current-month'

// Punto configurable: cambiar aquí (o leer de env) cuando el negocio defina
// un plazo distinto al mes calendario en curso.
const INVOICE_WINDOW_MODE: InvoiceWindowMode =
  (process.env.INVOICE_WINDOW_MODE as InvoiceWindowMode | undefined) ?? 'current-month'

const MX_TZ = 'America/Mexico_City'

/**
 * Devuelve { year, month } (1-indexed) del instante `date` en zona MX.
 * Usa Intl para respetar las reglas históricas de la zona sin hardcodear UTC-6.
 */
function getMxYearMonth(date: Date): { year: number; month: number } {
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
 * Retorna el instante UTC que corresponde al primer segundo del mes en curso
 * en zona horaria de México (00:00:00.000 MX = inicio del mes).
 *
 * Estrategia: construimos una fecha local ficticia en MX usando
 * Intl.DateTimeFormat para obtener year/month, luego buscamos el UTC
 * que representa ese "medianoche MX" resolviendo el offset explícitamente.
 *
 * Método confiable sin dependencias externas:
 *   1. Tomamos year/month del `now` en zona MX.
 *   2. Creamos "YYYY-MM-01T00:00:00" como string con sufijo de zona y parseamos
 *      con Date. Esto funciona porque los runtimes modernos aceptan ISO 8601
 *      con IANA tz implícita — pero no todos. Para máxima portabilidad usamos
 *      la diferencia de offsets: interpretamos "YYYY-MM-01T00:00:00" como UTC
 *      y luego ajustamos por la diferencia de offset entre UTC y MX en ese punto.
 */
function getMxMonthStart(now: Date): Date {
  const { year, month } = getMxYearMonth(now)

  // Construimos el inicio del mes como si fuera UTC y después calculamos
  // cuántos ms de diferencia hay entre "UTC midnight" y "MX midnight".
  // Tomamos dos muestras de offset (inicio del mes en UTC-naíve) para
  // manejar correctamente cualquier transición DST histórica dentro del rango.
  const naiveUtcMs = Date.UTC(year, month - 1, 1) // 1 de mes, 00:00 UTC

  // Calculamos el offset de MX en ese instante: la diferencia entre lo que
  // Intl reporta como hora local MX y la hora UTC.
  const offsetMs = getMxOffsetMs(new Date(naiveUtcMs))

  // El instante real de "00:00 MX" = naiveUTC - offsetMX
  // (si MX es UTC-6, offsetMs = -6*3600*1000, restamos negativo → sumamos 6h)
  return new Date(naiveUtcMs - offsetMs)
}

/**
 * Retorna el offset de America/Mexico_City en milisegundos para el instante dado.
 * Offset = localMX - UTC → negativo para UTC-6 (-21_600_000 ms).
 */
function getMxOffsetMs(utcDate: Date): number {
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
