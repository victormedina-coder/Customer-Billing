/**
 * Adapter de logging estructurado — implementa el puerto Logger sobre pino.
 *
 * Mismo patrón ya probado en el POS (src/lib/logger.js): un singleton
 * configurado por LOG_LEVEL que escribe JSON a stdout, que es lo que Railway
 * recolecta.
 *
 * NO se configura `transport` a propósito: pino-pretty levanta un worker thread
 * que rompe el bundling de Next.js, y en producción los logs se leen desde el
 * panel de Railway, donde el JSON plano es lo más útil.
 *
 * NUNCA loguear secretos/tokens/PII: solo IDs, conteos, nombres de marca y
 * metadata operativa (ver logRedact.ts para email/RFC).
 */

import pino from 'pino'
import type { Logger } from '../../domain/shared/ports/Logger'

const pinoLogger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'portal-facturacion' },
})

export const logger: Logger = {
  info: (fields, msg) => pinoLogger.info(fields, msg),
  warn: (fields, msg) => pinoLogger.warn(fields, msg),
  error: (fields, msg) => pinoLogger.error(fields, msg),
}
