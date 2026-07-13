/**
 * EmitGlobalInvoiceUseCase — Paso 5 de Facturación Global Mensual.
 *
 * Testea el caso de uso con fakes en memoria de TODOS los puertos (sin DB ni
 * red real) y reloj inyectable. Cubre: enumeración paginada, filtros de
 * elegibilidad, exclusión por unión de gateways (id + referencia), agrupación
 * por bucket + unmapped, chunking, idempotencia (skip / reap), carrera
 * por-fila, rollback de timbrado fallido, stamped_unconfirmed post-timbre, y
 * dryRun sin escrituras.
 */

import { describe, it, expect } from 'vitest'
import { EmitGlobalInvoiceUseCase } from '../src/application/global/EmitGlobalInvoiceUseCase'
import type {
  EmitGlobalInvoiceDeps,
  GlobalMembershipRepo,
} from '../src/application/global/EmitGlobalInvoiceUseCase'
import type { Order } from '../src/domain/orders/Order'
import { isFullyRefunded } from '../src/domain/orders/RefundPolicy'
import { buildOrderReference } from '../src/domain/orders/OrderReference'
import type {
  MonthlyOrder,
  MonthlyOrderSource,
  ListOrdersInRangeParams,
  ListOrdersInRangeResult,
} from '../src/domain/global/ports/MonthlyOrderSource'
import type { NormalizedPayment } from '../src/domain/global/PaymentBucketPolicy'
import type {
  GlobalInvoiceRepository,
  CreateGlobalHeaderData,
  CreateGlobalHeaderResult,
  UpdateGlobalStampData,
} from '../src/domain/global/ports/GlobalInvoiceRepository'
import type { GlobalInvoice, GlobalInvoiceIdentity, GlobalInvoiceStatus } from '../src/domain/global/GlobalInvoice'
import type {
  GlobalInvoiceStamping,
  EmitGlobalInvoicePayload,
  EmitGlobalInvoiceResult,
} from '../src/domain/global/ports/GlobalInvoiceStamping'
import type { InvoicedOrdersGateway, InvoicedOrderKeys } from '../src/domain/global/ports/InvoicedOrdersGateway'
import type { CreateInvoiceData } from '../src/infrastructure/db/invoice-repository'

// ── Fakes en memoria ──────────────────────────────────────────────────────────

class FakeMonthlyOrderSource implements MonthlyOrderSource {
  calls: ListOrdersInRangeParams[] = []
  constructor(private readonly pagesByStore: Map<string, ListOrdersInRangeResult[]>) {}

  async listOrdersInRange(params: ListOrdersInRangeParams): Promise<ListOrdersInRangeResult> {
    this.calls.push(params)
    const pages = this.pagesByStore.get(params.brandKey)
    if (!pages) return { orders: [], nextCursor: null }
    const pageIndex = params.cursor === null ? 0 : Number(params.cursor)
    return pages[pageIndex] ?? { orders: [], nextCursor: null }
  }
}

interface StoredHeader {
  header: GlobalInvoice
  createdAt: Date
}

class FakeGlobalInvoiceRepository implements GlobalInvoiceRepository {
  private readonly store = new Map<string, StoredHeader>()
  calls = { createGlobalHeader: 0, reapStaleGlobalHeader: 0, updateGlobalStamp: 0, deleteGlobalHeader: 0 }

  constructor(private readonly failFirstUpdateOnce = false) {}
  private failedOnce = false

  private keyOf(k: GlobalInvoiceIdentity): string {
    return [k.storeName, k.periodYear, k.periodMonth, k.paymentBucket, k.chunkIndex].join('|')
  }

  async createGlobalHeader(data: CreateGlobalHeaderData): Promise<CreateGlobalHeaderResult> {
    this.calls.createGlobalHeader++
    const key = this.keyOf(data)
    if (this.store.has(key)) return { created: false, reason: 'already_exists' }
    const header: GlobalInvoice = { ...data, id: crypto.randomUUID(), status: 'pending', facturamaId: null, uuidCfdi: null, itemCount: 0 }
    this.store.set(key, { header, createdAt: new Date() })
    return { created: true, header }
  }

