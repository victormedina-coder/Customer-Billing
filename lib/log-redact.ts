/**
 * Helpers de enmascarado de PII para logs de servidor.
 *
 * Cumplimiento LFPDPPP — principio de minimización de datos personales:
 * los logs de Railway se retienen y no deben contener datos personales en claro.
 * Solo email y RFC se enmascaran; folios, orderIds e invoiceIds son
 * identificadores operativos y se registran tal cual.
 */

/**
 * Enmascara un email para logs: conserva la primera letra del local y el dominio.
 * "juan.perez@gmail.com" → "j***@gmail.com"
 * Vacío / null / undefined → ""
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
 * Vacío / null / undefined → ""
 */
export function maskRfc(rfc?: string | null): string {
  if (!rfc) return ''
  return `${rfc.slice(0, 3)}***`
}
