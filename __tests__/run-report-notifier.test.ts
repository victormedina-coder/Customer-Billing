import { describe, it, expect } from 'vitest'
import { formatGlobalRunReportEmail } from '../src/infrastructure/notifications/formatGlobalRunReportEmail'
import { SmtpRunReportNotifier, type MailMessage } from '../src/infrastructure/notifications/SmtpRunReportNotifier'
import { shouldEmailRunReport } from '../src/application/global/RunReportEmailPolicy'
import type { GlobalRunReport, StoreReport } from '../src/application/global/EmitGlobalInvoiceUseCase'

function makeStore(overrides: Partial<StoreReport> = {}): StoreReport {
  return {
    store: 'ariat',
    orderCheck: { ran: false, truncated: false, checkedCfdis: 0, results: [] },
    enumerated: 1,
    eligible: 1,
    skippedNonPos: 0,
    partialRefunds: 0,
    skippedZeroTotal: 0,
    skippedUnpaid: { count: 0, orders: [] },
    skippedFullyRefunded: { count: 0, orders: [] },
    excludedAlreadyInvoiced: { count: 0, orders: [] },
    unresolvedHeaders: [],
    unmapped: { count: 0, orderIds: [] },
    buckets: [{
      bucket: 'efectivo',
      orders: 1,
      chunks: [{ chunkIndex: 0, itemCount: 1, outcome: 'emitted', uuid: 'uuid-abc', serieFolio: 'GDL1-7', excludedByRace: 0 }],
    }],
    unaccounted: 0,
    ...overrides,
  }
}

function makeReport(overrides: Partial<GlobalRunReport> = {}): GlobalRunReport {
  return {
    runId: 'run-1',
    year: 2026,
    month: 7,
    day: 23,
    dryRun: false,
    summary: {
      chunks: 1, emitted: 1, rolledBack: 0, rollbackFailed: 0, reservationFailed: 0, skippedIdempotent: 0, stampedUnconfirmed: 0,
      empty: 0, dryRun: 0, ordersEligible: 1, unresolvedOrders: 0, unresolvedHeaders: 0, unmapped: 0, unaccounted: 0, skippedUnpaid: 0, orderCheckFound: 0, orderCheckNotFound: 0, orderCheckAmbiguous: 0, hasFailures: false,
    },
    stores: [makeStore()],
    ...overrides,
  }
}

