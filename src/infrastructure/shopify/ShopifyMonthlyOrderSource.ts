/**
 * ShopifyMonthlyOrderSource — adapter de infraestructura que implementa el
 * port MonthlyOrderSource (Paso 3 de Facturación Global Mensual).
 *
 * Enumera TODOS los pedidos de una marca creados dentro de un rango de
 * fechas, una página por llamada (el bucle de paginación completo — seguir
 * pidiendo páginas hasta agotar el cursor — es responsabilidad del use case,
 * Paso 5). Reutiliza la infraestructura ya probada de ShopifyOrderSource:
 * el helper HTTP/auth `shopifyGraphQL` (client.ts), la resolución de
 * credenciales por marca (brands.ts) y la normalización de pedidos
 * (shopifyOrderNormalization.ts) — nada de eso se duplica aquí.
 *
 * Decisión — identificación de pedidos POS: el adapter individual
 * (ShopifyOrderSource) NO filtra por canal/fuente en la query GraphQL; solo
 * usa `sourceIdentifier` (presente únicamente en pedidos de punto de venta)
 * para hacer match del folio DESPUÉS de traer los candidatos. Para mantener
 * el mismo comportamiento, esta enumeración tampoco filtra por canal en la
 * query — trae todos los pedidos del rango de fechas, con su
 * `sourceIdentifier` disponible para quien consuma el resultado (el use case
 * decide qué hacer con pedidos sin POS, si aplica).
 *
 * Decisión — line items: se incluyen en la query (igual que en la búsqueda
 * individual) porque `normalizeOrder` los usa para construir `Order.lines`;
 * un `Order` sin líneas no es un CFDI válido, así que no se puede omitir
 * este campo aunque encarezca la query.
 *
 * Decisión — pagos: de `transactions` se conservan SOLO las de kind
 * SALE/CAPTURE con status SUCCESS (venta/captura exitosa) — son las que
 * representan dinero efectivamente cobrado. Los refunds (kind REFUND) NO se
 * netean en este adapter: la elegibilidad de un pedido reembolsado para
 * facturación global la decide `RefundPolicy` + la decisión D2 del plan, en
 * una capa superior. Este adapter solo entrega los pagos de venta tal cual
 * los reporta Shopify.
 */

import type {
  MonthlyOrderSource,
  ListOrdersInRangeParams,
  ListOrdersInRangeResult,
  MonthlyOrder,
} from '../../domain/global/ports/MonthlyOrderSource'
import type { NormalizedPayment } from '../../domain/global/PaymentBucketPolicy'
import type { BrandKey } from './brands'
import { getBrandConfig } from './brands'
import { shopifyGraphQL } from './client'
import type { ShopifyMoneySet, ShopifyOrder } from './shopifyOrderNormalization'
import { normalizeOrder, parseAmount } from './shopifyOrderNormalization'

// ─────────────────────────────────────────────────────────────────────────────
// Query GraphQL — enumeración paginada por rango de fechas
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 250

const ORDERS_IN_RANGE_QUERY = /* graphql */ `
  query OrdersInRange($queryStr: String!, $first: Int!, $after: String) {
    orders(first: $first, after: $after, query: $queryStr) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          name
          createdAt
          currencyCode
          email
          sourceName
          sourceIdentifier
          displayFinancialStatus
          totalRefundedSet {
            shopMoney { amount currencyCode }
          }
          subtotalPriceSet {
            shopMoney { amount currencyCode }
          }
          totalTaxSet {
            shopMoney { amount currencyCode }
          }
          totalPriceSet {
            shopMoney { amount currencyCode }
          }
          totalDiscountsSet {
            shopMoney { amount currencyCode }
          }
          totalShippingPriceSet {
            shopMoney { amount currencyCode }
          }
          lineItems(first: 50) {
            edges {
              node {
                title
                quantity
                sku
                originalUnitPriceSet {
                  shopMoney { amount currencyCode }
                }
                discountedUnitPriceSet {
                  shopMoney { amount currencyCode }
                }
                taxLines {
                  rate
                }
              }
            }
          }
          paymentGatewayNames
          physicalLocation {
            name
          }
          transactions {
            gateway
            kind
            status
            amountSet {
              shopMoney { amount currencyCode }
            }
          }
        }
      }
    }
  }
`

// ─────────────────────────────────────────────────────────────────────────────
// Tipos internos de la respuesta GraphQL
// ─────────────────────────────────────────────────────────────────────────────

interface ShopifyTransaction {
  gateway: string
  kind: string
  status: string
  amountSet: ShopifyMoneySet
}

interface ShopifyOrderWithTransactions extends ShopifyOrder {
  transactions: ShopifyTransaction[]
}

interface OrdersInRangeResponse {
  orders: {
    pageInfo: {
      hasNextPage: boolean
      endCursor: string | null
    }
    edges: Array<{ node: ShopifyOrderWithTransactions }>
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Filtrado de transacciones — solo venta/captura exitosa
// ─────────────────────────────────────────────────────────────────────────────

const SALE_TRANSACTION_KINDS = new Set(['sale', 'capture'])
const SUCCESS_STATUS = 'success'

function isEligibleSaleTransaction(tx: ShopifyTransaction): boolean {
  return (
    SALE_TRANSACTION_KINDS.has(tx.kind.toLowerCase()) &&
    tx.status.toLowerCase() === SUCCESS_STATUS
  )
}

function normalizePayments(transactions: ShopifyTransaction[]): NormalizedPayment[] {
  return transactions
    .filter(isEligibleSaleTransaction)
    .map((tx) => ({
      gateway: tx.gateway,
      amount: parseAmount(tx.amountSet),
    }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Filtro de rango de fechas — query string de Shopify (created_at)
// ─────────────────────────────────────────────────────────────────────────────

function buildDateRangeQuery(from: Date, to: Date): string {
  return `created_at:>='${from.toISOString()}' AND created_at:<='${to.toISOString()}'`
}

// ─────────────────────────────────────────────────────────────────────────────
// ShopifyMonthlyOrderSource
// ─────────────────────────────────────────────────────────────────────────────

export class ShopifyMonthlyOrderSource implements MonthlyOrderSource {
  async listOrdersInRange(
    params: ListOrdersInRangeParams
  ): Promise<ListOrdersInRangeResult> {
    const { brandKey, from, to, cursor } = params
    const cfg = getBrandConfig(brandKey as BrandKey)
    const queryStr = buildDateRangeQuery(from, to)

    const data = await shopifyGraphQL<OrdersInRangeResponse>(
      cfg,
      ORDERS_IN_RANGE_QUERY,
      { queryStr, first: PAGE_SIZE, after: cursor }
    )

    const orders: MonthlyOrder[] = data.orders.edges.map(({ node }) => ({
      order: normalizeOrder(node, cfg.label),
      payments: normalizePayments(node.transactions),
    }))

    const { hasNextPage, endCursor } = data.orders.pageInfo
    return {
      orders,
      nextCursor: hasNextPage ? endCursor : null,
    }
  }
}
