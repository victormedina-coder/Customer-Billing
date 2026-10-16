import type { IssuedCfdiItemsLookup } from '../../domain/global/ports/IssuedCfdiItemsLookup'
import { obtenerCFDI } from './facturamaClient'

export class CfdiIdentificationNumberMissingError extends Error {
  constructor(facturamaId: string) {
    super(facturamaId)
    this.name = 'CfdiIdentificationNumberMissingError'
  }
}

export class FacturamaIssuedCfdiItemsLookup implements IssuedCfdiItemsLookup {
  async getItems(facturamaId: string): Promise<string[]> {
    const cfdi = await obtenerCFDI(facturamaId)
    if (!Array.isArray(cfdi.Items)) throw new Error(`CFDI ${facturamaId} sin Items en Facturama`)
    return cfdi.Items.map((item) => {
      if (typeof item.IdentificationNumber !== 'string') {
        throw new CfdiIdentificationNumberMissingError(facturamaId)
      }
      return item.IdentificationNumber
    })
  }
}
