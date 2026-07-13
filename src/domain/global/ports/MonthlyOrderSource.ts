/**
 * MonthlyOrderSource — port (interfaz de dominio) para listar los pedidos de
 * una tienda dentro de un rango de fechas (el periodo mensual), paginado por
 * cursor. Implementación (adapter) en src/infrastructure/shopify/ (Paso 3).
 */

import type { Order } from '../../orders/Order'
import type { NormalizedPayment } from '../PaymentBucketPolicy'

/**
 * Pedido + sus transacciones de pago exitosas ya normalizadas. Se define
 * como tipo compuesto en el contrato del puerto (en vez de engordar `Order`)
 * porque solo la facturación global necesita las transacciones de pago; el
 * resto del dominio sigue usando `Order` tal cual.
 */
export interface MonthlyOrder {
  order: Order
  payments: NormalizedPayment[]
}

export interface ListOrdersInRangeParams {
  brandKey: string
  from: Date
  to: Date
  /** null en la primera página. */
  cursor: string | null
}

export interface ListOrdersInRangeResult {
  orders: MonthlyOrder[]
  /** null cuando ya no hay más páginas. */
  nextCursor: string | null
}

export interface MonthlyOrderSource {
  listOrdersInRange(params: ListOrdersInRangeParams): Promise<ListOrdersInRangeResult>
}
