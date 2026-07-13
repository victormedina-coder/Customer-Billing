/**
 * DrizzleInvoicedOrdersGateway — adapter de infraestructura que implementa el
 * canal 1 (DB del Portal) del puerto InvoicedOrdersGateway.
 *
 * Envuelve una consulta equivalente a `filterInvoicedOrderIds` pero sin
 * necesitar la lista de candidatos: devuelve TODOS los `order_id` ya
 * facturados (individual o global), para que el caso de uso pueda unirlos
 * con los de otros canales antes de filtrar los pedidos enumerados del mes.
 * No se acota por periodo — un pedido facturado una vez queda excluido para
 * siempre, sin importar en qué mes se re-corra la consulta (más simple y más
 * seguro que acotar por rango de fechas, ver
 * DrizzleGlobalInvoiceRepository.filterInvoicedOrderIds para la motivación).
 *
 * IMPORTANTE — `storeName` NO se usa para filtrar (bug real detectado en
 * dry-run contra la DB, 2026-07-10): el flujo INDIVIDUAL guarda en
 * `invoices.store_name` el nombre de SUCURSAL física (`order.storeName`
 * normalizado, ej. "Western Brothers Outlet Lerma"), pero el caso de uso
 * global consulta este gateway con la clave de MARCA (`brandKey`, ej.
 * "western-brothers") — nunca coincidían, y la exclusión por DB no excluía
 * NADA. La corrección: `order.id` (gid) de Shopify es único globalmente, así
 * que filtrar por tienda es innecesario y aquí además era activamente dañino.
 * Se recibe `storeName` solo por conformidad con el puerto (informativo,
 * ver InvoicedOrdersGateway) — no se usa en la consulta.
 *
 * El canal DB conoce el `order.id` real de Shopify (columna `orderId`), por
 * lo que `orderReferences` siempre es un Set vacío aquí — el match por
 * referencia de texto es exclusivo del canal Facturama (Paso 4/6).
 */

import { getDb } from './client'
import { invoices } from './schema'
import type {
  InvoicedOrdersGateway,
  InvoicedOrderKeys,
} from '../../domain/global/ports/InvoicedOrdersGateway'
import type { GlobalPeriod } from '../../domain/global/GlobalPeriod'

export class DrizzleInvoicedOrdersGateway implements InvoicedOrdersGateway {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async listInvoicedOrderKeys(_storeName: string, _period: GlobalPeriod): Promise<InvoicedOrderKeys> {
    const db = getDb()
    const rows = await db.select({ orderId: invoices.orderId }).from(invoices)

    return {
      orderIds: new Set(rows.map((r) => r.orderId)),
      orderReferences: new Set(),
    }
  }
}
