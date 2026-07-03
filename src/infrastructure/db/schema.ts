/**
 * Schema Drizzle — adapter de infraestructura.
 */

import { index, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'

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
  createdAt: timestamp('created_at').notNull().defaultNow(),
  cancelledAt: timestamp('cancelled_at'),
}, (table) => [
  // Cerrojo anti-duplicados: una orden por tienda = un único CFDI individual.
  unique('unique_order_store').on(table.orderId, table.storeName),

  // Acelera la consulta que lista órdenes no facturadas de un mes para la global.
  index('idx_invoices_store_name_created_at').on(table.storeName, table.createdAt),

  // Acelera la agrupación/conteo por tipo e estado.
  index('idx_invoices_invoice_type_status').on(table.invoiceType, table.status),
])
