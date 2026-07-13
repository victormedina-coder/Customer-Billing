import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import postgresJs from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from '../src/infrastructure/db/schema'
import { DrizzleInvoicedOrdersGateway } from '../src/infrastructure/db/DrizzleInvoicedOrdersGateway'
import { createInvoice } from '../src/infrastructure/db/invoice-repository'
import { createGlobalPeriod } from '../src/domain/global/GlobalPeriod'

// ── Skip cuando no hay DB de test ────────────────────────────────────────────
// DATABASE_URL ya fue redirigido a DATABASE_URL_TEST por vitest.config.ts,
// así getDb() usa la DB de test sin necesitar vi.mock (mismo patrón de
// __tests__/invoice-repository.test.ts).
const skip = !process.env.DATABASE_URL_TEST

let cleanupClient: ReturnType<typeof postgresJs> | undefined
let cleanupDb: ReturnType<typeof drizzle<typeof schema>> | undefined

if (!skip) {
  cleanupClient = postgresJs(process.env.DATABASE_URL_TEST!, { max: 1 })
  cleanupDb = drizzle(cleanupClient, { schema })
}

beforeEach(async () => {
  if (skip) return
  await cleanupDb!.execute(sql`TRUNCATE TABLE invoices, global_invoices RESTART IDENTITY CASCADE`)
})

afterAll(async () => {
  await cleanupClient?.end()
})

const gateway = new DrizzleInvoicedOrdersGateway()
const PERIOD = createGlobalPeriod(2026, 6)

describe.skipIf(skip)('DrizzleInvoicedOrdersGateway (integration, Railway test DB)', () => {
  it('devuelve Set vacíos cuando no hay facturas para la tienda', async () => {
    const result = await gateway.listInvoicedOrderKeys('tienda-ariat', PERIOD)
    expect(result.orderIds).toEqual(new Set())
    expect(result.orderReferences).toEqual(new Set())
  })

  it('incluye orderIds facturados INDIVIDUALMENTE', async () => {
    await createInvoice({ orderId: 'order-ind-1', orderNumber: '#1', storeName: 'tienda-ariat', invoiceType: 'individual' })

    const result = await gateway.listInvoicedOrderKeys('tienda-ariat', PERIOD)
    expect(result.orderIds.has('order-ind-1')).toBe(true)
  })

  it('incluye orderIds de membresías de una GLOBAL previa', async () => {
    await createInvoice({
      orderId: 'order-glob-1',
      orderNumber: '#2',
      storeName: 'tienda-ariat',
      invoiceType: 'global',
      paymentType: 'debito',
    })

    const result = await gateway.listInvoicedOrderKeys('tienda-ariat', PERIOD)
    expect(result.orderIds.has('order-glob-1')).toBe(true)
  })

  // NOTA — bug real corregido 2026-07-10: ANTES este gateway filtraba por
  // `eq(invoices.storeName, storeName)`, pero la global consulta con la
  // clave de MARCA (brandKey) mientras que `invoices.store_name` guarda la
  // SUCURSAL física (`order.storeName` normalizado) — nunca coincidían, y la
  // exclusión por DB no excluía nada. Ahora el match es solo por `order.id`
  // (único globalmente en Shopify), sin importar qué `storeName` se reciba.

  it('devuelve un orderId ya facturado sin importar el storeName consultado (order.id es único globalmente)', async () => {
    await createInvoice({ orderId: 'order-other-store', orderNumber: '#3', storeName: 'tienda-stetson' })

    const result = await gateway.listInvoicedOrderKeys('tienda-ariat', PERIOD)
    expect(result.orderIds.has('order-other-store')).toBe(true)
  })

  it('detecta una fila individual con store_name de SUCURSAL aunque se consulte con la clave de MARCA', async () => {
    await createInvoice({
      orderId: 'order-branch-1',
      orderNumber: '#5',
      storeName: 'Western Brothers Outlet Lerma', // sucursal, no la marca
      invoiceType: 'individual',
    })

    const result = await gateway.listInvoicedOrderKeys('western-brothers', PERIOD)
    expect(result.orderIds.has('order-branch-1')).toBe(true)
  })

  it('orderReferences siempre es un Set vacío (canal DB matchea solo por order.id)', async () => {
    await createInvoice({ orderId: 'order-ind-2', orderNumber: '#4', storeName: 'tienda-ariat' })

    const result = await gateway.listInvoicedOrderKeys('tienda-ariat', PERIOD)
    expect(result.orderReferences.size).toBe(0)
  })
})
