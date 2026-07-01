/**
 * Composition root — fábrica de InvoiceService (InvoiceStampingService).
 *
 * Reubicado desde lib/invoice-service/index.ts (Paso 9b del refactor DDD).
 */

import { FacturamaInvoiceService } from '../infrastructure/facturama/FacturamaInvoiceService'

export function getInvoiceService() {
  return new FacturamaInvoiceService()
}

export type { InvoiceStampingService as InvoiceService } from '../domain/invoicing/ports/InvoiceStampingService'
