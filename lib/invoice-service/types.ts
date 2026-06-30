import type { NormalizedOrderWithPayment } from '../shopify/mapper'
import type { FiscalInput } from '@/src/domain/fiscal/FiscalInput'

export type { FiscalInput }

/** Resultado de una emisión exitosa de CFDI */
export interface EmitResult {
  facturamaId: string
  uuid: string
  serieFolio: string
  fecha: string
  sello: string
  emisor: { rfc: string; nombre: string; regimen: string }
}

export interface InvoiceService {
  emitir(payload: { order: NormalizedOrderWithPayment; fiscal: FiscalInput }): Promise<EmitResult>
  obtener(facturamaId: string): Promise<unknown>
  descargar(facturamaId: string, format: 'pdf' | 'xml'): Promise<Buffer>
  cancelar(facturamaId: string): Promise<void>
  enviarCorreo(
    facturamaId: string,
    email: string,
    opts?: { serieFolio?: string }
  ): Promise<void>
}
