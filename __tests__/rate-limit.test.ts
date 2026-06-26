import { describe, it, expect, beforeEach } from 'vitest'
import { rateLimit, getClientIp, RateLimitStore } from '../lib/rate-limit'

// ── Store en memoria con reloj inyectable ────────────────────────────────────

class FakeStore implements RateLimitStore {
  private m = new Map<string, { count: number; expiresAt: number }>()
  constructor(private nowRef: { now: number }) {}

  async hit(key: string, windowSec: number) {
    const e = this.m.get(key)
    const now = this.nowRef.now
    if (!e || e.expiresAt <= now) {
      const fresh = { count: 1, expiresAt: now + windowSec }
      this.m.set(key, fresh)
      return { count: 1, ttl: windowSec }
    }
    e.count++
    return { count: e.count, ttl: Math.ceil(e.expiresAt - now) }
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('rateLimit', () => {
  const LIMIT = 5
  const WINDOW = 60
  let clock: { now: number }
  let store: FakeStore

  beforeEach(() => {
    clock = { now: 1000 }
    store = new FakeStore(clock)
  })

  it('permite peticiones bajo el límite', async () => {
    const r1 = await rateLimit('test:ip1', LIMIT, WINDOW, store)
    const r2 = await rateLimit('test:ip1', LIMIT, WINDOW, store)
    const r3 = await rateLimit('test:ip1', LIMIT, WINDOW, store)
    expect(r1.allowed).toBe(true)
    expect(r1.remaining).toBe(4)
    expect(r2.allowed).toBe(true)
    expect(r2.remaining).toBe(3)
    expect(r3.allowed).toBe(true)
    expect(r3.remaining).toBe(2)
  })

  it('permite el hit exactamente en el límite (remaining=0)', async () => {
    for (let i = 0; i < LIMIT - 1; i++) {
      await rateLimit('test:ip2', LIMIT, WINDOW, store)
    }
    const atLimit = await rateLimit('test:ip2', LIMIT, WINDOW, store)
    expect(atLimit.allowed).toBe(true)
    expect(atLimit.remaining).toBe(0)
  })

  it('bloquea el hit que supera el límite', async () => {
    for (let i = 0; i < LIMIT; i++) {
      await rateLimit('test:ip3', LIMIT, WINDOW, store)
    }
    const over = await rateLimit('test:ip3', LIMIT, WINDOW, store)
    expect(over.allowed).toBe(false)
    expect(over.retryAfter).toBeGreaterThan(0)
  })

  it('resetea tras vencer la ventana', async () => {
    for (let i = 0; i < LIMIT; i++) {
      await rateLimit('test:ip4', LIMIT, WINDOW, store)
    }
    // Avanzar el reloj más allá de la ventana
    clock.now += WINDOW + 1
    const after = await rateLimit('test:ip4', LIMIT, WINDOW, store)
    expect(after.allowed).toBe(true)
    expect(after.remaining).toBe(LIMIT - 1)
  })

  it('keys distintas no se interfieren', async () => {
    for (let i = 0; i < LIMIT; i++) {
      await rateLimit('test:ip5a', LIMIT, WINDOW, store)
    }
    const other = await rateLimit('test:ip5b', LIMIT, WINDOW, store)
    expect(other.allowed).toBe(true)
  })

  it('fail-open cuando el store lanza una excepción', async () => {
    const brokenStore: RateLimitStore = {
      hit: async () => { throw new Error('Redis down') },
    }
    const result = await rateLimit('test:ip6', LIMIT, WINDOW, brokenStore)
    expect(result.allowed).toBe(true)
  })

  it('no-op cuando no hay REDIS_URL ni store', async () => {
    // Aseguramos que REDIS_URL no esté definida en el entorno de test
    const original = process.env.REDIS_URL
    delete process.env.REDIS_URL
    try {
      const result = await rateLimit('test:ip7', LIMIT, WINDOW)
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(LIMIT)
    } finally {
      if (original !== undefined) process.env.REDIS_URL = original
    }
  })
})

describe('getClientIp', () => {
  it('extrae el primer hop de x-forwarded-for', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    })
    expect(getClientIp(req)).toBe('1.2.3.4')
  })

  it('cae a x-real-ip si no hay x-forwarded-for', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-real-ip': '9.9.9.9' },
    })
    expect(getClientIp(req)).toBe('9.9.9.9')
  })

  it('devuelve unknown si no hay headers de IP', () => {
    const req = new Request('http://localhost')
    expect(getClientIp(req)).toBe('unknown')
  })
})
