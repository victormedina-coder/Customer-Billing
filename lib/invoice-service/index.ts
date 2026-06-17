import { FacturamaInvoiceService } from './facturama'
export function getInvoiceService() { return new FacturamaInvoiceService() }
export type { InvoiceService } from './types'
