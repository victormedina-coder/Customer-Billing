/**
 * Tests de EmitSchema (lib/api/schemas.ts) — contrato HTTP de POST /api/invoice/emit.
 *
 * Cubre el gate de consentimiento legal agregado al contrato:
 * `consent: { acceptedPrivacy: true, acceptedTerms: true }` es obligatorio y
 * ambos flags deben ser exactamente `true` — Zod rechaza cualquier otro valor
 * (false, ausente, string, etc.) antes de llegar al use case.
 */

import { describe, it, expect } from 'vitest'
import { EmitSchema } from '../lib/api/schemas'

const VALID_FISCAL = {
  rfc: 'EKU9003173C9',
  razon: 'ESCUELA KEMPER URGATE',
  regimen: '601',
  cp: '26015',
  uso: 'G01',
  email: 'cliente@example.com',
}

const VALID_CONSENT = { acceptedPrivacy: true, acceptedTerms: true }

function makeBody(overrides: Record<string, unknown> = {}) {
  return {
    folio: '15-5333',
    amount: 116,
    fiscal: VALID_FISCAL,
    consent: VALID_CONSENT,
    ...overrides,
  }
}

describe('EmitSchema — consentimiento legal', () => {
  it('acepta el body cuando consent trae ambos flags en true', () => {
    const result = EmitSchema.safeParse(makeBody())
    expect(result.success).toBe(true)
  })

  it('rechaza cuando falta consent por completo', () => {
    const body = makeBody()
    delete (body as Record<string, unknown>).consent
    const result = EmitSchema.safeParse(body)
    expect(result.success).toBe(false)
  })

  it('rechaza cuando acceptedPrivacy es false', () => {
    const result = EmitSchema.safeParse(
      makeBody({ consent: { acceptedPrivacy: false, acceptedTerms: true } })
    )
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join('; ')
      expect(messages).toMatch(/Aviso de Privacidad/i)
    }
  })

  it('rechaza cuando acceptedTerms es false', () => {
    const result = EmitSchema.safeParse(
      makeBody({ consent: { acceptedPrivacy: true, acceptedTerms: false } })
    )
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join('; ')
      expect(messages).toMatch(/Términos y Condiciones/i)
    }
  })

  it('rechaza cuando ambos flags son false', () => {
    const result = EmitSchema.safeParse(
      makeBody({ consent: { acceptedPrivacy: false, acceptedTerms: false } })
    )
    expect(result.success).toBe(false)
  })

  it('rechaza cuando los flags no son booleanos (string "true")', () => {
    const result = EmitSchema.safeParse(
      makeBody({ consent: { acceptedPrivacy: 'true', acceptedTerms: 'true' } })
    )
    expect(result.success).toBe(false)
  })

  it('el body sin consent sigue rechazando aunque folio/amount/fiscal sean válidos', () => {
    const result = EmitSchema.safeParse({
      folio: '15-5333',
      amount: 116,
      fiscal: VALID_FISCAL,
    })
    expect(result.success).toBe(false)
  })
})
