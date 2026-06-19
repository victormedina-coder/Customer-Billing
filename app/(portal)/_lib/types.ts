export type PortalStep = 'ticket' | 'fiscal' | 'confirm' | 'success'

export type LookupError = '' | 'notfound' | 'invoiced' | 'deadline'

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
  uuid: string
  serieFolio: string
  fecha: string
  sello: string
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
}

export interface SelectOption {
  code: string
  label: string
}