describe('formatGlobalRunReportEmail', () => {
  it('abre con segunda corrida manual, hora del último header y límite 24 h tras el corte', () => {
    const ariat = makeStore({
      unresolvedHeaders: [
        { storeName: 'ariat', bucket: 'efectivo', chunkIndex: 1, status: 'stamped_unconfirmed', createdAt: new Date('2026-07-24T01:00:00Z'), itemCount: 1 },
        { storeName: 'ariat', bucket: 'efectivo', chunkIndex: 2, status: 'pending', createdAt: new Date('2026-07-24T02:00:00Z'), itemCount: 1 },
      ],
    })
    const stetson = makeStore({ store: 'stetson', buckets: [{ bucket: 'efectivo', orders: 2, chunks: [{ chunkIndex: 0, itemCount: 2, outcome: 'rolled_back' }] }] })
    const { text } = formatGlobalRunReportEmail(makeReport({ stores: [ariat, stetson] }), { finishedAt: new Date('2026-07-24T02:05:00Z'), minAgeMinutes: 30, cutoffHour: 21 })
    expect(text).toMatch(/^Acción requerida: segunda corrida manual/)
    expect(text).toContain('20:30')
    expect(text).toContain('2026-07-24 21:00')
    expect(text).toContain('{"year":2026,"month":7,"storeName":"ariat"}')
    expect(text).toContain('{"year":2026,"month":7,"storeName":"stetson"}')
    expect(text).toContain('{"year":2026,"month":7}')
    expect(text).toContain('No usar relative: current-month: después de medianoche resuelve al mes siguiente.')
    expect(text).toContain('"dryRun": true')
  })

  it('mensual julio: usa el header creado después de medianoche MX y el corte de fin de mes', () => {
    const store = makeStore({
      unresolvedHeaders: [{ storeName: 'ariat', bucket: 'efectivo', chunkIndex: 1, status: 'pending', createdAt: new Date('2026-08-01T06:20:00Z'), itemCount: 1 }],
    })
    const { text } = formatGlobalRunReportEmail(makeReport({ day: undefined, stores: [store] }), {
      finishedAt: new Date('2026-08-01T06:25:00Z'), minAgeMinutes: 30, cutoffHour: 21,
    })
    expect(text).toContain('Hora más temprana: 2026-08-01 00:50 MX')
    expect(text).toContain('Límite: 2026-08-01 21:00 MX')
    expect(text).toContain('{"year":2026,"month":7,"storeName":"ariat"}')
  })

  it('mensual diciembre: cruza al año siguiente en el límite', () => {
    const store = makeStore({ buckets: [{ bucket: 'efectivo', orders: 1, chunks: [{ chunkIndex: 0, itemCount: 1, outcome: 'rolled_back' }] }] })
    const { text } = formatGlobalRunReportEmail(makeReport({ day: undefined, month: 12, stores: [store] }), {
      finishedAt: new Date('2027-01-01T05:00:00Z'), minAgeMinutes: 30, cutoffHour: 21,
    })
    expect(text).toContain('Límite: 2027-01-01 21:00 MX')
    expect(text).toContain('{"year":2026,"month":12,"storeName":"ariat"}')
  })

  it('respeta la hora de corte configurada en periodos diario y mensual', () => {
    const store = makeStore({ buckets: [{ bucket: 'efectivo', orders: 1, chunks: [{ chunkIndex: 0, itemCount: 1, outcome: 'rolled_back' }] }] })
    const context = { finishedAt: new Date('2026-07-24T03:00:00Z'), minAgeMinutes: 30, cutoffHour: 22 }
    expect(formatGlobalRunReportEmail(makeReport({ stores: [store] }), context).text).toContain('Límite: 2026-07-24 22:00 MX')
    expect(formatGlobalRunReportEmail(makeReport({ day: undefined, stores: [store] }), context).text).toContain('Límite: 2026-08-01 22:00 MX')
  })

  it('considera pendiente un header sin membresías', () => {
    const store = makeStore({
      buckets: [],
      unresolvedHeaders: [{ storeName: 'ariat', bucket: 'efectivo', chunkIndex: 1, status: 'pending', createdAt: new Date('2026-08-01T06:20:00Z'), itemCount: 0 }],
    })
    const { text } = formatGlobalRunReportEmail(makeReport({ day: undefined, stores: [store] }), {
      finishedAt: new Date('2026-08-01T06:25:00Z'), minAgeMinutes: 30, cutoffHour: 21,
    })
    expect(text).toContain('Acción requerida: segunda corrida manual')
    expect(text).toContain('Hora más temprana: 2026-08-01 00:50 MX')
  })

  it('no propone otra corrida ante alertas puras de conciliación', () => {
    const report = makeReport({
      day: undefined,
      reconcile: {
        unexplainedGlobals: [{ facturamaId: 'manual-1', active: true, rfc: 'XAXX010101000', serieFolio: 'G-7', total: 120, date: '2026-07-31' }],
        unexplainedGlobalsInPeriod: 1,
        counts: { confirm: 0, release: 0, wait: 0, alert_duplicate: 1, alert_cancelled: 0, alert_late_stamp: 0 },
        alerts: [],
        decisions: [{ headerId: 'h1', store: 'ariat', period: '2026-07', bucket: 'efectivo', chunkIndex: 1, status: 'stamped_unconfirmed', decision: 'alert_duplicate', reason: 'dos CFDI', matches: [] }],
      },
    })
    const { text } = formatGlobalRunReportEmail(report, { finishedAt: new Date('2026-08-01T04:00:00Z'), minAgeMinutes: 30, cutoffHour: 21 })
    expect(text).not.toContain('Acción requerida: segunda corrida manual')
  })

  it('omite la segunda corrida manual cuando no hay pendientes o es dryRun', () => {
    const context = { finishedAt: new Date('2026-07-24T03:55:00Z'), minAgeMinutes: 30, cutoffHour: 21 }
    expect(formatGlobalRunReportEmail(makeReport(), context).text).not.toContain('Acción requerida: segunda corrida manual')
    const store = makeStore({ buckets: [{ bucket: 'efectivo', orders: 1, chunks: [{ chunkIndex: 0, itemCount: 1, outcome: 'reservation_failed' }] }] })
    expect(formatGlobalRunReportEmail(makeReport({ dryRun: true, stores: [store] }), context).text).not.toContain('Acción requerida: segunda corrida manual')
  })

  it('usa la hora de fin cuando los pendientes no tienen headers', () => {
    const store = makeStore({
      buckets: [{ bucket: 'efectivo', orders: 1, chunks: [{ chunkIndex: 0, itemCount: 1, outcome: 'skipped_idempotent' }] }],
    })
    const { text } = formatGlobalRunReportEmail(makeReport({ stores: [store] }), { finishedAt: new Date('2026-07-24T03:55:00Z'), minAgeMinutes: 30, cutoffHour: 21 })
    expect(text).toContain('Acción requerida: segunda corrida manual')
    expect(text).toContain('22:25')
  })

  it('incluye pedidos db_unresolved y respeta la edad configurada', () => {
    const store = makeStore({
      buckets: [],
      excludedAlreadyInvoiced: { count: 1, orders: [{ orderId: 'o-1', reference: '#1', matchedBy: 'db_unresolved' }] },
    })
    const { text } = formatGlobalRunReportEmail(makeReport({ stores: [store] }), { finishedAt: new Date('2026-07-24T03:55:00Z'), minAgeMinutes: 45, cutoffHour: 21 })
    expect(text).toContain('Acción requerida: segunda corrida manual')
    expect(text).toContain('22:40')
    expect(text).toContain('{"year":2026,"month":7,"storeName":"ariat"}')
  })

  it('explains shared receipt tails in the informational order check', () => {
    const store = makeStore({ orderCheck: { ran: true, truncated: false, checkedCfdis: 1, results: [{
      orderId: 'o1', reference: '#1000 2-1266', tail: '2-1266',
      foundIn: [{ facturamaId: 'cfdi-1', serieFolio: 'G-1' }],
      ambiguous: true, ambiguityReason: 'shared_tail', sharedTailOrderCount: 2,
    }] } })
    const { text } = formatGlobalRunReportEmail(makeReport({ stores: [store] }))
    expect(text).toContain('AMBIGUO')
    expect(text).toContain('misma cola en 2 pedidos')
    expect(text).toContain('posible devolución/cambio sobre el mismo ticket')
    expect(text).not.toContain('#1000 2-1266: APARECE')
  })
  it('muestra conciliación, espera y alertas con acción contable', () => {
    const report = makeReport({
      reconcile: {
        unexplainedGlobals: [{ facturamaId: 'manual-1', active: true, rfc: 'XAXX010101000', serieFolio: 'G-7', total: 120, date: '2026-07-31' }],
        unexplainedGlobalsInPeriod: 1,
        counts: { confirm: 1, release: 1, wait: 1, alert_duplicate: 1, alert_cancelled: 0, alert_late_stamp: 0 },
        alerts: [],
        decisions: [
          { headerId: 'h1', store: 'ariat', period: '2026-07', bucket: 'efectivo', chunkIndex: 0, status: 'stamped_unconfirmed', decision: 'confirm', reason: 'encontrado', matches: [] },
          { headerId: 'h2', store: 'ariat', period: '2026-07', bucket: 'efectivo', chunkIndex: 1, status: 'stamped_unconfirmed', decision: 'release', reason: 'sin timbrado', matches: [] },
          { headerId: 'h3', store: 'ariat', period: '2026-07', bucket: 'efectivo', chunkIndex: 2, status: 'stamped_unconfirmed', decision: 'wait', reason: 'listado incompleto', matches: [] },
          { headerId: 'h4', store: 'ariat', period: '2026-07', bucket: 'efectivo', chunkIndex: 3, status: 'stamped_unconfirmed', decision: 'alert_duplicate', reason: 'dos CFDI', matches: [] },
        ],
      },
    })
    const { text } = formatGlobalRunReportEmail(report)
    expect(text).toContain('CONCILIACIÓN')
    expect(text).toContain('Confirmados: 1')
    expect(text).toContain('Liberados: 1')
    expect(text).toContain('Globales no explicadas del periodo: 1')
    expect(text).toContain('manual-1')
    expect(text).toContain('listado incompleto')
    expect(text).toContain('alert_duplicate')
    expect(text).toContain('decidir la cancelación con contabilidad')
  })
  it('identifica pedidos y headers bloqueados y exige conciliación previa', () => {
    const store = makeStore({
      excludedAlreadyInvoiced: { count: 1, orders: [{ orderId: 'gid-1', reference: '#1 2-1', matchedBy: 'db_unresolved' }] },
      unresolvedHeaders: [{ storeName: 'ariat', bucket: 'efectivo', chunkIndex: 2, status: 'stamped_unconfirmed', createdAt: new Date('2026-07-23T21:00:00Z'), itemCount: 1 }],
    })
    const { text } = formatGlobalRunReportEmail(makeReport({ stores: [store], summary: { ...makeReport().summary, unresolvedOrders: 1, unresolvedHeaders: 1, hasFailures: true } }))
    expect(text).toContain('PEDIDOS BLOQUEADOS SIN CONFIRMAR TIMBRADO')
    expect(text).toContain('chunk 2 / stamped_unconfirmed / 1 pedido(s)')
    expect(text).toContain('gid-1')
    expect(text).toContain('Conciliar en Facturama antes de liberar')
    expect(text).not.toContain('Ninguno ✅')
  })
  it('header pending sin membresías indica cuándo se puede borrar manualmente', () => {
    const store = makeStore({
      buckets: [],
      unresolvedHeaders: [{ storeName: 'ariat', bucket: 'efectivo', chunkIndex: 2, status: 'pending', createdAt: new Date('2026-07-23T21:00:00Z'), itemCount: 0 }],
    })
    const { text } = formatGlobalRunReportEmail(makeReport({ stores: [store], summary: { ...makeReport().summary, unresolvedHeaders: 1, hasFailures: true } }))
    expect(text).toContain('invoices')
    expect(text).toContain('global_invoice_id')
    expect(text).toContain('borrar')
    expect(text).not.toContain('Ninguno ✅')
  })
  it('separa rollback fallido y reserva fallida sin prometer liberación por TTL', () => {
    const store = makeStore({ buckets: [{ bucket: 'efectivo', orders: 2, chunks: [
      { chunkIndex: 0, itemCount: 1, outcome: 'rollback_failed', error: 'DB down' },
      { chunkIndex: 1, itemCount: 1, outcome: 'reservation_failed', error: 'DB down' },
    ] }] })
    const report = makeReport({ stores: [store], summary: { ...makeReport().summary, rollbackFailed: 1, reservationFailed: 1, hasFailures: true } })
    const { text } = formatGlobalRunReportEmail(report)
    expect(text).toContain('Facturama no timbró')
    expect(text).toContain('Limpiar header y membresías en BD')
    expect(text).toContain('falló la reserva antes de llamar a Facturama')
    expect(text).toContain('Se liberaron el header y las membresías')
  })
  it('veredicto ✅, desglose y folio+UUID de auditoría en el cuerpo', () => {
    const { subject, text, html } = formatGlobalRunReportEmail(makeReport())
    expect(subject).toContain('✅')
    expect(subject).toContain('23 Julio 2026')
    expect(text).toContain('Veredicto: OK')
    expect(text).toContain('1 pedido')
    expect(text).toContain('GDL1-7')
    expect(text).toContain('uuid-abc')
    expect(html).toContain('<pre')
  })

  it('el asunto DIARIO trae el día; el MENSUAL el mes en palabras', () => {
    expect(formatGlobalRunReportEmail(makeReport()).subject).toContain('23 Julio 2026')
    expect(formatGlobalRunReportEmail(makeReport({ day: undefined })).subject).toContain('Julio 2026')
    expect(formatGlobalRunReportEmail(makeReport({ day: undefined })).subject).not.toContain('undefined')
  })

  it('veredicto 🔴 cuando hasFailures', () => {
    const { subject } = formatGlobalRunReportEmail(
      makeReport({ summary: { ...makeReport().summary, hasFailures: true } }),
    )
    expect(subject).toContain('🔴')
  })

  it('lista las excepciones de no-pagados con su estado', () => {
    const store = makeStore({
      skippedUnpaid: { count: 1, orders: [{ orderId: 'x', reference: '#100 1-1', financialStatus: 'PENDING' }] },
    })
    const { text } = formatGlobalRunReportEmail(makeReport({ stores: [store] }))
    expect(text).toContain('No pagados: 1')
    expect(text).toContain('#100 1-1')
    expect(text).toContain('PENDING')
  })

  it('marca el simulacro en el asunto', () => {
    const { subject } = formatGlobalRunReportEmail(makeReport({ dryRun: true }))
    expect(subject).toContain('[SIMULACRO]')
  })
})

