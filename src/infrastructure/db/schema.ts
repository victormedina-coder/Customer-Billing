/**
 * Schema Drizzle — adapter de infraestructura.
 */

import { index, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'

/**
 * global_invoices — encabezado (agregado GlobalInvoice) de un CFDI global
 * mensual. Header/detalle separado de `invoices` porque `facturama_id` y
 * `uuid_cfdi` son UNIQUE ahí y N pedidos comparten el mismo UUID de la
 * global (ver plan de diseño §4 en la memoria del proyecto).
 */
export const globalInvoices = pgTable('global_invoices', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  storeName: text('store_name').notNull(),
  periodYear: integer('period_year').notNull(),
  periodMonth: integer('period_month').notNull(),
  /** 'credito' | 'debito' | 'efectivo' — texto libre validado en código. */
  paymentBucket: text('payment_bucket').notNull(),
  /** Índice del chunk cuando el periodo/bucket se partió en varios CFDI. */
  chunkIndex: integer('chunk_index').notNull().default(0),
  facturamaId: text('facturama_id').unique(),
  uuidCfdi: text('uuid_cfdi').unique(),
  /**
   * Estado del ciclo de vida — mismo significado que `invoices.status`
   * ('pending' | 'emitted' | 'stamped_unconfirmed').
   */
  status: text('status').notNull().default('pending'),
  /** Nº de pedidos (conceptos) incluidos en este CFDI global. */
  itemCount: integer('item_count').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  // Cerrojo de idempotencia: un único CFDI global por (tienda, periodo, bucket, chunk).
  unique('unique_global_period_bucket_chunk').on(
    table.storeName,
    table.periodYear,
    table.periodMonth,
    table.paymentBucket,
    table.chunkIndex,
  ),

  // Acelera la consulta del run mensual (enumerar chunks de un periodo).
  index('idx_global_invoices_store_period').on(table.storeName, table.periodYear, table.periodMonth),
])

export const invoices = pgTable('invoices', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  orderId: text('order_id').notNull(),
  orderNumber: text('order_number').notNull(),
  storeName: text('store_name').notNull(),
  facturamaId: text('facturama_id').unique(),
  uuidCfdi: text('uuid_cfdi').unique(),
  rfcReceptor: text('rfc_receptor'),
  razonSocial: text('razon_social'),
  email: text('email'),
  /**
   * Estado del ciclo de vida de la fila (no es un enum de Postgres — texto libre
   * validado en código).
   * - 'pending': cerrojo insert-first tomado, timbrado aún no confirmado. Si
   *   queda huérfana (proceso murió antes de timbrar), el reap-lazy de
   *   EmitInvoiceUseCase la libera tras PENDING_TTL_MINUTES.
   * - 'emitted': CFDI timbrado y confirmado en la fila.
   * - 'stamped_unconfirmed': el CFDI SÍ se timbró en Facturama (existe), pero
   *   el UPDATE que debía confirmarlo en la fila falló. El reap-lazy NUNCA
   *   toca este status — borrarla permitiría un segundo timbrado duplicado
   *   del mismo pedido. Requiere conciliación manual (ver docs/08-plan-pre-deploy.md §4).
   */
  status: text('status').notNull().default('pending'),
  /**
   * Tipo de CFDI emitido.
   * - 'individual': factura emitida a un receptor específico (flujo normal).
   * - 'global': CFDI global mensual que agrupa órdenes no facturadas del mes
   *   (art. 29-A CFF / regla 2.7.1.25 RMISC).
   */
  invoiceType: text('invoice_type').notNull().default('individual'),
  /**
   * Forma de pago de la orden (aplica principalmente a filas de la global).
   * Valores: 'credito' | 'debito' | 'efectivo'.
   * Nullable porque las facturas individuales pueden no requerirlo.
   */
  paymentType: text('payment_type'),
  /**
   * Membresía: fila que pertenece a un CFDI global (invoiceType='global')
   * apunta a su encabezado en `global_invoices`. Nullable: las facturas
   * individuales no tienen encabezado global.
   */
  globalInvoiceId: text('global_invoice_id').references(() => globalInvoices.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  cancelledAt: timestamp('cancelled_at'),
  /**
   * Registro auditable de consentimiento legal (LFPDPPP) al momento de emitir
   * el CFDI. `privacyVersion`/`termsVersion` son la versión vigente de cada
   * documento (estampada por el servidor, ver CONSENT_VERSIONS) y `consentAt`
   * es el instante en que el usuario aceptó ambos. Junto con rfc/email/orden
   * ya presentes en la fila, constituyen el "quién + cuándo + qué versión".
   * Nullable: filas anteriores a esta feature no tienen consentimiento registrado.
   */
  privacyVersion: text('privacy_version'),
  termsVersion: text('terms_version'),
  consentAt: timestamp('consent_at'),
}, (table) => [
  // Cerrojo anti-duplicados: una orden por tienda = un único CFDI individual.
  unique('unique_order_store').on(table.orderId, table.storeName),

  // Acelera la consulta que lista órdenes no facturadas de un mes para la global.
  index('idx_invoices_store_name_created_at').on(table.storeName, table.createdAt),

  // Acelera la agrupación/conteo por tipo e estado.
  index('idx_invoices_invoice_type_status').on(table.invoiceType, table.status),
])
