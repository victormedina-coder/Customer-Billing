/**
 * Mapper: NormalizedOrderWithPayment (de src/domain/orders/Order.ts)
 *                   → Ticket (de app/(portal)/_lib/types.ts)
 *
 * Capa application: es la única autorizada a conocer tanto el dominio
 * (Order) como el DTO de UI (Ticket). El dominio NUNCA importa de app/.
 *
 * La ruta POST /api/invoice/lookup devuelve directamente el Ticket ya mapeado
 * ({ ticket }) para que usePortal solo haga setState — sin transformación en el cliente.
 *
 * Decisiones de mapeo:
 *   - fecha/hora: se derivan de createdAt (ISO 8601) formateando a zona MX.
 *   - sucursal:   storeName del NormalizedOrder.
 *   - formaPago:  primer elemento de paymentGatewayNames si existe, si no "N/D".
 *                 El gateway se almacena en el NormalizedOrder via el campo
 *                 que pasamos desde shopify.ts. Como NormalizedOrder no tiene
 *                 paymentGatewayNames (no está en el tipo base), se transporta
 *                 como campo extendido opcional.
 *   - status:     'ok' siempre por ahora (alreadyInvoiced=false es Etapa 3).
 *   - items:      description→desc, productCode→sku, quantity→qty, unitPrice→unit.
 *   - breakdown:  FiscalCalculator.compute(order).totales — el mismo cálculo que se
 *                 timbra en el CFDI. El cliente ('use client') NUNCA recalcula el
 *                 desglose fiscal; solo renderiza lo que el servidor ya calculó
 *                 (Paso 6 DDD — unificación del preview con FiscalCalculator).
 */

import type { NormalizedOrderWithPayment } from '../../domain/orders/Order'
import { FiscalCalculator } from '../../domain/fiscal/FiscalCalculator'
import type { Ticket, TicketItem } from '../../../app/(portal)/_lib/types'

/**
 * Formatea un string ISO 8601 a fecha y hora legibles en zona de México.
 * Usa Intl.DateTimeFormat con timeZone 'America/Mexico_City' para que la
 * hora sea correcta independientemente de la zona del servidor (ej. Railway UTC).
 * Si el parse falla, devuelve strings vacíos para no reventar la UI.
 */
function formatDateTimeMX(iso: string): { fecha: string; hora: string } {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return { fecha: '', hora: '' }
  const parts = new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Mexico_City',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const fecha = `${get('day')}/${get('month')}/${get('year')}`
  let hora = `${get('hour')}:${get('minute')}`
  // Algunos motores emiten '24' para medianoche con hour12:false
  if (hora === '24:00') hora = '00:00'
  return { fecha, hora }
}

/**
 * Convierte la lista de gateways de Shopify a una etiqueta legible.
 * Shopify devuelve strings como "bogus", "visa", "paypal", "cash", etc.
 * Por ahora se capitaliza el primero; el contador puede ajustar el mapeo.
 */
function mapFormaPago(gateways?: string[]): string {
  if (!gateways || gateways.length === 0) return 'N/D'
  const raw = gateways[0]
  // Capitalizar primera letra para presentación
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

/**
 * Convierte un NormalizedOrder a Ticket para la UI del portal.
 *
 * @param displayFolio  Folio a mostrar al cliente. Se usa el que el cliente
 *   tecleó (el número de recibo del POS, ej. "15-5333") en vez del `name`
 *   interno de Shopify (ej. "#45371"): es más intuitivo y no expone datos
 *   internos. Si no se pasa, cae al orderNumber del pedido.
 */
export function normalizedOrderToTicket(
  order: NormalizedOrderWithPayment,
  displayFolio?: string
): Ticket {
  const { fecha, hora } = formatDateTimeMX(order.createdAt)

  const items: TicketItem[] = order.lines.map((line) => ({
    desc: line.description,
    sku: line.productCode,
    qty: line.quantity,
    unit: line.unitPrice,
  }))

  const { totales } = FiscalCalculator.compute(order)

  return {
    folio: displayFolio ?? order.orderNumber,
    fecha,
    hora,
    sucursal: order.storeName,
    total: order.total,
    tax: order.taxAmount,
    discount: order.discountAmount,
    breakdown: totales,
    // status siempre 'ok' por ahora — alreadyInvoiced es Etapa 3
    status: 'ok',
    formaPago: mapFormaPago(order.paymentGatewayNames),
    items,
  }
}
