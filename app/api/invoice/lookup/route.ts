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
 * Nota: BRAND_NOT_IDENTIFIED fue eliminado. La búsqueda usa fan-out paralelo
 * sobre todas las marcas configuradas; no se necesita identificar la marca
 * por el prefijo del folio.
 *
 * Segundo factor — por qué el error es genérico (VALIDATION_FAILED uniforme):
 *   Si folio-no-encontrado devolviera un código distinto al de monto-incorrecto,
 *   un atacante podría enumerar folios válidos con un escáner de folios antes
 *   de intentar el monto. El error uniforme elimina ese oráculo: el atacante
 *   no puede distinguir "folio existe pero monto mal" de "folio no existe".
 */

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { getOrderSource } from '@/lib/order-source'
import { normalizedOrderToTicket } from '@/lib/shopify/mapper'
import { isWithinInvoiceWindow } from '@/lib/invoice-window'
import { isFullyRefunded } from '@/lib/refund'
import { LookupSchema } from '@/lib/api/schemas'
import { isAlreadyInvoiced } from '@/lib/db/invoice-repository'
import { amountMatches } from '@/lib/amount-match'

/** Forma canónica de error de la API */
function errorResponse(
  code: string,
  message: string,
  status: number,
  headers?: Record<string, string>
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status, headers })
}

/**
 * Respuesta de validación fallida genérica (folio no encontrado O monto incorrecto).
 *
 * Por qué es idéntica en ambos casos: ver comentario del módulo. El cliente legítimo
 * sabe cuál campo corregir (revisará su ticket físico); el atacante no gana información.
 */
const VALIDATION_FAILED_RESPONSE = {
  code: 'VALIDATION_FAILED',
  message: 'El folio o el monto no coinciden con un ticket facturable. Verifica los datos de tu ticket e intenta de nuevo.',
} as const

function validationFailedResponse(): NextResponse {
  return NextResponse.json(
    { error: VALIDATION_FAILED_RESPONSE },
    { status: 422 }
  )
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 0. Rate limiting por IP ───────────────────────────────────────────────
  const ip = getClientIp(req)
  const rl = await rateLimit(`lookup:${ip}`, RATE_LIMITS.lookup.max, RATE_LIMITS.lookup.windowSec)
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
  // Si folio o amount están ausentes o tienen formato inválido devolvemos
  // VALIDATION_FAILED (mismo código genérico) para no revelar qué campo falta.
  // Esto evita que un atacante deduzca si "folio existe pero faltó el amount".
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
  // La clave es el folio en mayúsculas para normalizar variantes ("15-5333" ≡ "15-5333").
  // Por qué por folio y no solo por IP: un atacante que rota IPs puede evitar el
  // límite de IP; el folio es el recurso que está atacando y no cambia.
  // Un usuario legítimo nunca supera 1-2 intentos por folio.
  const folioUpper = folio.toUpperCase()
  const rlFolio = await rateLimit(
    `validate:folio:${folioUpper}`,
    RATE_LIMITS.validate.max,
    RATE_LIMITS.validate.windowSec
  )
  if (!rlFolio.allowed) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Demasiadas solicitudes. Intenta de nuevo en un momento.' } },
      { status: 429, headers: { 'Retry-After': String(rlFolio.retryAfter) } }
    )
  }

  // ── 4. Buscar pedido ──────────────────────────────────────────────────────
  try {
    const source = getOrderSource()
    // verifier: vacío por ahora — validación por email diferida
    const order = await source.findOrder({ orderNumber: folio, verifier: '' })

    // VALIDATION_FAILED genérico (igual que monto-incorrecto) para no revelar
    // si el folio existe. Ver comentario del módulo.
    if (!order) {
      return validationFailedResponse()
    }

    // ── 5. Compuerta de monto (segundo factor) ────────────────────────────────
    // Comparamos al centavo: order.total es el monto real que pagó el cliente
    // (campo `total` de NormalizedOrder, mapeado desde Shopify currentTotalPrice).
    // Si no coincide → mismo error genérico que folio no encontrado.
    if (!amountMatches(amount, order.total)) {
      return validationFailedResponse()
    }

    // ── Compuerta superada: a partir de aquí podemos revelar estados específicos ──

    // ── 6. Verificar reembolso total ──────────────────────────────────────────
    if (isFullyRefunded(order)) {
      return errorResponse(
        'FULLY_REFUNDED',
        'Este pedido fue reembolsado en su totalidad y no puede facturarse.',
        409
      )
    }

    // ── 7. Validar ventana de facturación ─────────────────────────────────────
    // Solo se puede facturar un pedido cuya fecha caiga en el mes calendario
    // en curso (zona horaria America/Mexico_City).
    if (!isWithinInvoiceWindow(order.createdAt)) {
      return errorResponse(
        'DEADLINE_EXCEEDED',
        'El periodo de facturación de este ticket ya venció (solo se factura dentro del mes en curso).',
        422
      )
    }

    // ── 8. Verificar doble-facturación ────────────────────────────────────────
    const invoiced = await isAlreadyInvoiced(order.id, order.storeName)
    if (invoiced) {
      return errorResponse(
        'ALREADY_INVOICED',
        'Este pedido ya cuenta con un CFDI emitido.',
        409
      )
    }

    // ── 9. Mapear a Ticket para la UI ─────────────────────────────────────────
    // Se muestra el folio que tecleó el cliente (recibo POS, ej. "15-5333"),
    // no el `name` interno de Shopify (ej. "#45371").
    // Aquí ya es seguro devolver el total: el cliente demostró conocerlo.
    const ticket = normalizedOrderToTicket(order, folio)

    return NextResponse.json({ ticket }, { status: 200 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)

    // Todos los errores que llegan aquí son problemas del upstream (Shopify):
    // - Todas las tiendas fallaron
    // - Sin marcas configuradas
    // - Error de red / respuesta inesperada
    console.error('[lookup] Error al consultar Shopify:', {
      folio,
      error: message,
    })
    return errorResponse(
      'SHOPIFY_ERROR',
      'Error al consultar el pedido. Intenta de nuevo más tarde.',
      502
    )
  }
}
