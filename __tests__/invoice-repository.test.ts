import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import postgresJs from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from '../src/infrastructure/db/schema'
import {
  isAlreadyInvoiced,
  findByOrder,
  findById,
  createInvoice,
  updateInvoiceStamp,
  deleteById,
  deleteByGlobalInvoiceId,
  listInvoicedOrderIds,
  reapIfStalePending,
  type CreateInvoiceData,
} from '../src/infrastructure/db/invoice-repository'

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

  it('una membresía GLOBAL con el mismo (order_id, store_name de sucursal) que una fila INDIVIDUAL choca — cerrojo anti-doble-facturación entre canales (bug corregido 2026-07-10)', async () => {
    const sucursal = 'Western Brothers Outlet Lerma'
    const individual = await createInvoice({
      orderId: 'order-branch-1', orderNumber: '#B1', storeName: sucursal, invoiceType: 'individual',
    })
    expect(individual.created).toBe(true)

    // La membresía global usa `order.storeName` (sucursal), NO la clave de
    // marca — por eso debe chocar con la fila individual del mismo pedido.
    const membership = await createInvoice({
      orderId: 'order-branch-1', orderNumber: '#B1', storeName: sucursal,
      invoiceType: 'global', paymentType: 'efectivo',
    })
    expect(membership.created).toBe(false)
    if (!membership.created) expect(membership.reason).toBe('already_invoiced')
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

  // ── findById ───────────────────────────────────────────────────────────────

  it('findById devuelve null para un id inexistente', async () => {
    const result = await findById(crypto.randomUUID())
    expect(result).toBeNull()
  })

  it('findById devuelve la fila completa tras createInvoice', async () => {
    const data: CreateInvoiceData = {
      orderId: 'order-006',
      orderNumber: '#1006',
      storeName: 'tienda-ariat',
      facturamaId: 'F-XYZ789',
      uuidCfdi: crypto.randomUUID(),
      rfcReceptor: 'EKU9003173C9',
      razonSocial: 'ESCUELA KEMPER URGATE',
      email: 'receptor@example.com',
      status: 'emitted',
      invoiceType: 'individual',
    }
    const created = await createInvoice(data)
    expect(created.created).toBe(true)
    if (!created.created) return

    const row = await findById(created.invoice.id)
    expect(row).not.toBeNull()
    expect(row?.facturamaId).toBe('F-XYZ789')
    expect(row?.email).toBe('receptor@example.com')
    expect(row?.id).toBe(created.invoice.id)
  })

  // ── updateInvoiceStamp ─────────────────────────────────────────────────────

  it('updateInvoiceStamp actualiza facturamaId, uuidCfdi y status', async () => {
    const created = await createInvoice({
      orderId: 'order-008',
      orderNumber: '#1008',
      storeName: 'tienda-ariat',
      status: 'pending',
    })
    expect(created.created).toBe(true)
    if (!created.created) return

    const uuid = crypto.randomUUID()
    const updated = await updateInvoiceStamp(created.invoice.id, {
      facturamaId: 'F-STAMP01',
      uuidCfdi: uuid,
      status: 'emitted',
    })
    expect(updated).not.toBeNull()
    expect(updated?.facturamaId).toBe('F-STAMP01')
    expect(updated?.uuidCfdi).toBe(uuid)
    expect(updated?.status).toBe('emitted')
  })

  it('updateInvoiceStamp sobre id inexistente devuelve null', async () => {
    const result = await updateInvoiceStamp(crypto.randomUUID(), {
      facturamaId: 'F-NOEXIST',
      uuidCfdi: crypto.randomUUID(),
    })
    expect(result).toBeNull()
  })

  // ── deleteById ─────────────────────────────────────────────────────────────

  it('deleteById borra la fila; findById devuelve null tras el borrado', async () => {
    const created = await createInvoice({
      orderId: 'order-009',
      orderNumber: '#1009',
      storeName: 'tienda-ariat',
      status: 'pending',
    })
    expect(created.created).toBe(true)
    if (!created.created) return

    await deleteById(created.invoice.id)
    expect(await findById(created.invoice.id)).toBeNull()
  })

  it('deleteById sobre id inexistente no lanza', async () => {
    await expect(deleteById(crypto.randomUUID())).resolves.toBeUndefined()
  })

  // ── deleteByGlobalInvoiceId — rollback de membresías de una global ────────

  it('deleteByGlobalInvoiceId borra TODAS las membresías de un CFDI global; no toca otras filas', async () => {
    const [header] = await cleanupDb!
      .insert(schema.globalInvoices)
      .values({ storeName: 'tienda-ariat', periodYear: 2026, periodMonth: 6, paymentBucket: 'debito', chunkIndex: 0 })
      .returning()

    await createInvoice({
      orderId: 'order-glob-a', orderNumber: '#A', storeName: 'tienda-ariat',
      invoiceType: 'global', paymentType: 'debito', globalInvoiceId: header.id,
    })
    await createInvoice({
      orderId: 'order-glob-b', orderNumber: '#B', storeName: 'tienda-ariat',
      invoiceType: 'global', paymentType: 'debito', globalInvoiceId: header.id,
    })
    await createInvoice({ orderId: 'order-individual', orderNumber: '#C', storeName: 'tienda-ariat', invoiceType: 'individual' })

    await deleteByGlobalInvoiceId(header.id)

    expect(await findByOrder('order-glob-a', 'tienda-ariat')).toBeNull()
    expect(await findByOrder('order-glob-b', 'tienda-ariat')).toBeNull()
    expect(await findByOrder('order-individual', 'tienda-ariat')).not.toBeNull()
  })

  it('deleteByGlobalInvoiceId sobre un id inexistente no lanza', async () => {
    await expect(deleteByGlobalInvoiceId(crypto.randomUUID())).resolves.toBeUndefined()
  })

  // ── Flujo insert-first ─────────────────────────────────────────────────────

  it('flujo insert-first: pending → updateInvoiceStamp → emitted', async () => {
    // 1. Insertar fila pending (cerrojo adquirido)
    const created = await createInvoice({
      orderId: 'order-010',
      orderNumber: '#1010',
      storeName: 'tienda-ariat',
      status: 'pending',
      facturamaId: null,
      uuidCfdi: null,
    })
    expect(created.created).toBe(true)
    if (!created.created) return
    const id = created.invoice.id

    // 2. Verificar que la fila está en pending y sin datos de CFDI
    const pending = await findById(id)
    expect(pending?.status).toBe('pending')
    expect(pending?.facturamaId).toBeNull()

    // 3. Simular timbrado exitoso: actualizar con datos del CFDI
    const uuid = crypto.randomUUID()
    await updateInvoiceStamp(id, { facturamaId: 'F-INSERTFIRST', uuidCfdi: uuid, status: 'emitted' })

    // 4. Verificar estado final
    const emitted = await findById(id)
    expect(emitted?.status).toBe('emitted')
    expect(emitted?.facturamaId).toBe('F-INSERTFIRST')
    expect(emitted?.uuidCfdi).toBe(uuid)
  })

  it('createInvoice persiste el email cuando se proporciona', async () => {
    const data: CreateInvoiceData = {
      orderId: 'order-007',
      orderNumber: '#1007',
      storeName: 'tienda-ariat',
      email: 'test@example.com',
      status: 'emitted',
    }
    const created = await createInvoice(data)
    expect(created.created).toBe(true)
    if (!created.created) return

    const row = await findById(created.invoice.id)
    expect(row?.email).toBe('test@example.com')
  })

  it('createInvoice persiste el registro de consentimiento (privacyVersion, termsVersion, consentAt)', async () => {
    const consentAt = new Date()
    const data: CreateInvoiceData = {
      orderId: 'order-consent-001',
      orderNumber: '#C001',
      storeName: 'tienda-ariat',
      status: 'pending',
      privacyVersion: '2026-07-03',
      termsVersion: '2026-07-03',
      consentAt,
    }
    const created = await createInvoice(data)
    expect(created.created).toBe(true)
    if (!created.created) return

    const row = await findById(created.invoice.id)
    expect(row?.privacyVersion).toBe('2026-07-03')
    expect(row?.termsVersion).toBe('2026-07-03')
    expect(row?.consentAt?.getTime()).toBe(consentAt.getTime())
  })

  it('createInvoice deja privacyVersion/termsVersion/consentAt en null cuando no se proporcionan', async () => {
    const created = await createInvoice({
      orderId: 'order-consent-002',
      orderNumber: '#C002',
      storeName: 'tienda-ariat',
    })
    expect(created.created).toBe(true)
    if (!created.created) return

    const row = await findById(created.invoice.id)
    expect(row?.privacyVersion).toBeNull()
    expect(row?.termsVersion).toBeNull()
    expect(row?.consentAt).toBeNull()
  })

  // ── reapIfStalePending (docs/08-plan-pre-deploy.md §4) ────────────────────

  it('reapIfStalePending borra una fila pending más vieja que el TTL y devuelve true', async () => {
    const created = await createInvoice({
      orderId: 'order-reap-001',
      orderNumber: '#R001',
      storeName: 'tienda-ariat',
      status: 'pending',
    })
    expect(created.created).toBe(true)

    // now = 20 minutos en el futuro respecto a createdAt (default DB = now()),
    // con TTL de 10 min la fila queda vieja.
    const future = new Date(Date.now() + 20 * 60_000)
    const reaped = await reapIfStalePending('order-reap-001', 'tienda-ariat', 10, future)

    expect(reaped).toBe(true)
    expect(await findByOrder('order-reap-001', 'tienda-ariat')).toBeNull()
  })

  it('reapIfStalePending NO borra una fila pending reciente (dentro del TTL) y devuelve false', async () => {
    const created = await createInvoice({
      orderId: 'order-reap-002',
      orderNumber: '#R002',
      storeName: 'tienda-ariat',
      status: 'pending',
    })
    expect(created.created).toBe(true)

    const reaped = await reapIfStalePending('order-reap-002', 'tienda-ariat', 10, new Date())

    expect(reaped).toBe(false)
    expect(await findByOrder('order-reap-002', 'tienda-ariat')).not.toBeNull()
  })

  it('reapIfStalePending NO borra una fila emitted aunque sea vieja', async () => {
    const created = await createInvoice({
      orderId: 'order-reap-003',
      orderNumber: '#R003',
      storeName: 'tienda-ariat',
      status: 'emitted',
      facturamaId: 'F-REAP003',
      uuidCfdi: crypto.randomUUID(),
    })
    expect(created.created).toBe(true)

    const future = new Date(Date.now() + 20 * 60_000)
    const reaped = await reapIfStalePending('order-reap-003', 'tienda-ariat', 10, future)

    expect(reaped).toBe(false)
    expect(await findByOrder('order-reap-003', 'tienda-ariat')).not.toBeNull()
  })

  it('reapIfStalePending NO borra una fila stamped_unconfirmed aunque sea vieja — invariante anti-doble-timbre', async () => {
    const created = await createInvoice({
      orderId: 'order-reap-004',
      orderNumber: '#R004',
      storeName: 'tienda-ariat',
      status: 'stamped_unconfirmed',
      facturamaId: 'F-REAP004',
      uuidCfdi: crypto.randomUUID(),
    })
    expect(created.created).toBe(true)

    const future = new Date(Date.now() + 20 * 60_000)
    const reaped = await reapIfStalePending('order-reap-004', 'tienda-ariat', 10, future)

    expect(reaped).toBe(false)
    const row = await findByOrder('order-reap-004', 'tienda-ariat')
    expect(row).not.toBeNull()
    expect(row?.status).toBe('stamped_unconfirmed')
  })

  it('reapIfStalePending devuelve false cuando no existe fila para el pedido', async () => {
    const reaped = await reapIfStalePending('order-inexistente', 'tienda-ariat', 10, new Date())
    expect(reaped).toBe(false)
  })
})
