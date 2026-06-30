/**
 * InvoiceRepository — port (interfaz de dominio) para persistencia de facturas.
 *
 * Agrupa las firmas de las funciones sueltas que hoy existen en
 * lib/db/invoice-repository.ts. Los tipos de datos se re-exportan desde
 * lib/db/invoice-repository para compatibilidad.
 *
 * Implementaciones (adapters) en src/infrastructure/db/.
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface CreateInvoiceData {
  orderId: string
  orderNumber: string
  storeName: string
  facturamaId?: string | null
  uuidCfdi?: string | null
  rfcReceptor?: string | null
  razonSocial?: string | null
  email?: string | null
  status?: string
  invoiceType?: 'individual' | 'global'
  paymentType?: 'credito' | 'debito' | 'efectivo' | null
}

export interface InvoiceRecord {
  id: string
  orderId: string
  orderNumber: string
  storeName: string
  facturamaId: string | null
  uuidCfdi: string | null
  rfcReceptor: string | null
  razonSocial: string | null
  email: string | null
  status: string
  invoiceType: string
  paymentType: string | null
  createdAt: Date
  cancelledAt: Date | null
}

export interface CreateInvoiceSuccess {
  created: true
  invoice: InvoiceRecord
}

export interface CreateInvoiceConflict {
  created: false
  reason: 'already_invoiced'
}

export type CreateInvoiceResult = CreateInvoiceSuccess | CreateInvoiceConflict

// ─── Port ─────────────────────────────────────────────────────────────────────

export interface InvoiceRepository {
  isAlreadyInvoiced(orderId: string, storeName: string): Promise<boolean>
  createInvoice(data: CreateInvoiceData): Promise<CreateInvoiceResult>
  findById(id: string): Promise<InvoiceRecord | null>
  findByOrder(orderId: string, storeName: string): Promise<InvoiceRecord | null>
  updateInvoiceStamp(
    id: string,
    data: { facturamaId: string; uuidCfdi: string; status?: string }
  ): Promise<InvoiceRecord | null>
  deleteById(id: string): Promise<void>
  listInvoicedOrderIds(storeName: string, fromDate: Date, toDate: Date): Promise<string[]>
}