  async reapStaleGlobalHeader(key: GlobalInvoiceIdentity, ttlMinutes: number, now: Date): Promise<boolean> {
    this.calls.reapStaleGlobalHeader++
    const rec = this.store.get(this.keyOf(key))
    if (!rec) return false
    if (rec.header.status !== 'pending') return false
    const ageMs = now.getTime() - rec.createdAt.getTime()
    if (ageMs <= ttlMinutes * 60_000) return false
    this.store.delete(this.keyOf(key))
    return true
  }

  async updateGlobalStamp(id: string, data: UpdateGlobalStampData): Promise<void> {
    this.calls.updateGlobalStamp++
    if (this.failFirstUpdateOnce && !this.failedOnce && data.status === 'emitted') {
      this.failedOnce = true
      throw new Error('DB down')
    }
    for (const rec of this.store.values()) {
      if (rec.header.id === id) {
        rec.header.status = data.status
        if (data.facturamaId !== undefined) rec.header.facturamaId = data.facturamaId
        if (data.uuidCfdi !== undefined) rec.header.uuidCfdi = data.uuidCfdi
        if (data.itemCount !== undefined) rec.header.itemCount = data.itemCount
        return
      }
    }
  }

  async deleteGlobalHeader(id: string): Promise<void> {
    this.calls.deleteGlobalHeader++
    for (const [key, rec] of this.store.entries()) {
      if (rec.header.id === id) {
        this.store.delete(key)
        return
      }
    }
  }

  async filterInvoicedOrderIds(): Promise<Set<string>> {
    return new Set()
  }

  // ── helpers de test ────────────────────────────────────────────────────────
  getByIdentity(key: GlobalInvoiceIdentity): GlobalInvoice | undefined {
    return this.store.get(this.keyOf(key))?.header
  }

  seed(identity: GlobalInvoiceIdentity, status: GlobalInvoiceStatus, createdAt: Date): GlobalInvoice {
    const header: GlobalInvoice = {
      ...identity,
      id: crypto.randomUUID(),
      status,
      facturamaId: status === 'pending' ? null : 'SEED-FACT',
      uuidCfdi: status === 'pending' ? null : 'SEED-UUID',
      itemCount: 0,
    }
    this.store.set(this.keyOf(identity), { header, createdAt })
    return header
  }
}

class FakeGlobalMembershipRepo implements GlobalMembershipRepo {
  private readonly rows: CreateInvoiceData[] = []
  calls = { createInvoice: 0, deleteByGlobalInvoiceId: 0 }
  private readonly conflictOrderIds: Set<string>

  constructor(conflictOrderIds: string[] = []) {
    this.conflictOrderIds = new Set(conflictOrderIds)
  }

  async createInvoice(data: CreateInvoiceData): ReturnType<GlobalMembershipRepo['createInvoice']> {
    this.calls.createInvoice++
    const exists =
      this.conflictOrderIds.has(data.orderId) ||
      this.rows.some((r) => r.orderId === data.orderId && r.storeName === data.storeName)
    if (exists) return { created: false, reason: 'already_invoiced' }
    this.rows.push(data)
    return { created: true, invoice: { id: crypto.randomUUID() } }
  }

  async deleteByGlobalInvoiceId(globalInvoiceId: string): Promise<void> {
    this.calls.deleteByGlobalInvoiceId++
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i].globalInvoiceId === globalInvoiceId) this.rows.splice(i, 1)
    }
  }

  get allRows(): readonly CreateInvoiceData[] {
    return this.rows
  }

  rowsFor(globalInvoiceId: string): CreateInvoiceData[] {
    return this.rows.filter((r) => r.globalInvoiceId === globalInvoiceId)
  }
}

class FakeInvoicedOrdersGateway implements InvoicedOrdersGateway {
  calls = 0
  constructor(private readonly keys: InvoicedOrderKeys) {}

  async listInvoicedOrderKeys(): Promise<InvoicedOrderKeys> {
    this.calls++
    return this.keys
  }
}

