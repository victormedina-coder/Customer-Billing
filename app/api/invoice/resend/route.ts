/**
 * POST /api/invoice/resend
 *
 * Reenvía por correo un CFDI ya emitido usando el endpoint de Facturama.
 *
 * Recibe: { facturamaId: string, email: string, serieFolio?: string }
 * Responde: { ok: true } en 200, o error estructurado en 4xx/5xx.
 *
 * Runtime: Node.js — necesario para acceder a secretos de servidor.
 *
 * Errores:
 *   400 INVALID_BODY  → body no es JSON válido
 *   400 INVALID_BODY  → Zod falla en la validación
 *   503 EMAIL_ERROR   → Facturama no pudo enviar el correo
 */

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { ResendSchema } from '@/lib/api/schemas'
import { getInvoiceService } from '@/lib/invoice-service'

/** Forma canónica de error de la API */
function errorResponse(
  code: string,
  message: string,
  status: number
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1. Parsear body ───────────────────────────────────────────────────────
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('INVALID_BODY', 'El cuerpo de la petición no es JSON válido.', 400)
  }

  // ── 2. Validación Zod ─────────────────────────────────────────────────────
  const result = ResendSchema.safeParse(body)
  if (!result.success) {
    const msg = result.error.issues.map(i => i.message).join('; ')
    return errorResponse('INVALID_BODY', msg, 400)
  }
  const { facturamaId, email, serieFolio } = result.data

  // ── 3. Enviar correo via InvoiceService ───────────────────────────────────
  try {
    await getInvoiceService().enviarCorreo(facturamaId, email, { serieFolio })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[resend] Error al enviar el correo:', { facturamaId, email, error: message })
    return errorResponse(
      'EMAIL_ERROR',
      'No se pudo enviar el correo. Intenta de nuevo más tarde.',
      503
    )
  }
}
