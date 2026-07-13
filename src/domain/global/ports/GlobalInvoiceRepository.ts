/**
 * GlobalInvoiceRepository — port (interfaz de dominio) de persistencia para
 * encabezados de CFDI global mensual. Implementación (adapter) en
 * src/infrastructure/ (Paso 3/4 — DB del portal).
 */

import type { GlobalInvoice, GlobalInvoiceIdentity, GlobalInvoiceStatus } from '../GlobalInvoice'

export type CreateGlobalHeaderData = GlobalInvoiceIdentity

export type CreateGlobalHeaderResult =
  | { created: true; header: GlobalInvoice }
  | { created: false; reason: 'already_exists' }

export interface UpdateGlobalStampData {
  status: GlobalInvoiceStatus
  facturamaId?: string | null
  uuidCfdi?: string | null
  /**
   * Nº de pedidos que sobrevivieron el insert-first de membresías (puede ser
   * menor al planeado si alguno chocó por carrera — ver EmitGlobalInvoiceUseCase
   * §6.b). Ajuste del Paso 2: el Paso 1 omitió este campo, pero GlobalInvoice
   * lo declara (`itemCount`) y el caso de uso necesita persistirlo al timbrar.
   */
  itemCount?: number
}

export interface GlobalInvoiceRepository {
  /**
   * Reserva el encabezado (identidad única) antes de llamar a Facturama —
   * evita timbrar dos veces el mismo periodo/bucket/chunk en llamadas
   * concurrentes. `already_exists` cuando ya hay un encabezado con esa
   * identidad (pending, emitted o stamped_unconfirmed).
   */
  createGlobalHeader(data: CreateGlobalHeaderData): Promise<CreateGlobalHeaderResult>

  /**
   * "Reap" de un encabezado 'pending' o 'stamped_unconfirmed' abandonado:
   * si su antigüedad supera `ttlMinutes` (respecto a `now`), lo libera para
   * poder reintentar. Devuelve true si se liberó algo.
   */
  reapStaleGlobalHeader(key: GlobalInvoiceIdentity, ttlMinutes: number, now: Date): Promise<boolean>

  /** Actualiza estado/ids de timbrado de un encabezado ya creado. */
  updateGlobalStamp(id: string, data: UpdateGlobalStampData): Promise<void>

  /** Elimina un encabezado (ej. rollback si falló el timbrado). */
  deleteGlobalHeader(id: string): Promise<void>

  /**
   * De `orderIds`, devuelve el subconjunto que ya está facturado (individual
   * o global, cualquier tienda) — para excluirlos del siguiente lote.
   * `storeName` se conserva en la firma por compatibilidad pero NO filtra:
   * `order.id` es único globalmente en Shopify y `invoices.store_name` guarda
   * la sucursal del pedido, no necesariamente el valor que aquí se pase (ver
   * DrizzleInvoicedOrdersGateway para el bug real que motivó este cambio).
   */
  filterInvoicedOrderIds(storeName: string, orderIds: string[]): Promise<Set<string>>
}
