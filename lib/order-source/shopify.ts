/**
 * ShopifyOrderSource — implementación real de OrderSource contra Shopify Admin API.
 *
 * Flujo (fan-out paralelo):
 *   1. Obtiene la lista de marcas configuradas (con credenciales completas).
 *   2. Consulta TODAS en paralelo con Promise.allSettled — costo O(marcas configuradas)
 *      en paralelo, tolerante a fallos parciales: un fallo en una tienda no cancela
 *      las demás.
 *   3. Recolecta resultados:
 *      - 1 match   → devuelve el pedido normalizado.
 *      - 0 matches y al menos una tienda respondió OK → null (→ 404 ORDER_NOT_FOUND).
 *      - >1 matches (el folio debería ser único en el grupo) → warn + devuelve el primero.
 *      - Todas las tiendas configuradas fallaron → lanza error (→ 502 SHOPIFY_ERROR).
 *      - Sin marcas configuradas → lanza error (→ 502 SHOPIFY_ERROR).
 *
 * CÓMO FUNCIONA LA BÚSQUEDA POR FOLIO POS
 * ────────────────────────────────────────
 * El folio que el cliente teclea (ej. "15-5333") NO es el `name` del pedido en
 * Shopify (ej. "#45371"). Es la cola del campo `sourceIdentifier` del pedido POS,
 * cuyo formato es "{idDispositivo}-{folio}" (ej. "61103865937-15-5333").
 *
 * Estrategia:
 *   a) Normalizar el folio: trim + quitar '#' inicial + mayúsculas.
 *   b) Buscar con free-text entrecomillado: query: "\"<folio>\"" (first: 15).
 *      Shopify indexa el sourceIdentifier en texto completo; las comillas fuerzan
 *      coincidencia exacta de frase y reducen falsos positivos.
 *   c) Filtrar candidatos: el pedido cuyo sourceIdentifier (en mayúsculas)
 *      sea igual al folio O termine en '-' + folio.
 *   d) Si no hay match con comillas, reintentar sin comillas (first: 25) y
 *      aplicar el mismo filtro — fallback para casos de indexación parcial.
 *   e) Si tampoco hay match → null para esa marca.
 *
 * TODO: validación por email (verifier) diferida — se ignora por ahora.
 * TODO Etapa 3: verificar alreadyInvoiced contra tabla `invoices` de Neon.
 */

import type { OrderSource, OrderLine } from './types'
import type { NormalizedOrderWithPayment } from '../shopify/mapper'
import type { BrandConfig } from '../shopify/brands'
import { listConfiguredBrands } from '../shopify/brands'
import { shopifyGraphQL } from '../shopify/client'

// ─────────────────────────────────────────────────────────────────────────────
// Query GraphQL
//
// El folio del ticket POS es la cola del campo `sourceIdentifier` del pedido
// (formato: "{idDispositivo}-{folio}", ej. "61103865937-15-5333").
// Se busca por free-text y se filtra por sourceIdentifier — NO por `name`.
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

/** Resultado de consultar una sola tienda: la marca + el pedido encontrado (o null). */
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

  // Determina si el precio incluye impuestos según taxLines
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

  // TODO Etapa 3: verificar alreadyInvoiced consultando la tabla `invoices`
  // de Neon con el id del pedido. Por ahora siempre es false.
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
    // physicalLocation.name (ej. "Ariat Ecuestre Nogales") es la sucursal real del POS.
    // Si es null, se cae al label de la marca configurada.
    storeName: order.physicalLocation?.name ?? storeName,
    paymentGatewayNames: order.paymentGatewayNames,
    refundedAmount: parseAmount(order.totalRefundedSet),
    financialStatus: order.displayFinancialStatus ?? '',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: filtrar candidatos por sourceIdentifier