class FakeGlobalInvoiceStamping implements GlobalInvoiceStamping {
  calls: EmitGlobalInvoicePayload[] = []
  constructor(private readonly impl: (payload: EmitGlobalInvoicePayload) => Promise<EmitGlobalInvoiceResult>) {}

  async emitirGlobal(payload: EmitGlobalInvoicePayload): Promise<EmitGlobalInvoiceResult> {
    this.calls.push(payload)
    return this.impl(payload)
  }
}

// ── Fixtures ───────────────────────────────────────────────────────────────────

const STORE = 'tienda-ariat'
const FIXED_NOW = new Date('2026-07-01T00:00:00.000Z')

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-default',
    orderNumber: '#1000',
    createdAt: '2026-06-15T12:00:00.000Z',
    currency: 'MXN',
    subtotal: 100,
    taxAmount: 16,
    total: 116,
    discountAmount: 0,
    shippingAmount: 0,
    lines: [],
    customerEmail: 'cliente@example.com',
    alreadyInvoiced: false,
    storeName: STORE,
    refundedAmount: 0,
    financialStatus: 'PAID',
    sourceIdentifier: '87008247993-2-1000',
    ...overrides,
  }
}

function makeMonthlyOrder(orderOverrides: Partial<Order>, payments: NormalizedPayment[] = [{ gateway: 'cash', amount: 100 }]): MonthlyOrder {
  return { order: makeOrder(orderOverrides), payments }
}

function makeSuccessfulStamping(): FakeGlobalInvoiceStamping {
  return new FakeGlobalInvoiceStamping(async () => ({ facturamaId: 'GF-001', uuidCfdi: crypto.randomUUID() }))
}

function makeDeps(overrides: Partial<EmitGlobalInvoiceDeps> = {}): EmitGlobalInvoiceDeps {
  return {
    monthlyOrderSource: new FakeMonthlyOrderSource(new Map()),
    globalStamping: makeSuccessfulStamping(),
    globalRepo: new FakeGlobalInvoiceRepository(),
    invoiceRepo: new FakeGlobalMembershipRepo(),
    invoicedOrdersGateways: [],
    refundPolicy: { isFullyRefunded },
    storeNames: [STORE],
    now: () => FIXED_NOW,
    ...overrides,
  }
}

function pageSource(store: string, pages: ListOrdersInRangeResult[]): FakeMonthlyOrderSource {
  return new FakeMonthlyOrderSource(new Map([[store, pages]]))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EmitGlobalInvoiceUseCase — validación de entrada', () => {
  it('year/month inválido devuelve VALIDATION_FAILED sin llamar a monthlyOrderSource', async () => {
    const monthlyOrderSource = new FakeMonthlyOrderSource(new Map())
    const useCase = new EmitGlobalInvoiceUseCase(makeDeps({ monthlyOrderSource }))

    const result = await useCase.execute({ year: 2026, month: 13 })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED')
    expect(monthlyOrderSource.calls).toHaveLength(0)
  })

  it('storeName no configurado devuelve STORE_NOT_CONFIGURED', async () => {
    const useCase = new EmitGlobalInvoiceUseCase(makeDeps({ storeNames: [STORE] }))

    const result = await useCase.execute({ year: 2026, month: 6, storeName: 'tienda-inexistente' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('STORE_NOT_CONFIGURED')
  })

  it('sin storeName itera TODAS las marcas configuradas', async () => {
    const monthlyOrderSource = new FakeMonthlyOrderSource(new Map())
    const useCase = new EmitGlobalInvoiceUseCase(makeDeps({ monthlyOrderSource, storeNames: ['a', 'b'] }))

    const result = await useCase.execute({ year: 2026, month: 6, dryRun: true })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.stores.map((s) => s.store)).toEqual(['a', 'b'])
    }
    expect(monthlyOrderSource.calls.map((c) => c.brandKey)).toEqual(['a', 'b'])
  })
})

