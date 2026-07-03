import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { rateLimit, getClientIp, RateLimitStore } from '../src/infrastructure/rate-limit'

// ── Mock de ioredis para los tests de RedisStore ─────────────────────────────
// Simula sobre un Map en memoria la semántica del script Lua de HIT_SCRIPT:
// INCR + TTL, y si ttl < 0 (llave nueva o que perdió su TTL) le asigna
// windowSec. Así probamos que RedisStore.hit delega en `eval` (un solo
// round-trip) y que el resultado refleja la auto-curación de TTL.
const evalMock = vi.fn(async (_script: string, _numKeys: number, key: string, windowSec: number) => {
  const now = Date.now()
  const entry = fakeRedisData.get(key)
  let count: number
  let expiresAt: number | undefined = entry?.expiresAt
  if (!entry) {
    count = 1
  } else {
    count = entry.count + 1
  }
  let ttl: number
  if (expiresAt === undefined || expiresAt <= now) {
    ttl = -1
  } else {
    ttl = Math.ceil((expiresAt - now) / 1000)
  }
  if (ttl < 0) {
    expiresAt = now + Number(windowSec) * 1000
    ttl = Number(windowSec)
  }
  fakeRedisData.set(key, { count, expiresAt: expiresAt as number })
  return [count, ttl]
})

let fakeRedisData: Map<string, { count: number; expiresAt: number }>

vi.mock('ioredis', () => {
  class FakeRedis {
    eval = evalMock
    on = vi.fn()
  }
  return { default: FakeRedis }
})

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

// ── Tests de rateLimit ───────────────────────────────────────────────────────

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

  it('usa fallback en memoria cuando el store lanza — bloquea al superar el límite', async () => {
    // Store que siempre lanza: fuerza el camino del fallback en memoria.
    // El fallbackStore es un singleton, por lo que usamos una key única para
    // no interferir con otros tests que también ejerciten el fallback.
    const brokenStore: RateLimitStore = {
      hit: async () => { throw new Error('Redis down') },
    }
    const key = `test:fallback:${Date.now()}-${Math.random()}`

    // Las primeras LIMIT llamadas deben ser permitidas por el fallback en memoria
    for (let i = 0; i < LIMIT; i++) {
      const r = await rateLimit(key, LIMIT, WINDOW, brokenStore)
      expect(r.allowed).toBe(true)
    }
    // La siguiente debe ser bloqueada por el fallback (no fail-open total)
    const over = await rateLimit(key, LIMIT, WINDOW, brokenStore)
    expect(over.allowed).toBe(false)
    expect(over.retryAfter).toBeGreaterThan(0)
  })

  it('no-op cuando no hay REDIS_URL ni store', async () => {
    // Guardamos y borramos REDIS_URL para que el test sea determinista
    // aunque el .env lo tenga definido (vitest carga .env al iniciar)
    const original = process.env.REDIS_URL
    delete process.env.REDIS_URL
    try {
      const result = await rateLimit('test:noop', LIMIT, WINDOW)
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(LIMIT)
    } finally {
      if (original !== undefined) process.env.REDIS_URL = original
    }
  })
})

// ── Tests de getClientIp ─────────────────────────────────────────────────────

describe('getClientIp', () => {
  // Guardamos y restauramos TRUSTED_PROXY_COUNT para no contaminar otros tests
  let originalTrustedProxyCount: string | undefined

  beforeEach(() => {
    originalTrustedProxyCount = process.env.TRUSTED_PROXY_COUNT
    delete process.env.TRUSTED_PROXY_COUNT
  })

  afterEach(() => {
    if (originalTrustedProxyCount !== undefined) {
      process.env.TRUSTED_PROXY_COUNT = originalTrustedProxyCount
    } else {
      delete process.env.TRUSTED_PROXY_COUNT
    }
  })

  it('XFF de un solo hop con trusted=1 (default) → devuelve ese hop', () => {
    const req = new Request('http://x', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    })
    expect(getClientIp(req)).toBe('1.2.3.4')
  })

  it('XFF con hop falsificado al frente: toma el último hop (el que vio el proxy)', () => {
    // El atacante antepone "9.9.9.9"; el proxy de Railway agrega "5.5.5.5" al final.
    // Con trusted=1, tomamos el último → "5.5.5.5" (la real).
    const req = new Request('http://x', {
      headers: { 'x-forwarded-for': '9.9.9.9, 5.5.5.5' },
    })
    expect(getClientIp(req)).toBe('5.5.5.5')
  })

  it('XFF con tres hops y trusted=1 → toma el último', () => {
    const req = new Request('http://x', {
      headers: { 'x-forwarded-for': 'a.a.a.a, b.b.b.b, c.c.c.c' },
    })
    expect(getClientIp(req)).toBe('c.c.c.c')
  })

  it('con TRUSTED_PROXY_COUNT=2 y tres hops → toma el penúltimo', () => {
    process.env.TRUSTED_PROXY_COUNT = '2'
    const req = new Request('http://x', {
      headers: { 'x-forwarded-for': 'client, real, inner' },
    })
    // parts = ['client','real','inner'], idx = max(0, 3-2) = 1 → 'real'
    expect(getClientIp(req)).toBe('real')
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

// ── Tests de RedisStore.hit (atomicidad vía script Lua) ──────────────────────

describe('RedisStore.hit', () => {
  const originalRedisUrl = process.env.REDIS_URL

  beforeEach(() => {
    process.env.REDIS_URL = 'redis://fake-host:6379'
    fakeRedisData = new Map()
    evalMock.mockClear()
    vi.resetModules()
  })

  afterEach(() => {
    if (originalRedisUrl !== undefined) {
      process.env.REDIS_URL = originalRedisUrl
    } else {
      delete process.env.REDIS_URL
    }
  })

  it('hace UNA sola llamada a client.eval (round-trip único, no incr/expire/ttl por separado)', async () => {
    const { RedisStore } = await import('../src/infrastructure/rate-limit')
    const store = new RedisStore()

    await store.hit('test:redis:atomic', 60)

    expect(evalMock).toHaveBeenCalledTimes(1)
    expect(evalMock).toHaveBeenCalledWith(expect.any(String), 1, 'test:redis:atomic', 60)
  })

  it('devuelve { count, ttl } con los valores que retorna el script', async () => {
    const { RedisStore } = await import('../src/infrastructure/rate-limit')
    const store = new RedisStore()

    const r1 = await store.hit('test:redis:values', 60)
    expect(r1.count).toBe(1)
    expect(r1.ttl).toBe(60)

    const r2 = await store.hit('test:redis:values', 60)
    expect(r2.count).toBe(2)
    expect(r2.ttl).toBeGreaterThan(0)
  })

  it('auto-cura una llave atascada sin TTL (ttl=-1) asignándole windowSec', async () => {
    // Simula el escenario del bug en producción: la llave ya tiene contador
    // pero quedó sin expiración (p. ej. por un timeout parcial anterior).
    fakeRedisData.set('test:redis:stuck', { count: 49, expiresAt: -1 })

    const { RedisStore } = await import('../src/infrastructure/rate-limit')
    const store = new RedisStore()

    const result = await store.hit('test:redis:stuck', 60)

    // El fake refleja que ya no queda en -1: se le asignó windowSec como ttl.
    expect(result.ttl).toBe(60)
    expect(fakeRedisData.get('test:redis:stuck')?.expiresAt).toBeGreaterThan(Date.now())
  })
})
