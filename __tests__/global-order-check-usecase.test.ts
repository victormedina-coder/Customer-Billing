import { describe, expect, it, vi } from 'vitest'
import { EmitGlobalInvoiceUseCase } from '../src/application/global/EmitGlobalInvoiceUseCase'
import type { EmitGlobalInvoiceDeps } from '../src/application/global/EmitGlobalInvoiceUseCase'
import type { ReconcileReport } from '../src/application/global/ReconcileGlobalStampsUseCase'
import type { Order } from '../src/domain/orders/Order'

const order: Order = {
  id: 'o1', orderNumber: '#1000', sourceIdentifier: 'long-2-1266',
  createdAt: '2026-06-15T12:00:00.000Z', currency: 'MXN', subtotal: 100,
  taxAmount: 16, total: 116, discountAmount: 0, shippingAmount: 0, lines: [],
  customerEmail: 'x@example.com', alreadyInvoiced: false, storeName: 'store',
  refundedAmount: 0, financialStatus: 'PAID',
}

const reconcile: ReconcileReport = {
  decisions: [], counts: { confirm: 0, release: 0, wait: 0, alert_duplicate: 0, alert_cancelled: 0, alert_late_stamp: 0 },
  alerts: [], unexplainedGlobalsInPeriod: 1,
  unexplainedGlobals: [{ facturamaId: 'cfdi-1', serieFolio: 'G-1', active: true, rfc: 'XAXX010101000', date: '2026-06-15' }],
}

function setup(blocked: boolean, report: ReconcileReport = reconcile, max = 30, budgetMs?: number) {
  const getItems = vi.fn(async () => ['2-1266'])
  const deps: EmitGlobalInvoiceDeps = {
    monthlyOrderSource: { listOrdersInRange: async () => ({ orders: [{ order, payments: [{ gateway: 'cash', amount: 116 }] }], nextCursor: null }) },
    globalStamping: { emitirGlobal: vi.fn(async () => ({ facturamaId: 'new', uuidCfdi: 'uuid' })) },
    globalRepo: { listUnresolvedHeaders: async () => [], nextChunkIndex: async () => 0 } as unknown as EmitGlobalInvoiceDeps['globalRepo'],
    invoiceRepo: { createInvoice: vi.fn(), deleteByGlobalInvoiceId: vi.fn() },
    invoicedOrdersGateways: blocked ? [{ listInvoicedOrderKeys: async () => ({ orderIds: new Set(['o1']), unresolvedOrderIds: new Set(['o1']), orderReferences: new Set<string>() }) }] : [],
    refundPolicy: { isFullyRefunded: () => false }, storeNames: ['store'],
    issuedCfdiItemsLookup: { getItems }, orderCheckMaxCfdis: max, orderCheckBudgetMs: budgetMs,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }
  return { useCase: new EmitGlobalInvoiceUseCase(deps), getItems, report }
}

describe('informational global order check', () => {
  it('does not call the detail lookup without blocked orders or unexplained globals', async () => {
    const { useCase, getItems } = setup(false, { ...reconcile, unexplainedGlobalsInPeriod: 0, unexplainedGlobals: [] })
    const result = await useCase.execute({ year: 2026, month: 6, dryRun: true })
    expect(result.ok).toBe(true)
    expect(getItems).not.toHaveBeenCalled()
  })

  it('checks a blocked order and leaves the exclusion unchanged', async () => {
    const { useCase, getItems, report } = setup(true)
    const result = await useCase.execute({ year: 2026, month: 6, dryRun: true, reconcile: report })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(getItems).toHaveBeenCalledExactlyOnceWith('cfdi-1')
    expect(result.value.stores[0].orderCheck.results[0].foundIn).toEqual([{ facturamaId: 'cfdi-1', serieFolio: 'G-1' }])
    expect(result.value.stores[0].excludedAlreadyInvoiced.orders[0].matchedBy).toBe('db_unresolved')
    expect(result.value.summary.orderCheckFound).toBe(1)
  })

  it('reports lookup errors without changing the run outcome', async () => {
    const checked = setup(true)
    checked.getItems.mockRejectedValueOnce(new Error('Facturama unavailable'))
    const result = await checked.useCase.execute({ year: 2026, month: 6, dryRun: true, reconcile })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.stores[0].orderCheck.unavailable).toBe('Facturama unavailable')
    expect(result.value.summary.hasFailures).toBe(true)
    expect(result.value.stores[0].excludedAlreadyInvoiced.orders[0].matchedBy).toBe('db_unresolved')
  })

  it('does not release or exclude differently because of the informational check', async () => {
    const withCheck = await setup(true).useCase.execute({ year: 2026, month: 6, dryRun: true, reconcile })
    const withoutCheck = await setup(true).useCase.execute({ year: 2026, month: 6, dryRun: true })
    expect(withCheck.ok && withoutCheck.ok).toBe(true)
    if (!withCheck.ok || !withoutCheck.ok) return
    expect(withCheck.value.stores[0].excludedAlreadyInvoiced).toEqual(withoutCheck.value.stores[0].excludedAlreadyInvoiced)
    expect(withCheck.value.stores[0].buckets).toEqual(withoutCheck.value.stores[0].buckets)
    expect(withCheck.value.summary.hasFailures).toBe(withoutCheck.value.summary.hasFailures)
  })

  it('truncates before looking up CFDIs beyond the configured cap', async () => {
    const { useCase, getItems } = setup(true, reconcile, 0)
    const result = await useCase.execute({ year: 2026, month: 6, dryRun: true, reconcile })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.stores[0].orderCheck.truncated).toBe(true)
    expect(getItems).not.toHaveBeenCalled()
  })

  it('truncates when the shared time budget is exhausted before Items lookup', async () => {
    const { useCase, getItems } = setup(true, reconcile, 30, 0)
    const result = await useCase.execute({ year: 2026, month: 6, dryRun: true, reconcile })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.stores[0].orderCheck.truncated).toBe(true)
    expect(getItems).not.toHaveBeenCalled()
  })

  it('does not wait indefinitely for a slow Items lookup', async () => {
    const { useCase, getItems } = setup(true, reconcile, 30, 1)
    getItems.mockImplementation(() => new Promise<string[]>(() => {}))
    const result = await useCase.execute({ year: 2026, month: 6, dryRun: true, reconcile })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.stores[0].orderCheck.truncated).toBe(true)
  })
})
