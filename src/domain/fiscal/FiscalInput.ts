/**
 * Datos fiscales del receptor tal como los captura el cliente en el portal.
 * Tipo canónico en domain — sin dependencias de UI, lib ni infraestructura.
 * Importado por app/ (como FiscalData) y por lib/invoice-service/ (como FiscalInput).
 */
export interface FiscalInput {
  rfc: string
  razon: string
  regimen: string
  cp: string
  uso: string
  email: string
}
