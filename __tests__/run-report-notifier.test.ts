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
  it('veredicto ✅ y folio+uuid en el cuerpo cuando no hay fallos', () => {
    const { subject, text, html } = formatGlobalRunReportEmail(makeReport())
    expect(subject).toContain('✅')
    expect(subject).toContain('2026-07-23')
    expect(text).toContain('GDL1-7')
    expect(text).toContain('uuid-abc')
    expect(html).toContain('<pre')
  })

  it('el asunto DIARIO trae el día; el MENSUAL solo año-mes', () => {
    expect(formatGlobalRunReportEmail(makeReport()).subject).toContain('2026-07-23')
    expect(formatGlobalRunReportEmail(makeReport({ day: undefined })).subject).toContain('2026-07 ')
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

  it('diaria limpia: NO envía', () => {
    expect(shouldEmailRunReport(makeReport())).toBe(false)
  })

  it('diaria con fallos: envía', () => {
    expect(shouldEmailRunReport(makeReport({ summary: { ...makeReport().summary, hasFailures: true } }))).toBe(true)
  })

  it('diaria con un POS sin pagar: envía (aunque no sea hasFailures)', () => {
    const store = makeStore({ skippedUnpaid: { count: 1, orders: [{ orderId: 'x', reference: '#1', financialStatus: 'PENDING' }] } })
    expect(shouldEmailRunReport(makeReport({ stores: [store] }))).toBe(true)
  })
})
