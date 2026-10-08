/**
 * DrizzleGlobalInvoiceRepository — adapter de infraestructura que implementa
 * GlobalInvoiceRepository (encabezados de CFDI global mensual).
 *
 * Sigue el mismo patrón maduro de `invoice-repository.ts`: insert-first
 * atrapando la violación UNIQUE (23505 — postgres-js la pone en `err.cause`),
 * índices crecientes por periodo/bucket, y rollback vía delete.
 */

import { and, eq, inArray, max } from 'drizzle-orm'
import { getDb } from './client'
import { globalInvoices, invoices } from './schema'
import type {
  CreateGlobalHeaderData,
  CreateGlobalHeaderResult,
  GlobalInvoiceRepository,
  UpdateGlobalStampData,
  UnresolvedGlobalHeader,
} from '../../domain/global/ports/GlobalInvoiceRepository'
import type { GlobalInvoice } from '../../domain/global/GlobalInvoice'
import type { PaymentBucket } from '../../domain/global/PaymentBucket'

export type GlobalInvoiceRow = typeof globalInvoices.$inferSelect

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

const PG_UNIQUE_VIOLATION = '23505'

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as Record<string, unknown>
  if (e['code'] === PG_UNIQUE_VIOLATION) return true
  const cause = e['cause']
  if (cause && typeof cause === 'object') {
    return (cause as Record<string, unknown>)['code'] === PG_UNIQUE_VIOLATION
  }
  return false
}

/**
 * Mapea una fila cruda de `global_invoices` al agregado de dominio
 * `GlobalInvoice` — función pura, sin I/O (testeable sin DB). El sentinela
 * `period_day = 0` (mensual) se traduce a `undefined` en el dominio — ver
 * comentario de la columna en schema.ts y GlobalInvoiceIdentity.periodDay.
 */
export function mapRowToGlobalInvoice(row: GlobalInvoiceRow): GlobalInvoice {
  return {
    id: row.id,
    storeName: row.storeName,
    periodYear: row.periodYear,
    periodMonth: row.periodMonth,
    periodDay: row.periodDay === 0 ? undefined : row.periodDay,
    paymentBucket: row.paymentBucket as PaymentBucket,
    chunkIndex: row.chunkIndex,
    status: row.status as GlobalInvoice['status'],
    facturamaId: row.facturamaId,
    uuidCfdi: row.uuidCfdi,
    itemCount: row.itemCount,
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class DrizzleGlobalInvoiceRepository implements GlobalInvoiceRepository {
  async nextChunkIndex(storeName: string, periodYear: number, periodMonth: number, periodDay: number | undefined, paymentBucket: PaymentBucket): Promise<number> {
    const rows = await getDb().select({ highest: max(globalInvoices.chunkIndex) }).from(globalInvoices).where(and(
      eq(globalInvoices.storeName, storeName),
      eq(globalInvoices.periodYear, periodYear),
      eq(globalInvoices.periodMonth, periodMonth),
      eq(globalInvoices.periodDay, periodDay ?? 0),
      eq(globalInvoices.paymentBucket, paymentBucket),
    ))
    return (rows[0]?.highest ?? -1) + 1
  }

  async listUnresolvedHeaders(storeName: string, periodYear: number, periodMonth: number, periodDay: number | undefined): Promise<UnresolvedGlobalHeader[]> {
    const rows = await getDb().select().from(globalInvoices).where(and(
      eq(globalInvoices.storeName, storeName),
      eq(globalInvoices.periodYear, periodYear),
      eq(globalInvoices.periodMonth, periodMonth),
      eq(globalInvoices.periodDay, periodDay ?? 0),
      inArray(globalInvoices.status, ['pending', 'stamped_unconfirmed']),
    ))
    return rows.map(row => ({ storeName: row.storeName, bucket: row.paymentBucket as PaymentBucket, chunkIndex: row.chunkIndex, status: row.status as UnresolvedGlobalHeader['status'], createdAt: row.createdAt, itemCount: row.itemCount }))
  }

  async createGlobalHeader(data: CreateGlobalHeaderData): Promise<CreateGlobalHeaderResult> {
    const db = getDb()
    try {
      const rows = await db
        .insert(globalInvoices)
        .values({
          storeName: data.storeName,
          periodYear: data.periodYear,
          periodMonth: data.periodMonth,
          periodDay: data.periodDay ?? 0,
          paymentBucket: data.paymentBucket,
          chunkIndex: data.chunkIndex,
        })
        .returning()
      return { created: true, header: mapRowToGlobalInvoice(rows[0]) }
    } catch (err) {
      if (isUniqueViolation(err)) {
        return { created: false, reason: 'already_exists' }
      }
      throw err
    }
  }

  async updateGlobalStamp(id: string, data: UpdateGlobalStampData): Promise<void> {
    const db = getDb()
    const rows = await db
      .update(globalInvoices)
      .set({
        status: data.status,
        ...(data.facturamaId !== undefined ? { facturamaId: data.facturamaId } : {}),
        ...(data.uuidCfdi !== undefined ? { uuidCfdi: data.uuidCfdi } : {}),
        ...(data.itemCount !== undefined ? { itemCount: data.itemCount } : {}),
      })
      .where(eq(globalInvoices.id, id))
      .returning({ id: globalInvoices.id })
    if (rows.length === 0) throw new Error(`No se encontró el header global ${id} al actualizar timbrado`)
  }

  async deleteGlobalHeader(id: string): Promise<void> {
    const db = getDb()
    await db.delete(globalInvoices).where(eq(globalInvoices.id, id))
  }

  async filterInvoicedOrderIds(_storeName: string, orderIds: string[]): Promise<Set<string>> {
    if (orderIds.length === 0) return new Set()
    const db = getDb()
    // NO se filtra por storeName (bug real corregido 2026-07-10, mismo caso
    // que DrizzleInvoicedOrdersGateway): `invoices.store_name` guarda la
    // sucursal del pedido, no la marca; y `order.id` es único globalmente en
    // Shopify, así que basta con matchear por orderId. `_storeName` se
    // conserva en la firma por conformidad con GlobalInvoiceRepository.
    const rows = await db
      .select({ orderId: invoices.orderId })
      .from(invoices)
      .where(inArray(invoices.orderId, orderIds))
    return new Set(rows.map((r) => r.orderId))
  }
}
