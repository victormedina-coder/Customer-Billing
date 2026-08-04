import { describe, it, expect } from 'vitest'
import { formatGlobalRunReportEmail } from '../src/infrastructure/notifications/formatGlobalRunReportEmail'
import { SmtpRunReportNotifier, type MailMessage } from '../src/infrastructure/notifications/SmtpRunReportNotifier'
import { shouldEmailRunReport } from '../src/application/global/RunReportEmailPolicy'
import type { GlobalRunReport, StoreReport } from '../src/application/global/EmitGlobalInvoiceUseCase'

function makeStore(overrides: Partial<StoreReport> = {}): StoreReport {
  return {
    store: 'ariat',
    enumerated: 1,
    eligible: 1,
    skippedNonPos: 0,
    partialRefunds: 0,
    skippedZeroTotal: 0,
    skippedUnpaid: { count: 0, orders: [] },
    skippedFullyRefunded: { count: 0, orders: [] },
    excludedAlreadyInvoiced: { count: 0, orders: [] },
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
      chunks: 1, emitted: 1, rolledBack: 0, skippedIdempotent: 0, stampedUnconfirmed: 0,
      empty: 0, dryRun: 0, ordersEligible: 1, unmapped: 0, unaccounted: 0, skippedUnpaid: 0, hasFailures: false,
    },
    stores: [makeStore()],
    ...overrides,
  }
}

describe('formatGlobalRunReportEmail', () => {
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
    summary: { chunks: 9, emitted: 9, rolledBack: 0, skippedIdempotent: 0, stampedUnconfirmed: 0, empty: 0, dryRun: 0, ordersEligible: 50, unmapped: 0, unaccounted: 0, skippedUnpaid: 0, hasFailures: false },
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
  })

  it('caso idempotente: 0 pedidos nuevos y nota explicativa (no lo trata como error)', () => {
    const store = makeStore({
      store: 'ariat',
      buckets: [{ bucket: 'efectivo', orders: 10, chunks: [{ chunkIndex: 0, itemCount: 10, outcome: 'skipped_idempotent', excludedByRace: 0 }] }],
    })
    const { subject, text } = formatGlobalRunReportEmail(makeReport({ day: undefined, stores: [store] }))
    expect(subject).toContain('0 pedidos facturados')
    expect(text).toContain('idempotencia')
    expect(text).toContain('no facturó nada nuevo')
  })
})

describe('SmtpRunReportNotifier', () => {
  it('envía con el from/to configurado y un asunto no vacío', async () => {
    const sent: MailMessage[] = []
    const fakeTransport = { sendMail: async (m: MailMessage) => { sent.push(m); return {} } }
    const notifier = new SmtpRunReportNotifier(fakeTransport, { from: 'a@1522.mx', to: 'b@1522.mx' })

    await notifier.notify(makeReport())

    expect(sent).toHaveLength(1)
    expect(sent[0].from).toBe('a@1522.mx')
    expect(sent[0].to).toBe('b@1522.mx')
    expect(sent[0].subject.length).toBeGreaterThan(0)
    expect(sent[0].html).toContain('<h2')
  })

  it('propaga el error del transport (el route es quien lo captura)', async () => {
    const failing = { sendMail: async () => { throw new Error('smtp caído') } }
    const notifier = new SmtpRunReportNotifier(failing, { from: 'a@1522.mx', to: 'b@1522.mx' })
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
