/**
 * Puerto de logging — contrato PURO de dominio, sin dependencias de framework
 * ni de librería. Permite que `application` emita trazas estructuradas sin
 * conocer pino, console, ni ningún destino concreto: el adapter se inyecta
 * desde el composition root (ver src/infrastructure/observability/logger.ts).
 *
 * La firma (campos primero, mensaje después) espeja la de pino a propósito,
 * para que el adapter de producción sea una delegación directa sin traducción.
 *
 * NUNCA pasar secretos, tokens ni PII sin enmascarar: usar los helpers de
 * src/infrastructure/observability/logRedact.ts en el borde que los produce.
 */

export interface LogFields {
  [key: string]: unknown
}

export interface Logger {
  info(fields: LogFields, msg: string): void
  warn(fields: LogFields, msg: string): void
  error(fields: LogFields, msg: string): void
}
