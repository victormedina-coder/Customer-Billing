const GENERIC_EMIT_ERROR = 'Error al generar la factura. Intenta de nuevo más tarde.'

export function selectEmitErrorMessage(message: unknown): string {
  return typeof message === 'string' && message.trim() ? message : GENERIC_EMIT_ERROR
}
