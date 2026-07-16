/**
 * GlobalInvoiceStamping — port (interfaz de dominio) para timbrar el CFDI
 * global mensual. Implementación (adapter): FacturamaGlobalStamping en
 * src/infrastructure/facturama/ (Paso 4).
 *
 * El payload ya lleva los pedidos sobrevivientes del chunk (`orders`) — el
 * adapter los necesita para construir las líneas del CFDI (un Item por
 * pedido, ver globalCfdiPayloadBuilder). Antes del Paso 4 el payload era
 * mínimo (solo metadatos de identidad); se detalla aquí siguiendo el mismo
 * patrón que InvoiceStampingService.emitir para CFDIs individuales.
 */

import type { PaymentBucket } from '../PaymentBucket'
import type { MonthlyOrder } from './MonthlyOrderSource'

export interface EmitGlobalInvoicePayload {
  storeName: string
  periodYear: number
  periodMonth: number
  /** Día del periodo cuando es DIARIO; `undefined` en un periodo mensual. */
  periodDay?: number
  paymentBucket: PaymentBucket
  itemCount: number
  /** Pedidos sobrevivientes del chunk — insumo para construir los Items del CFDI. */
  orders: MonthlyOrder[]
}

/** Resultado de una emisión exitosa de CFDI global. */
export interface EmitGlobalInvoiceResult {
  facturamaId: string
  uuidCfdi: string
}

export interface GlobalInvoiceStamping {
  emitirGlobal(payload: EmitGlobalInvoicePayload): Promise<EmitGlobalInvoiceResult>
}