describe('formatGlobalRunReportEmail — totales de PEDIDOS (no CFDIs)', () => {
  // 3 marcas × 3 buckets = 9 CFDIs pero 50 PEDIDOS. El correo debe contar
  // pedidos (Σ itemCount de chunks emitidos), NO summary.emitted (= 9 CFDIs).
  function billedStore(store: string, ef: number, cr: number, de: number): StoreReport {
    return makeStore({
      store,
      buckets: [
        { bucket: 'efectivo', orders: ef, chunks: [{ chunkIndex: 0, itemCount: ef, outcome: 'emitted', uuid: `u-${store}-ef`, serieFolio: `${store}-1`, excludedByRace: 0 }] },
        { bucket: 'credito', orders: cr, chunks: [{ chunkIndex: 0, itemCount: cr, outcome: 'emitted', uuid: `u-${store}-cr`, serieFolio: `${store}-2`, excludedByRace: 0 }] },
        { bucket: 'debito', orders: de, chunks: [{ chunkIndex: 0, itemCount: de, outcome: 'emitted', uuid: `u-${store}-de`, serieFolio: `${store}-3`, excludedByRace: 0 }] },
      ],
    })
  }

  const report = makeReport({
    day: undefined,
    summary: { chunks: 9, emitted: 9, rolledBack: 0, rollbackFailed: 0, reservationFailed: 0, skippedIdempotent: 0, stampedUnconfirmed: 0, empty: 0, dryRun: 0, ordersEligible: 50, unresolvedOrders: 0, unresolvedHeaders: 0, unmapped: 0, unaccounted: 0, skippedUnpaid: 0, orderCheckFound: 0, orderCheckNotFound: 0, orderCheckAmbiguous: 0, hasFailures: false },
    stores: [billedStore('western-brothers', 3, 12, 5), billedStore('stetson', 8, 9, 3), billedStore('ariat', 2, 6, 2)],
  })

  it('el asunto cuenta 50 PEDIDOS, no 9 CFDIs', () => {
    const { subject } = formatGlobalRunReportEmail(report)
    expect(subject).toContain('50 pedidos facturados')
    expect(subject).not.toContain('9 pedidos')
  })

  it('desglosa pedidos por marca y forma de pago', () => {
    const { text } = formatGlobalRunReportEmail(report)
    expect(text).toContain('Western Brothers')
    expect(text).toContain('20 pedidos')
    expect(text).toContain('efectivo  3 · crédito 12 · débito  5')
    expect(text).toContain('Stetson')
    expect(text).toContain('Ariat')
    expect(text).toContain('Pedidos facturados')
  })
})

