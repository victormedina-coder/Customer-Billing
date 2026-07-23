/**
 * Tests de integración del route handler POST /api/global/emit (Paso 6).
 *
 * Estrategia: a diferencia de route-handlers.test.ts (que mockea los
 * adapters individuales porque el composition root de emit es solo pegamento
 * de funciones), aquí se mockea directamente el composition root
 * `makeEmitGlobalInvoiceUseCase` — el use case que produce (EmitGlobalInvoiceUseCase)
 * ya tiene su propia batería de tests en emit-global-invoice-usecase.test.ts,
 * así que este archivo solo verifica la responsabilidad del HANDLER: secreto,
 * rate limit, validación Zod y el mapeo Result → HTTP. Repetir aquí los casos
 * de negocio del use case sería duplicar cobertura (DRY).
 *
 * Se sigue el mismo patrón de vi.mock + vi.mocked().mockImplementation() por
 * test, y el mismo helper makePostRequest, que route-handlers.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { GlobalRunReport, GlobalRunSummary } from '../src/application/global/EmitGlobalInvoiceUseCase'

// ─────────────────────────────────────────────────────────────────────────────
// vi.mock — composition root + rate-limit
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../src/infrastructure/rate-limit', () => ({
  rateLimit: vi.fn(async () => ({ allowed: true, remaining: 10, retryAfter: 0 })),
  getClientIp: vi.fn(() => 'test-ip'),
  RATE_LIMITS: {
    globalEmit: { max: 5, windowSec: 900 },
  },
}))

vi.mock('../src/composition/makeEmitGlobalInvoiceUseCase', () => ({
  makeEmitGlobalInvoiceUseCase: vi.fn(),
}))

let rateLimitMod: typeof import('../src/infrastructure/rate-limit')
let compositionMod: typeof import('../src/composition/makeEmitGlobalInvoiceUseCase')
let POST: typeof import('../app/api/global/emit/route')['POST']

const SECRET = 'test-global-secret'

/** Resumen "todo en ceros" — corrida sin chunks, que es el caso base sin fallos. */
const EMPTY_SUMMARY: GlobalRunSummary = {
  chunks: 0, emitted: 0, rolledBack: 0, skippedIdempotent: 0,
  stampedUnconfirmed: 0, empty: 0, dryRun: 0,
  ordersEligible: 0, unmapped: 0, hasFailures: false,
}

function makeFakeReport(overrides: Partial<GlobalRunReport> = {}): GlobalRunReport {
  return {
    runId: 'run-1',
    year: 2026,
    month: 6,
    dryRun: false,
    summary: EMPTY_SUMMARY,
    stores: [],
    ...overrides,
  }
}

function makeUseCase(executeImpl: (input: unknown) => Promise<unknown>) {
  return { execute: vi.fn(executeImpl) }
}

function makePostRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/global/emit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

function withSecretHeader(headers: Record<string, string> = {}): Record<string, string> {
  return { 'x-global-secret': SECRET, ...headers }
}

