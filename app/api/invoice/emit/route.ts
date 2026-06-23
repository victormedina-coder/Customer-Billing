/**
 * POST /api/invoice/emit
 *
 * Recibe: { folio: string, fiscal: FiscalData }
 * Responde: { factura: { uuid, serieFolio, fecha, sello } } en 200,
 *           o error estructurado en 4xx/5xx.
 *
 * Runtime: Node.js (no edge) — secretos de servidor, caché OAuth en memoria.
 *
 * Errores:
 *   400 FISCAL_INVALID    → Zod falla en fiscal o folio
 *   400 INVALID_FOLIO     → folio vacío tras trim
 *   404 ORDER_NOT_FOUND   → Shopify no encuentra el pedido
 *   409 ALREADY_INVOICED  → el pedido ya tiene CFDI (activado en Etapa 3)
 *   422 DEADLINE_EXCEEDED → fuera de la ventana de facturación
 *   502 SHOPIFY_ERROR     → todas las tiendas fallaron / error de conexión
 *   503 FACTURAMA_ERROR   → Facturama lanza error al timbrar
 */

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { EmitSchema } from '@/lib/api/schemas'
import { getOrderSource } from '@/lib/order-source'
import { isWithinInvoiceWindow } from '@/lib/invoice-window'
import { getInvoiceService } from '@/lib/invoice-service'
import type { NormalizedOrderWithPayment } from '@/lib/shopify/mapper'

/** Forma canónica de error de la API */
function errorResponse(
  code: string,
  message: string,
  status: number
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status })
}

/** Genera un CFDI de prueba sin llamar a Facturama ni Shopify */
function mockCfdi(folio: string) {
  void folio
  const now = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  const fecha = `${p(now.getDate())}/${p(now.getMonth() + 1)}/${now.getFullYear()} ${p(now.getHours())}:${p(now.getMinutes())}`
  const folioNum = Math.floor(100000 + Math.random() * 899999)
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/'
  const sello = Array.from({ length: 48 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  const uuid = crypto.randomUUID()
  return {
    facturamaId: `MOCK-${folioNum}`,
    uuid,
    serieFolio: `GR-${folioNum}`,
    fecha,
    sello,
  }
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
  const result = EmitSchema.safeParse(body)
  if (!result.success) {
    const msg = result.error.issues.map(i => i.message).join('; ')
    return errorResponse('FISCAL_INVALID', msg, 400)
  }
  const { folio: rawFolio, fiscal } = result.data
  const folio = rawFolio.trim()
  if (!folio) {
    return errorResponse('INVALID_FOLIO', 'El folio no puede estar vacío.', 400)
  }

  // ── 3. Mock de emit (desarrollo sin credenciales) ─────────────────────────
  if (process.env.EMIT_MOCK === 'true') {
    const factura = mockCfdi(folio)
    return NextResponse.json({ factura }, { status: 200 })
  }

  // ── 4. Re-lookup en Shopify ───────────────────────────────────────────────
  let order: NormalizedOrderWithPayment | null
  try {
    const source = getOrderSource()
    const found = await source.findOrder({ orderNumber: folio, verifier: '' })
    // findOrder devuelve NormalizedOrder; lo casteamos al tipo extendido.
    // paymentGatewayNames puede no existir si la fuente no es Shopify — es opcional.
    order = found as NormalizedOrderWithPayment | null
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[emit] Error al consultar Shopify:', { folio, error: message })
    return errorResponse('SHOPIFY_ERROR', 'Error al consultar el pedido. Intenta de nuevo más tarde.', 502)
  }

  if (!order) {
    return errorResponse('ORDER_NOT_FOUND', `No se encontró ningún pedido con el folio "${folio}".`, 404)
  }

  // alreadyInvoiced siempre false por ahora — Etapa 3 activará la verificación
  const alreadyInvoiced = false
  if (alreadyInvoiced) {
    return errorResponse('ALREADY_INVOICED', 'Este pedido ya cuenta con un CFDI emitido.', 409)
  }

  // ── 5. Validar ventana de facturación ─────────────────────────────────────
  if (!isWithinInvoiceWindow(order.createdAt)) {
    return errorResponse(
      'DEADLINE_EXCEEDED',
      'El periodo de facturación de este ticket ya venció (solo se factura dentro del mes en curso).',
      422
    )
  }

  // ── 6. Emitir CFDI via Facturama ──────────────────────────────────────────
  try {
    const invoiceService = getInvoiceService()
    const emitResult = await invoiceService.emitir({ order, fiscal })

    // La respuesta al cliente incluye los campos de GeneratedInvoice
    // más facturamaId por si el front necesita hacer descargas.
    const factura = {
      facturamaId: emitResult.facturamaId,
      uuid:        emitResult.uuid,
      serieFolio:  emitResult.serieFolio,
      fecha:       emitResult.fecha,
      sello:       emitResult.sello,
    }
    return NextResponse.json({ factura }, { status: 200 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[emit] Facturama:', message)
    return errorResponse('FACTURAMA_ERROR', 'Error al generar la factura. Intenta de nuevo más tarde.', 503)
  }
}
