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
 *   409 FULLY_REFUNDED    → pedido reembolsado en su totalidad (neto = 0)
 *   422 DEADLINE_EXCEEDED → fuera de la ventana de facturación
 *   502 SHOPIFY_ERROR     → todas las tiendas fallaron / error de conexión
 *   503 FACTURAMA_ERROR   → Facturama lanza error al timbrar
 */

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { EmitSchema } from '@/lib/api/schemas'
import { getOrderSource } from '@/lib/order-source'
import { isWithinInvoiceWindow } from '@/lib/invoice-window'
import { isFullyRefunded } from '@/lib/refund'
import { getInvoiceService } from '@/lib/invoice-service'
import type { NormalizedOrderWithPayment } from '@/lib/shopify/mapper'
import { isAlreadyInvoiced, createInvoice, updateInvoiceStamp, deleteById } from '@/lib/db/invoice-repository'
import { maskEmail } from '@/lib/log-redact'

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
    invoiceId: crypto.randomUUID(),
    uuid,
    serieFolio: `GR-${folioNum}`,
    fecha,
    sello,
    emisor: { rfc: 'XAXX010101000', nombre: 'EMISOR DEMO (MOCK)', regimen: '601' },
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 0. Rate limiting ──────────────────────────────────────────────────────
  const ip = getClientIp(req)
  const rl = await rateLimit(`emit:${ip}`, RATE_LIMITS.emit.max, RATE_LIMITS.emit.windowSec)
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
    const { invoiceId, uuid, serieFolio, fecha, sello, emisor } = mockCfdi(folio)
    const factura = { invoiceId, uuid, serieFolio, fecha, sello, emisor }
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

  // ── Etapa 3: verificación real de doble-facturación ───────────────────────
  const alreadyInvoiced = await isAlreadyInvoiced(order.id, order.storeName)
  if (alreadyInvoiced) {
    return errorResponse('ALREADY_INVOICED', 'Este pedido ya cuenta con un CFDI emitido.', 409)
  }

  if (isFullyRefunded(order)) {
    return errorResponse(
      'FULLY_REFUNDED',
      'Este pedido fue reembolsado en su totalidad y no puede facturarse.',
      409
    )
  }

  // ── 5. Validar ventana de facturación ─────────────────────────────────────
  if (!isWithinInvoiceWindow(order.createdAt)) {
    return errorResponse(
      'DEADLINE_EXCEEDED',
      'El periodo de facturación de este ticket ya venció (solo se factura dentro del mes en curso).',
      422
    )
  }

  // ── 6. Insert-first: adquirir el cerrojo UNIQUE antes de timbrar ───────────
  // Insertamos una fila 'pending' que adquiere el cerrojo UNIQUE(order_id, store_name).
  // Si otro request ya lo tiene (carrera), createInvoice devuelve already_invoiced.
  // Esto serializa el timbrado: solo quien gana el INSERT gasta dinero en Facturama.
  // NOTA: una fila 'pending' también hará que isAlreadyInvoiced (paso anterior) devuelva
  // true — comportamiento conservador correcto. Un job de conciliación futuro deberá
  // limpiar filas 'pending' viejas (timbrados iniciados pero nunca completados).
  let invoiceId: string
  const pending = await createInvoice({
    orderId: order.id,
    orderNumber: order.orderNumber,
    storeName: order.storeName,
    rfcReceptor: fiscal.rfc,
    razonSocial: fiscal.razon,
    email: fiscal.email,
    status: 'pending',
    invoiceType: 'individual',
  })
  if (!pending.created) {
    return errorResponse('ALREADY_INVOICED', 'Este pedido ya cuenta con un CFDI emitido.', 409)
  }
  invoiceId = pending.invoice.id

  // ── 7. Timbrar en Facturama ───────────────────────────────────────────────
  let emitResult
  try {
    emitResult = await getInvoiceService().emitir({ order, fiscal })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[emit] Facturama:', message)
    // El timbrado falló: liberamos el cerrojo borrando la fila pendiente para
    // permitir que el cliente reintente.
    try {
      await deleteById(invoiceId)
    } catch (delErr: unknown) {
      const delMsg = delErr instanceof Error ? delErr.message : String(delErr)
      console.error('[emit] No se pudo limpiar la fila pendiente tras fallo de timbrado:', {
        invoiceId, error: delMsg,
      })
    }
    return errorResponse('FACTURAMA_ERROR', 'Error al generar la factura. Intenta de nuevo más tarde.', 503)
  }

  // ── 8. Persistir los datos del CFDI en la fila ya bloqueada ────────────────
  // El cerrojo ya está tomado; este UPDATE no puede fallar por carrera.
  // Si la DB falla aquí (raro), el CFDI YA está timbrado y el pedido sigue
  // bloqueado contra doble-timbre — se concilia manualmente. No tumbamos la respuesta.
  try {
    await updateInvoiceStamp(invoiceId, {
      facturamaId: emitResult.facturamaId,
      uuidCfdi: emitResult.uuid,
      status: 'emitted',
    })
  } catch (dbErr: unknown) {
    const dbMsg = dbErr instanceof Error ? dbErr.message : String(dbErr)
    console.error('[emit] CFDI timbrado pero no se pudo actualizar la fila (conciliar):', {
      invoiceId, error: dbMsg,
    })
  }

  // ── 9. Enviar el CFDI por correo (best-effort) ────────────────────────────
  try {
    await getInvoiceService().enviarCorreo(emitResult.facturamaId, fiscal.email, {
      serieFolio: emitResult.serieFolio,
    })
  } catch (mailErr: unknown) {
    const mailMsg = mailErr instanceof Error ? mailErr.message : String(mailErr)
    console.error('[emit] Correo automático falló (CFDI ya timbrado):', {
      facturamaId: emitResult.facturamaId, email: maskEmail(fiscal.email), error: mailMsg,
    })
  }

  // ── 10. Responder al cliente con el invoiceId como token ──────────────────
  const factura = {
    invoiceId,
    uuid:        emitResult.uuid,
    serieFolio:  emitResult.serieFolio,
    fecha:       emitResult.fecha,
    sello:       emitResult.sello,
    emisor:      emitResult.emisor,
  }
  return NextResponse.json({ factura }, { status: 200 })
}
