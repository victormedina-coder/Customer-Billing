/**
 * shopifyOrderNormalization — helpers de infraestructura compartidos para
 * convertir la forma de un pedido de la Admin API de Shopify (GraphQL) en un
 * `NormalizedOrderWithPayment` de dominio.
 *
 * Extraído de ShopifyOrderSource (búsqueda individual por folio) para que
 * ShopifyMonthlyOrderSource (enumeración mensual, Paso 3 de Facturación
 * Global) reutilice EXACTAMENTE la misma lógica de normalización — evita
 * divergencia entre cómo se calculan totales/líneas/impuestos en ambos
 * adapters (DRY).
 */

import type { OrderLine, NormalizedOrderWithPayment } from '../../domain/orders/Order'

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de la respuesta GraphQL de Shopify que consume la normalización
// ─────────────────────────────────────────────────────────────────────────────

export interface ShopifyMoney {
  amount: string
  currencyCode: string
}

export interface ShopifyMoneySet {
  shopMoney: ShopifyMoney
}

export interface ShopifyLineItem {
  title: string
  quantity: number
  sku: string | null
  originalUnitPriceSet: ShopifyMoneySet
  discountedUnitPriceSet: ShopifyMoneySet
  taxLines: Array<{ rate: number }>
}

export interface ShopifyOrder {
  id: string
  name: string
  createdAt: string
  currencyCode: string
  email: string | null
  sourceName: string | null
  sourceIdentifier: string | null
  displayFinancialStatus: string | null
  totalRefundedSet: ShopifyMoneySet
  subtotalPriceSet: ShopifyMoneySet
  totalTaxSet: ShopifyMoneySet
  totalPriceSet: ShopifyMoneySet
  totalDiscountsSet: ShopifyMoneySet
  totalShippingPriceSet: ShopifyMoneySet
  lineItems: { edges: Array<{ node: ShopifyLineItem }> }
  paymentGatewayNames: string[]
  physicalLocation: { name: string } | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de normalización
// ─────────────────────────────────────────────────────────────────────────────

export function parseAmount(money: ShopifyMoneySet): number {
  return parseFloat(money.shopMoney.amount) || 0
}

const DEFAULT_TAX_RATE = 0.16
const RATE_TOLERANCE = 0.0001
const RECOGNIZED_RATES = [0, DEFAULT_TAX_RATE]

/**
 * Deriva la tasa de IVA efectiva de una línea sumando las taxLines.
 * Regla KISS + defensiva: sumar tasas de todas las taxLines (normalmente
 * hay una sola). Si la suma no es un valor reconocido (0 o ~0.16), se
 * loguea un warn estructurado y se cae al default 0.16 para no bloquear
 * el timbrado.
 */
export function deriveTaxRate(item: ShopifyLineItem): number {
  if (item.taxLines.length === 0) return 0

  const summedRate = item.taxLines.reduce((acc, tl) => acc + tl.rate, 0)
  const isRecognized = RECOGNIZED_RATES.some(
    (r) => Math.abs(summedRate - r) <= RATE_TOLERANCE
  )

  if (!isRecognized) {
    console.warn('[shopify] tasa IVA inesperada', {
      title: item.title,
      sku: item.sku,
      taxLines: item.taxLines,
      summedRate,
      fallback: DEFAULT_TAX_RATE,
    })
    return DEFAULT_TAX_RATE
  }

  // Normaliza a 0 exacto cuando cae dentro de tolerancia de tasa cero.
  return Math.abs(summedRate) <= RATE_TOLERANCE ? 0 : summedRate
}

export function normalizeLineItem(item: ShopifyLineItem): OrderLine {
  const originalPrice = parseAmount(item.originalUnitPriceSet)
  const discountedPrice = parseAmount(item.discountedUnitPriceSet)
  const discount = originalPrice - discountedPrice
  const hasTaxLines = item.taxLines.length > 0
  const taxRate = deriveTaxRate(item)
  // '02' gravado (incluye tasa cero real); '01' exento solo si NO había taxLines.
  const taxObject: OrderLine['taxObject'] = hasTaxLines ? '02' : '01'
  return {
    description: item.title,
    quantity: item.quantity,
    unitPrice: originalPrice,
    taxRate,
    taxObject,
    discount: discount < 0 ? 0 : discount,
    productCode: item.sku ?? '',
  }
}

export function normalizeOrder(
  order: ShopifyOrder,
  storeName: string
): NormalizedOrderWithPayment {
  const lines = order.lineItems.edges.map((e) => normalizeLineItem(e.node))
  const alreadyInvoiced = false
  return {
    id: order.id,
    orderNumber: order.name,
    createdAt: order.createdAt,
    currency: order.currencyCode,
    subtotal: parseAmount(order.subtotalPriceSet),
    taxAmount: parseAmount(order.totalTaxSet),
    total: parseAmount(order.totalPriceSet),
    discountAmount: parseAmount(order.totalDiscountsSet),
    shippingAmount: parseAmount(order.totalShippingPriceSet),
    lines,
    customerEmail: order.email ?? '',
    alreadyInvoiced,
    storeName: order.physicalLocation?.name ?? storeName,
    paymentGatewayNames: order.paymentGatewayNames,
    refundedAmount: parseAmount(order.totalRefundedSet),
    financialStatus: order.displayFinancialStatus ?? '',
    sourceIdentifier: order.sourceIdentifier ?? null,
  }
}
