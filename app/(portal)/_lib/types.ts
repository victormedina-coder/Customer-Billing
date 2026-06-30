import type { FiscalInput } from '@/src/domain/fiscal/FiscalInput'

export type PortalStep = 'ticket' | 'fiscal' | 'confirm' | 'success'

export type LookupError =
  | ''
  | 'notfound'    // legado — ya no usa el backend, mantenemos por seguridad
  | 'invalid'     // folio O monto incorrecto (error genérico, VALIDATION_FAILED)
  | 'invoiced'
  | 'deadline'
  | 'refunded'
  | 'ratelimited' // demasiados intentos (RATE_LIMITED)

// 'idle'         — campo vacío o sin tocar
// 'valid-format' — formato correcto según regex local; NO afirma registro en el SAT
//                  (anti-oráculo: no revelamos existencia en onBlur)
// 'invalid'      — formato incorrecto según regex local
export type RfcValidationState = 'idle' | 'valid-format' | 'invalid'

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

export type FiscalData = FiscalInput

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
  /** Lo que el usuario teclea en el campo "Importe total" (string crudo, ej. "8,900.00" o "$1899"). */
  amount: string
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
