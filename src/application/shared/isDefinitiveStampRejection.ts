/** Rechazos explícitos que confirman que Facturama no timbró el CFDI. */
export function isDefinitiveStampRejection(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return false
  return error.statusCode === 400 || error.statusCode === 401 || error.statusCode === 403 || error.statusCode === 422
}
