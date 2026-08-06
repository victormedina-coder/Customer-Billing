/**
 * Hook de arranque de Next.js — `register()` corre UNA vez al iniciar el server.
 *
 * Guard de producción (fable-security A-1): el rate limiter hace *fail-open* si
 * falta `REDIS_URL` (src/infrastructure/rate-limit/index.ts:135) — en un portal
 * PÚBLICO sin login eso deja los endpoints sin cota, en silencio, incluida la
 * emisión de CFDIs que cuesta folios. Se prefiere que el servicio NO arranque a
 * que arranque sin protección anti-abuso.
 *
 * Solo aplica en producción: en dev/test se permite sin Redis (el rate limiter
 * usa su fallback en memoria). No se toca el fallback en memoria para blips
 * transitorios de Redis en runtime — esto solo cubre el arranque sin Redis.
 */
export function register(): void {
  if (process.env.NODE_ENV === 'production' && !process.env.REDIS_URL) {
    throw new Error(
      '[bootstrap] REDIS_URL es obligatorio en producción: sin él el rate limiting ' +
        'hace fail-open y el portal público queda sin protección anti-abuso ' +
        '(enumeración / consumo de folios). Se aborta el arranque.',
    )
  }
}
