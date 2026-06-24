import type { NormalizedOrderWithPayment } from '../shopify/mapper'

/**
 * Datos fiscales del receptor tal como los captura el cliente en el portal.
 * Duplica FiscalData de app/(portal)/_lib/types.ts para evitar un ciclo de
 * imports entre lib/ y app/. Ambas definiciones deben mantenerse en sync.
 */
export interface FiscalInput {
  rfc: string
  razon: string
  regimen: string
  cp: string
  uso: string
  email: string
}

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
