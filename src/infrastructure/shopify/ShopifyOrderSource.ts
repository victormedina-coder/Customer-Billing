/**
 * ShopifyOrderSource — adapter de infraestructura que implementa el port OrderSource.
 *
 * Mueve el contenido de lib/order-source/shopify.ts sin cambiar comportamiento.
 * El puente en lib/order-source/shopify.ts re-exporta esta clase para
 * compatibilidad con imports existentes.
 */

import type { OrderSource } from '../../domain/orders/ports/OrderSource'
import type { Order, OrderLine } from '../../domain/orders/Order'
import type { NormalizedOrderWithPayment } from '../../../lib/shopify/mapper'
import type { BrandConfig } from '../../../lib/shopify/brands'
import { listConfiguredBrands } from '../../../lib/shopify/brands'
import { shopifyGraphQL } from '../../../lib/shopify/client'

// ─────────────────────────────────────────────────────────────────────────────
// Query GraphQL
// ─────────────────────────────────────────────────────────────────────────────
const ORDER_BY_FOLIO_QUERY = /* graphql */ `
  query OrderByFolio($queryStr: String!, $first: Int!) {
    orders(first: $first, query: $queryStr) {
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
        }
      }
    }
  }
`

// ─────────────────────────────────────────────────────────────────────────────
// Tipos internos de la respuesta GraphQL
// ─────────────────────────────────────────────────────────────────────────────

interface ShopifyMoney {
  amount: string
  currencyCode: string
}

interface ShopifyMoneySet {
  shopMoney: ShopifyMoney
}

interface ShopifyLineItem {
  title: string
  quantity: number
  sku: string | null
  originalUnitPriceSet: ShopifyMoneySet
  discountedUnitPriceSet: ShopifyMoneySet
  taxLines: Array<{ rate: number }>
}

interface ShopifyOrder {
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

interface OrdersResponse {
  orders: {
    edges: Array<{ node: ShopifyOrder }>
  }
}

interface BrandResult {
  brand: BrandConfig
  order: ShopifyOrder | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de normalización
// ─────────────────────────────────────────────────────────────────────────────

function parseAmount(money: ShopifyMoneySet): number {
  return parseFloat(money.shopMoney.amount) || 0
}

function normalizeLineItem(item: ShopifyLineItem): OrderLine {
  const originalPrice = parseAmount(item.originalUnitPriceSet)
  const discountedPrice = parseAmount(item.discountedUnitPriceSet)
  const discount = originalPrice - discountedPrice
  const hasTax = item.taxLines.length > 0
  return {
    description: item.title,
    quantity: item.quantity,
    unitPrice: originalPrice,
    unitPriceIncludesTax: hasTax,
    discount: discount < 0 ? 0 : discount,
    productCode: item.sku ?? '',
  }
}

function normalizeOrder(
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
  }
}

function matchesBySourceIdentifier(
  order: ShopifyOrder,
  folioUpper: string
): boolean {
  const si = order.sourceIdentifier
  if (!si) return false
  const siUpper = si.toUpperCase()
  return siUpper === folioUpper || siUpper.endsWith('-' + folioUpper)
}

// ─────────────────────────────────────────────────────────────────────────────
// ShopifyOrderSource
// ─────────────────────────────────────────────────────────────────────────────

export class ShopifyOrderSource implements OrderSource {
  async findOrder(params: {
    orderNumber: string
    verifier: string
  }): Promise<Order | null> {
    const { orderNumber } = params
    const folioClean = orderNumber.trim().toUpperCase().replace(/^#/, '')

    const brands = listConfiguredBrands()
    if (brands.length === 0) {
      throw new Error(
        '[shopify] No hay ninguna marca Shopify configurada con credenciales completas. ' +
        'Verifica las variables de entorno (ARIAT_SHOPIFY_*, STETSON_SHOPIFY_*, WB_SHOPIFY_*).'
      )
    }

    const settled = await Promise.allSettled(
      brands.map((cfg) => this.queryBrand(cfg, folioClean))
    )

    const successes: BrandResult[] = []
    const failures: string[] = []

    for (let i = 0; i < settled.length; i++) {
      const result = settled[i]
      const brand = brands[i]
      if (result.status === 'fulfilled') {
        successes.push(result.value)
      } else {
        failures.push(brand.key)
        console.error(`[shopify] Fallo al consultar la tienda '${brand.key}':`, {
          folio: folioClean,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        })
      }
    }

    if (successes.length === 0) {
      throw new Error(
        `[shopify] Todas las tiendas configuradas fallaron al buscar el folio '${folioClean}'. ` +
        `Marcas con error: ${failures.join(', ')}.`
      )
    }

    const matches = successes.filter((r) => r.order !== null)
    if (matches.length === 0) return null

    if (matches.length > 1) {
      const conflictingBrands = matches.map((r) => r.brand.key).join(', ')
      console.warn(
        `[shopify] El folio '${folioClean}' se encontró en más de una tienda: [${conflictingBrands}]. ` +
        `Se usa el resultado de la primera tienda ('${matches[0].brand.key}'). ` +
        `Investiga la colisión — el folio debe ser único en el grupo.`
      )
    }

    const winner = matches[0]
    return normalizeOrder(winner.order!, winner.brand.label)
  }

  private async queryBrand(cfg: BrandConfig, folioClean: string): Promise<BrandResult> {
    const quotedQuery = `"${folioClean}"`
    const quotedCandidates = await this.fetchCandidates(cfg, quotedQuery, 15)
    const quotedMatch = quotedCandidates.find((o) =>
      matchesBySourceIdentifier(o, folioClean)
    )
    if (quotedMatch) return { brand: cfg, order: quotedMatch }

    const unquotedCandidates = await this.fetchCandidates(cfg, folioClean, 25)
    const unquotedMatch = unquotedCandidates.find((o) =>
      matchesBySourceIdentifier(o, folioClean)
    )
    if (unquotedMatch) return { brand: cfg, order: unquotedMatch }

    return { brand: cfg, order: null }
  }

  private async fetchCandidates(
    cfg: BrandConfig,
    queryStr: string,
    first: number
  ): Promise<ShopifyOrder[]> {
    const data = await shopifyGraphQL<OrdersResponse>(
      cfg,
      ORDER_BY_FOLIO_QUERY,
      { queryStr, first }
    )
    return data.orders.edges.map((e) => e.node)
  }
}
