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

describe('GlobalEmitSchema — day opcional (R1, periodicidad diaria)', () => {
  it('{ year, month, day } válido → pasa y day se conserva', () => {
    const result = GlobalEmitSchema.safeParse({ year: 2026, month: 6, day: 15 })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.day).toBe(15)
  })

  it('{ day } solo (sin year/month) → inválido, mensaje claro', () => {
    const result = GlobalEmitSchema.safeParse({ day: 15 })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join('; ')
      expect(messages).toMatch(/day requiere year y month explícitos/)
    }
  })

  it('{ year, day } sin month → inválido (día sin periodo completo es ambiguo)', () => {
    const result = GlobalEmitSchema.safeParse({ year: 2026, day: 15 })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join('; ')
      expect(messages).toMatch(/day requiere year y month explícitos/)
    }
  })

  it('{ month, day } sin year → inválido', () => {
    const result = GlobalEmitSchema.safeParse({ month: 6, day: 15 })
    expect(result.success).toBe(false)
  })

  it('day 0 o day 32 → inválido (rango 1-31)', () => {
    expect(GlobalEmitSchema.safeParse({ year: 2026, month: 6, day: 0 }).success).toBe(false)
    expect(GlobalEmitSchema.safeParse({ year: 2026, month: 6, day: 32 }).success).toBe(false)
  })

  it('sin day (solo year/month) → sigue siendo válido (comportamiento mensual intacto)', () => {
    const result = GlobalEmitSchema.safeParse({ year: 2026, month: 6 })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.day).toBeUndefined()
  })

  it('body vacío {} → sigue válido, day undefined', () => {
    const result = GlobalEmitSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.day).toBeUndefined()
  })
})

describe('GlobalEmitSchema — relative (R4, resolución de defaults para crons)', () => {
  it("relative: 'current-month' solo → válido", () => {
    const result = GlobalEmitSchema.safeParse({ relative: 'current-month' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.relative).toBe('current-month')
  })

  it("relative: 'previous-month' solo → válido", () => {
    const result = GlobalEmitSchema.safeParse({ relative: 'previous-month' })
    expect(result.success).toBe(true)
  })

  // [DAILY-SCAFFOLDING] test-only, remover junto con el modo 'yesterday' (ver plan R5).
  it("relative: 'yesterday' solo → válido", () => {
    const result = GlobalEmitSchema.safeParse({ relative: 'yesterday' })
    expect(result.success).toBe(true)
  })

  it('relative con valor fuera del enum → inválido', () => {
    const result = GlobalEmitSchema.safeParse({ relative: 'next-month' })
    expect(result.success).toBe(false)
  })

  it('relative + year → inválido (mutuamente excluyentes)', () => {
    const result = GlobalEmitSchema.safeParse({ relative: 'current-month', year: 2026 })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join('; ')
      expect(messages).toMatch(/relative es excluyente con year\/month\/day/)
    }
  })

  it('relative + year + month → inválido (mutuamente excluyentes aunque el par sea válido)', () => {
    const result = GlobalEmitSchema.safeParse({ relative: 'current-month', year: 2026, month: 6 })
    expect(result.success).toBe(false)
  })

  it("relative: 'yesterday' + month → inválido (mutuamente excluyentes)", () => {
    const result = GlobalEmitSchema.safeParse({ relative: 'yesterday', month: 6 })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join('; ')
      expect(messages).toMatch(/relative es excluyente con year\/month\/day/)
    }
  })

  it('relative + day → inválido', () => {
    const result = GlobalEmitSchema.safeParse({ relative: 'yesterday', day: 15 })
    expect(result.success).toBe(false)
  })

  it('sin relative y sin componentes explícitos (body vacío) → sigue válido', () => {
    const result = GlobalEmitSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.relative).toBeUndefined()
  })

  it('storeName/dryRun se conservan junto con relative', () => {
    const result = GlobalEmitSchema.safeParse({ relative: 'current-month', storeName: 'ariat', dryRun: true })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.storeName).toBe('ariat')
      expect(result.data.dryRun).toBe(true)
    }
  })
})
