/**
 * DrizzleGlobalInvoiceRepository — adapter de infraestructura que implementa
 * GlobalInvoiceRepository (encabezados de CFDI global mensual).
 *
 * Sigue el mismo patrón maduro de `invoice-repository.ts`: insert-first
 * atrapando la violación UNIQUE (23505 — postgres-js la pone en `err.cause`),
 * índices crecientes por periodo/bucket, y rollback vía delete.
 */

import { and, eq, gte, inArray, lte, max, ne, or } from 'drizzle-orm'
import { getDb } from './client'
import { globalInvoices, invoices } from './schema'
import type {
  CreateGlobalHeaderData,
  CreateGlobalHeaderResult,
  GlobalInvoiceRepository,
  ReconciliationHeader,
  UpdateGlobalStampData,
  UnresolvedGlobalHeader,
} from '../../domain/global/ports/GlobalInvoiceRepository'
import type { GlobalInvoice } from '../../domain/global/GlobalInvoice'
import type { PaymentBucket } from '../../domain/global/PaymentBucket'
import { globalCorrelationKey } from '../../domain/global/globalCorrelationKey'

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
  async listForReconciliation(now: Date): Promise<ReconciliationHeader[]> {
    const since = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000)
    const rows = await getDb().select().from(globalInvoices).where(and(
      or(inArray(globalInvoices.status, ['pending', 'stamped_unconfirmed']), and(eq(globalInvoices.status, 'released'), gte(globalInvoices.createdAt, since))),
    ))
    return rows.map(row => ({
      id: row.id,
      storeName: row.storeName,
      periodYear: row.periodYear,
      periodMonth: row.periodMonth,
      periodDay: row.periodDay === 0 ? undefined : row.periodDay,
      paymentBucket: row.paymentBucket as PaymentBucket,
      chunkIndex: row.chunkIndex,
      status: row.status as ReconciliationHeader['status'],
      createdAt: row.createdAt,
      correlationKey: globalCorrelationKey(row.id),
      facturamaId: row.facturamaId,
      uuidCfdi: row.uuidCfdi,
    }))
  }

  async listAllGlobalFacturamaIds(): Promise<string[]> {
    const rows = await getDb().select({ facturamaId: globalInvoices.facturamaId }).from(globalInvoices)
    return rows.flatMap(row => row.facturamaId ? [row.facturamaId] : [])
  }

  async listEmittedHeaderIds(): Promise<string[]> {
    const rows = await getDb().select({ id: globalInvoices.id }).from(globalInvoices).where(eq(globalInvoices.status, 'emitted'))
    return rows.map(row => row.id)
  }

  async listEmittedFacturamaIdsBetween(from: Date, to: Date): Promise<string[]> {
    const rows = await getDb().select({ facturamaId: globalInvoices.facturamaId })
      .from(globalInvoices).where(and(
        eq(globalInvoices.status, 'emitted'),
        gte(globalInvoices.createdAt, from),
        lte(globalInvoices.createdAt, to),
      ))
    return rows.flatMap(row => row.facturamaId ? [row.facturamaId] : [])
  }

  async releaseHeader(id: string): Promise<'applied' | 'already_applied'> {
    return getDb().transaction(async tx => {
      const rows = await tx.select({ status: globalInvoices.status }).from(globalInvoices)
        .where(eq(globalInvoices.id, id)).for('update')
      if (rows.length === 1 && rows[0].status === 'released') return 'already_applied'
      if (rows.length !== 1 || !['pending', 'stamped_unconfirmed'].includes(rows[0].status)) {
        throw new Error(`Header global ${id} no está disponible para liberar`)
      }
      await tx.delete(invoices).where(eq(invoices.globalInvoiceId, id))
      await tx.update(globalInvoices).set({ status: 'released' }).where(eq(globalInvoices.id, id))
      return 'applied'
    })
  }

  async confirmHeader(id: string, stamp: { facturamaId: string; uuidCfdi: string }): Promise<'applied' | 'already_applied'> {
    const rows = await getDb().update(globalInvoices)
      .set({ status: 'emitted', facturamaId: stamp.facturamaId, uuidCfdi: stamp.uuidCfdi })
      .where(and(eq(globalInvoices.id, id), eq(globalInvoices.status, 'stamped_unconfirmed')))
      .returning({ id: globalInvoices.id })
    if (rows.length !== 1) {
      const existing = await getDb().select({ status: globalInvoices.status, facturamaId: globalInvoices.facturamaId }).from(globalInvoices).where(eq(globalInvoices.id, id))
      if (existing.length === 1 && existing[0].status === 'emitted' && existing[0].facturamaId === stamp.facturamaId) return 'already_applied'
      throw new Error(`Header global ${id} no está disponible para confirmar`)
    }
    return 'applied'
  }
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
      .where(and(eq(globalInvoices.id, id), ne(globalInvoices.status, 'released')))
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
