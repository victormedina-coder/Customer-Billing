/**
 * InvoicedOrdersGateway — port (interfaz de dominio) para saber qué pedidos
 * de una tienda/periodo YA tienen un CFDI emitido, sin importar el CANAL que
 * lo emitió.
 *
 * La exclusión de "ya facturado" de la facturación global mensual debe
 * cubrir DOS canales (ver plan de diseño §15, decisión 2026-07-08/09):
 *   1. La DB del Portal (`invoices.order_id`) — facturas individuales y
 *      globales emitidas por este sistema. Match exacto por `order.id`.
 *   2. Los CFDIs emitidos por la app de autofacturación de Facturama en
 *      Shopify (canal externo, no escribe en la DB del Portal). Esa app no
 *      expone el `order.id` de Shopify — solo el campo `OrderNumber` del CFDI
 *      con la referencia de texto `"#{name} {sourceIdentifier}"` (ver
 *      src/domain/orders/OrderReference.ts). Match por referencia
 *      normalizada, no por id.
 *
 * Por eso el puerto devuelve AMBOS conjuntos de llaves: un pedido se
 * considera ya facturado si su `order.id` está en `orderIds` O SU referencia
 * normalizada (`buildOrderReference(order.orderNumber, order.sourceIdentifier)`)
 * está en `orderReferences`. El caso de uso recibe una LISTA de gateways
 * (uno por canal) y excluye la UNIÓN de todos.
 *
 * Implementado ahora: el adapter DB (`DrizzleInvoicedOrdersGateway`, canal 1).
 * El adapter Facturama (canal 2, lista los CFDIs del periodo por API y lee
 * `OrderNumber`) queda para el Paso 4/6 — este puerto ya lo deja listo: solo
 * necesita devolver `orderReferences` con las referencias normalizadas de
 * ese periodo.
 *
 * `storeName` es informativo, no una garantía de filtrado: cada adapter
 * decide si lo usa. El canal DB NO lo usa para filtrar — `order.id` es único
 * globalmente en Shopify y el `store_name` guardado en `invoices` es el
 * nombre de SUCURSAL (no la marca que identifica este parámetro), así que
 * filtrar por él excluiría de menos, no de más (ver
 * DrizzleInvoicedOrdersGateway para el bug real que esto corrigió). El canal
 * Facturama tampoco lo usa (cuenta única, sin filtrado server-side por marca).
 */

import type { GlobalPeriod } from '../GlobalPeriod'

export interface InvoicedOrderKeys {
  /** `order.id` de Shopify de pedidos ya facturados (match exacto). */
  orderIds: Set<string>
  /**
   * Referencia normalizada (`buildOrderReference`) de pedidos ya facturados
   * por un canal que no expone `order.id` (ej. la app de Facturama).
   */
  orderReferences: Set<string>
}

export interface InvoicedOrdersGateway {
  listInvoicedOrderKeys(storeName: string, period: GlobalPeriod): Promise<InvoicedOrderKeys>
}
