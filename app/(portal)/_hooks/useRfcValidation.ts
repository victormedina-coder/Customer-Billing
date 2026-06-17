'use client'
import { useState, useRef, useCallback } from 'react'
import type { RfcValidationState } from '../_lib/types'
import { isValidRfcFormat } from '../_lib/validators'
import { DEMO_SAT_REGISTRY } from '../_lib/constants'

export interface RfcValidationResult {
  state: RfcValidationState
  rfcRazon: string
}

export function useRfcValidation() {
  const [result, setResult] = useState<RfcValidationResult>({ state: 'idle', rfcRazon: '' })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const validate = useCallback((rfc: string, onRegistered: (razon: string, regimen: string) => void) => {
    const normalized = rfc.trim().toUpperCase()
    if (!normalized) { setResult({ state: 'idle', rfcRazon: '' }); return }
    if (!isValidRfcFormat(normalized)) { setResult({ state: 'invalid', rfcRazon: '' }); return }

    setResult({ state: 'checking', rfcRazon: '' })
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      // TODO: en producción, llamar a /api/rfc/validate o al servicio de Facturama
      const hit = DEMO_SAT_REGISTRY[normalized]
      if (hit) {
        setResult({ state: 'registered', rfcRazon: hit.razon })
        onRegistered(hit.razon, hit.regimen)
      } else {
        setResult({ state: 'format', rfcRazon: '' })
      }
    }, 850)
  }, [])

  const reset = useCallback(() => setResult({ state: 'idle', rfcRazon: '' }), [])

  return { ...result, validate, reset }
}
