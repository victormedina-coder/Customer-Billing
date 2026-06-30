/**
 * Helpers de enmascarado de PII para logs de servidor — infraestructura/observabilidad.
 * Contenido movido de lib/log-redact.ts sin cambiar comportamiento.
 * El puente en lib/log-redact.ts re-exporta desde aquí.
 *
 * Cumplimiento LFPDPPP — principio de minimización de datos personales.
 */

/**
 * Enmascara un email para logs: conserva la primera letra del local y el dominio.
 * "juan.perez@gmail.com" → "j***@gmail.com"
 */
export function maskEmail(email?: string | null): string {
  if (!email) return ''
  const [local, domain] = email.split('@')
  if (!domain) return '***'
  const head = local.slice(0, 1)
  return `${head}***@${domain}`
}

/**
 * Enmascara un RFC para logs: conserva los primeros 3 caracteres.
 * "EKU9003173C9" → "EKU***"
 */
export function maskRfc(rfc?: string | null): string {
  if (!rfc) return ''
  return `${rfc.slice(0, 3)}***`
}
