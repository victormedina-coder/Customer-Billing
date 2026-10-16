import { decideReconciliation } from '../../domain/global/decideReconciliation'
import type { ReconciliationDecision } from '../../domain/global/decideReconciliation'
import type { GlobalInvoiceRepository, ReconciliationHeader } from '../../domain/global/ports/GlobalInvoiceRepository'
import type { IssuedCfdiLookup, IssuedCfdiRef } from '../../domain/global/ports/IssuedCfdiLookup'
import type { Logger } from '../../domain/shared/ports/Logger'
import { findUnexplainedGlobals } from '../../domain/global/findUnexplainedGlobals'
import { mxMonthStart } from '../../domain/shared/MxCalendar'
import { globalCorrelationKey, normalizeGlobalCorrelationKey } from '../../domain/global/globalCorrelationKey'

export interface ReconcileDecisionReport {
  headerId: string
  store: string
  period: string
  bucket: string
  chunkIndex: number
  status: ReconciliationHeader['status']
  decision: ReconciliationDecision
  reason: string
  matches: IssuedCfdiRef[]
}

export interface ReconcileReport {
  failed?: boolean
  decisions: ReconcileDecisionReport[]
  counts: Record<ReconciliationDecision, number>
  alerts: ReconcileDecisionReport[]
  unexplainedGlobals: IssuedCfdiRef[]
  unexplainedGlobalsInPeriod: number
}

interface Dependencies {
  repo: Pick<GlobalInvoiceRepository, 'listForReconciliation' | 'listAllGlobalFacturamaIds' | 'listEmittedHeaderIds' | 'listEmittedFacturamaIdsBetween' | 'releaseHeader' | 'confirmHeader'>
  lookup: IssuedCfdiLookup
  logger: Logger
  minAgeMinutes: number
  now?: () => Date
}

const alertDecisions = new Set<ReconciliationDecision>(['alert_duplicate', 'alert_cancelled', 'alert_late_stamp'])

function emptyReport(): ReconcileReport {
  return {
    decisions: [],
    counts: { confirm: 0, release: 0, wait: 0, alert_duplicate: 0, alert_cancelled: 0, alert_late_stamp: 0 },
    alerts: [],
    unexplainedGlobals: [],
    unexplainedGlobalsInPeriod: 0,
  }
}

function waitReport(header: ReconciliationHeader, reason: string): ReconcileDecisionReport {
  return {
    headerId: header.id,
    store: header.storeName,
    period: `${header.periodYear}-${String(header.periodMonth).padStart(2, '0')}${header.periodDay === undefined ? '' : `-${String(header.periodDay).padStart(2, '0')}`}`,
    bucket: header.paymentBucket,
    chunkIndex: header.chunkIndex,
    status: header.status,
    decision: 'wait',
    reason,
    matches: [],
  }
}

export class ReconcileGlobalStampsUseCase {
  constructor(private readonly deps: Dependencies) {}