describe('EmitGlobalInvoiceUseCase — enumeración paginada', () => {
  it('sigue el cursor hasta nextCursor===null y suma todas las páginas', async () => {
    const monthlyOrderSource = pageSource(STORE, [
      { orders: [makeMonthlyOrder({ id: 'o1' }), makeMonthlyOrder({ id: 'o2' })], nextCursor: '1' },
      { orders: [makeMonthlyOrder({ id: 'o3' })], nextCursor: '2' },
      { orders: [makeMonthlyOrder({ id: 'o4' })], nextCursor: null },
    ])
    const useCase = new EmitGlobalInvoiceUseCase(makeDeps({ monthlyOrderSource }))

    const result = await useCase.execute({ year: 2026, month: 6, dryRun: true })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.stores[0].enumerated).toBe(4)
    }
    expect(monthlyOrderSource.calls).toHaveLength(3)
    expect(monthlyOrderSource.calls[0].cursor).toBeNull()
    expect(monthlyOrderSource.calls[1].cursor).toBe('1')
    expect(monthlyOrderSource.calls[2].cursor).toBe('2')
  })
})

describe('EmitGlobalInvoiceUseCase — filtros de elegibilidad', () => {
  it('excluye non-POS, no-PAID y full-refund; incluye y cuenta el reembolso parcial', async () => {
    const monthlyOrderSource = pageSource(STORE, [
      {
        orders: [
          makeMonthlyOrder({ id: 'no-pos', sourceIdentifier: null }),
          makeMonthlyOrder({ id: 'no-paid', financialStatus: 'PENDING' }),
          makeMonthlyOrder({ id: 'full-refund', financialStatus: 'REFUNDED', refundedAmount: 116 }),
          makeMonthlyOrder({ id: 'partial-refund', total: 116, refundedAmount: 50, financialStatus: 'PARTIALLY_REFUNDED' }),
          makeMonthlyOrder({ id: 'normal' }),
        ],
        nextCursor: null,
      },
    ])
    const useCase = new EmitGlobalInvoiceUseCase(makeDeps({ monthlyOrderSource }))

    const result = await useCase.execute({ year: 2026, month: 6, dryRun: true })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const store = result.value.stores[0]
    expect(store.enumerated).toBe(5)
    expect(store.skippedNonPos).toBe(1)
    expect(store.partialRefunds).toBe(1)
    expect(store.eligible).toBe(2) // partial-refund + normal
  })
})

describe('EmitGlobalInvoiceUseCase — pedidos con total 0 (descuento 100%), decisión finanzas 2026-07-10', () => {
  it('pedido total 0 se excluye y se cuenta en skippedZeroTotal; no aparece en buckets ni en unmapped', async () => {
    const zeroTotalNoPayments = makeMonthlyOrder({ id: 'zero-total', total: 0 }, [])
    const normal = makeMonthlyOrder({ id: 'normal' })

    const monthlyOrderSource = pageSource(STORE, [{ orders: [zeroTotalNoPayments, normal], nextCursor: null }])
    const useCase = new EmitGlobalInvoiceUseCase(makeDeps({ monthlyOrderSource }))

    const result = await useCase.execute({ year: 2026, month: 6, dryRun: true })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const store = result.value.stores[0]
    expect(store.skippedZeroTotal).toBe(1)
    expect(store.eligible).toBe(1)
    expect(store.unmapped.count).toBe(0)
    const totalSurvivingOrders = store.buckets.reduce((acc, b) => acc + b.orders, 0)
    expect(totalSurvivingOrders).toBe(1)
    expect(store.unmapped.orderIds).not.toContain('zero-total')
  })

  it('pedido con total > 0 sin transacciones de pago SIGUE cayendo en unmapped (anomalía real)', async () => {
    const noPaymentsButPositiveTotal = makeMonthlyOrder({ id: 'no-payments' }, [])

    const monthlyOrderSource = pageSource(STORE, [{ orders: [noPaymentsButPositiveTotal], nextCursor: null }])
    const useCase = new EmitGlobalInvoiceUseCase(makeDeps({ monthlyOrderSource }))

    const result = await useCase.execute({ year: 2026, month: 6, dryRun: true })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const store = result.value.stores[0]
    expect(store.skippedZeroTotal).toBe(0)
    expect(store.unmapped.count).toBe(1)
    expect(store.unmapped.orderIds).toEqual(['no-payments'])
  })
})

