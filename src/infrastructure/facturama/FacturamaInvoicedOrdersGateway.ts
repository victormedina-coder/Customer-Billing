/**
 * FacturamaInvoicedOrdersGateway — adapter de infraestructura que implementa
 * el canal 2 (app externa de Facturama en Shopify) del puerto
 * InvoicedOrdersGateway (Paso 4).
 *
 * Lista los CFDIs emitidos vía GET /cfdi?type=issued (Basic auth del cliente
 * existente, ver facturamaClient.listarCfdisEmitidos), acotados server-side
 * al rango del periodo (`dateStart`/`dateEnd`, paginado internamente por el
 * cliente) y, de los vigentes dentro del periodo, extrae `OrderNumber` para
 * poblar `orderReferences`. Esta app no expone el `order.id` de Shopify —
 * por eso `orderIds` siempre es un Set vacío aquí (match por referencia de
 * texto, no por id; ver InvoicedOrdersGateway para la motivación completa).
 *
 * `storeName` se recibe por conformidad con el puerto pero NO se usa: la
 * cuenta de Facturama es única (no hay filtrado server-side por tienda/marca)
 * — igual asimetría que `_period` en DrizzleInvoicedOrdersGateway (canal 1),
 * solo que aquí el parámetro sin usar es el opuesto.
 */

import { listarCfdisEmitidos } from './facturamaClient'
import type { FacturamaCfdiListItem } from './facturamaClient'
import type { InvoicedOrdersGateway, InvoicedOrderKeys } from '../../domain/global/ports/InvoicedOrdersGateway'
import type { GlobalPeriod } from '../../domain/global/GlobalPeriod'
import { normalizeOrderReference } from '../../domain/orders/OrderReference'

/**
 * CFDI cancelado según las señales observadas en el sandbox (2026-07-09):
 * `IsActive: false` y/o `Status` distinto de "active". Se aceptan ambas
 * señales porque el sondeo no determinó cuál es la definitiva; sin ninguna
 * de las dos presentes se asume vigente (comportamiento conservador: no
 * excluir pedidos por error de un CFDI que en realidad sí está activo).
 */
function isCancelled(item: FacturamaCfdiListItem): boolean {
  if (item.IsActive === false) return true
  if (typeof item.Status === 'string' && item.Status.trim().toLowerCase() !== 'active') return true
  return false
}

export class FacturamaInvoicedOrdersGateway implements InvoicedOrdersGateway {
  async listInvoicedOrderKeys(
    storeName: string,
    period: GlobalPeriod
  ): Promise<InvoicedOrderKeys> {
    const items = await listarCfdisEmitidos(period.rangeMx())
    const inPeriod = this.filterByPeriod(items, period)

    const orderReferences = new Set<string>()
    for (const item of inPeriod) {
      if (isCancelled(item)) continue
      if (!item.OrderNumber) continue

      const normalized = normalizeOrderReference(item.OrderNumber)
      if (normalized) orderReferences.add(normalized)
    }

    return { orderIds: new Set(), orderReferences }
  }

  /**
   * Filtrado client-side por `Date` dentro del rango del periodo — defensa
   * en profundidad ADEMÁS del filtro server-side (`dateStart`/`dateEnd`) que
   * ya aplica `listarCfdisEmitidos`. Se conserva porque la semántica exacta
   * de esos params (inclusividad de bordes, zona horaria) no está verificada
   * contra el sandbox; este filtro recorta cualquier exceso que el servidor
   * llegue a devolver.
   */
  private filterByPeriod(items: FacturamaCfdiListItem[], period: GlobalPeriod): FacturamaCfdiListItem[] {
    const { from, to } = period.rangeMx()
    return items.filter((item) => {
      if (!item.Date) return false
      const date = new Date(item.Date)
      if (Number.isNaN(date.getTime())) return false
      return date >= from && date <= to
    })
  }
}
