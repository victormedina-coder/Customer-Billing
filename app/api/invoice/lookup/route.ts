/**
 * POST /api/invoice/lookup
 *
 * Recibe: { folio: string, amount: number }
 * Responde: { ticket: Ticket } en 200, o error estructurado en 4xx/5xx.
 *
 * Runtime: Node.js (no edge) — necesario para acceder a secretos de servidor
 * y para el caché de tokens OAuth en memoria del proceso.
 *
 * Errores:
 *   422 VALIDATION_FAILED  → folio o monto ausentes/inválidos, folio no encontrado,
 *                            o monto incorrecto (BYTE-IDÉNTICOS intencionalmente —
 *                            ver comentario de seguridad más abajo)
 *   409 FULLY_REFUNDED     → pedido reembolsado en su totalidad (neto = 0)
 *   422 DEADLINE_EXCEEDED  → pedido encontrado pero fuera de la ventana de facturación
 *   409 ALREADY_INVOICED   → pedido ya cuenta con CFDI emitido
 *   429 RATE_LIMITED       → demasiados intentos (por IP o por folio)
 *   502 SHOPIFY_ERROR      → todas las tiendas fallaron o error de conexión
 *
 * Segundo factor — por qué el error es genérico (VALIDATION_FAILED uniforme):
 *   Si folio-no-encontrado devolviera un código distinto al de monto-incorrecto,
 *   un atacante podría enumerar folios válidos con un escáner de folios antes
 *   de intentar el monto. El error uniforme elimina ese oráculo: el atacante
 *   no puede distinguir "folio existe pero monto mal" de "folio no existe".
 */

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { normalizedOrderToTicket } from '@/lib/shopify/mapper'
import { LookupSchema } from '@/lib/api/schemas'
import { makeLookupOrderUseCase } from '@/src/composition/makeLookupOrderUseCase'
import type { LookupErrorCode } from '@/src/application/invoice/LookupOrderUseCase'
import { httpError, rateLimitedResponse } from '@/src/interface/http/httpError'
import { enforceRateLimit } from '@/src/interface/http/withRateLimit'

/**
 * Respuesta de validación fallida genérica (folio no encontrado O monto incorrecto).
 *
 * Por qué es idéntica en ambos casos: ver comentario del módulo. El cliente legítimo
 * sabe cuál campo corregir (revisará su ticket físico); el atacante no gana información.
 */
function validationFailedResponse(): NextResponse {
  return httpError(
    'VALIDATION_FAILED',
    'El folio o el monto no coinciden con un ticket facturable. Verifica los datos de tu ticket e intenta de nuevo.',
    422
  )
}

/** Mapa de código de error de dominio → status HTTP */
const ERROR_STATUS: Record<LookupErrorCode, number> = {
  VALIDATION_FAILED: 422,
  SHOPIFY_ERROR:     502,
  FULLY_REFUNDED:    409,
  DEADLINE_EXCEEDED: 422,
  ALREADY_INVOICED:  409,
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 0. Rate limiting por IP ───────────────────────────────────────────────
  const rateLimited = await enforceRateLimit(req, 'lookup', RATE_LIMITS.lookup.max, RATE_LIMITS.lookup.windowSec)
  if (rateLimited) return rateLimited

  // ── 1. Parsear body ───────────────────────────────────────────────────────
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return httpError('INVALID_BODY', 'El cuerpo de la petición no es JSON válido.', 400)
  }

  // ── 2. Validación Zod ─────────────────────────────────────────────────────
  // Si folio o amount están ausentes o tienen formato inválido devolvemos
  // VALIDATION_FAILED (mismo código genérico) para no revelar qué campo falta.
  const result = LookupSchema.safeParse(body)
  if (!result.success) {
    return validationFailedResponse()
  }
  const folio = result.data.folio.trim()
  if (!folio) {
    return validationFailedResponse()
  }
  const { amount } = result.data

  // ── 3. Rate limiting por folio (anti-fuerza-bruta de montos) ─────────────
  // La clave es el folio en mayúsculas para normalizar variantes.
  // Por qué por folio y no solo por IP: un atacante que rota IPs puede evitar el
  // límite de IP; el folio es el recurso que está atacando y no cambia.
  const folioUpper = folio.toUpperCase()
  const rlFolio = await rateLimit(
    `validate:folio:${folioUpper}`,
    RATE_LIMITS.validate.max,
    RATE_LIMITS.validate.windowSec
  )
  if (!rlFolio.allowed) {
    return rateLimitedResponse(rlFolio.retryAfter)
  }

  // ── 4–6. Orquestación delegada al use case ────────────────────────────────
  const useCase = makeLookupOrderUseCase()
  const ucResult = await useCase.execute({ folio, amount })

  if (!ucResult.ok) {
    const { code, message } = ucResult.error
    return httpError(code, message, ERROR_STATUS[code])
  }

  // ── 7. Mapear Order→Ticket para la UI ─────────────────────────────────────
  // Se muestra el folio que tecleó el cliente (recibo POS, ej. "15-5333"),
  // no el `name` interno de Shopify (ej. "#45371").
  const order = ucResult.value
  const ticket = normalizedOrderToTicket(order, folio)

  return NextResponse.json({ ticket }, { status: 200 })
}
