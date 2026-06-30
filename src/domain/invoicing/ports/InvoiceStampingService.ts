/**
 * InvoiceStampingService — port (interfaz de dominio) para timbrar CFDIs.
 *
 * Nombre canónico en domain. El alias InvoiceService se re-exporta desde
 * lib/invoice-service/types.ts para compatibilidad con los imports existentes.
 *
 * Implementaciones (adapters) en src/infrastructure/facturama/.
 */

import type { FiscalInput } from '../../fiscal/FiscalInput'
import type { Order } from '../../orders/Order'

/** Resultado de una emisión exitosa de CFDI */
export interface EmitResult {
  facturamaId: string
  uuid: string
  serieFolio: string
  fecha: string
  sello: string
  emisor: { rfc: string; nombre: string; regimen: string }
}

export interface InvoiceStampingService {
  emitir(payload: { order: Order; fiscal: FiscalInput }): Promise<EmitResult>
  obtener(facturamaId: string): Promise<unknown>
  descargar(facturamaId: string, format: 'pdf' | 'xml'): Promise<Buffer>
  cancelar(facturamaId: string): Promise<void>
  enviarCorreo(
    facturamaId: string,
    email: string,
    opts?: { serieFolio?: string }
  ): Promise<void>
}

/** Alias de compatibilidad — usar InvoiceStampingService en código nuevo. */
export type InvoiceService = InvoiceStampingService
