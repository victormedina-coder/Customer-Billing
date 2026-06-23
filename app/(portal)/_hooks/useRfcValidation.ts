'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import type { RfcValidationState, FiscalData } from '../_lib/types'
import { isValidRfcFormat } from '../_lib/validators'

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type SatFieldErrors = Partial<Record<'rfc' | 'razon' | 'regimen' | 'cp', string>>

export interface ValidateReceptorResult {
  ok: boolean
  serviceError: boolean
  fieldErrors: SatFieldErrors
}

// ─── Respuestas de la API /api/fiscal/validate ────────────────────────────────

interface StatusResponse {
  mode: 'status'
  existsRfc: boolean
}

interface FullResponse {
  mode: 'full'
  existsRfc: boolean
  matchName: boolean
  matchZipCode: boolean
  matchFiscalRegime: boolean
}

type ValidateApiResponse = StatusResponse | FullResponse

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useRfcValidation() {
  const [state, setState] = useState<RfcValidationState>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Contador de secuencia: ignora respuestas de requests obsoletos (race condition).
  const seqRef = useRef(0)

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  /**
   * validateRfc — para el onBlur del campo RFC.
   * 1. Valida formato local; si inválido → 'invalid', sin fetch.
   * 2. Si bien formado → 'checking', debounce 600ms, llama /api/fiscal/validate.
   *    - existsRfc true  → 'registered'
   *    - existsRfc false → 'format' (bien formado pero no registrado en el SAT)
   *    - error de red/503 → vuelve a 'idle' (degrada sin bloquear)
   */
  const validateRfc = useCallback((rfc: string): void => {
    const normalized = rfc.trim().toUpperCase()

    if (!normalized) {
      setState('idle')
      return
    }

    if (!isValidRfcFormat(normalized)) {
      setState('invalid')
      return
    }

    // RFC bien formado: iniciar verificación asíncrona
    setState('checking')
    if (timerRef.current) clearTimeout(timerRef.current)

    const seq = ++seqRef.current

    timerRef.current = setTimeout(() => {
      fetch('/api/fiscal/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rfc: normalized }),
      })
        .then((res) => res.json() as Promise<ValidateApiResponse | { error: unknown }>)
        .then((data) => {
          // Ignorar respuestas de requests viejos
          if (seq !== seqRef.current) return

          if ('error' in data) {
            // 503 de Facturama: degradar sin bloquear
            setState('idle')
            return
          }

          const typedData = data as ValidateApiResponse
          if (typedData.mode === 'status') {
            setState(typedData.existsRfc ? 'registered' : 'format')
          }
        })
        .catch(() => {
          if (seq !== seqRef.current) return
          // Error de red: degradar sin bloquear
          setState('idle')
        })
    }, 600)
  }, [])

  /**
   * validateReceptor — para el botón Continuar.
   * POST con el conjunto completo: rfc, name, zipCode, fiscalRegime.
   * Mapea las discrepancias a mensajes de campo específicos.
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
          // 400 (RFC malformado — no debería llegar aquí si validateFiscal pasó)
          // 503 FACTURAMA_ERROR
          return { ok: false, serviceError: true, fieldErrors: {} }
        }

        const data = (await res.json()) as ValidateApiResponse

        if (data.mode !== 'full') {
          // Respuesta inesperada
          return { ok: false, serviceError: true, fieldErrors: {} }
        }

        const fieldErrors: SatFieldErrors = {}

        if (!data.existsRfc) {
          fieldErrors.rfc = 'RFC no registrado en el SAT'
        }
        if (!data.matchName) {
          fieldErrors.razon = 'El nombre no coincide con el registrado en el SAT'
        }
        if (!data.matchZipCode) {
          fieldErrors.cp = 'El código postal no coincide con el SAT'
        }
        if (!data.matchFiscalRegime) {
          fieldErrors.regimen = 'El régimen no coincide con el SAT'
        }

        const ok = Object.keys(fieldErrors).length === 0
        return { ok, serviceError: false, fieldErrors }
      } catch {
        // Error de red
        return { ok: false, serviceError: true, fieldErrors: {} }
      }
    },
    []
  )

  const reset = useCallback((): void => {
    if (timerRef.current) clearTimeout(timerRef.current)
    seqRef.current++
    setState('idle')
  }, [])

  return { state, validateRfc, validateReceptor, reset }
}