  async execute(input: { runId: string; apply: boolean; period?: { year: number; month: number } }): Promise<ReconcileReport> {
    const report = emptyReport()
    let headers: ReconciliationHeader[] = []
    try {
      const now = this.deps.now?.() ?? new Date()
      headers = await this.deps.repo.listForReconciliation(now)
      if (headers.length === 0 && !input.period) return report

      const periodStart = input.period ? mxMonthStart(input.period.year, input.period.month).getTime() : Infinity
      const earliest = Math.min(periodStart, ...headers.map(header => header.createdAt.getTime()))
      const from = new Date(earliest - 24 * 60 * 60 * 1000)
      const to = new Date(now.getTime() + 24 * 60 * 60 * 1000)
      const items = await this.deps.lookup.listIssuedBetween(from, to)
      const [emittedIds, knownIds, emittedHeaderIds] = await Promise.all([
        this.deps.repo.listEmittedFacturamaIdsBetween(from, to),
        this.deps.repo.listAllGlobalFacturamaIds(),
        this.deps.repo.listEmittedHeaderIds(),
      ])
      const knownKeys = new Set([...headers.map(header => header.correlationKey), ...emittedHeaderIds.map(globalCorrelationKey)].map(normalizeGlobalCorrelationKey).filter((key): key is string => key !== undefined))
      report.unexplainedGlobals = findUnexplainedGlobals(items, new Set(knownIds), knownKeys)
      if (input.period) {
        const monthPrefix = `${input.period.year}-${String(input.period.month).padStart(2, '0')}`
        report.unexplainedGlobalsInPeriod = report.unexplainedGlobals.filter(item =>
          !item.date || item.date.startsWith(monthPrefix),
        ).length
      }
      for (const item of report.unexplainedGlobals) {
        this.deps.logger.error({ runId: input.runId, facturamaId: item.facturamaId, serieFolio: item.serieFolio, total: item.total, date: item.date, orderNumber: item.orderNumber }, normalizeGlobalCorrelationKey(item.orderNumber) ? '[global-reconcile] Llave GLB huérfana' : '[global-reconcile] Global ajena sin explicar en la ventana')
      }
      const listedIds = new Set(items.map(item => item.facturamaId))
      const hasRfc = items.some(item => Boolean(item.rfc))
      if (items.length > 0 && !hasRfc) this.deps.logger.error({ runId: input.runId, itemCount: items.length }, '[global-reconcile] Listado sin Rfc: veto inoperante')
      const listingHealthy = items.length > 0 && hasRfc && emittedIds.every(id => listedIds.has(id))

      for (const header of headers) {
        const normalizedKey = normalizeGlobalCorrelationKey(header.correlationKey)
        const matches = items.filter(item => (normalizedKey !== undefined && (normalizeGlobalCorrelationKey(item.correlationKey) === normalizedKey || normalizeGlobalCorrelationKey(item.orderNumber) === normalizedKey)) || (header.facturamaId !== null && item.facturamaId === header.facturamaId))
        if (header.status === 'released' && !matches.some(item => item.active)) continue
        const result = decideReconciliation(header, matches, { now, minAgeMinutes: this.deps.minAgeMinutes, listingHealthy, unexplainedGlobals: report.unexplainedGlobals.length })
        const decision: ReconcileDecisionReport = { ...waitReport(header, result.reason), decision: result.decision, matches }
        const activeMatch = matches.find(item => item.active && item.facturamaId === header.facturamaId) ?? matches.find(item => item.active)
        if (decision.decision === 'confirm' && !activeMatch?.uuid) {
          decision.decision = 'wait'
          decision.reason = 'CFDI activo sin UUID en el listado; conciliar a mano'
        }

        try {
          if (input.apply && decision.decision === 'release') {
            if (await this.deps.repo.releaseHeader(header.id) === 'already_applied') decision.reason = 'Decisión ya aplicada: released'
          }
          if (input.apply && decision.decision === 'confirm') {
            if (!activeMatch?.uuid) throw new Error('CFDI activo sin UUID')
            if (await this.deps.repo.confirmHeader(header.id, { facturamaId: activeMatch.facturamaId, uuidCfdi: activeMatch.uuid }) === 'already_applied') decision.reason = 'Decisión ya aplicada: emitted'
          }
        } catch (error) {
          report.failed = true
          this.deps.logger.error({ runId: input.runId, headerId: header.id, store: header.storeName, period: decision.period, bucket: header.paymentBucket, chunkIndex: header.chunkIndex, error }, '[global-reconcile] Error al aplicar decisión')
          decision.decision = 'wait'
          decision.reason = 'Falló la escritura de conciliación; revisar logs'
        }

        this.add(report, decision)
        this.deps.logger.info({ runId: input.runId, headerId: header.id, store: header.storeName, period: decision.period, bucket: header.paymentBucket, chunkIndex: header.chunkIndex, decision: decision.decision, apply: input.apply }, '[global-reconcile] Decisión de conciliación')
      }
    } catch (error) {
      report.failed = true
      this.deps.logger.error({ runId: input.runId, error }, '[global-reconcile] Falló la consulta de conciliación')
      for (const header of headers) this.add(report, waitReport(header, 'Error al consultar el listado o canario; conciliar a mano'))
    }
    return report
  }

  private add(report: ReconcileReport, decision: ReconcileDecisionReport): void {
    report.decisions.push(decision)
    report.counts[decision.decision]++
    if (alertDecisions.has(decision.decision)) report.alerts.push(decision)
  }
}
