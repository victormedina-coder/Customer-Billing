export type PortalStep = 'ticket' | 'fiscal' | 'confirm' | 'success'

export type LookupError = '' | 'notfound' | 'invoiced' | 'deadline' | 'refunded'

export type RfcValidationState = 'idle' | 'checking' | 'registered' | 'format' | 'invalid'

export interface TicketItem {
  desc: string
  sku: string
  qty: number
  unit: number
}

export interface Ticket {
  folio: string
  fecha: string
  hora: string
  sucursal: string
  total: number
  status: 'ok' | 'invoiced'
  formaPago: string
  items: TicketItem[]
  // Montos autoritativos de Shopify para el desglose fiscal B1
  tax?: number      // IVA real (order.taxAmount)
  discount?: number // Descuento a nivel pedido con IVA incluido (order.discountAmount)
  // Solo si status === 'invoiced'
  facturaFolio?: string
  fechaTimbrado?: string
}

export interface FiscalData {
  rfc: string
  razon: string
  regimen: string
  cp: string
  uso: string
  email: string
}

export interface GeneratedInvoice {
  invoiceId: string | null
  uuid: string
  serieFolio: string
  fecha: string
  sello: string
  emisor: { rfc: string; nombre: string; regimen: string }
}

export interface PortalState {
  step: PortalStep
  folio: string
  busy: boolean
  lookupError: LookupError
  ticket: Ticket | null
  fiscal: FiscalData
  touched: boolean
  rfcRazon: string
  showFolioHelp: boolean
  factura: GeneratedInvoice | null
  /** Si el usuario aceptó el Aviso de Privacidad en StepFiscal. */
  privacyAccepted: boolean
}

export interface SelectOption {
  code: string
  label: string
}
