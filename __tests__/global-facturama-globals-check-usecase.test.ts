import { describe, expect, it, vi } from 'vitest'
import { EmitGlobalInvoiceUseCase } from '../src/application/global/EmitGlobalInvoiceUseCase'
import type { EmitGlobalInvoiceDeps } from '../src/application/global/EmitGlobalInvoiceUseCase'
import type { IssuedCfdiRef } from '../src/domain/global/ports/IssuedCfdiLookup'
import type { Order } from '../src/domain/orders/Order'
import { formatGlobalRunReportEmail } from '../src/infrastructure/notifications/formatGlobalRunReportEmail'
import type { ReconcileReport } from '../src/application/global/ReconcileGlobalStampsUseCase'

const baseOrder: Order = {
  id: 'o1', orderNumber: '#1000', sourceIdentifier: 'long-2-1266',
  createdAt: '2026-10-15T12:00:00.000Z', currency: 'MXN', subtotal: 100,
  taxAmount: 16, total: 116, discountAmount: 0, shippingAmount: 0, lines: [],
  customerEmail: 'x@example.com', alreadyInvoiced: false, storeName: 'WB',
  refundedAmount: 0, financialStatus: 'PAID',
}
const global: IssuedCfdiRef = {
  facturamaId: 'g1', serie: 'GDL1', serieFolio: 'GDL1-1', active: true,
  rfc: 'XAXX010101000', date: '2026-10-31T21:04:00',
}

function setup(options: {
  globals?: IssuedCfdiRef[]
  items?: Record<string, string[]>
  orders?: Record<string, Order[]>
  series?: Record<string, string | undefined>
  dbIds?: string[]
  disabled?: boolean
  listFails?: boolean
  itemsFail?: string
  budgetMs?: number
  noItemsLookup?: boolean
  unresolvedIds?: string[]
} = {}) {
  const orders = options.orders ?? { WB: [baseOrder] }
  const listIssuedBetween = vi.fn(async () => {
    if (options.listFails) throw new Error('listing failed')
    return options.globals ?? []
  })
  const getItems = vi.fn(async (id: string) => {
    if (options.itemsFail === id) throw new Error('items failed')
    return options.items?.[id] ?? []
  })
  const emitirGlobal = vi.fn(async () => ({ facturamaId: 'new', uuidCfdi: 'uuid' }))
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const deps: EmitGlobalInvoiceDeps = {
    monthlyOrderSource: { listOrdersInRange: async ({ brandKey }) => ({ orders: (orders[brandKey] ?? []).map(order => ({ order, payments: [{ gateway: 'cash', amount: 116 }] })), nextCursor: null }) },
    globalStamping: { emitirGlobal },
    globalRepo: { listUnresolvedHeaders: async () => [], nextChunkIndex: async () => 0 } as unknown as EmitGlobalInvoiceDeps['globalRepo'],
    invoiceRepo: { createInvoice: vi.fn(), deleteByGlobalInvoiceId: vi.fn() },
    invoicedOrdersGateways: [{ listInvoicedOrderKeys: async () => ({ orderIds: new Set(options.dbIds ?? []), unresolvedOrderIds: new Set(options.unresolvedIds ?? []), orderReferences: new Set<string>() }) }],
    refundPolicy: { isFullyRefunded: () => false }, storeNames: Object.keys(orders),
    ...(!options.noItemsLookup ? { issuedCfdiItemsLookup: { getItems } } : {}),
    ...(!options.disabled ? { periodGlobalsCheck: { issuedCfdiLookup: { listIssuedBetween }, seriesByStore: options.series ?? { WB: 'gdl1' }, budgetMs: options.budgetMs ?? 60000 } } : {}),
    logger,
  }
  return { useCase: new EmitGlobalInvoiceUseCase(deps), listIssuedBetween, getItems, emitirGlobal, logger }
}

