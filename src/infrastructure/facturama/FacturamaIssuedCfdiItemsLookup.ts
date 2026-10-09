import type { IssuedCfdiItemsLookup } from '../../domain/global/ports/IssuedCfdiItemsLookup'
import { obtenerCFDI } from './facturamaClient'

export class FacturamaIssuedCfdiItemsLookup implements IssuedCfdiItemsLookup {
  async getItems(facturamaId: string): Promise<string[]> {
    const cfdi = await obtenerCFDI(facturamaId)
    if (!Array.isArray(cfdi.Items)) throw new Error(`CFDI ${facturamaId} sin Items en Facturama`)
    return cfdi.Items.map((item, index) => {
      if (typeof item.IdentificationNumber !== 'string') {
        throw new Error(`CFDI ${facturamaId}, concepto ${index}: IdentificationNumber ausente`)
      }
      return item.IdentificationNumber
    })
  }
}
