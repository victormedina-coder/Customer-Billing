import { afterEach, describe, expect, it, vi } from 'vitest'
import { getGlobalReconcileApply, getGlobalReconcileMinAgeMinutes } from '../src/composition/makeReconcileGlobalStampsUseCase'

afterEach(() => vi.unstubAllEnvs())

describe('configuración de conciliación global', () => {
  it('aplica por defecto y solo false desactiva los cambios', () => {
    vi.stubEnv('GLOBAL_RECONCILE_APPLY', '')
    expect(getGlobalReconcileApply()).toBe(true)
    vi.stubEnv('GLOBAL_RECONCILE_APPLY', 'false')
    expect(getGlobalReconcileApply()).toBe(false)
  })

  it.each(['', '0', '-1', '1.5', 'abc'])('usa 60 minutos si el valor %s es inválido', (raw) => {
    vi.stubEnv('GLOBAL_RECONCILE_MIN_AGE_MINUTES', raw)
    expect(getGlobalReconcileMinAgeMinutes()).toBe(60)
  })

  it('acepta un entero positivo', () => {
    vi.stubEnv('GLOBAL_RECONCILE_MIN_AGE_MINUTES', '90')
    expect(getGlobalReconcileMinAgeMinutes()).toBe(90)
  })
})
