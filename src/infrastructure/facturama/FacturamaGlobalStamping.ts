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
 * conserve los intentos inciertos y solo libere rechazos definitivos.
 */

import type {
  GlobalInvoiceStamping,
  EmitGlobalInvoicePayload,
  EmitGlobalInvoiceResult,
} from '../../domain/global/ports/GlobalInvoiceStamping'
import { createDailyGlobalPeriod, createGlobalPeriod } from '../../domain/global/GlobalPeriod'
import { emitirCFDI, isFacturamaConfigured } from './facturamaClient'
import { buildGlobalCfdiPayload } from './globalCfdiPayloadBuilder'
import { resolveExpeditionPlace } from './FacturamaInvoiceService'
import { StampPreparationError } from '../../application/shared/StampPreparationError'

export class FacturamaGlobalStamping implements GlobalInvoiceStamping {
  constructor(private readonly timeoutMs = 120000) {}

  async emitirGlobal(payload: EmitGlobalInvoicePayload): Promise<EmitGlobalInvoiceResult> {
    const { storeName, periodYear, periodMonth, periodDay, paymentBucket, orders } = payload

    let cfdiPayload
    try {
      if (!isFacturamaConfigured()) {
        throw new Error('Facturama no está configurado: faltan FACTURAMA_USER o FACTURAMA_PASS')
      }
      const period = periodDay !== undefined
        ? createDailyGlobalPeriod(periodYear, periodMonth, periodDay)
        : createGlobalPeriod(periodYear, periodMonth)
      const expeditionPlace = await resolveExpeditionPlace()
      cfdiPayload = buildGlobalCfdiPayload(period, paymentBucket, orders, storeName, expeditionPlace)
    } catch (cause: unknown) {
      throw new StampPreparationError(cause)
    }

    const resp = await emitirCFDI(cfdiPayload, { timeoutMs: this.timeoutMs })

    const facturamaId = resp.Id
    const uuidCfdi = resp.Complement?.TaxStamp?.Uuid ?? resp.Uuid ?? ''
    //Misma composicion que FacturamaInvoiceService.emitir para el individual.
    const serieFolio = [resp.Serie, resp.Folio].filter(Boolean).join('-') || undefined

    return { facturamaId, uuidCfdi, serieFolio }
  }
}
