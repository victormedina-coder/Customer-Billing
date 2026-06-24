import type { InvoiceService, FiscalInput, EmitResult } from './types'
import type { NormalizedOrderWithPayment } from '../shopify/mapper'
import {
  emitirCFDI,
  obtenerCFDI,
  descargarArchivo,
  cancelarCFDI,
  enviarCFDIEmail,
} from './facturama-client'
import { buildCfdiPayload } from './cfdi-mapper'

export class FacturamaInvoiceService implements InvoiceService {
  /**
   * Emite un CFDI 4.0 individual contra Facturama.
   * Construye el payload, llama al API y extrae los campos del timbrado.
   */
  async emitir(payload: {
    order: NormalizedOrderWithPayment
    fiscal: FiscalInput
  }): Promise<EmitResult> {
    const { order, fiscal } = payload
    const cfdiPayload = buildCfdiPayload(order, fiscal)
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

  /** Obtiene el detalle de un CFDI emitido por su ID de Facturama */
  async obtener(facturamaId: string): Promise<unknown> {
    return obtenerCFDI(facturamaId)
  }

  /** Descarga un CFDI en formato PDF o XML; devuelve el contenido como Buffer */
  async descargar(facturamaId: string, format: 'pdf' | 'xml'): Promise<Buffer> {
    const { buffer } = await descargarArchivo(facturamaId, format)
    return buffer
  }

  /**
   * Cancela un CFDI.
   * Usa motivo '02' = "Comprobante emitido con errores sin relación".
   * Para cancelaciones con sustitución (motivo '01'), se necesitaría
   * el UUID del CFDI que reemplaza — no cubierto en esta implementación base.
   */
  async cancelar(facturamaId: string): Promise<void> {
    await cancelarCFDI(facturamaId, '02')
  }

  /**
   * Envía el CFDI por correo al receptor usando el endpoint de Facturama.
   *
   * `issuerEmail` se toma de FACTURAMA_ISSUER_EMAIL (configurable en .env).
   * Si el resultado de Facturama indica `success: false`, lanza un Error
   * con el mensaje devuelto para que la ruta pueda registrarlo.
   */
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
