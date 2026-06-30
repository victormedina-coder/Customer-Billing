/**
 * PUENTE — re-exporta desde src/infrastructure/rate-limit/index.ts.
 * Los imports existentes siguen funcionando sin cambios.
 * Este puente se elimina en el Paso 9 del refactor DDD.
 */
export type { RateLimitStore, RateLimitResult } from '../src/infrastructure/rate-limit/index'
export {
  RedisStore,
  RATE_LIMITS,
  rateLimit,
  getClientIp,
} from '../src/infrastructure/rate-limit/index'
