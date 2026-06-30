/**
 * Value object Rfc — fuente única del regex y predicado de formato RFC.
 *
 * Capa domain: CERO imports de next/react/ioredis/postgres/drizzle.
 *
 * Formato SAT (CFDI 4.0):
 *   - Personas morales: 3 letras + 6 dígitos fecha + 3 alfanuméricos (12 chars)
 *   - Personas físicas: 4 letras + 6 dígitos fecha + 3 alfanuméricos (13 chars)
 *   - Letras válidas: A-Z, Ñ, &
 *
 * Normalización: el llamador es responsable de trim()+toUpperCase() antes de
 * invocar isValid(); este VO no impone normalización para no ocultar qué valor
 * llega realmente a la validación.
 */

/** Regex canónico de formato RFC (sin normalización). */
export const RFC_REGEX = /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/

/**
 * Verifica si `value` cumple el formato SAT de RFC.
 * El valor debe estar ya normalizado (trim + toUpperCase) por el llamador.
 */
export function isValidRfc(value: string): boolean {
  return RFC_REGEX.test(value)
}
