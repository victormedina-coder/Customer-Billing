/**
 * DrizzleGlobalInvoiceRepository — adapter de infraestructura que implementa
 * GlobalInvoiceRepository (encabezados de CFDI global mensual).
 *
 * Sigue el mismo patrón maduro de `invoice-repository.ts`: insert-first
 * atrapando la violación UNIQUE (23505 — postgres-js la pone en `err.cause`),
 * reap-lazy de encabezados 'pending' huérfanos, y rollback vía delete.
 */

import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from './client'
import { globalInvoices, invoices } from './schema'
import type {
  CreateGlobalHeaderData,
  CreateGlobalHeaderResult,
  GlobalInvoiceRepository,
  UpdateGlobalStampData,
} from '../../domain/global/ports/GlobalInvoiceRepository'
import type { GlobalInvoice, GlobalInvoiceIdentity } from '../../domain/global/GlobalInvoice'
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

function identityWhere(key: GlobalInvoiceIdentity) {
  return and(
    eq(globalInvoices.storeName, key.storeName),
    eq(globalInvoices.periodYear, key.periodYear),
    eq(globalInvoices.periodMonth, key.periodMonth),
    eq(globalInvoices.paymentBucket, key.paymentBucket),
    eq(globalInvoices.chunkIndex, key.chunkIndex),
  )
}

/**
 * Mapea una fila cruda de `global_invoices` al agregado de dominio
 * `GlobalInvoice` — función pura, sin I/O (testeable sin DB).
 */
export function mapRowToGlobalInvoice(row: GlobalInvoiceRow): GlobalInvoice {
  return {
    id: row.id,
    storeName: row.storeName,
    periodYear: row.periodYear,
    periodMonth: row.periodMonth,
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
  async createGlobalHeader(data: CreateGlobalHeaderData): Promise<CreateGlobalHeaderResult> {
    const db = getDb()
    try {
      const rows = await db
        .insert(globalInvoices)
        .values({
          storeName: data.storeName,
          periodYear: data.periodYear,
          periodMonth: data.periodMonth,
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

  async reapStaleGlobalHeader(
    key: GlobalInvoiceIdentity,
    ttlMinutes: number,
    now: Date,
  ): Promise<boolean> {
    const db = getDb()
    const rows = await db.select().from(globalInvoices).where(identityWhere(key)).limit(1)
    const row = rows[0]
    if (!row) return false
    // Invariante anti-doble-timbre: jamás reapear 'emitted' ni
    // 'stamped_unconfirmed' — este último indica que el CFDI YA existe en
    // Facturama aunque la fila no se haya podido confirmar.
    if (row.status !== 'pending') return false

    const ageMs = now.getTime() - row.createdAt.getTime()
    const ttlMs = ttlMinutes * 60_000
    if (ageMs <= ttlMs) return false

    await db
      .delete(globalInvoices)
      .where(and(eq(globalInvoices.id, row.id), eq(globalInvoices.status, 'pending')))
    return true
  }

  async updateGlobalStamp(id: string, data: UpdateGlobalStampData): Promise<void> {
    const db = getDb()
    await db
      .update(globalInvoices)
      .set({
        status: data.status,
        ...(data.facturamaId !== undefined ? { facturamaId: data.facturamaId } : {}),
        ...(data.uuidCfdi !== undefined ? { uuidCfdi: data.uuidCfdi } : {}),
        ...(data.itemCount !== undefined ? { itemCount: data.itemCount } : {}),
      })
      .where(eq(globalInvoices.id, id))
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
