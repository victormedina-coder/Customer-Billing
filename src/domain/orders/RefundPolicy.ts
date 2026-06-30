/**
 * Helpers de estado de reembolso de un pedido.
 *
 * Lógica del neto: neto = order.total − order.refundedAmount
 * Si Shopify marca el pedido como REFUNDED, O si hubo reembolso y el neto
 * es ~0 (absorbe redondeos de centavos con epsilon = 0.005), el pedido se
 * considera reembolsado en su totalidad y NO se puede facturar.
 *
 * Los pedidos parcialmente reembolsados (neto > 0) siguen siendo facturables.
 */

/**
 * Un pedido está reembolsado en su totalidad cuando Shopify lo marca como
 * REFUNDED, o cuando hubo reembolso (monto > 0) y el neto pagado (total − reembolsado)
 * es ~0. Los parcialmente reembolsados (neto > 0) NO se consideran totales.
 * El epsilon absorbe redondeos de centavos.
 */
export function isFullyRefunded(order: {
  total: number
  refundedAmount: number
  financialStatus: string
}): boolean {
  if (order.financialStatus === 'REFUNDED') return true
  return order.refundedAmount > 0 && (order.total - order.refundedAmount) <= 0.005
}