//
// El folio del cliente (ej. "15-5333") debe coincidir con:
//   - sourceIdentifier completo en mayúsculas  (raro, pero posible), O
//   - la cola del sourceIdentifier tras el último '-' (formato "{device}-{folio}")
//
// Ambas comparaciones son case-insensitive (todo en mayúsculas).
// ─────────────────────────────────────────────────────────────────────────────
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
  /**
   * Busca un pedido en Shopify por folio POS usando fan-out paralelo sobre todas
   * las marcas configuradas.
   *
   * El folio del ticket POS (ej. "15-5333") es la cola del campo `sourceIdentifier`
   * del pedido (formato "{idDispositivo}-{folio}", ej. "61103865937-15-5333").
   * La búsqueda usa free-text sobre ese campo; NO se usa el `name` del pedido.
   *
   * @param params.orderNumber  El folio del ticket POS (ej. "15-5333", "#15-5333").
   * @param params.verifier     Email del cliente — ignorado por ahora.
   *                            TODO: validación por email diferida (Etapa 2b).
   * @returns NormalizedOrder si se encuentra, null si no existe en ninguna tienda.
   * @throws Error con prefijo [shopify] si todas las tiendas fallaron o si no hay
   *         ninguna marca configurada (→ ruta lo convierte en 502 SHOPIFY_ERROR).
   */
  async findOrder(params: {
    orderNumber: string
    verifier: string
  }): Promise<NormalizedOrderWithPayment | null> {
    const { orderNumber } = params
    // TODO: validación por email diferida — params.verifier ignorado por ahora.

    // Normalizar el folio: trim + quitar '#' inicial + mayúsculas.
    const folioClean = orderNumber.trim().toUpperCase().replace(/^#/, '')

    // ── 1. Obtener marcas con credenciales completas ───────────────────────
    const brands = listConfiguredBrands()

    if (brands.length === 0) {
      throw new Error(
        '[shopify] No hay ninguna marca Shopify configurada con credenciales completas. ' +
        'Verifica las variables de entorno (ARIAT_SHOPIFY_*, STETSON_SHOPIFY_*, WB_SHOPIFY_*).'
      )
    }

    // ── 2. Fan-out paralelo — O(marcas configuradas) en paralelo ─────────
    // Promise.allSettled garantiza que un fallo en una tienda no cancela las demás.
    const settled = await Promise.allSettled(
      brands.map((cfg) => this.queryBrand(cfg, folioClean))
    )

    // ── 3. Clasificar resultados ──────────────────────────────────────────
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

    // Si TODAS las tiendas fallaron, lanzar para que la ruta devuelva 502.
    if (successes.length === 0) {
      throw new Error(
        `[shopify] Todas las tiendas configuradas fallaron al buscar el folio '${folioClean}'. ` +
        `Marcas con error: ${failures.join(', ')}.`
      )
    }

    // Recolectar los matches (pedidos encontrados)
    const matches = successes.filter((r) => r.order !== null)

    // ── 4. Caso: 0 matches (al menos una tienda respondió OK) → not found ─
    if (matches.length === 0) {
      return null
    }

    // ── 5. Caso: >1 matches — el folio debería ser único en el grupo ──────
    if (matches.length > 1) {
      const conflictingBrands = matches.map((r) => r.brand.key).join(', ')
      console.warn(
        `[shopify] El folio '${folioClean}' se encontró en más de una tienda: [${conflictingBrands}]. ` +
        `Se usa el resultado de la primera tienda ('${matches[0].brand.key}'). ` +
        `Investiga la colisión — el folio debe ser único en el grupo.`
      )
    }

    // ── 6. Caso: 1 match (o >1, toma el primero tras el warn) ────────────
    const winner = matches[0]
    return normalizeOrder(winner.order!, winner.brand.label)
  }

  /**
   * Consulta una marca específica buscando por folio POS (sourceIdentifier).
   *
   * Estrategia de dos pasos:
   *   1. Free-text entrecomillado: query: "\"<folio>\"" — coincidencia exacta de
   *      frase, menos candidatos. Si hay match por sourceIdentifier → return.
   *   2. Fallback sin comillas: query: "<folio>" — búsqueda más amplia, hasta 25
   *      candidatos. Aplica el mismo filtro por sourceIdentifier.
   *
   * El filtro por sourceIdentifier evita falsos positivos: otro pedido cuyo
   * `name` o campos de texto contengan el folio pero no sea el pedido POS correcto.
   */
  private async queryBrand(cfg: BrandConfig, folioClean: string): Promise<BrandResult> {
    // Paso 1: free-text entrecomillado (coincidencia exacta de frase)
    const quotedQuery = `"${folioClean}"`
    const quotedCandidates = await this.fetchCandidates(cfg, quotedQuery, 15)
    const quotedMatch = quotedCandidates.find((o) =>
      matchesBySourceIdentifier(o, folioClean)
    )
    if (quotedMatch) {
      return { brand: cfg, order: quotedMatch }
    }

    // Paso 2: fallback sin comillas (búsqueda más amplia)
    const unquotedCandidates = await this.fetchCandidates(cfg, folioClean, 25)
    const unquotedMatch = unquotedCandidates.find((o) =>
      matchesBySourceIdentifier(o, folioClean)
    )
    if (unquotedMatch) {
      return { brand: cfg, order: unquotedMatch }
    }

    return { brand: cfg, order: null }
  }

  /**
   * Ejecuta la consulta GraphQL y devuelve la lista de pedidos candidatos.
   * No aplica ningún filtro — el filtro por sourceIdentifier lo hace el llamador.
   */
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
