/**
 * Tests de getEvaluationNow (src/infrastructure/time/getEvaluationNow.ts).
 *
 * Cubre el guard duro por NODE_ENV (D7 del plan de diseño): en producción el
 * override de desarrollo debe ser IMPOSIBLE de activar, sin importar qué
 * tenga puesto DEV_NOW_OVERRIDE.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { getEvaluationNow } from '../src/infrastructure/time/getEvaluationNow'

describe('getEvaluationNow', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('NODE_ENV=production ignora DEV_NOW_OVERRIDE aunque esté seteada y sea válida', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('DEV_NOW_OVERRIDE', '2026-07-31T21:00:00-06:00')

    const before = Date.now()
    const result = getEvaluationNow()
    const after = Date.now()

    expect(result.getTime()).toBeGreaterThanOrEqual(before)
    expect(result.getTime()).toBeLessThanOrEqual(after)
  })

  it('fuera de producción, sin DEV_NOW_OVERRIDE → devuelve la fecha real', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('DEV_NOW_OVERRIDE', '')

    const before = Date.now()
    const result = getEvaluationNow()
    const after = Date.now()

    expect(result.getTime()).toBeGreaterThanOrEqual(before)
    expect(result.getTime()).toBeLessThanOrEqual(after)
  })

  it('fuera de producción, con DEV_NOW_OVERRIDE válida → respeta el override', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('DEV_NOW_OVERRIDE', '2026-07-31T21:00:00-06:00')
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = getEvaluationNow()

    expect(result.toISOString()).toBe('2026-08-01T03:00:00.000Z')
  })

  it('fuera de producción, con DEV_NOW_OVERRIDE inválida → cae a la fecha real (no lanza)', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('DEV_NOW_OVERRIDE', 'not-a-date')
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const before = Date.now()
    const result = getEvaluationNow()
    const after = Date.now()

    expect(result.getTime()).toBeGreaterThanOrEqual(before)
    expect(result.getTime()).toBeLessThanOrEqual(after)
  })

  it('emite console.warn cuando el override está activo (visibilidad operativa)', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('DEV_NOW_OVERRIDE', '2026-07-31T21:00:00-06:00')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    getEvaluationNow()

    expect(warnSpy).toHaveBeenCalled()
  })
})