describe('EmitGlobalInvoiceUseCase — exclusión de ya facturados (unión de gateways)', () => {
  it('excluye por order.id (gateway DB) Y por referencia normalizada (gateway Facturama)', async () => {
    const byId = makeMonthlyOrder({ id: 'order-1', orderNumber: '#1' })
    const byReference = makeMonthlyOrder({ id: 'order-2', orderNumber: '#2', sourceIdentifier: '87008247993-3-2000' })
    const survivor = makeMonthlyOrder({ id: 'order-3', orderNumber: '#3' })

    const monthlyOrderSource = pageSource(STORE, [{ orders: [byId, byReference, survivor], nextCursor: null }])

    const reference = buildOrderReference('#2', '87008247993-3-2000')
    expect(reference).toBe('#2 3-2000')

    const dbGateway = new FakeInvoicedOrdersGateway({ orderIds: new Set(['order-1']), orderReferences: new Set() })
    const facturamaGateway = new FakeInvoicedOrdersGateway({ orderIds: new Set(), orderReferences: new Set([reference]) })

    const useCase = new EmitGlobalInvoiceUseCase(
      makeDeps({ monthlyOrderSource, invoicedOrdersGateways: [dbGateway, facturamaGateway] })
    )

    const result = await useCase.execute({ year: 2026, month: 6, dryRun: true })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const store = result.value.stores[0]
    expect(store.excludedAlreadyInvoiced).toBe(2)
    expect(dbGateway.calls).toBe(1)
    expect(facturamaGateway.calls).toBe(1)
    // Solo order-3 sobrevive → cae en un bucket con 1 pedido.
    const totalSurvivingOrders = store.buckets.reduce((acc, b) => acc + b.orders, 0) + store.unmapped.count
    expect(totalSurvivingOrders).toBe(1)
  })
})

describe('EmitGlobalInvoiceUseCase — identidad de membresía (bug sucursal vs marca, 2026-07-10)', () => {
  const BRAND_KEY = 'western-brothers'
  const SUCURSAL = 'Western Brothers Outlet Lerma'

  it('crea la membresía con order.storeName (sucursal), NO con la clave de marca (store/brandKey)', async () => {
    const order = makeMonthlyOrder({ id: 'order-1', storeName: SUCURSAL })
    const monthlyOrderSource = pageSource(BRAND_KEY, [{ orders: [order], nextCursor: null }])
    const invoiceRepo = new FakeGlobalMembershipRepo()

    const useCase = new EmitGlobalInvoiceUseCase(
      makeDeps({ monthlyOrderSource, invoiceRepo, storeNames: [BRAND_KEY] })
    )

    const result = await useCase.execute({ year: 2026, month: 6, storeName: BRAND_KEY })

    expect(result.ok).toBe(true)
    expect(invoiceRepo.allRows).toHaveLength(1)
    expect(invoiceRepo.allRows[0].storeName).toBe(SUCURSAL)
    expect(invoiceRepo.allRows[0].storeName).not.toBe(BRAND_KEY)
  })

  it('la identidad del header (global_invoices) sigue usando la clave de marca, no la sucursal', async () => {
    const order = makeMonthlyOrder({ id: 'order-1', storeName: SUCURSAL })
    const monthlyOrderSource = pageSource(BRAND_KEY, [{ orders: [order], nextCursor: null }])
    const globalRepo = new FakeGlobalInvoiceRepository()

    const result = await new EmitGlobalInvoiceUseCase(
      makeDeps({ monthlyOrderSource, globalRepo, storeNames: [BRAND_KEY] })
    ).execute({ year: 2026, month: 6, storeName: BRAND_KEY })

    expect(result.ok).toBe(true)
    const identity: GlobalInvoiceIdentity = {
      storeName: BRAND_KEY, periodYear: 2026, periodMonth: 6, paymentBucket: 'efectivo', chunkIndex: 0,
    }
    expect(globalRepo.getByIdentity(identity)).toBeDefined()
  })
})

