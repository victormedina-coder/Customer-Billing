/**
 * ShopifyOrderSource — adapter de infraestructura que implementa el port OrderSource.
 */

import type { OrderSource } from '../../domain/orders/ports/OrderSource'
import type { Order, OrderLine, NormalizedOrderWithPayment } from '../../domain/orders/Order'
import type { BrandConfig } from './brands'
import { listConfiguredBrands } from './brands'
import { shopifyGraphQL } from './client'

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
function deriveTaxRate(item: ShopifyLineItem): number {
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

function normalizeLineItem(item: ShopifyLineItem): OrderLine {
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
