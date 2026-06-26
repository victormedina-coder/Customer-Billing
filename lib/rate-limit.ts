/**
 * Rate limiting de ventana fija (fixed-window) por IP.
 *
 * Decisiones de diseño:
 * - No-op si REDIS_URL no está definida: evita romper dev local, CI y tests.
 * - Fail-open si Redis está caído: preferimos servir la petición antes que
 *   tumbar el portal público por una caída de Redis.
 * - Store inyectable para testear sin Redis real.
 */

import Redis from 'ioredis'

// ── Interfaz de store ────────────────────────────────────────────────────────

export interface RateLimitStore {
  /**
   * Registra un hit para `key` dentro de una ventana de `windowSec` segundos.
   * Devuelve el conteo actual tras el incremento y el TTL restante (segundos).
   */
  hit(key: string, windowSec: number): Promise<{ count: number; ttl: number }>
}

// ── Implementación Redis ─────────────────────────────────────────────────────

let redisClient: Redis | null = null

function getRedisClient(): Redis | null {
  if (!process.env.REDIS_URL) return null
  if (!redisClient) {
    redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      commandTimeout: 1000,
      // No reconectar infinitamente si el server no está disponible al inicio
      lazyConnect: true,
    })
    redisClient.on('error', (err) => {
      // Silenciamos errores de conexión; el fail-open los maneja a nivel de llamada
      console.warn('[rate-limit] Redis connection error:', err.message)
    })
  }
  return redisClient
}

export class RedisStore implements RateLimitStore {
  async hit(key: string, windowSec: number): Promise<{ count: number; ttl: number }> {
    const client = getRedisClient()
    if (!client) throw new Error('Redis no disponible')

    // Fixed-window: INCR + EXPIRE en el primer hit de la ventana
    const count = await client.incr(key)
    if (count === 1) {
      await client.expire(key, windowSec)
    }
    const ttl = await client.ttl(key)
    return { count, ttl: ttl > 0 ? ttl : windowSec }
  }
}

// ── Configuración de límites por endpoint ────────────────────────────────────

export const RATE_LIMITS = {
  lookup: {
    max: Number(process.env.RATE_LIMIT_LOOKUP_MAX ?? 20),
    windowSec: Number(process.env.RATE_LIMIT_LOOKUP_WINDOW_SEC ?? 60),
  },
  emit: {
    max: Number(process.env.RATE_LIMIT_EMIT_MAX ?? 5),
    windowSec: Number(process.env.RATE_LIMIT_EMIT_WINDOW_SEC ?? 60),
  },
  fiscal: {
    max: Number(process.env.RATE_LIMIT_FISCAL_MAX ?? 15),
    windowSec: Number(process.env.RATE_LIMIT_FISCAL_WINDOW_SEC ?? 60),
  },
  resend: {
    max: Number(process.env.RATE_LIMIT_RESEND_MAX ?? 5),
    windowSec: Number(process.env.RATE_LIMIT_RESEND_WINDOW_SEC ?? 60),
  },
  download: {
    max: Number(process.env.RATE_LIMIT_DOWNLOAD_MAX ?? 40),
    windowSec: Number(process.env.RATE_LIMIT_DOWNLOAD_WINDOW_SEC ?? 60),
  },
} as const

// ── Resultado de rate limiting ───────────────────────────────────────────────

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfter: number // segundos hasta poder reintentar (0 si allowed)
}

// ── Función principal ────────────────────────────────────────────────────────

/**
 * Aplica rate limiting de ventana fija.
 * @param key       identificador único (ej. `emit:${ip}`)
 * @param limit     máximo de hits permitidos en la ventana
 * @param windowSec tamaño de la ventana en segundos
 * @param store     store inyectable (default: Redis si REDIS_URL existe, si no no-op)
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
  store?: RateLimitStore,
): Promise<RateLimitResult> {
  // No-op si no hay store ni REDIS_URL
  if (!store && !process.env.REDIS_URL) {
    return { allowed: true, remaining: limit, retryAfter: 0 }
  }

  const effectiveStore = store ?? new RedisStore()

  try {
    const { count, ttl } = await effectiveStore.hit(key, windowSec)

    if (count <= limit) {
      return { allowed: true, remaining: limit - count, retryAfter: 0 }
    }

    // Sobre el límite
    return { allowed: false, remaining: 0, retryAfter: ttl }
  } catch (err) {
    // Fail-open: si Redis falla, dejamos pasar la petición para no tumbar el portal
    console.warn('[rate-limit] store error, fail-open:', err)
    return { allowed: true, remaining: limit, retryAfter: 0 }
  }
}

// ── Helper de IP ─────────────────────────────────────────────────────────────

/**
 * Obtiene la IP del cliente desde los headers (primer hop de x-forwarded-for).
 * Railway inyecta este header automáticamente.
 */
export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}
