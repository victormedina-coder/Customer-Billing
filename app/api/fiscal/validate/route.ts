/**
 * POST /api/fiscal/validate
 *
 * Proxy servidor para la validación de datos fiscales contra el SAT vía Facturama.
 * Nunca se llama a Facturama desde el cliente — todo pasa por aquí.
 *
 * Contrato (único modo soportado):
 *   Body requerido: { rfc, name, zipCode, fiscalRegime }
 *   200 → { valid: boolean }
 *     true  = RFC existe en el SAT Y los 3 campos coinciden exactamente.
 *     false = alguno de los 4 criterios no coincidió.
 *
 * El resultado se COLAPSA a un booleano en el servidor a propósito:
 *   - No se revelan qué campos fallaron (MatchName, MatchZipCode, etc.).
 *   - No se revela si el RFC existe por separado del conjunto.
 *   Esto impide usar el endpoint como oráculo de enumeración de datos fiscales.
 *
 * Errores:
 *   400 INVALID_BODY  → body no es JSON o faltan campos requeridos
 *   400 INVALID_RFC   → RFC malformado (falla la validación Zod de formato)
 *   429 RATE_LIMITED  → límite por IP superado
 *   503 FACTURAMA_ERROR → fallo real de Facturama/SAT (5xx, red, timeout)
 */

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { FiscalValidateSchema } from '@/lib/api/schemas'
import { makeValidateFiscalUseCase } from '@/src/composition/makeValidateFiscalUseCase'
import type { ValidateFiscalErrorCode } from '@/src/application/fiscal/ValidateFiscalUseCase'

function errorResponse(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status })
}

/** Mapa de código de error de dominio → status HTTP */
const ERROR_STATUS: Record<ValidateFiscalErrorCode, number> = {
  FACTURAMA_ERROR: 503,
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 0. Rate limiting ──────────────────────────────────────────────────────
  const ip = getClientIp(req)
  const rl = await rateLimit(`fiscal-validate:${ip}`, RATE_LIMITS.fiscal.max, RATE_LIMITS.fiscal.windowSec)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Demasiadas solicitudes. Intenta de nuevo en un momento.' } },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  // ── 1. Parsear body ───────────────────────────────────────────────────────
  let body: unknown
  try {
    body = await req.json()
  } catch {
    // Body no es JSON válido — error genérico sin detalles fiscales
    return errorResponse('INVALID_BODY', 'Datos incompletos para validar.', 400)
  }

  // ── 2. Validación Zod ─────────────────────────────────────────────────────
  // Si falta cualquiera de los 4 campos o el RFC tiene formato incorrecto, se
  // responde con error genérico (INVALID_BODY) o de formato (INVALID_RFC).
  // Nunca se comunica al cliente qué campo fiscal específico causó el rechazo.
  const result = FiscalValidateSchema.safeParse(body)
  if (!result.success) {
    const hasRfcError = result.error.issues.some((i) => i.path.includes('rfc'))
    if (hasRfcError) {
      // El formato del RFC es conocimiento del cliente (regex público del SAT),
      // no es un oráculo de datos reales — se puede indicar.
      const msg = result.error.issues
        .filter((i) => i.path.includes('rfc'))
        .map((i) => i.message)
        .join('; ')
      return errorResponse('INVALID_RFC', msg, 400)
    }
    // Campos faltantes o con formato inválido (name, zipCode, fiscalRegime)
    return errorResponse('INVALID_BODY', 'Datos incompletos para validar.', 400)
  }

  const { rfc, name, zipCode, fiscalRegime } = result.data

  // ── 3. Orquestación delegada al use case ──────────────────────────────────
  const useCase = makeValidateFiscalUseCase()
  const ucResult = await useCase.execute({ rfc, name, zipCode, fiscalRegime })

  if (!ucResult.ok) {
    const { code, message } = ucResult.error
    return errorResponse(code, message, ERROR_STATUS[code])
  }

  return NextResponse.json({ valid: ucResult.value.valid })
}
