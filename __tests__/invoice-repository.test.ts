import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import postgresJs from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from '../lib/db/schema'
import {
  isAlreadyInvoiced,
  findByOrder,
  createInvoice,
  listInvoicedOrderIds,
  type CreateInvoiceData,
} from '../lib/db/invoice-repository'

// ── Skip cuando no hay DB de test ────────────────────────────────────────────
// DATABASE_URL ya fue redirigido a DATABASE_URL_TEST por vitest.config.ts,
// así getDb() usa la DB de test sin necesitar vi.mock.
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
  await cleanupDb!.execute(sql`TRUNCATE TABLE invoices RESTART IDENTITY CASCADE`)
})

afterAll(async () => {
  await cleanupClient?.end()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe.skipIf(skip)('invoice-repository (integration, Railway test DB)', () => {

  // ── isAlreadyInvoiced ──────────────────────────────────────────────────────

  it('returns false when no invoice exists', async () => {
    expect(await isAlreadyInvoiced('order-001', 'tienda-ariat')).toBe(false)
  })

  it('returns true after inserting an invoice', async () => {
    await createInvoice({ orderId: 'order-001', orderNumber: '#1001', storeName: 'tienda-ariat' })
    expect(await isAlreadyInvoiced('order-001', 'tienda-ariat')).toBe(true)
  })

  it('is scoped to storeName — same orderId in different store returns false', async () => {
    await createInvoice({ orderId: 'order-001', orderNumber: '#1001', storeName: 'tienda-ariat' })
    expect(await isAlreadyInvoiced('order-001', 'tienda-stetson')).toBe(false)
  })

  // ── createInvoice ──────────────────────────────────────────────────────────

  it('returns { created: true, invoice } on first insert', async () => {
    const data: CreateInvoiceData = {
      orderId: 'order-002',
      orderNumber: '#1002',
      storeName: 'tienda-ariat',
      facturamaId: 'F-ABC123',
      uuidCfdi: crypto.randomUUID(),
      rfcReceptor: 'EKU9003173C9',
      razonSocial: 'ESCUELA KEMPER URGATE',
      status: 'emitted',
      invoiceType: 'individual',
    }
    const result = await createInvoice(data)
    expect(result.created).toBe(true)
    if (result.created) {
      expect(result.invoice.orderId).toBe('order-002')
      expect(result.invoice.storeName).toBe('tienda-ariat')
      expect(result.invoice.facturamaId).toBe('F-ABC123')
      expect(result.invoice.status).toBe('emitted')
      expect(result.invoice.id).toBeTruthy()
    }
  })

  it('returns { created: false, reason: already_invoiced } on duplicate', async () => {
    const base: CreateInvoiceData = { orderId: 'order-003', orderNumber: '#1003', storeName: 'tienda-ariat' }
    await createInvoice(base)
    const second = await createInvoice({ ...base, facturamaId: 'F-OTRO' })
    expect(second.created).toBe(false)
    if (!second.created) expect(second.reason).toBe('already_invoiced')
  })

  it('allows same orderId in different stores (not a duplicate)', async () => {
    const r1 = await createInvoice({ orderId: 'order-004', orderNumber: '#1004', storeName: 'tienda-ariat' })
    const r2 = await createInvoice({ orderId: 'order-004', orderNumber: '#1004', storeName: 'tienda-stetson' })
    expect(r1.created).toBe(true)
    expect(r2.created).toBe(true)
  })

  // ── findByOrder ────────────────────────────────────────────────────────────

  it('returns null when no invoice exists', async () => {
    expect(await findByOrder('order-X', 'tienda-ariat')).toBeNull()
  })

  it('returns the invoice row after insertion', async () => {
    await createInvoice({ orderId: 'order-005', orderNumber: '#1005', storeName: 'tienda-ariat', rfcReceptor: 'EKU9003173C9' })
    const row = await findByOrder('order-005', 'tienda-ariat')
    expect(row).not.toBeNull()
    expect(row?.rfcReceptor).toBe('EKU9003173C9')
    expect(row?.cancelledAt).toBeNull()
  })

  // ── listInvoicedOrderIds ───────────────────────────────────────────────────

  it('returns empty array when no invoices exist in range', async () => {
    const result = await listInvoicedOrderIds('tienda-ariat', new Date('2026-06-01'), new Date('2026-06-30'))
    expect(result).toEqual([])
  })

  it('returns individual invoice orderIds in range, excludes globals', async () => {
    await createInvoice({ orderId: 'order-A', orderNumber: '#A', storeName: 'tienda-ariat', invoiceType: 'individual' })
    await createInvoice({ orderId: 'order-B', orderNumber: '#B', storeName: 'tienda-ariat', invoiceType: 'individual' })
    await createInvoice({ orderId: 'order-C', orderNumber: '#C', storeName: 'tienda-ariat', invoiceType: 'global' })

    const from = new Date(Date.now() - 60_000)
    const to   = new Date(Date.now() + 60_000)
    const result = await listInvoicedOrderIds('tienda-ariat', from, to)
    expect(result).toContain('order-A')
    expect(result).toContain('order-B')
    expect(result).not.toContain('order-C')
  })

  it('is scoped to storeName', async () => {
    await createInvoice({ orderId: 'order-D', orderNumber: '#D', storeName: 'tienda-ariat' })
    const from = new Date(Date.now() - 60_000)
    const to   = new Date(Date.now() + 60_000)
    const result = await listInvoicedOrderIds('tienda-stetson', from, to)
    expect(result).not.toContain('order-D')
  })
})
