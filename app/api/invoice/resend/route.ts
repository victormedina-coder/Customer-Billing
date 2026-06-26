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
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { ResendSchema } from '@/lib/api/schemas'
import { getInvoiceService } from '@/lib/invoice-service'
import { findById } from '@/lib/db/invoice-repository'

/** Forma canónica de error de la API */
function errorResponse(
  code: string,
  message: string,
  status: number
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 0. Rate limiting ──────────────────────────────────────────────────────
  const ip = getClientIp(req)
  const rl = await rateLimit(`resend:${ip}`, RATE_LIMITS.resend.max, RATE_LIMITS.resend.windowSec)
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

  // ── 2. Validación Zod (solo invoiceId, sin email del cliente) ─────────────
  const result = ResendSchema.safeParse(body)
  if (!result.success) {
    const msg = result.error.issues.map(i => i.message).join('; ')
    return errorResponse('INVALID_BODY', msg, 400)
  }
  const { invoiceId } = result.data

  // ── 3. Resolver fila en DB usando el invoiceId como token de capacidad ────
  const row = await findById(invoiceId)
  if (!row || !row.facturamaId) {
    return errorResponse('NOT_FOUND', 'Factura no encontrada.', 404)
  }

  // ── 4. Usar el email guardado en DB — nunca el del request ───────────────
  if (!row.email) {
    return errorResponse('NO_EMAIL', 'No hay correo registrado para esta factura.', 422)
  }

  // ── 5. Enviar correo via InvoiceService ───────────────────────────────────
  try {
    await getInvoiceService().enviarCorreo(row.facturamaId, row.email, {})
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    // No loguear el email en claro — solo el invoiceId y el error
    console.error('[resend] Error al enviar el correo:', { invoiceId, error: message })
    return errorResponse(
      'EMAIL_ERROR',
      'No se pudo enviar el correo. Intenta de nuevo más tarde.',
      503
    )
  }
}