describe('formatGlobalRunReportEmail — excluidos, errores e idempotencia', () => {
  it('muestra los ya facturados (excluidos) con total y por marca', () => {
    const store = makeStore({ store: 'ariat', buckets: [], excludedAlreadyInvoiced: { count: 8, orders: [] } })
    const { text } = formatGlobalRunReportEmail(makeReport({ day: undefined, stores: [store] }))
    expect(text).toContain('Total 8')
    expect(text).toContain('Ariat 8')
  })

  it('reporta un CFDI fallido por grupo (marca/forma de pago) con el motivo', () => {
    const store = makeStore({
      store: 'ariat',
      buckets: [{ bucket: 'credito', orders: 45, chunks: [{ chunkIndex: 0, itemCount: 45, outcome: 'rolled_back', error: 'Base x Rate != Total', excludedByRace: 0 }] }],
    })
    const summary = { ...makeReport().summary, hasFailures: true, rolledBack: 1 }
    const { subject, text } = formatGlobalRunReportEmail(makeReport({ day: undefined, summary, stores: [store] }))
    expect(subject).toContain('🔴')
    expect(text).toContain('45 pedido(s) NO se facturaron')
    expect(text).toContain('Ariat / crédito — 45 pedidos — "Base x Rate != Total"')
    expect(text).not.toContain('los ya facturados no se duplican')
  })

  it('ante timbrado incierto advierte que puede existir el CFDI y prohíbe reintentar', () => {
    const store = makeStore({
      store: 'ariat',
      buckets: [{ bucket: 'credito', orders: 250, chunks: [{ chunkIndex: 0, itemCount: 250, outcome: 'stamped_unconfirmed', error: 'The operation was aborted due to timeout', excludedByRace: 0 }] }],
    })
    const summary = { ...makeReport().summary, hasFailures: true, stampedUnconfirmed: 1 }
    const { text } = formatGlobalRunReportEmail(makeReport({ day: undefined, summary, stores: [store] }))
    expect(text).toContain('pueden estar facturados')
    expect(text).toContain('NO reintentar')
    expect(text).not.toContain('The operation was aborted due to timeout')
    expect(text).not.toContain('250 pedido(s) NO se facturaron')
  })

  it('colisión de header con pedidos se reporta como fallo pendiente', () => {
    const store = makeStore({
      store: 'ariat',
      buckets: [{ bucket: 'efectivo', orders: 10, chunks: [{ chunkIndex: 0, itemCount: 10, outcome: 'skipped_idempotent', excludedByRace: 0 }] }],
    })
    const { subject, text } = formatGlobalRunReportEmail(makeReport({ day: undefined, stores: [store], summary: { ...makeReport().summary, skippedIdempotent: 1, hasFailures: true } }))
    expect(subject).toContain('0 pedidos facturados')
    expect(text).toContain('quedaron sin timbrar por colisión de header')
  })
})

