/**
 * Tests de GlobalEmitSchema (lib/api/schemas.ts) — contrato HTTP de
 * POST /api/global/emit.
 *
 * Cubre el cambio a year/month opcionales (el cron de Railway dispara el
 * endpoint con un body estático, sin periodo): deben venir ambos o ninguno,
 * los rangos existentes (2020-2100 / 1-12) se conservan cuando sí vienen, y
 * dryRun sigue defaulteando a false.
 */

import { describe, it, expect } from 'vitest'
import { GlobalEmitSchema } from '../lib/api/schemas'

describe('GlobalEmitSchema — year/month opcionales', () => {
  it('sin year ni month → válido (el periodo se resuelve en el route handler)', () => {
    const result = GlobalEmitSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('solo year (sin month) → inválido', () => {
    const result = GlobalEmitSchema.safeParse({ year: 2026 })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join('; ')
      expect(messages).toMatch(/year y month deben venir juntos/)
    }
  })

  it('solo month (sin year) → inválido', () => {
    const result = GlobalEmitSchema.safeParse({ month: 6 })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join('; ')
      expect(messages).toMatch(/year y month deben venir juntos/)
    }
  })

  it('ambos presentes → válido (comportamiento previo)', () => {
    const result = GlobalEmitSchema.safeParse({ year: 2026, month: 6 })
    expect(result.success).toBe(true)
  })

  it('year fuera de rango → inválido aunque month también venga', () => {
    const result = GlobalEmitSchema.safeParse({ year: 1999, month: 6 })
    expect(result.success).toBe(false)
  })

  it('month fuera de rango → inválido aunque year también venga', () => {
    const result = GlobalEmitSchema.safeParse({ year: 2026, month: 13 })
    expect(result.success).toBe(false)
  })

  it('dryRun no viene → default false', () => {
    const result = GlobalEmitSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.dryRun).toBe(false)
  })

  it('storeName opcional se conserva cuando viene junto con year/month', () => {
    const result = GlobalEmitSchema.safeParse({ year: 2026, month: 6, storeName: 'ariat' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.storeName).toBe('ariat')
  })
})
