'use client'
import { useState, useCallback } from 'react'
import type { RfcValidationState, FiscalData } from '../_lib/types'
import { isValidRfcFormat } from '../_lib/validators'

// ─── Tipos públicos ───────────────────────────────────────────────────────────

/**
 * Resultado de validateReceptor (botón Continuar).
 *
 * Anti-oráculo: ya NO se exponen errores por campo SAT.
 * El backend solo devuelve { valid: boolean }; nosotros solo exponemos ok/serviceError.
 */
export interface ValidateReceptorResult {
  ok: boolean
  /** true si hubo error de red, 503, 429 u otro status no-200 */
  serviceError: boolean
}

// ─── Respuesta del nuevo contrato /api/fiscal/validate ───────────────────────

interface ValidateApiResponse {
  valid: boolean
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useRfcValidation() {
  const [state, setState] = useState<RfcValidationState>('idle')

  /**
   * validateRfc — para el onBlur del campo RFC.
   *
   * Anti-oráculo: SOLO valida formato local. NO hace fetch a la API ni al SAT.
   * No revelamos si el RFC existe o no registrado; eso ocurre únicamente al
   * pulsar Continuar, colapsado en un error genérico de identidad.
   *
   *   vacío          → 'idle'
   *   formato malo   → 'invalid'
   *   formato correcto → 'valid-format'  (NO significa "registrado en el SAT")
   */
  const validateRfc = useCallback((rfc: string): void => {
    const normalized = rfc.trim().toUpperCase()

    if (!normalized) {
      setState('idle')
      return
    }

    setState(isValidRfcFormat(normalized) ? 'valid-format' : 'invalid')
  }, [])

  /**
   * validateReceptor — para el botón Continuar.
   *
   * POST con el conjunto completo: rfc, name, zipCode, fiscalRegime.
   * El backend devuelve { valid: boolean } — sin detallar qué campo falló.
   * Nosotros NO mapeamos a errores por campo: solo ok / serviceError.
   */
  const validateReceptor = useCallback(
    async (fiscal: FiscalData): Promise<ValidateReceptorResult> => {
      try {
        const res = await fetch('/api/fiscal/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rfc: fiscal.rfc.trim().toUpperCase(),
            name: fiscal.razon.trim(),
            zipCode: fiscal.cp.trim(),
            fiscalRegime: fiscal.regimen,
          }),
        })

        if (!res.ok) {
          // 400 INVALID_RFC / INVALID_BODY, 429 RATE_LIMITED, 503 FACTURAMA_ERROR
          return { ok: false, serviceError: true }
        }

        const data = (await res.json()) as ValidateApiResponse
        return { ok: data.valid === true, serviceError: false }
      } catch {
        // Error de red
        return { ok: false, serviceError: true }
      }
    },
    []
  )

  const reset = useCallback((): void => {
    setState('idle')
  }, [])

  return { state, validateRfc, validateReceptor, reset }
}
