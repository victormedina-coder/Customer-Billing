/**
 * Composition root — cablea las dependencias del EmitGlobalInvoiceUseCase
 * (Paso 6 del plan de Facturación Global Mensual).
 *
 * Mismo patrón que `makeEmitInvoiceUseCase.ts`: se invoca DENTRO del handler
 * POST en cada request (nunca a nivel de módulo), y las funciones de
 * `invoice-repository.ts` se importan directamente para que los vi.mock de
 * los tests las intercepten. Los adapters de clase (Shopify/Facturama/Drizzle)
 * no cargan configuración en su constructor — la resuelven perezosamente en
 * cada llamada (ver brands.ts) — por lo que instanciarlos aquí es seguro y no
 * necesita una fábrica intermedia como `getOrderSource()`.
 *
 * Exclusión de ya facturado = UNIÓN de los dos canales (ver plan §4):
 *   1. DrizzleInvoicedOrdersGateway  — DB del Portal (individual + global).
 *   2. FacturamaInvoicedOrdersGateway — CFDIs emitidos vía la app de Facturama.
 */

import { EmitGlobalInvoiceUseCase } from '../application/global/EmitGlobalInvoiceUseCase'
import type { EmitGlobalInvoiceDeps } from '../application/global/EmitGlobalInvoiceUseCase'

import { ShopifyMonthlyOrderSource } from '../infrastructure/shopify/ShopifyMonthlyOrderSource'
import { FacturamaGlobalStamping } from '../infrastructure/facturama/FacturamaGlobalStamping'
import { DrizzleGlobalInvoiceRepository } from '../infrastructure/db/DrizzleGlobalInvoiceRepository'
import { DrizzleInvoicedOrdersGateway } from '../infrastructure/db/DrizzleInvoicedOrdersGateway'
import { FacturamaInvoicedOrdersGateway } from '../infrastructure/facturama/FacturamaInvoicedOrdersGateway'
import { listConfiguredBrands } from '../infrastructure/shopify/brands'

// Funciones del repo de membresías — importadas desde infrastructure/db/
// directamente para que los vi.mock('.../infrastructure/db/invoice-repository')
// de los tests las intercepten, igual que en makeEmitInvoiceUseCase.
import { createInvoice, deleteByGlobalInvoiceId } from '../infrastructure/db/invoice-repository'
import { isFullyRefunded } from '../domain/orders/RefundPolicy'

const DEFAULT_MAX_ITEMS_PER_CFDI = 250
const DEFAULT_PENDING_TTL_MINUTES = 10

/**
 * Tope de conceptos por CFDI global (ver plan §7). Debe ser un entero >= 1;
 * cualquier valor inválido en env cae al default en vez de romper la corrida.
 */
function getMaxItemsPerChunk(): number {
  const raw = process.env.GLOBAL_MAX_ITEMS_PER_CFDI
  if (!raw) return DEFAULT_MAX_ITEMS_PER_CFDI
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : DEFAULT_MAX_ITEMS_PER_CFDI
}

/**
 * Misma variable de entorno que usa el flujo individual (`PENDING_TTL_MINUTES`)
 * — un solo TTL de reap-lazy para todo el portal, ver makeEmitInvoiceUseCase.ts.
 */
function getPendingTtlMinutes(): number {
  const raw = process.env.PENDING_TTL_MINUTES
  if (!raw) return DEFAULT_PENDING_TTL_MINUTES
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PENDING_TTL_MINUTES
}

/**
 * Construye un EmitGlobalInvoiceUseCase con todas sus dependencias cableadas.
 * Debe invocarse dentro del handler POST (en cada request).
 */
export function makeEmitGlobalInvoiceUseCase(): EmitGlobalInvoiceUseCase {
  const deps: EmitGlobalInvoiceDeps = {
    monthlyOrderSource: new ShopifyMonthlyOrderSource(),
    globalStamping: new FacturamaGlobalStamping(),
    globalRepo: new DrizzleGlobalInvoiceRepository(),
    invoiceRepo: {
      createInvoice: (data) => createInvoice(data),
      deleteByGlobalInvoiceId: (id) => deleteByGlobalInvoiceId(id),
    },
    invoicedOrdersGateways: [new DrizzleInvoicedOrdersGateway(), new FacturamaInvoicedOrdersGateway()],
    refundPolicy: {
      isFullyRefunded: (order) => isFullyRefunded(order),
    },
    // La application no lee config — recibe las marcas configuradas inyectadas.
    storeNames: listConfiguredBrands().map((brand) => brand.key),
    maxItemsPerChunk: getMaxItemsPerChunk(),
    pendingTtlMinutes: getPendingTtlMinutes(),
  }

  return new EmitGlobalInvoiceUseCase(deps)
}
