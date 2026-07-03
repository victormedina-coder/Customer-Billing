/**
 * DrizzleInvoiceRepository — adapter de infraestructura que implementa InvoiceRepository.
 *
 * IMPORTANTE — regla SAT "una compra = un CFDI":
 * El cerrojo de anti-doble-facturación está en la unique constraint
 * `unique_order_store` de la BD, NO en un SELECT-then-INSERT a nivel
 * aplicación.
 */

import { and, between, eq } from 'drizzle-orm'
import { getDb } from './client'
import { invoices } from './schema'

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface CreateInvoiceData {
  orderId: string
  orderNumber: string
  storeName: string
  facturamaId?: string | null
  uuidCfdi?: string | null
  rfcReceptor?: string | null
  razonSocial?: string | null
  email?: string | null
  status?: string
  invoiceType?: 'individual' | 'global'
  paymentType?: 'credito' | 'debito' | 'efectivo' | null
}

export type InvoiceRow = typeof invoices.$inferSelect

export interface CreateInvoiceSuccess {
  created: true
  invoice: InvoiceRow
}

export interface CreateInvoiceConflict {
  created: false
  reason: 'already_invoiced'
}

export type CreateInvoiceResult = CreateInvoiceSuccess | CreateInvoiceConflict

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

// ---------------------------------------------------------------------------
// Funciones de repositorio (API funcional — compatible con los imports existentes)
// ---------------------------------------------------------------------------

export async function isAlreadyInvoiced(
  orderId: string,
  storeName: string,
): Promise<boolean> {
  const db = getDb()
  const rows = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.orderId, orderId),
        eq(invoices.storeName, storeName),
      ),
    )
    .limit(1)
  return rows.length > 0
}

export async function findByOrder(
  orderId: string,
  storeName: string,
): Promise<InvoiceRow | null> {
  const db = getDb()
  const rows = await db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.orderId, orderId),
        eq(invoices.storeName, storeName),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

export async function createInvoice(
  data: CreateInvoiceData,
): Promise<CreateInvoiceResult> {
  const db = getDb()
  try {
    const rows = await db
      .insert(invoices)
      .values({
        orderId: data.orderId,
        orderNumber: data.orderNumber,
        storeName: data.storeName,
        facturamaId: data.facturamaId ?? null,
        uuidCfdi: data.uuidCfdi ?? null,
        rfcReceptor: data.rfcReceptor ?? null,
        razonSocial: data.razonSocial ?? null,
        email: data.email ?? null,
        status: data.status ?? 'pending',
        invoiceType: data.invoiceType ?? 'individual',
        paymentType: data.paymentType ?? null,
      })
      .returning()
    return { created: true, invoice: rows[0] }
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { created: false, reason: 'already_invoiced' }
    }
    throw err
  }
}

export async function findById(id: string): Promise<InvoiceRow | null> {
  const db = getDb()
  const rows = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1)
  return rows[0] ?? null
}

/**
 * Reap-lazy de filas 'pending' huérfanas — ver docs/08-plan-pre-deploy.md §4.
 *
 * `EmitInvoiceUseCase` inserta una fila 'pending' (cerrojo insert-first) antes
 * de timbrar. Si el proceso muere entre el INSERT y el timbrado/rollback, la
 * fila queda huérfana y bloquea reintentos del mismo pedido para siempre
 * (UNIQUE(order_id, store_name)).
 *
 * Esta función borra la fila SOLO si sigue en 'pending' y es más vieja que
 * `ttlMinutes` — nunca toca 'emitted' ni 'stamped_unconfirmed' (ese último
 * status indica que el CFDI YA existe en Facturama aunque la fila no se haya
 * podido confirmar; reapearla permitiría un segundo timbrado duplicado).
 *
 * Devuelve `true` si liberó el cerrojo (la fila se borró), `false` si no
 * había nada que reapear (no existe, no es 'pending', o no es lo bastante
 * vieja) — en ese caso el llamador debe tratar el pedido como ya facturado.
 */
export async function reapIfStalePending(
  orderId: string,
  storeName: string,
  ttlMinutes: number,
  now: Date = new Date(),
): Promise<boolean> {
  const row = await findByOrder(orderId, storeName)
  if (!row) return false
  if (row.status !== 'pending') return false

  const ageMs = now.getTime() - row.createdAt.getTime()
  const ttlMs = ttlMinutes * 60_000
  if (ageMs <= ttlMs) return false

  const db = getDb()
  await db
    .delete(invoices)
    .where(and(eq(invoices.id, row.id), eq(invoices.status, 'pending')))
  return true
}

export async function updateInvoiceStamp(
  id: string,
  data: { facturamaId: string; uuidCfdi: string; status?: string },
): Promise<InvoiceRow | null> {
  const db = getDb()
  const rows = await db
    .update(invoices)
    .set({
      facturamaId: data.facturamaId,
      uuidCfdi: data.uuidCfdi,
      status: data.status ?? 'emitted',
    })
    .where(eq(invoices.id, id))
    .returning()
  return rows[0] ?? null
}

export async function deleteById(id: string): Promise<void> {
  const db = getDb()
  await db.delete(invoices).where(eq(invoices.id, id))
}

export async function listInvoicedOrderIds(
  storeName: string,
  fromDate: Date,
  toDate: Date,
): Promise<string[]> {
  const db = getDb()
  const rows = await db
    .select({ orderId: invoices.orderId })
    .from(invoices)
    .where(
      and(
        eq(invoices.storeName, storeName),
        eq(invoices.invoiceType, 'individual'),
        between(invoices.createdAt, fromDate, toDate),
      ),
    )
  return rows.map((r) => r.orderId)
}
