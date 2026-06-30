/**
 * POST /api/invoice/resend
 *
 * Reenvía por correo un CFDI ya emitido usando el endpoint de Facturama.
 * El email destino se toma exclusivamente de la fila en DB (campo `email`),
 * nunca del request del cliente — esto previene la vulnerabilidad IDOR/BOLA
 * de reenvío a un email arbitrario.
 *
 * Recibe: { invoiceId: string (UUID) }
 * Responde: { ok: true } en 200, o error estructurado en 4xx/5xx.
 *
 * Runtime: Node.js — necesario para acceder a secretos de servidor.
 *
 * Errores:
 *   400 INVALID_BODY  → body no es JSON válido o invoiceId no es UUID
 *   404 NOT_FOUND     → no existe fila con ese invoiceId o no tiene facturamaId
 *   422 NO_EMAIL      → la fila existe pero no tiene email guardado
 *   503 EMAIL_ERROR   → Facturama no pudo enviar el correo
 */

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { RATE_LIMITS } from '@/lib/rate-limit'
import { ResendSchema } from '@/lib/api/schemas'
import { makeResendInvoiceUseCase } from '@/src/composition/makeResendInvoiceUseCase'
import type { ResendErrorCode } from '@/src/application/invoice/ResendInvoiceUseCase'
import { httpError } from '@/src/interface/http/httpError'
import { enforceRateLimit } from '@/src/interface/http/withRateLimit'

/** Mapa de código de error de dominio → status HTTP */
const ERROR_STATUS: Record<ResendErrorCode, number> = {
  NOT_FOUND:   404,
  NO_EMAIL:    422,
  EMAIL_ERROR: 503,
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 0. Rate limiting ──────────────────────────────────────────────────────
  const rateLimited = await enforceRateLimit(req, 'resend', RATE_LIMITS.resend.max, RATE_LIMITS.resend.windowSec)
  if (rateLimited) return rateLimited

  // ── 1. Parsear body ───────────────────────────────────────────────────────
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return httpError('INVALID_BODY', 'El cuerpo de la petición no es JSON válido.', 400)
  }

  // ── 2. Validación Zod (solo invoiceId, sin email del cliente) ─────────────
  const result = ResendSchema.safeParse(body)
  if (!result.success) {
    const msg = result.error.issues.map(i => i.message).join('; ')
    return httpError('INVALID_BODY', msg, 400)
  }
  const { invoiceId } = result.data

  // ── 3–5. Orquestación delegada al use case ────────────────────────────────
  const useCase = makeResendInvoiceUseCase()
  const ucResult = await useCase.execute(invoiceId)

  if (!ucResult.ok) {
    const { code, message } = ucResult.error
    return httpError(code, message, ERROR_STATUS[code])
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