describe('EmitGlobalInvoiceUseCase — agrupación por bucket (por forma de pago) + unmapped', () => {
  it('$200 efectivo + $300 débito clasifica a credito (varias formas, decisión 2026-07-10); gateway no mapeado va a unmapped y no se timbra', async () => {
    const mixedPayment = makeMonthlyOrder(
      { id: 'mixed' },
      [{ gateway: 'cash', amount: 200 }, { gateway: 'debit_card', amount: 300 }]
    )
    const unmappedOrder = makeMonthlyOrder({ id: 'unmapped-1' }, [{ gateway: 'wire_transfer_unknown', amount: 100 }])

    const monthlyOrderSource = pageSource(STORE, [{ orders: [mixedPayment, unmappedOrder], nextCursor: null }])
    const useCase = new EmitGlobalInvoiceUseCase(makeDeps({ monthlyOrderSource }))

    const result = await useCase.execute({ year: 2026, month: 6, dryRun: true })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const store = result.value.stores[0]
    expect(store.buckets).toHaveLength(1)
    expect(store.buckets[0].bucket).toBe('credito')
    expect(store.buckets[0].orders).toBe(1)
    expect(store.unmapped.count).toBe(1)
    expect(store.unmapped.orderIds).toEqual(['unmapped-1'])
  })
})

describe('EmitGlobalInvoiceUseCase — chunking', () => {
  it('501 pedidos con max 250 produce 3 chunks (250/250/1)', async () => {
    const orders: MonthlyOrder[] = Array.from({ length: 501 }, (_, i) =>
      makeMonthlyOrder({ id: `order-${i}`, orderNumber: `#${i}`, sourceIdentifier: `dev-${i}` })
    )
    const monthlyOrderSource = pageSource(STORE, [{ orders, nextCursor: null }])
    const useCase = new EmitGlobalInvoiceUseCase(makeDeps({ monthlyOrderSource, maxItemsPerChunk: 250 }))

    const result = await useCase.execute({ year: 2026, month: 6, dryRun: true })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const bucket = result.value.stores[0].buckets.find((b) => b.bucket === 'efectivo')
    expect(bucket).toBeDefined()
    expect(bucket!.chunks.map((c) => c.itemCount)).toEqual([250, 250, 1])
    expect(bucket!.chunks.every((c) => c.outcome === 'dry_run')).toBe(true)
  })
})

describe('EmitGlobalInvoiceUseCase — idempotencia', () => {
  const IDENTITY: GlobalInvoiceIdentity = {
    storeName: STORE,
    periodYear: 2026,
    periodMonth: 6,
    paymentBucket: 'efectivo',
    chunkIndex: 0,
  }

  it('header ya emitted → skip, sin timbrar de nuevo', async () => {
    const globalRepo = new FakeGlobalInvoiceRepository()
    globalRepo.seed(IDENTITY, 'emitted', FIXED_NOW)

    const monthlyOrderSource = pageSource(STORE, [{ orders: [makeMonthlyOrder({ id: 'order-1' })], nextCursor: null }])
    const stamping = makeSuccessfulStamping()
    const invoiceRepo = new FakeGlobalMembershipRepo()
    const useCase = new EmitGlobalInvoiceUseCase(makeDeps({ monthlyOrderSource, globalRepo, globalStamping: stamping, invoiceRepo }))

    const result = await useCase.execute({ year: 2026, month: 6 })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const chunk = result.value.stores[0].buckets[0].chunks[0]
    expect(chunk.outcome).toBe('skipped_idempotent')
    expect(stamping.calls).toHaveLength(0)
    expect(invoiceRepo.calls.createInvoice).toBe(0)
  })

  it('header pending viejo (> TTL) → reap y reintento exitoso', async () => {
    const globalRepo = new FakeGlobalInvoiceRepository()
    const staleCreatedAt = new Date(FIXED_NOW.getTime() - 20 * 60_000)
    globalRepo.seed(IDENTITY, 'pending', staleCreatedAt)

    const monthlyOrderSource = pageSource(STORE, [{ orders: [makeMonthlyOrder({ id: 'order-1' })], nextCursor: null }])
    const useCase = new EmitGlobalInvoiceUseCase(
      makeDeps({ monthlyOrderSource, globalRepo, pendingTtlMinutes: 10, now: () => FIXED_NOW })
    )

    const result = await useCase.execute({ year: 2026, month: 6 })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const chunk = result.value.stores[0].buckets[0].chunks[0]
    expect(chunk.outcome).toBe('emitted')
    expect(globalRepo.calls.createGlobalHeader).toBe(2)
    expect(globalRepo.calls.reapStaleGlobalHeader).toBe(1)
  })

  it('header pending reciente (<= TTL) → skip, no se reapea', async () => {
    const globalRepo = new FakeGlobalInvoiceRepository()
    globalRepo.seed(IDENTITY, 'pending', FIXED_NOW)

    const monthlyOrderSource = pageSource(STORE, [{ orders: [makeMonthlyOrder({ id: 'order-1' })], nextCursor: null }])
    const useCase = new EmitGlobalInvoiceUseCase(
      makeDeps({ monthlyOrderSource, globalRepo, pendingTtlMinutes: 10, now: () => FIXED_NOW })
    )

    const result = await useCase.execute({ year: 2026, month: 6 })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.stores[0].buckets[0].chunks[0].outcome).toBe('skipped_idempotent')
    expect(globalRepo.calls.createGlobalHeader).toBe(1)
  })
})

