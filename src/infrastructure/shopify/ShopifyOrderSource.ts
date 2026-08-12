/**
 * ShopifyOrderSource — adapter de infraestructura que implementa el port OrderSource.
 */

import type { OrderSource } from '../../domain/orders/ports/OrderSource'
import type { Order } from '../../domain/orders/Order'
import type { BrandConfig } from './brands'
import { listConfiguredBrands } from './brands'
import { shopifyGraphQL } from './client'
import type { ShopifyOrder } from './shopifyOrderNormalization'
import { normalizeOrder } from './shopifyOrderNormalization'

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
// (ShopifyOrder/ShopifyMoneySet y la normalización viven en
// ./shopifyOrderNormalization — compartidos con ShopifyMonthlyOrderSource)

interface OrdersResponse {
  orders: {
    edges: Array<{ node: ShopifyOrder }>
  }
}

interface BrandResult {
  brand: BrandConfig
  order: ShopifyOrder | null
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
    // Se propaga la brand KEY (no el label) porque resuelve la Serie fiscal del
    // CFDI (brandSerie.ts); `winner.brand.label` sigue como storeName de display.
    return normalizeOrder(winner.order!, winner.brand.label, winner.brand.key)
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
