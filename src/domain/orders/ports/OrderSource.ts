/**
 * OrderSource — port (interfaz de dominio) para obtener pedidos normalizados.
 *
 * Implementaciones (adapters) en src/infrastructure/shopify/ShopifyOrderSource.ts
 */

import type { Order } from '../Order'

export interface OrderSource {
  findOrder(params: { orderNumber: string; verifier: string }): Promise<Order | null>
}
