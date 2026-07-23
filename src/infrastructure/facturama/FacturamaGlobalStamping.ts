/**
 * FacturamaGlobalStamping — adapter de infraestructura que implementa el
 * puerto GlobalInvoiceStamping (Paso 4). Timbra el CFDI global mensual
 * reutilizando el MISMO endpoint HTTP (`emitirCFDI`, POST /3/cfdis) y el
 * MISMO mecanismo de resolución de ExpeditionPlace que FacturamaInvoiceService
 * (CFDI individual) — solo cambia el payload, construido por
 * globalCfdiPayloadBuilder en vez de cfdiPayloadBuilder.
 *
 * Manejo de errores: igual que FacturamaInvoiceService.emitir — no envuelve
 * ni reinterpreta el error de emitirCFDI (validación 4xx, red, timeout);
 * lo deja propagar tal cual para que EmitGlobalInvoiceUseCase.processChunk
 * decida el rollback.
 */

import type {
  GlobalInvoiceStamping,
  EmitGlobalInvoicePayload,
  EmitGlobalInvoiceResult,
} from '../../domain/global/ports/GlobalInvoiceStamping'
import { createDailyGlobalPeriod, createGlobalPeriod } from '../../domain/global/GlobalPeriod'
import { emitirCFDI } from './facturamaClient'
import { buildGlobalCfdiPayload } from './globalCfdiPayloadBuilder'
import { resolveExpeditionPlace } from './FacturamaInvoiceService'

export class FacturamaGlobalStamping implements GlobalInvoiceStamping {
  async emitirGlobal(payload: EmitGlobalInvoicePayload): Promise<EmitGlobalInvoiceResult> {
    const { storeName, periodYear, periodMonth, periodDay, paymentBucket, orders } = payload

    const period = periodDay !== undefined
      ? createDailyGlobalPeriod(periodYear, periodMonth, periodDay)
      : createGlobalPeriod(periodYear, periodMonth)
    const expeditionPlace = await resolveExpeditionPlace()
    const cfdiPayload = buildGlobalCfdiPayload(period, paymentBucket, orders, storeName, expeditionPlace)

    const resp = await emitirCFDI(cfdiPayload)

    const facturamaId = resp.Id
    const uuidCfdi = resp.Complement?.TaxStamp?.Uuid ?? resp.Uuid ?? ''
    //Misma composicion que FacturamaInvoiceService.emitir para el individual.
    const serieFolio = [resp.Serie, resp.Folio].filter(Boolean).join('-') || undefined

    return { facturamaId, uuidCfdi, serieFolio }
  }
}
