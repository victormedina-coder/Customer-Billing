import { pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'

export const invoices = pgTable('invoices', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  orderId: text('order_id').notNull(),
  orderNumber: text('order_number').notNull(),
  storeName: text('store_name').notNull(),
  facturamaId: text('facturama_id').unique(),
  uuidCfdi: text('uuid_cfdi').unique(),
  rfcReceptor: text('rfc_receptor'),
  razonSocial: text('razon_social'),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  cancelledAt: timestamp('cancelled_at'),
}, (table) => [
  unique('unique_order_store').on(table.orderId, table.storeName),
])
