/**
 * FacturamaInvoiceService — adapter de infraestructura que implementa InvoiceStampingService.
 * Contenido movido de lib/invoice-service/facturama.ts sin cambiar comportamiento.
 * El puente en lib/invoice-service/facturama.ts re-exporta esta clase.
 */

import type { InvoiceStampingService, EmitResult } from '../../domain/invoicing/ports/InvoiceStampingService'
import type { FiscalInput } from '../../domain/fiscal/FiscalInput'
import type { Order } from '../../domain/orders/Order'
import type { NormalizedOrderWithPayment } from '../../../lib/shopify/mapper'
import {
  emitirCFDI,
  obtenerCFDI,
  descargarArchivo,
  cancelarCFDI,
  enviarCFDIEmail,
} from './facturamaClient'
import { buildCfdiPayload } from '../../../lib/invoice-service/cfdi-mapper'

export class FacturamaInvoiceService implements InvoiceStampingService {
  async emitir(payload: {
    order: Order
    fiscal: FiscalInput
  }): Promise<EmitResult> {
    const { order, fiscal } = payload
    // buildCfdiPayload espera NormalizedOrderWithPayment; Order es compatible
    // porque ShopifyOrderSource siempre devuelve NormalizedOrderWithPayment.
    const cfdiPayload = buildCfdiPayload(order as NormalizedOrderWithPayment, fiscal)
    const resp = await emitirCFDI(cfdiPayload)

    const facturamaId = resp.Id
    const uuid        = resp.Complement?.TaxStamp?.Uuid ?? resp.Uuid ?? ''
    const serieFolio  =
      [resp.Series, resp.Folio].filter(Boolean).join('-') || resp.Folio || resp.Id
    const fecha = resp.Date ?? ''
    const sello =
      resp.Complement?.TaxStamp?.SatSign ?? resp.Complement?.TaxStamp?.CfdiSign ?? ''
    const emisor = {
      rfc:     resp.Issuer?.Rfc ?? '',
      nombre:  resp.Issuer?.Name ?? '',
      regimen: resp.Issuer?.FiscalRegime ?? '',
    }

    return { facturamaId, uuid, serieFolio, fecha, sello, emisor }
  }

  async obtener(facturamaId: string): Promise<unknown> {
    return obtenerCFDI(facturamaId)
  }

  async descargar(facturamaId: string, format: 'pdf' | 'xml'): Promise<Buffer> {
    const { buffer } = await descargarArchivo(facturamaId, format)
    return buffer
  }

  async cancelar(facturamaId: string): Promise<void> {
    await cancelarCFDI(facturamaId, '02')
  }

  async enviarCorreo(
    facturamaId: string,
    email: string,
    opts?: { serieFolio?: string }
  ): Promise<void> {
    const suffix = opts?.serieFolio ? ` ${opts.serieFolio}` : ''
    const subject  = `Tu factura electrónica (CFDI)${suffix}`
    const comments = 'Adjuntamos tu Comprobante Fiscal Digital (CFDI). Gracias por tu compra.'
    const issuerEmail = process.env.FACTURAMA_ISSUER_EMAIL ?? ''

    const result = await enviarCFDIEmail({
      cfdiId: facturamaId,
      email,
      subject,
      comments,
      issuerEmail,
    })

    if (!result.success) {
      throw new Error(result.msj || 'Facturama no pudo enviar el correo')
    }
  }
}
