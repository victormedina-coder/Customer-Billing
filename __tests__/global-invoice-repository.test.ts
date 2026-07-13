import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import postgresJs from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from '../src/infrastructure/db/schema'
import { DrizzleGlobalInvoiceRepository } from '../src/infrastructure/db/DrizzleGlobalInvoiceRepository'
import { createInvoice } from '../src/infrastructure/db/invoice-repository'
import type { GlobalInvoiceIdentity } from '../src/domain/global/GlobalInvoice'

// ── Skip cuando no hay DB de test ────────────────────────────────────────────
// DATABASE_URL ya fue redirigido a DATABASE_URL_TEST por vitest.config.ts,
// así getDb() usa la DB de test sin necesitar vi.mock (mismo patrón de
// __tests__/invoice-repository.test.ts).
const skip = !process.env.DATABASE_URL_TEST

// ── Cliente independiente solo para TRUNCATE entre tests ─────────────────────
let cleanupClient: ReturnType<typeof postgresJs> | undefined
let cleanupDb: ReturnType<typeof drizzle<typeof schema>> | undefined

if (!skip) {
  cleanupClient = postgresJs(process.env.DATABASE_URL_TEST!, { max: 1 })
  cleanupDb = drizzle(cleanupClient, { schema })
}

beforeEach(async () => {
  if (skip) return
  // invoices tiene FK a global_invoices — truncar ambas juntas evita el orden.
  await cleanupDb!.execute(sql`TRUNCATE TABLE invoices, global_invoices RESTART IDENTITY CASCADE`)
})

afterAll(async () => {
  await cleanupClient?.end()
})

const repo = new DrizzleGlobalInvoiceRepository()