beforeEach(async () => {
  vi.stubEnv('GLOBAL_INVOICE_SECRET', SECRET)

  rateLimitMod = await import('../src/infrastructure/rate-limit')
  compositionMod = await import('../src/composition/makeEmitGlobalInvoiceUseCase')
  ;({ POST } = await import('../app/api/global/emit/route'))

  vi.mocked(rateLimitMod.rateLimit).mockImplementation(async () => ({
    allowed: true,
    remaining: 10,
    retryAfter: 0,
  }))
  vi.mocked(compositionMod.makeEmitGlobalInvoiceUseCase).mockReturnValue(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    makeUseCase(async () => ({ ok: true, value: makeFakeReport() })) as any,
  )
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('POST /api/global/emit', () => {
  it('responde 503 si GLOBAL_INVOICE_SECRET no está configurado', async () => {
    vi.stubEnv('GLOBAL_INVOICE_SECRET', '')

    const res = await POST(
      makePostRequest({ year: 2026, month: 6 }, withSecretHeader()) as never,
    )
    const json = await res.json()

    expect(res.status).toBe(503)
    expect(json.error.code).toBe('FEATURE_NOT_CONFIGURED')
    expect(compositionMod.makeEmitGlobalInvoiceUseCase).not.toHaveBeenCalled()
  })

  it('responde 401 sin el header x-global-secret', async () => {
    const res = await POST(makePostRequest({ year: 2026, month: 6 }) as never)
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error.code).toBe('UNAUTHORIZED')
    expect(json.error.message).not.toContain(SECRET)
    expect(compositionMod.makeEmitGlobalInvoiceUseCase).not.toHaveBeenCalled()
  })

  it('responde 401 con un header x-global-secret incorrecto', async () => {
    const res = await POST(
      makePostRequest({ year: 2026, month: 6 }, { 'x-global-secret': 'wrong-secret' }) as never,
    )
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error.code).toBe('UNAUTHORIZED')
  })

  it('acepta el secreto correcto sin importar timing/longitud del header (comportamiento, no implementación)', async () => {
    // Un header mucho más largo o más corto que el secreto real tampoco debe
    // autenticar — se verifica el resultado (401), no la función interna de
    // comparación.
    const tooLong = SECRET + 'x'.repeat(500)
    const res = await POST(
      makePostRequest({ year: 2026, month: 6 }, { 'x-global-secret': tooLong }) as never,
    )
    expect(res.status).toBe(401)
  })

  it('responde 400 con body inválido (mes fuera de rango)', async () => {
    const res = await POST(
      makePostRequest({ year: 2026, month: 13 }, withSecretHeader()) as never,
    )
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error.code).toBe('VALIDATION_FAILED')
    expect(compositionMod.makeEmitGlobalInvoiceUseCase).not.toHaveBeenCalled()
  })

  it('responde 400 con body inválido (año como string)', async () => {
    const res = await POST(
      makePostRequest({ year: '2026', month: 6 }, withSecretHeader()) as never,
    )
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error.code).toBe('VALIDATION_FAILED')
  })

  it('responde 400 con body inválido (solo year, sin month — periodo parcial ambiguo)', async () => {
    // year/month ahora son opcionales (ver GlobalEmitSchema), pero deben venir
    // juntos: un body con solo uno de los dos sigue siendo inválido. Un body
    // {} completo (ambos ausentes) es válido — eso lo cubre el test de
    // "usa el mes anterior en zona MX" más abajo.
    const res = await POST(makePostRequest({ year: 2026 }, withSecretHeader()) as never)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error.code).toBe('VALIDATION_FAILED')
  })

  it('responde 400 si el body no es JSON válido', async () => {
    const req = new Request('http://localhost/api/global/emit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...withSecretHeader() },
      body: '{not-json',
    })
    const res = await POST(req as never)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error.code).toBe('INVALID_BODY')
  })

  it('body válido + secreto correcto → llama al use case con los args correctos y regresa 200 + reporte', async () => {
    const fakeReport = makeFakeReport({ runId: 'run-abc', year: 2026, month: 6 })
    const execute = vi.fn(async () => ({ ok: true, value: fakeReport }))
    vi.mocked(compositionMod.makeEmitGlobalInvoiceUseCase).mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { execute } as any,
    )

    const res = await POST(
      makePostRequest({ year: 2026, month: 6, storeName: 'ariat' }, withSecretHeader()) as never,
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.report).toEqual(fakeReport)
    expect(execute).toHaveBeenCalledWith({ year: 2026, month: 6, storeName: 'ariat', dryRun: false })
  })

  // Regresión 2026-07-22: una corrida con los 9 chunks en `rolled_back` (serie
  // no dada de alta en Facturama) viajó dentro de un HTTP 200 y Railway pintó el
  // cron en verde — cero CFDIs emitidos y nadie se enteró. El status debe
  // reflejar el resultado real de la corrida, no solo que el handler terminó.
  it('summary.hasFailures → responde 500 con el reporte COMPLETO en el body', async () => {
    const failedSummary: GlobalRunSummary = {
      ...EMPTY_SUMMARY, chunks: 9, rolledBack: 9, ordersEligible: 37, hasFailures: true,
    }
    const fakeReport = makeFakeReport({ runId: 'run-failed', summary: failedSummary })
    const execute = vi.fn(async () => ({ ok: true, value: fakeReport }))
    vi.mocked(compositionMod.makeEmitGlobalInvoiceUseCase).mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { execute } as any,
    )

    const res = await POST(makePostRequest({ year: 2026, month: 7, day: 21 }, withSecretHeader()) as never)
    const json = await res.json()

    expect(res.status).toBe(500)
    // El reporte NO se recorta al fallar: es lo único que permite diagnosticar.
    expect(json.report).toEqual(fakeReport)
  })

  it('stamped_unconfirmed (timbrado sin registrar) también marca la corrida como fallida', async () => {
    const unconfirmedSummary: GlobalRunSummary = {
      ...EMPTY_SUMMARY, chunks: 3, emitted: 2, stampedUnconfirmed: 1, hasFailures: true,
    }
    const execute = vi.fn(async () => ({ ok: true, value: makeFakeReport({ summary: unconfirmedSummary }) }))
    vi.mocked(compositionMod.makeEmitGlobalInvoiceUseCase).mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { execute } as any,
    )

    const res = await POST(makePostRequest({ year: 2026, month: 7 }, withSecretHeader()) as never)

    expect(res.status).toBe(500)
  })

  it('body sin year/month → el use case recibe el mes anterior en zona MX (cron sin periodo)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T18:00:00.000Z')) // 15-jul-2026 12:00 MX → mes anterior: junio 2026

    const execute = vi.fn(async () => ({ ok: true, value: makeFakeReport({ year: 2026, month: 6 }) }))
    vi.mocked(compositionMod.makeEmitGlobalInvoiceUseCase).mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { execute } as any,
    )

    const res = await POST(makePostRequest({ dryRun: true }, withSecretHeader()) as never)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.report).toEqual(makeFakeReport({ year: 2026, month: 6 }))
    expect(execute).toHaveBeenCalledWith({ year: 2026, month: 6, storeName: undefined, dryRun: true })
  })

  describe("body con relative (R4) — reloj inyectado con vi.setSystemTime", () => {
    it("relative: 'current-month' resuelve al mes MX EN CURSO (no al anterior)", async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-07-15T18:00:00.000Z')) // 15-jul-2026 12:00 MX → mes en curso: julio 2026

      const execute = vi.fn(async () => ({ ok: true, value: makeFakeReport({ year: 2026, month: 7 }) }))
      vi.mocked(compositionMod.makeEmitGlobalInvoiceUseCase).mockReturnValue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { execute } as any,
      )

      const res = await POST(makePostRequest({ relative: 'current-month', dryRun: true }, withSecretHeader()) as never)

      expect(res.status).toBe(200)
      expect(execute).toHaveBeenCalledWith({ year: 2026, month: 7, day: undefined, storeName: undefined, dryRun: true })
    })

    it("relative: 'previous-month' resuelve al mes MX anterior (mismo resultado que el default histórico)", async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-07-15T18:00:00.000Z')) // mes anterior: junio 2026

      const execute = vi.fn(async () => ({ ok: true, value: makeFakeReport({ year: 2026, month: 6 }) }))
      vi.mocked(compositionMod.makeEmitGlobalInvoiceUseCase).mockReturnValue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { execute } as any,
      )

      const res = await POST(makePostRequest({ relative: 'previous-month', dryRun: true }, withSecretHeader()) as never)

      expect(res.status).toBe(200)
      expect(execute).toHaveBeenCalledWith({ year: 2026, month: 6, day: undefined, storeName: undefined, dryRun: true })
    })

    // [DAILY-SCAFFOLDING] test-only, remover junto con el modo 'yesterday' (ver plan R5).
    it("relative: 'yesterday' resuelve al día MX de ayer (corrida DIARIA)", async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-07-15T18:00:00.000Z')) // 15-jul-2026 12:00 MX → ayer: 14-jul-2026

      const execute = vi.fn(async () => ({ ok: true, value: makeFakeReport({ year: 2026, month: 7, day: 14 }) }))
      vi.mocked(compositionMod.makeEmitGlobalInvoiceUseCase).mockReturnValue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { execute } as any,
      )

      const res = await POST(makePostRequest({ relative: 'yesterday', dryRun: true }, withSecretHeader()) as never)

      expect(res.status).toBe(200)
      expect(execute).toHaveBeenCalledWith({ year: 2026, month: 7, day: 14, storeName: undefined, dryRun: true })
    })

    it('responde 400 con relative + year/month (mutuamente excluyentes) — no llama al use case', async () => {
      const res = await POST(
        makePostRequest({ relative: 'current-month', year: 2026, month: 6 }, withSecretHeader()) as never,
      )
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error.code).toBe('VALIDATION_FAILED')
      expect(compositionMod.makeEmitGlobalInvoiceUseCase).not.toHaveBeenCalled()
    })
  })

  it('propaga dryRun: true al use case', async () => {
    const execute = vi.fn(async () => ({ ok: true, value: makeFakeReport({ dryRun: true }) }))
    vi.mocked(compositionMod.makeEmitGlobalInvoiceUseCase).mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { execute } as any,
    )

    const res = await POST(
      makePostRequest({ year: 2026, month: 6, dryRun: true }, withSecretHeader()) as never,
    )

    expect(res.status).toBe(200)
    expect(execute).toHaveBeenCalledWith({ year: 2026, month: 6, storeName: undefined, dryRun: true })
  })

  it('body con { year, month, day } válido → llama al use case con day propagado', async () => {
    const fakeReport = makeFakeReport({ runId: 'run-daily', year: 2026, month: 6, day: 15 })
    const execute = vi.fn(async () => ({ ok: true, value: fakeReport }))
    vi.mocked(compositionMod.makeEmitGlobalInvoiceUseCase).mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { execute } as any,
    )

    const res = await POST(
      makePostRequest({ year: 2026, month: 6, day: 15, dryRun: true }, withSecretHeader()) as never,
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.report).toEqual(fakeReport)
    expect(execute).toHaveBeenCalledWith({ year: 2026, month: 6, day: 15, storeName: undefined, dryRun: true })
  })

  it('responde 400 con { day } solo (sin year/month — ambiguo)', async () => {
    const res = await POST(makePostRequest({ day: 15 }, withSecretHeader()) as never)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error.code).toBe('VALIDATION_FAILED')
    expect(compositionMod.makeEmitGlobalInvoiceUseCase).not.toHaveBeenCalled()
  })

  it('responde 400 con { year, day } sin month', async () => {
    const res = await POST(makePostRequest({ year: 2026, day: 15 }, withSecretHeader()) as never)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error.code).toBe('VALIDATION_FAILED')
  })

  it('mapea VALIDATION_FAILED del use case a 400', async () => {
    const execute = vi.fn(async () => ({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'periodo inválido' },
    }))
    vi.mocked(compositionMod.makeEmitGlobalInvoiceUseCase).mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { execute } as any,
    )

    const res = await POST(
      makePostRequest({ year: 2026, month: 6 }, withSecretHeader()) as never,
    )
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toEqual({ code: 'VALIDATION_FAILED', message: 'periodo inválido' })
  })

  it('mapea STORE_NOT_CONFIGURED del use case a 422', async () => {
    const execute = vi.fn(async () => ({
      ok: false,
      error: { code: 'STORE_NOT_CONFIGURED', message: 'tienda no configurada' },
    }))
    vi.mocked(compositionMod.makeEmitGlobalInvoiceUseCase).mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { execute } as any,
    )

    const res = await POST(
      makePostRequest({ year: 2026, month: 6, storeName: 'nope' }, withSecretHeader()) as never,
    )
    const json = await res.json()

    expect(res.status).toBe(422)
    expect(json.error).toEqual({ code: 'STORE_NOT_CONFIGURED', message: 'tienda no configurada' })
  })

  it('responde 429 cuando se excede el rate limit', async () => {
    vi.mocked(rateLimitMod.rateLimit).mockImplementation(async () => ({
      allowed: false,
      remaining: 0,
      retryAfter: 30,
    }))

    const res = await POST(
      makePostRequest({ year: 2026, month: 6 }, withSecretHeader()) as never,
    )
    const json = await res.json()

    expect(res.status).toBe(429)
    expect(json.error.code).toBe('RATE_LIMITED')
    expect(res.headers.get('Retry-After')).toBe('30')
    expect(compositionMod.makeEmitGlobalInvoiceUseCase).not.toHaveBeenCalled()
  })
})
