/**
 * Composition root — fábrica de OrderSource.
 *
 * Reubicado desde lib/order-source/index.ts (Paso 9b del refactor DDD).
 * Decisión de usuario #1: se elimina NetSuiteOrderSource y el branch por
 * ORDER_SOURCE — cablea ShopifyOrderSource directo. El port OrderSource se
 * conserva (útil para fakes en tests).
 */

import type { OrderSource } from '../domain/orders/ports/OrderSource'
import { ShopifyOrderSource } from '../infrastructure/shopify/ShopifyOrderSource'

export function getOrderSource(): OrderSource {
  return new ShopifyOrderSource()
}

export type { OrderSource } from '../domain/orders/ports/OrderSource'
export type { Order as NormalizedOrder, OrderLine } from '../domain/orders/Order'