describe('EmitGlobalInvoiceUseCase — carrera por-fila en membresías', () => {
  it('un pedido en conflicto se excluye del chunk; el resto continúa y se timbra', async () => {
    const survives = makeMonthlyOrder({ id: 'order-1' })
    const loses = makeMonthlyOrder({ id: 'order-2', orderNumber: '#2', sourceIdentifier: 'dev-2' })
    const monthlyOrderSource = pageSource(STORE, [{ orders: [survives, loses], nextCursor: null }])

    const invoiceRepo = new FakeGlobalMembershipRepo(['order-2'])
    const stamping = makeSuccessfulStamping()
    const useCase = new EmitGlobalInvoiceUseCase(makeDeps({ monthlyOrderSource, invoiceRepo, globalStamping: stamping }))

    const result = await useCase.execute({ year: 2026, month: 6 })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const chunk = result.value.stores[0].buckets[0].chunks[0]
    expect(chunk.outcome).toBe('emitted')
    expect(chunk.itemCount).toBe(1)
    expect(chunk.excludedByRace).toBe(1)
    expect(stamping.calls[0].itemCount).toBe(1)
  })

  it('todos los pedidos del chunk chocan → chunk vacío, header borrado, sin timbrar', async () => {
    const loses = makeMonthlyOrder({ id: 'order-1' })
    const monthlyOrderSource = pageSource(STORE, [{ orders: [loses], nextCursor: null }])

    const invoiceRepo = new FakeGlobalMembershipRepo(['order-1'])
    const globalRepo = new FakeGlobalInvoiceRepository()
    const stamping = makeSuccessfulStamping()
    const useCase = new EmitGlobalInvoiceUseCase(makeDeps({ monthlyOrderSource, invoiceRepo, globalRepo, globalStamping: stamping }))

    const result = await useCase.execute({ year: 2026, month: 6 })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const chunk = result.value.stores[0].buckets[0].chunks[0]
    expect(chunk.outcome).toBe('empty')
    expect(chunk.itemCount).toBe(0)
    expect(stamping.calls).toHaveLength(0)
    expect(globalRepo.calls.deleteGlobalHeader).toBe(1)
  })
})

