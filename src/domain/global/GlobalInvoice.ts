/**
 * GlobalInvoice — agregado de dominio puro.
 *
 * Representa el encabezado de un CFDI global mensual: un comprobante que
 * agrupa N pedidos de una tienda, un periodo (año/mes) y un PaymentBucket,
 * partido en chunks cuando excede el máximo de partidas por CFDI (ver
 * GlobalChunkPolicy). La identidad natural es la tupla
 * (storeName, periodYear, periodMonth, paymentBucket, chunkIndex) — es la
 * que usa GlobalInvoiceRepository.createGlobalHeader para detectar
 * duplicados antes de timbrar.
 */

import type { PaymentBucket } from './PaymentBucket'

/**
 * Estados del ciclo de vida de un GlobalInvoice:
 *   - 'pending': encabezado reservado, aún no se llamó a Facturama.
 *   - 'emitted': Facturama confirmó el timbrado (tenemos uuid).
 *   - 'stamped_unconfirmed': se llamó a Facturama pero la respuesta no llegó
 *     o no se pudo confirmar (timeout/error de red) — requiere reconciliación
 *     antes de reintentar, para no duplicar el timbrado.
 */
export type GlobalInvoiceStatus = 'pending' | 'emitted' | 'stamped_unconfirmed'

export interface GlobalInvoiceIdentity {
  storeName: string
  periodYear: number
  periodMonth: number
  paymentBucket: PaymentBucket
  /** Índice del chunk dentro del periodo/bucket cuando se partió en varios CFDI. */
  chunkIndex: number
}

export interface GlobalInvoice extends GlobalInvoiceIdentity {
  id: string
  status: GlobalInvoiceStatus
  /** Id interno de Facturama del CFDI global; null hasta que se emite. */
  facturamaId: string | null
  /** UUID fiscal del CFDI timbrado; null hasta confirmar el timbrado. */
  uuidCfdi: string | null
  /** Número de pedidos agrupados en este CFDI global. */
  itemCount: number
}
