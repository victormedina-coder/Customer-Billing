/**
 * invoice-repository.ts
 *
 * Módulo de acceso a datos para la tabla `invoices`.
 * Usa getDb() de client.ts (lazy) — importar este módulo en el top-level
 * NO abre conexión ni lanza error si DATABASE_URL no existe todavía.
 *
 * IMPORTANTE — regla SAT "una compra = un CFDI":
 * El cerrojo de anti-doble-facturación está en la unique constraint
 * `unique_order_store` de la BD, NO en un SELECT-then-INSERT a nivel
 * aplicación.  Un SELECT-then-INSERT sufre condición de carrera bajo
 * concurrencia: dos requests simultáneos pueden pasar el SELECT y luego
 * ambos hacer el INSERT, emitiendo dos CFDIs para la misma orden.
 * Al delegar el cerrojo a la constraint de Postgres, el motor serializa
 * el INSERT y rechaza el duplicado con un error PG23505, que este
 * repositorio convierte en un resultado distinguible (`already_invoiced`).
 */

import { and, between, eq } from 'drizzle-orm'
import { getDb } from './client'
import { invoices } from './schema'

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

/** Columnas requeridas para crear una factura nueva. */
export interface CreateInvoiceData {
  orderId: string
  orderNumber: string
  storeName: string
  facturamaId?: string | null
  uuidCfdi?: string | null
  rfcReceptor?: string | null
  razonSocial?: string | null
  status?: string
  invoiceType?: 'individual' | 'global'
  paymentType?: 'credito' | 'debito' | 'efectivo' | null
}

/** Fila de invoice tal como la devuelve Drizzle. */
export type InvoiceRow = typeof invoices.$inferSelect

/** Resultado exitoso de createInvoice. */
export interface CreateInvoiceSuccess {
  created: true
  invoice: InvoiceRow
}

/** Resultado cuando la unique constraint detecta un duplicado. */
export interface CreateInvoiceConflict {
  created: false
  reason: 'already_invoiced'
}

export type CreateInvoiceResult = CreateInvoiceSuccess | CreateInvoiceConflict

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/** Código de error Postgres para violación de unique constraint. */
const PG_UNIQUE_VIOLATION = '23505'

/**
 * Detecta si un error lanzado por Drizzle/pg es una violación de
 * la unique constraint `unique_order_store`.
 */
function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as Record<string, unknown>
  // postgres-js expone el código directamente en el error
  if (e['code'] === PG_UNIQUE_VIOLATION) return true
  // Drizzle con postgres-js envuelve el PostgresError en err.cause
  const cause = e['cause']
  if (cause && typeof cause === 'object') {
    return (cause as Record<string, unknown>)['code'] === PG_UNIQUE_VIOLATION
  }
  return false
}

// ---------------------------------------------------------------------------
// Repositorio
// ---------------------------------------------------------------------------

/**
 * Devuelve `true` si ya existe un CFDI (individual o global) para el par
 * (orderId, storeName).  Úsalo como pre-check de UX antes de llamar a
 * Facturama; el cerrojo real sigue siendo la unique constraint del INSERT.
 */
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

/**
 * Devuelve la fila completa para (orderId, storeName) o `null` si no existe.
 */
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

/**
 * Inserta una nueva factura en la tabla.
 *
 * El cerrojo transaccional contra doble-facturación es la unique constraint
 * `unique_order_store` (ver nota al inicio del archivo).  Si Postgres rechaza
 * el INSERT por violación de esa constraint, este método devuelve
 * `{ created: false, reason: 'already_invoiced' }` en lugar de lanzar.
 * Cualquier otro error de BD sí se propaga para que el caller lo maneje.
 *
 * @example
 * const result = await createInvoice({ orderId, storeName, ... })
 * if (!result.created) {
 *   // orden ya facturada — mostrar mensaje al usuario
 * }
 */
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
    // Error inesperado de BD — propágalo sin swallow silencioso.
    throw err
  }
}

/**
 * Devuelve los `orderId` que YA tienen CFDI individual en la tienda y
 * rango de fechas indicados.  Úsalo en el job de factura global para
 * excluir órdenes que no deben incluirse (ya tienen su CFDI individual).
 *
 * @param storeName  - nombre de la tienda Shopify
 * @param fromDate   - inicio del rango (inclusive)
 * @param toDate     - fin del rango (inclusive)
 */
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
