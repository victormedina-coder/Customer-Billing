import type { IssuedCfdiLookup, IssuedCfdiRef } from '../../domain/global/ports/IssuedCfdiLookup'
import { listarCfdisEmitidos } from './facturamaClient'
import { isCancelledIssuedCfdi } from './isCancelledIssuedCfdi'
import { normalizeGlobalCorrelationKey } from '../../domain/global/globalCorrelationKey'

/** La fecha de Facturama carece de zona; solo OrderNumber une un CFDI al header. */
export class FacturamaIssuedCfdiLookup implements IssuedCfdiLookup {
  async listIssuedBetween(from: Date, to: Date): Promise<IssuedCfdiRef[]> {
    const items = await listarCfdisEmitidos({ from, to })
    return items.map(item => ({
      facturamaId: item.Id,
      correlationKey: normalizeGlobalCorrelationKey(item.OrderNumber)?.startsWith('GLB:') ? item.OrderNumber : undefined,
      uuid: typeof item.Uuid === 'string' ? item.Uuid : undefined,
      active: !isCancelledIssuedCfdi(item),
      serieFolio: [item.Serie, item.Folio].filter(Boolean).join('-') || undefined,
      orderNumber: item.OrderNumber,
      rfc: item.Rfc,
      total: item.Total,
      date: item.Date,
    }))
  }
}
