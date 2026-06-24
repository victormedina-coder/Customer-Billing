/**
 * Mapper: NormalizedOrder (de lib/order-source/types.ts)
 *                   → Ticket (de app/(portal)/_lib/types.ts)
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
 */

import type { NormalizedOrder } from '../order-source/types'
import type { Ticket, TicketItem } from '../../app/(portal)/_lib/types'

/**
 * NormalizedOrder extendido con el campo de forma de pago de Shopify.
 * El campo es opcional para no romper otras fuentes (NetSuite, etc.).
 */
export interface NormalizedOrderWithPayment extends NormalizedOrder {
  paymentGatewayNames?: string[]
}

/**
 * Formatea un string ISO 8601 a fecha y hora legibles en zona de México.
 * Si el parse falla, devuelve strings vacíos para no reventar la UI.
 */
function formatDateTimeMX(iso: string): { fecha: string; hora: string } {
  try {
    const d = new Date(iso)
    const p = (n: number) => String(n).padStart(2, '0')
    const fecha = `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
    const hora = `${p(d.getHours())}:${p(d.getMinutes())}`
    return { fecha, hora }
  } catch {
    return { fecha: '', hora: '' }
  }
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

  return {
    folio: displayFolio ?? order.orderNumber,
    fecha,
    hora,
    sucursal: order.storeName,
    total: order.total,
    tax: order.taxAmount,
    discount: order.discountAmount,
    // status siempre 'ok' por ahora — alreadyInvoiced es Etapa 3
    status: 'ok',
    formaPago: mapFormaPago(order.paymentGatewayNames),
    items,
  }
}