describe('SmtpRunReportNotifier', () => {
  it('envía con el from/to configurado y un asunto no vacío', async () => {
    const sent: MailMessage[] = []
    const fakeTransport = { sendMail: async (m: MailMessage) => { sent.push(m); return {} } }
    const notifier = new SmtpRunReportNotifier(fakeTransport, { from: 'a@1522.mx', to: 'b@1522.mx', minAgeMinutes: 30, cutoffHour: 21 })

    await notifier.notify(makeReport())

    expect(sent).toHaveLength(1)
    expect(sent[0].from).toBe('a@1522.mx')
    expect(sent[0].to).toBe('b@1522.mx')
    expect(sent[0].subject.length).toBeGreaterThan(0)
    expect(sent[0].html).toContain('<h2')
  })

  it('propaga el error del transport (el route es quien lo captura)', async () => {
    const failing = { sendMail: async () => { throw new Error('smtp caído') } }
    const notifier = new SmtpRunReportNotifier(failing, { from: 'a@1522.mx', to: 'b@1522.mx', minAgeMinutes: 30, cutoffHour: 21 })
    await expect(notifier.notify(makeReport())).rejects.toThrow('smtp caído')
  })
})

describe('shouldEmailRunReport', () => {
  it('mensual: siempre envía, aunque esté todo limpio', () => {
    expect(shouldEmailRunReport(makeReport({ day: undefined }))).toBe(true)
  })

  it('diaria limpia: TAMBIÉN envía (decisión finanzas 2026-08-03: siempre)', () => {
    expect(shouldEmailRunReport(makeReport())).toBe(true)
  })

  it('diaria con fallos: envía', () => {
    expect(shouldEmailRunReport(makeReport({ summary: { ...makeReport().summary, hasFailures: true } }))).toBe(true)
  })

  it('diaria con un POS sin pagar: envía (aunque no sea hasFailures)', () => {
    const store = makeStore({ skippedUnpaid: { count: 1, orders: [{ orderId: 'x', reference: '#1', financialStatus: 'PENDING' }] } })
    expect(shouldEmailRunReport(makeReport({ stores: [store] }))).toBe(true)
  })
})
