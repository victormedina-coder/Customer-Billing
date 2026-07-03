/**
 * FacturamaInvoiceService — adapter de infraestructura que implementa InvoiceStampingService.
 */

import type { InvoiceStampingService, EmitResult } from '../../domain/invoicing/ports/InvoiceStampingService'
import type { FiscalInput } from '../../domain/fiscal/FiscalInput'
import type { Order, NormalizedOrderWithPayment } from '../../domain/orders/Order'
import {
  emitirCFDI,
  obtenerCFDI,
  descargarArchivo,
  cancelarCFDI,
  enviarCFDIEmail,
  getExpeditionPlace,
} from './facturamaClient'
import { buildCfdiPayload } from './cfdiPayloadBuilder'

/**
 * Resuelve el Lugar de Expedición del CFDI.
 *
 * FACTURAMA_EXPEDITION_PLACE es SOLO un override manual explícito (útil para
 * escenarios multi-sucursal futuros). Por defecto se resuelve en vivo contra
 * el perfil fiscal del emisor en Facturama — nunca cae al CP del receptor.
 */
async function resolveExpeditionPlace(): Promise<string> {
  const override = (process.env.FACTURAMA_EXPEDITION_PLACE ?? '').trim()
  if (override) return override
  return getExpeditionPlace()
}

export class FacturamaInvoiceService implements InvoiceStampingService {
  async emitir(payload: {
    order: Order
    fiscal: FiscalInput
  }): Promise<EmitResult> {
    const { order, fiscal } = payload
    const expeditionPlace = await resolveExpeditionPlace()
    // buildCfdiPayload espera NormalizedOrderWithPayment; Order es compatible
    // porque ShopifyOrderSource siempre devuelve NormalizedOrderWithPayment.
    const cfdiPayload = buildCfdiPayload(order as NormalizedOrderWithPayment, fiscal, expeditionPlace)
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
