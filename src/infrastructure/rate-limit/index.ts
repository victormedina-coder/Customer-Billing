/**
 * Rate limiting de ventana fija (fixed-window) por IP — adapter de infraestructura.
 */

import Redis from 'ioredis'
import type { RateLimitStore } from '../../domain/eligibility/ports/RateLimitStore'

export type { RateLimitStore }

// ── Implementación Redis ─────────────────────────────────────────────────────

let redisClient: Redis | null = null

function getRedisClient(): Redis | null {
  if (!process.env.REDIS_URL) return null
  if (!redisClient) {
    redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      commandTimeout: 1000,
      lazyConnect: true,
    })
    redisClient.on('error', (err) => {
      console.warn('[rate-limit] Redis connection error:', err.message)
    })
  }
  return redisClient
}

export class RedisStore implements RateLimitStore {
  async hit(key: string, windowSec: number): Promise<{ count: number; ttl: number }> {
    const client = getRedisClient()
    if (!client) throw new Error('Redis no disponible')

    const count = await client.incr(key)
    if (count === 1) {
      await client.expire(key, windowSec)
    }
    const ttl = await client.ttl(key)
    return { count, ttl: ttl > 0 ? ttl : windowSec }
  }
}

// ── Store en memoria (fallback cuando Redis falla) ───────────────────────────

class InMemoryStore implements RateLimitStore {
  private m = new Map<string, { count: number; expiresAt: number }>()

  async hit(key: string, windowSec: number): Promise<{ count: number; ttl: number }> {
    const now = Date.now()
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
  validate: {
    max: Number(process.env.RATE_LIMIT_VALIDATE_MAX ?? 5),
    windowSec: Number(process.env.RATE_LIMIT_VALIDATE_WINDOW_SEC ?? 900),
  },
} as const

// ── Resultado de rate limiting ───────────────────────────────────────────────

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfter: number
}

// ── Helper interno ───────────────────────────────────────────────────────────

function evaluate(r: { count: number; ttl: number }, limit: number): RateLimitResult {
  if (r.count <= limit) return { allowed: true, remaining: limit - r.count, retryAfter: 0 }
  return { allowed: false, remaining: 0, retryAfter: r.ttl }
}

// ── Función principal ────────────────────────────────────────────────────────

export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
  store?: RateLimitStore,
): Promise<RateLimitResult> {
  if (!store && !process.env.REDIS_URL) {
    return { allowed: true, remaining: limit, retryAfter: 0 }
  }

  const effectiveStore = store ?? new RedisStore()

  try {
    return evaluate(await effectiveStore.hit(key, windowSec), limit)
  } catch (err) {
    console.warn('[rate-limit] Redis error → fallback en memoria (por instancia):', err)
    try {
      return evaluate(await fallbackStore.hit(key, windowSec), limit)
    } catch (memErr) {
      console.warn('[rate-limit] fallback en memoria también falló, fail-open:', memErr)
      return { allowed: true, remaining: limit, retryAfter: 0 }
    }
  }
}

// ── Helper de IP ─────────────────────────────────────────────────────────────

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
