/**
 * Rate limiting de ventana fija (fixed-window) por IP.
 *
 * Decisiones de diseño:
 * - No-op si REDIS_URL no está definida: evita romper dev local, CI y tests.
 * - Fallback en memoria si Redis está caído: antes de abrir completamente
 *   (fail-open), se usa un store en memoria por instancia como respaldo parcial.
 *   Solo si el fallback también falla se hace fail-open total.
 * - Store inyectable para testear sin Redis real.
 * - IP resistente a falsificación de XFF: se toma el hop correcto desde la
 *   derecha de la cadena X-Forwarded-For según TRUSTED_PROXY_COUNT.
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
      // Silenciamos errores de conexión; el fallback los maneja a nivel de llamada
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

// ── Store en memoria (fallback cuando Redis falla) ───────────────────────────

/**
 * Store en memoria por instancia. Se usa SOLO como respaldo cuando Redis falla,
 * para no quedar completamente sin rate limiting (fail-open). Limita por proceso,
 * no globalmente: bajo múltiples instancias el límite efectivo se multiplica por
 * el nº de instancias, pero es mucho mejor que abrir del todo.
 */
class InMemoryStore implements RateLimitStore {
  private m = new Map<string, { count: number; expiresAt: number }>()

  async hit(key: string, windowSec: number): Promise<{ count: number; ttl: number }> {
    const now = Date.now()
    // Limpieza oportunista: si el Map crece demasiado, purga las entradas expiradas
    if (this.m.size > 10_000) {
      for (const [k, v] of this.m) if (v.expiresAt <= now) this.m.delete(k)
    }
    const e = this.m.get(key)
    if (!e || e.expiresAt <= now) {
      this.m.set(key, { count: 1, expiresAt: now + windowSec * 1000 })
      return { count: 1, ttl: windowSec }
    }
    e.count++
    return { count: e.count, ttl: Math.max(1, Math.ceil((e.expiresAt - now) / 1000)) }
  }
}

// Instancia única de respaldo (persiste mientras viva el proceso)
const fallbackStore = new InMemoryStore()

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

// ── Helper interno ───────────────────────────────────────────────────────────

function evaluate(r: { count: number; ttl: number }, limit: number): RateLimitResult {
  if (r.count <= limit) return { allowed: true, remaining: limit - r.count, retryAfter: 0 }
  return { allowed: false, remaining: 0, retryAfter: r.ttl }
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
  // No-op si no hay store inyectado ni REDIS_URL
  if (!store && !process.env.REDIS_URL) {
    return { allowed: true, remaining: limit, retryAfter: 0 }
  }

  const effectiveStore = store ?? new RedisStore()

  try {
    return evaluate(await effectiveStore.hit(key, windowSec), limit)
  } catch (err) {
    // Si Redis (o el store inyectado) falla, usamos el fallback en memoria por instancia.
    // Es un rate limiting parcial (no global entre instancias), pero mucho mejor que fail-open total.
    console.warn('[rate-limit] Redis error → fallback en memoria (por instancia):', err)
    try {
      return evaluate(await fallbackStore.hit(key, windowSec), limit)
    } catch (memErr) {
      // Si hasta el fallback falla (no debería ocurrir), recién entonces fail-open.
      console.warn('[rate-limit] fallback en memoria también falló, fail-open:', memErr)
      return { allowed: true, remaining: limit, retryAfter: 0 }
    }
  }
}

// ── Helper de IP ─────────────────────────────────────────────────────────────

/**
 * Obtiene la IP del cliente para rate limiting, resistente a falsificación de XFF.
 *
 * X-Forwarded-For se lee de izquierda (IP que el cliente AFIRMA, NO confiable) a
 * derecha (cada proxy de confianza agrega la IP que observó). Tomamos la IP a
 * `TRUSTED_PROXY_COUNT` posiciones desde el final: con 1 proxy de confianza
 * (Railway), es la última entrada = la IP real que vio el proxy.
 *
 * IMPORTANTE: esto solo es seguro detrás de un proxy que NORMALICE/agregue XFF.
 * En local sin proxy, XFF no es autoritativo (no hay quien lo agregue), pero ese
 * no es el modelo de amenazas — producción siempre va detrás de Railway.
 *
 * Config: TRUSTED_PROXY_COUNT (default 1 = Railway). Súbelo si hay más proxies
 * de confianza encadenados frente a la app.
 */
export function getClientIp(req: Request): string {
  const trusted = Math.max(1, Number(process.env.TRUSTED_PROXY_COUNT ?? 1))
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean)
    if (parts.length > 0) {
      const idx = Math.max(0, parts.length - trusted)
      return parts[idx]
    }
  }
  return req.headers.get('x-real-ip') ?? 'unknown'
}
