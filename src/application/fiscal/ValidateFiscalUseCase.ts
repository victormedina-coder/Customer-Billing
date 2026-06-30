/**
 * ValidateFiscalUseCase — caso de uso de validación de datos fiscales contra el SAT.
 *
 * Orquesta: llamar a validarReceptor y COLAPSAR la respuesta a { valid: boolean }.
 *
 * Seguridad: los granulares (ExistRfc, MatchName, MatchZipCode, MatchFiscalRegime)
 * NUNCA salen del use case — solo el booleano colapsado llega al handler/cliente.
 * Esto impide usar el endpoint como oráculo de enumeración de datos fiscales.
 *
 * Devuelve Result<{ valid: boolean }, ValidateFiscalError> — nunca lanza para
 * control de flujo.
 * NO importa 'next' ni construye NextResponse.
 */

import { ok, err } from '../shared/Result'
import type { Result } from '../shared/Result'
import { maskRfc } from '../../../lib/log-redact'

// ─── Tipos de error ───────────────────────────────────────────────────────────

export type ValidateFiscalErrorCode = 'FACTURAMA_ERROR'

export interface ValidateFiscalError {
  code: ValidateFiscalErrorCode
  message: string
}

// ─── Tipo de entrada (refleja los 4 campos requeridos por el SAT) ─────────────

export interface ValidateFiscalInput {
  rfc: string
  name: string
  zipCode: string
  fiscalRegime: string
}

// ─── Tipo de respuesta granular del servicio externo ─────────────────────────

export interface ReceptorValidationResult {
  Rfc: string
  ExistRfc: boolean
  MatchName: boolean
  MatchZipCode: boolean
  MatchFiscalRegime: boolean
}

// ─── Port mínimo ──────────────────────────────────────────────────────────────

export interface FiscalValidationService {
  validarReceptor(input: {
    Rfc: string
    Name: string
    ZipCode: string
    FiscalRegime: string
  }): Promise<ReceptorValidationResult>
}

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface ValidateFiscalDeps {
  fiscalService: FiscalValidationService
}

// ─── Use Case ─────────────────────────────────────────────────────────────────

export class ValidateFiscalUseCase {
  constructor(private readonly deps: ValidateFiscalDeps) {}

  async execute(
    input: ValidateFiscalInput
  ): Promise<Result<{ valid: boolean }, ValidateFiscalError>> {
    const { rfc, name, zipCode, fiscalRegime } = input
    const { fiscalService } = this.deps

    try {
      const v = await fiscalService.validarReceptor({
        Rfc:          rfc,
        Name:         name,
        ZipCode:      zipCode,
        FiscalRegime: fiscalRegime,
      })

      // Colapso server-side: valid es true solo si los 4 criterios pasan.
      // No se distingue qué campo falló ni si el RFC existe por separado.
      const valid = v.ExistRfc && v.MatchName && v.MatchZipCode && v.MatchFiscalRegime

      return ok({ valid })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      console.error('[fiscal/validate] Error en validarReceptor:', { rfc: maskRfc(rfc), error: message })
      return err({
        code: 'FACTURAMA_ERROR',
        message: 'No se pudo verificar con el SAT en este momento. Intenta de nuevo más tarde.',
      })
    }
  }
}
