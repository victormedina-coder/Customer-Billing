/**
 * POST /api/invoice/lookup
 *
 * Recibe: { folio: string }
 * Responde: { ticket: Ticket } en 200, o error estructurado en 4xx/5xx.
 *
 * Runtime: Node.js (no edge) — necesario para acceder a secretos de servidor
 * y para el caché de tokens OAuth en memoria del proceso.
 *
 * Errores:
 *   400 INVALID_FOLIO   → folio vacío o malformado
 *   404 ORDER_NOT_FOUND → pedido no encontrado en ninguna tienda Shopify
 *   422 DEADLINE_EXCEEDED → pedido encontrado pero fuera de la ventana de facturación
 *   502 SHOPIFY_ERROR   → todas las tiendas fallaron, sin marcas configuradas,
 *                         o error de conexión / respuesta inesperada
 *
 * Nota: BRAND_NOT_IDENTIFIED fue eliminado. La búsqueda usa fan-out paralelo
 * sobre todas las marcas configuradas; no se necesita identificar la marca
 * por el prefijo del folio.
 */

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { getOrderSource } from '@/lib/order-source'
import { normalizedOrderToTicket } from '@/lib/shopify/mapper'
import { isWithinInvoiceWindow } from '@/lib/invoice-window'
import { LookupSchema } from '@/lib/api/schemas'

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
  const result = LookupSchema.safeParse(body)
  if (!result.success) {
    const msg = result.error.issues.map(i => i.message).join('; ')
    return errorResponse('INVALID_FOLIO', msg, 400)
  }
  const folio = result.data.folio.trim()
  if (!folio) {
    return errorResponse('INVALID_FOLIO', 'El folio no puede estar vacío.', 400)
  }

  // ── 3. Buscar pedido ──────────────────────────────────────────────────────
  try {
    const source = getOrderSource()
    // verifier: vacío por ahora — validación por email diferida
    const order = await source.findOrder({ orderNumber: folio, verifier: '' })

    if (!order) {
      return errorResponse(
        'ORDER_NOT_FOUND',
        `No se encontró ningún pedido con el folio "${folio}".`,
        404
      )
    }

    // ── 4. Validar ventana de facturación ────────────────────────────────
    // Solo se puede facturar un pedido cuya fecha caiga en el mes calendario
    // en curso (zona horaria America/Mexico_City).
    // TODO contador: confirmar corte/plazo exacto (mes en curso por ahora).
    if (!isWithinInvoiceWindow(order.createdAt)) {
      return errorResponse(
        'DEADLINE_EXCEEDED',
        'El periodo de facturación de este ticket ya venció (solo se factura dentro del mes en curso).',
        422
      )
    }

    // ── 5. Mapear a Ticket para la UI ─────────────────────────────────────
    // Se muestra el folio que tecleó el cliente (recibo POS, ej. "15-5333"),
    // no el `name` interno de Shopify (ej. "#45371").
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