describe('EmitGlobalInvoiceUseCase — rollback en fallo de timbrado', () => {
  it('Facturama lanza → borra membresías del chunk y el header (rolled_back)', async () => {
    const order = makeMonthlyOrder({ id: 'order-1' })
    const monthlyOrderSource = pageSource(STORE, [{ orders: [order], nextCursor: null }])

    const invoiceRepo = new FakeGlobalMembershipRepo()
    const globalRepo = new FakeGlobalInvoiceRepository()
    const failingStamping = new FakeGlobalInvoiceStamping(async () => {
      throw new Error('facturama down')
    })

    const useCase = new EmitGlobalInvoiceUseCase(
      makeDeps({ monthlyOrderSource, invoiceRepo, globalRepo, globalStamping: failingStamping })
    )

    const result = await useCase.execute({ year: 2026, month: 6 })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const chunk = result.value.stores[0].buckets[0].chunks[0]
    expect(chunk.outcome).toBe('rolled_back')
    expect(chunk.error).toBe('facturama down')
    expect(invoiceRepo.calls.deleteByGlobalInvoiceId).toBe(1)
    expect(globalRepo.calls.deleteGlobalHeader).toBe(1)
    expect(invoiceRepo.allRows).toHaveLength(0)

    const identity: GlobalInvoiceIdentity = { storeName: STORE, periodYear: 2026, periodMonth: 6, paymentBucket: 'efectivo', chunkIndex: 0 }
    expect(globalRepo.getByIdentity(identity)).toBeUndefined()
  })
})

describe('EmitGlobalInvoiceUseCase — stamped_unconfirmed tras timbrado exitoso', () => {
  it('si updateGlobalStamp falla tras timbrar OK, se reintenta marcando stamped_unconfirmed (sin rollback)', async () => {
    const order = makeMonthlyOrder({ id: 'order-1' })
    const monthlyOrderSource = pageSource(STORE, [{ orders: [order], nextCursor: null }])

    const globalRepo = new FakeGlobalInvoiceRepository(true) // falla el primer updateGlobalStamp('emitted')
    const fixedUuid = crypto.randomUUID()
    const stamping = new FakeGlobalInvoiceStamping(async () => ({ facturamaId: 'GF-001', uuidCfdi: fixedUuid }))
    const useCase = new EmitGlobalInvoiceUseCase(makeDeps({ monthlyOrderSource, globalRepo, globalStamping: stamping }))

    const result = await useCase.execute({ year: 2026, month: 6 })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const chunk = result.value.stores[0].buckets[0].chunks[0]
    expect(chunk.outcome).toBe('stamped_unconfirmed')
    expect(chunk.uuid).toBe(fixedUuid)
    expect(globalRepo.calls.updateGlobalStamp).toBe(2)
    // El CFDI YA se timbró — NO debe haber rollback de membresías ni de header.
    expect(globalRepo.calls.deleteGlobalHeader).toBe(0)
  })
})

describe('EmitGlobalInvoiceUseCase — dryRun no escribe', () => {
  it('cero llamadas de escritura a globalRepo/invoiceRepo/globalStamping', async () => {
    const orders = [
      makeMonthlyOrder({ id: 'order-1' }),
      makeMonthlyOrder({ id: 'order-2', orderNumber: '#2', sourceIdentifier: 'dev-2' }),
    ]
    const monthlyOrderSource = pageSource(STORE, [{ orders, nextCursor: null }])
    const globalRepo = new FakeGlobalInvoiceRepository()
    const invoiceRepo = new FakeGlobalMembershipRepo()
    const stamping = makeSuccessfulStamping()
    const gateway = new FakeInvoicedOrdersGateway({ orderIds: new Set(), orderReferences: new Set() })

    const useCase = new EmitGlobalInvoiceUseCase(
      makeDeps({ monthlyOrderSource, globalRepo, invoiceRepo, globalStamping: stamping, invoicedOrdersGateways: [gateway] })
    )

    const result = await useCase.execute({ year: 2026, month: 6, dryRun: true })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.dryRun).toBe(true)

    // Lecturas SÍ ocurren (enumeración + exclusión ya-facturados).
    expect(monthlyOrderSource.calls.length).toBeGreaterThan(0)
    expect(gateway.calls).toBeGreaterThan(0)

    // Cero escrituras.
    expect(globalRepo.calls.createGlobalHeader).toBe(0)
    expect(globalRepo.calls.updateGlobalStamp).toBe(0)
    expect(globalRepo.calls.deleteGlobalHeader).toBe(0)
    expect(invoiceRepo.calls.createInvoice).toBe(0)
    expect(invoiceRepo.calls.deleteByGlobalInvoiceId).toBe(0)
    expect(stamping.calls).toHaveLength(0)
  })
})