async function report(setupResult: ReturnType<typeof setup>, dryRun = true) {
  const result = await setupResult.useCase.execute({ year: 2026, month: 10, dryRun })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('Unexpected result')
  return result.value
}

describe('Facturama period globals check', () => {
  it('ignores a September stamp outside the October window', async () => {
    const checked = setup({ globals: [{ ...global, date: '2026-09-30T21:04:00' }], items: { g1: ['#1000 2-1266'] } })
    const result = await report(checked)
    expect(result.stores[0].facturamaGlobals.globals).toEqual([])
    expect(result.summary.dryRun).toBe(1)
    expect(checked.getItems).not.toHaveBeenCalled()
  })

  it('excludes an order found in an external global', async () => {
    const checked = setup({ globals: [global], items: { g1: ['#1000 2-1266'] } })
    const result = await report(checked, false)
    expect(result.stores[0].excludedAlreadyInvoiced.orders[0].matchedBy).toBe('facturama_global')
    expect(result.summary.chunks).toBe(0)
    expect(checked.emitirGlobal).not.toHaveBeenCalled()
  })

  it('excludes an own GLB global without DB membership', async () => {
    const result = await report(setup({ globals: [{ ...global, orderNumber: 'GLB:orphan' }], items: { g1: ['#1000 2-1266'] } }))
    expect(result.stores[0].excludedAlreadyInvoiced.orders[0].matchedBy).toBe('facturama_global')
  })

  it('compares series without case', async () => {
    const result = await report(setup({ globals: [global], items: { g1: ['#1000 2-1266'] } }))
    expect(result.stores[0].facturamaGlobals.status).toBe('checked')
    expect(result.stores[0].facturamaGlobals.checkedCfdis).toBe(1)
  })

  it('does not apply STET concepts to WB', async () => {
    const result = await report(setup({ globals: [{ ...global, serie: 'STET' }], series: { WB: 'gdl1', STET: 'STET' }, items: { g1: ['#1000 2-1266'] } }))
    expect(result.stores[0].facturamaGlobals.checkedCfdis).toBe(0)
    expect(result.summary.dryRun).toBe(1)
  })

  it('ignores cancelled globals', async () => {
    const result = await report(setup({ globals: [{ ...global, active: false }] }))
    expect(result.summary.dryRun).toBe(1)
  })

  it.each([undefined, 'UNKNOWN'])('blocks all stores for unattributable series %s', async serie => {
    const result = await report(setup({ globals: [{ ...global, serie }], orders: { WB: [baseOrder], STET: [{ ...baseOrder, id: 'o2' }] }, series: { WB: 'gdl1', STET: 'STET' } }))
    expect(result.stores.map(store => store.facturamaGlobals.status)).toEqual(['unattributable_global', 'unattributable_global'])
    expect(result.summary.chunks).toBe(0)
    expect(result.summary.hasFailures).toBe(true)
    expect(result.stores.every(store => store.unaccounted === 0)).toBe(true)
  })

  it('blocks all stores if the listing fails', async () => {
    const result = await report(setup({ listFails: true, orders: { WB: [baseOrder], STET: [{ ...baseOrder, id: 'o2' }] } }))
    expect(result.stores.map(store => store.facturamaGlobals.status)).toEqual(['unavailable', 'unavailable'])
    expect(result.summary.chunks).toBe(0)
  })

  it('does not expose provider error details in the report or logs', async () => {
    const checked = setup({ globals: [global], itemsFail: 'g1' })
    checked.getItems.mockRejectedValueOnce(new Error('secret-marker@example.com'))
    const result = await report(checked)
    expect(result.stores[0].facturamaGlobals.status).toBe('unavailable')
    expect(JSON.stringify({ result, logs: checked.logger.error.mock.calls })).not.toContain('secret-marker@example.com')
  })

  it('blocks only the store whose concepts fail', async () => {
    const result = await report(setup({ globals: [global], itemsFail: 'g1', orders: { WB: [baseOrder], STET: [{ ...baseOrder, id: 'o2' }] }, series: { WB: 'gdl1', STET: 'STET' } }))
    expect(result.stores.map(store => store.facturamaGlobals.status)).toEqual(['unavailable', 'checked'])
    expect(result.summary.dryRun).toBe(1)
  })

  it('blocks when the concept budget expires', async () => {
    vi.useFakeTimers()
    try {
      const checked = setup({ globals: [global], budgetMs: 100 })
      checked.getItems.mockImplementation(() => new Promise<string[]>(() => {}))
      const pending = report(checked)
      await vi.advanceTimersByTimeAsync(100)
      const result = await pending
      expect(result.stores[0].facturamaGlobals.reason).toBe('Presupuesto de conceptos agotado')
      expect(result.summary.chunks).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('blocks when the listing budget expires', async () => {
    vi.useFakeTimers()
    try {
      const checked = setup({ budgetMs: 100 })
      checked.listIssuedBetween.mockImplementation(() => new Promise<IssuedCfdiRef[]>(() => {}))
      const pending = report(checked)
      await vi.advanceTimersByTimeAsync(100)
      const result = await pending
      expect(result.stores[0].facturamaGlobals.reason).toBe('Presupuesto de verificación agotado')
      expect(result.summary.chunks).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('holds only ambiguous tail orders and emits the rest', async () => {
    const orders = [baseOrder, { ...baseOrder, id: 'o2', orderNumber: '#1001' }, { ...baseOrder, id: 'o3', orderNumber: '#1002', sourceIdentifier: 'long-3-9999' }]
    const result = await report(setup({ globals: [global], items: { g1: ['2-1266'] }, orders: { WB: orders } }))
    expect(result.summary.heldOrders).toBe(2)
    expect(result.summary.dryRun).toBe(1)
    expect(result.summary.hasFailures).toBe(true)
  })

  it('checks in dry run', async () => {
    const checked = setup({ globals: [global], items: { g1: ['#1000 2-1266'] } })
    await report(checked)
    expect(checked.listIssuedBetween).toHaveBeenCalledOnce()
    expect(checked.getItems).toHaveBeenCalledOnce()
  })

  it('preserves old behavior when disabled', async () => {
    const result = await report(setup({ disabled: true }))
    expect(result.stores[0].facturamaGlobals.status).toBe('disabled')
    expect(result.summary.dryRun).toBe(1)
  })

  it('keeps DB precedence while recording Facturama serie folios', async () => {
    const result = await report(setup({ globals: [global], items: { g1: ['#1000 2-1266'] }, dbIds: ['o1'] }))
    expect(result.stores[0].excludedAlreadyInvoiced.orders[0]).toMatchObject({ matchedBy: 'db', serieFolios: ['GDL1-1'] })
  })

  it('counts only Facturama-held orders when DB takes precedence', async () => {
    const orders = [baseOrder, { ...baseOrder, id: 'o2', orderNumber: '#1001' }]
    const result = await report(setup({ globals: [global], items: { g1: ['2-1266'] }, orders: { WB: orders }, dbIds: ['o1'] }))
    expect(result.stores[0].excludedAlreadyInvoiced.orders[0]).toMatchObject({ matchedBy: 'db', held: true, serieFolios: ['GDL1-1'] })
    expect(result.summary.heldOrders).toBe(1)
    expect(result.summary.hasFailures).toBe(true)
  })

  it('ignores an individual XAXX CFDI with an order number', async () => {
    const checked = setup({ globals: [{ ...global, orderNumber: '#1150' }] })
    const result = await report(checked)
    expect(result.stores[0].facturamaGlobals).toMatchObject({ status: 'checked', checkedCfdis: 0 })
    expect(checked.getItems).not.toHaveBeenCalled()
  })

  it('blocks a store without a configured serie', async () => {
    // Sin globales, unattributable_global no tiene prioridad sobre store_without_serie.
    const result = await report(setup({ globals: [], series: {} }))
    expect(result.stores[0].facturamaGlobals.status).toBe('store_without_serie')
  })

  it.each(['#47534', ''])('blocks an unrecognized concept %j', async concept => {
    const result = await report(setup({ globals: [global], items: { g1: [concept] } }))
    expect(result.stores[0].facturamaGlobals.status).toBe('unrecognized_concepts')
  })

  it('marks an invalid date permanent and excludes a rerun suggestion', async () => {
    const result = await report(setup({ globals: [{ ...global, date: 'bad-date' }] }), false)
    expect(result.stores[0].facturamaGlobals).toMatchObject({ status: 'unavailable', permanent: true, facturamaId: 'g1' })
    const email = formatGlobalRunReportEmail(result, { finishedAt: new Date(), minAgeMinutes: 10, cutoffHour: 21 })
    expect(email.text).toContain('Revisar el CFDI g1 en Facturama antes de volver a correr')
    expect(email.text).not.toContain('segunda corrida manual')
  })

  it('marks a missing RFC on an active CFDI permanent', async () => {
    const result = await report(setup({ globals: [{ ...global, rfc: undefined }] }))
    expect(result.stores[0].facturamaGlobals).toMatchObject({ status: 'unavailable', permanent: true, facturamaId: 'g1' })
  })

  it('marks a concept without IdentificationNumber permanent without leaking provider details', async () => {
    const checked = setup({ globals: [global] })
    const error = new Error('provider-secret')
    error.name = 'CfdiIdentificationNumberMissingError'
    checked.getItems.mockRejectedValueOnce(error)
    const result = await report(checked)
    expect(result.stores[0].facturamaGlobals).toMatchObject({ status: 'unavailable', permanent: true, facturamaId: 'g1', reason: 'Dato inválido en CFDI de Facturama' })
    expect(JSON.stringify(checked.logger.error.mock.calls)).not.toContain('provider-secret')
  })

  it('marks a missing IdentificationNumber permanent without exposing provider details', async () => {
    const checked = setup({ globals: [global] })
    const error = new Error('g1')
    error.name = 'CfdiIdentificationNumberMissingError'
    checked.getItems.mockRejectedValueOnce(error)
    const result = await report(checked)
    expect(result.stores[0].facturamaGlobals).toMatchObject({ status: 'unavailable', permanent: true, facturamaId: 'g1' })
    expect(JSON.stringify(checked.logger.error.mock.calls)).not.toContain('IdentificationNumber')
  })

  it.each([
    { active: false, rfc: 'XAXX010101000' },
    { active: true, rfc: 'AAA010101AAA' },
  ])('ignores irrelevant CFDIs with invalid dates: %j', async fields => {
    const result = await report(setup({ globals: [{ ...global, ...fields, date: 'bad-date' }] }))
    expect(result.stores[0].facturamaGlobals.status).toBe('checked')
    expect(result.summary.dryRun).toBe(1)
  })

  it('blocks when the concepts lookup is absent', async () => {
    const result = await report(setup({ globals: [global], noItemsLookup: true }))
    expect(result.stores[0].facturamaGlobals.status).toBe('unavailable')
  })

  it('handles a rejected cached concept promise when the order check reads it again', async () => {
    const checked = setup({ globals: [global], itemsFail: 'g1', unresolvedIds: ['o1'] })
    const reconcile: ReconcileReport = {
      decisions: [], counts: { confirm: 0, release: 0, wait: 0, alert_duplicate: 0, alert_cancelled: 0, alert_late_stamp: 0 },
      alerts: [], unexplainedGlobalsInPeriod: 1,
      unexplainedGlobals: [{ ...global }],
    }
    const result = await checked.useCase.execute({ year: 2026, month: 10, dryRun: true, reconcile })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.stores[0].facturamaGlobals.status).toBe('unavailable')
    expect(result.value.stores[0].orderCheck.unavailable).toBeTruthy()
    expect(checked.getItems).toHaveBeenCalledOnce()
  })
})
