/**
 * POST /api/fiscal/validate
 *
 * Proxy servidor para la validación de datos fiscales contra el SAT vía Facturama.
 * Nunca se llama a Facturama desde el cliente — todo pasa por aquí.
 *
 * Modos:
 *   - "status"  (solo rfc)              → llama validarRfc()
 *   - "full"    (rfc+name+zipCode+fiscalRegime) → llama validarReceptor()
 *
 * Errores:
 *   400 INVALID_RFC        → RFC malformado (falla la validación Zod)
 *   503 FACTURAMA_ERROR    → fallo real de Facturama (5xx, red, timeout)
 */

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { FiscalValidateSchema } from '@/lib/api/schemas'
import { validarRfc, validarReceptor } from '@/lib/invoice-service/facturama-client'
import { maskRfc } from '@/lib/log-redact'

function errorResponse(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status })
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
    return errorResponse('INVALID_BODY', 'El cuerpo de la petición no es JSON válido.', 400)
  }

  // ── 2. Validación Zod ─────────────────────────────────────────────────────
  const result = FiscalValidateSchema.safeParse(body)
  if (!result.success) {
    const msg = result.error.issues.map((i) => i.message).join('; ')
    return errorResponse('INVALID_RFC', msg, 400)
  }

  const { rfc, name, zipCode, fiscalRegime } = result.data
  const hasFullSet = name !== undefined && zipCode !== undefined && fiscalRegime !== undefined

  // ── 3. Modo conjunto (los 3 campos opcionales presentes) ──────────────────
  if (hasFullSet) {
    try {
      const validation = await validarReceptor({
        Rfc: rfc,
        Name: name,
        ZipCode: zipCode,
        FiscalRegime: fiscalRegime,
      })
      return NextResponse.json({
        mode: 'full',
        existsRfc: validation.ExistRfc,
        matchName: validation.MatchName,
        matchZipCode: validation.MatchZipCode,
        matchFiscalRegime: validation.MatchFiscalRegime,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[fiscal/validate] Error en validarReceptor:', { rfc: maskRfc(rfc), error: message })
      return errorResponse(
        'FACTURAMA_ERROR',
        'No se pudo verificar con el SAT en este momento. Intenta de nuevo más tarde.',
        503
      )
    }
  }

  // ── 4. Modo existencia (solo rfc) ─────────────────────────────────────────
  try {
    const existsRfc = await validarRfc(rfc)
    return NextResponse.json({ mode: 'status', existsRfc })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    // 404 de la ruta o 5xx de Facturama: degradamos con gracia.
    // En modo existencia (blur) no bloqueamos al cliente — devolvemos existsRfc: null
    // para que el hook trate el resultado como "no se pudo verificar".
    console.error('[fiscal/validate] Error en validarRfc:', { rfc: maskRfc(rfc), error: message })
    return errorResponse(
      'FACTURAMA_ERROR',
      'No se pudo verificar con el SAT en este momento.',
      503
    )
  }
}