const KEY: GlobalInvoiceIdentity = {
  storeName: 'tienda-ariat',
  periodYear: 2026,
  periodMonth: 6,
  paymentBucket: 'debito',
  chunkIndex: 0,
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe.skipIf(skip)('DrizzleGlobalInvoiceRepository (integration, Railway test DB)', () => {

  // ── createGlobalHeader — idempotencia del UNIQUE compuesto ─────────────────

  it('crea el encabezado en pending con facturamaId/uuidCfdi/itemCount en null/0', async () => {
    const result = await repo.createGlobalHeader(KEY)
    expect(result.created).toBe(true)
    if (!result.created) return
    expect(result.header.storeName).toBe(KEY.storeName)
    expect(result.header.periodYear).toBe(KEY.periodYear)
    expect(result.header.periodMonth).toBe(KEY.periodMonth)
    expect(result.header.paymentBucket).toBe(KEY.paymentBucket)
    expect(result.header.chunkIndex).toBe(KEY.chunkIndex)
    expect(result.header.status).toBe('pending')
    expect(result.header.facturamaId).toBeNull()
    expect(result.header.uuidCfdi).toBeNull()
    expect(result.header.itemCount).toBe(0)
    expect(result.header.id).toBeTruthy()
  })

  it('devuelve { created: false, reason: already_exists } en un choque del UNIQUE compuesto', async () => {
    const first = await repo.createGlobalHeader(KEY)
    expect(first.created).toBe(true)

    const second = await repo.createGlobalHeader(KEY)
    expect(second.created).toBe(false)
    if (!second.created) expect(second.reason).toBe('already_exists')
  })

  it('permite el mismo (tienda, periodo, bucket) con distinto chunkIndex — no es duplicado', async () => {
    const chunk0 = await repo.createGlobalHeader(KEY)
    const chunk1 = await repo.createGlobalHeader({ ...KEY, chunkIndex: 1 })
    expect(chunk0.created).toBe(true)
    expect(chunk1.created).toBe(true)
  })

  it('permite el mismo (periodo, bucket, chunk) en otra tienda — no es duplicado', async () => {
    const ariat = await repo.createGlobalHeader(KEY)
    const stetson = await repo.createGlobalHeader({ ...KEY, storeName: 'tienda-stetson' })
    expect(ariat.created).toBe(true)
    expect(stetson.created).toBe(true)
  })

  // ── reapStaleGlobalHeader — SOLO pending viejo ──────────────────────────────

  it('reapea un encabezado pending más viejo que el TTL y devuelve true', async () => {
    const created = await repo.createGlobalHeader(KEY)
    expect(created.created).toBe(true)

    const future = new Date(Date.now() + 20 * 60_000)
    const reaped = await repo.reapStaleGlobalHeader(KEY, 10, future)
    expect(reaped).toBe(true)

    // El cerrojo quedó libre: se puede volver a crear el mismo encabezado.
    const retried = await repo.createGlobalHeader(KEY)
    expect(retried.created).toBe(true)
  })

  it('NO reapea un encabezado pending reciente (dentro del TTL)', async () => {
    const created = await repo.createGlobalHeader(KEY)
    expect(created.created).toBe(true)

    const reaped = await repo.reapStaleGlobalHeader(KEY, 10, new Date())
    expect(reaped).toBe(false)
  })

  it('NUNCA reapea un encabezado emitted aunque sea viejo', async () => {
    const created = await repo.createGlobalHeader(KEY)
    expect(created.created).toBe(true)
    if (!created.created) return
    await repo.updateGlobalStamp(created.header.id, {
      status: 'emitted',
      facturamaId: 'GF-001',
      uuidCfdi: crypto.randomUUID(),
      itemCount: 5,
    })

    const future = new Date(Date.now() + 20 * 60_000)
    const reaped = await repo.reapStaleGlobalHeader(KEY, 10, future)
    expect(reaped).toBe(false)

    // El choque del UNIQUE sigue vivo — no se liberó el cerrojo.
    const retried = await repo.createGlobalHeader(KEY)
    expect(retried.created).toBe(false)
  })

  it('NUNCA reapea un encabezado stamped_unconfirmed aunque sea viejo — invariante anti-doble-timbre', async () => {
    const created = await repo.createGlobalHeader(KEY)
    expect(created.created).toBe(true)
    if (!created.created) return
    await repo.updateGlobalStamp(created.header.id, { status: 'stamped_unconfirmed' })

    const future = new Date(Date.now() + 20 * 60_000)
    const reaped = await repo.reapStaleGlobalHeader(KEY, 10, future)
    expect(reaped).toBe(false)
  })

  it('devuelve false cuando no existe encabezado para esa identidad', async () => {
    const reaped = await repo.reapStaleGlobalHeader(KEY, 10, new Date())
    expect(reaped).toBe(false)
  })

  // ── updateGlobalStamp ────────────────────────────────────────────────────────

  it('actualiza status/facturamaId/uuidCfdi/itemCount', async () => {
    const created = await repo.createGlobalHeader(KEY)
    expect(created.created).toBe(true)
    if (!created.created) return

    const uuid = crypto.randomUUID()
    await repo.updateGlobalStamp(created.header.id, {
      status: 'emitted',
      facturamaId: 'GF-STAMP01',
      uuidCfdi: uuid,
      itemCount: 42,
    })

    const rows = await cleanupDb!
      .select()
      .from(schema.globalInvoices)
      .where(eq(schema.globalInvoices.id, created.header.id))
    const row = rows[0]
    expect(row.status).toBe('emitted')
    expect(row.facturamaId).toBe('GF-STAMP01')
    expect(row.uuidCfdi).toBe(uuid)
    expect(row.itemCount).toBe(42)
  })

  it('actualiza SOLO status cuando facturamaId/uuidCfdi/itemCount se omiten', async () => {
    const created = await repo.createGlobalHeader(KEY)
    expect(created.created).toBe(true)
    if (!created.created) return

    await repo.updateGlobalStamp(created.header.id, { status: 'stamped_unconfirmed' })

    const rows = await cleanupDb!
      .select()
      .from(schema.globalInvoices)
      .where(eq(schema.globalInvoices.id, created.header.id))
    const row = rows[0]
    expect(row.status).toBe('stamped_unconfirmed')
    expect(row.facturamaId).toBeNull()
    expect(row.itemCount).toBe(0)
  })

  // ── deleteGlobalHeader — rollback ───────────────────────────────────────────

  it('deleteGlobalHeader borra el encabezado; libera el cerrojo del UNIQUE', async () => {
    const created = await repo.createGlobalHeader(KEY)
    expect(created.created).toBe(true)
    if (!created.created) return

    await repo.deleteGlobalHeader(created.header.id)

    const retried = await repo.createGlobalHeader(KEY)
    expect(retried.created).toBe(true)
  })

  it('deleteGlobalHeader sobre un id inexistente no lanza', async () => {
    await expect(repo.deleteGlobalHeader(crypto.randomUUID())).resolves.toBeUndefined()
  })

  // ── filterInvoicedOrderIds — mezcla individual/global + lista vacía ─────────

  it('devuelve un Set vacío sin consultar la DB cuando orderIds está vacío', async () => {
    const result = await repo.filterInvoicedOrderIds('tienda-ariat', [])
    expect(result).toEqual(new Set())
  })

  it('excluye pedidos ya facturados INDIVIDUALMENTE', async () => {
    await createInvoice({ orderId: 'order-ind-1', orderNumber: '#1', storeName: 'tienda-ariat', invoiceType: 'individual' })

    const result = await repo.filterInvoicedOrderIds('tienda-ariat', ['order-ind-1', 'order-new'])
    expect(result.has('order-ind-1')).toBe(true)
    expect(result.has('order-new')).toBe(false)
  })

  it('excluye pedidos ya incluidos en una GLOBAL previa (membresía)', async () => {
    const header = await repo.createGlobalHeader(KEY)
    expect(header.created).toBe(true)
    if (!header.created) return

    await createInvoice({
      orderId: 'order-glob-1',
      orderNumber: '#2',
      storeName: 'tienda-ariat',
      invoiceType: 'global',
      paymentType: 'debito',
      globalInvoiceId: header.header.id,
    })

    const result = await repo.filterInvoicedOrderIds('tienda-ariat', ['order-glob-1', 'order-new'])
    expect(result.has('order-glob-1')).toBe(true)
    expect(result.has('order-new')).toBe(false)
  })

  // NOTA — bug real corregido 2026-07-10: ANTES este método filtraba por
  // `eq(invoices.storeName, storeName)`, pero `invoices.store_name` guarda la
  // SUCURSAL física del pedido (no necesariamente el valor que se pase aquí)
  // y `order.id` es único globalmente en Shopify — filtrar por storeName
  // excluía de menos, no de más. Ahora matchea solo por orderId.
  it('excluye un orderId ya facturado sin importar el storeName consultado (order.id es único globalmente)', async () => {
    await createInvoice({ orderId: 'order-other-store', orderNumber: '#3', storeName: 'tienda-stetson' })

    const result = await repo.filterInvoicedOrderIds('tienda-ariat', ['order-other-store'])
    expect(result.has('order-other-store')).toBe(true)
  })
})
