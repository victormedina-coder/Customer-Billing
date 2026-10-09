import { ReconcileGlobalStampsUseCase } from '../application/global/ReconcileGlobalStampsUseCase'
import { DrizzleGlobalInvoiceRepository } from '../infrastructure/db/DrizzleGlobalInvoiceRepository'
import { FacturamaIssuedCfdiLookup } from '../infrastructure/facturama/FacturamaIssuedCfdiLookup'
import { logger } from '../infrastructure/observability/logger'

const DEFAULT_MIN_AGE_MINUTES = 60

export function getGlobalReconcileApply(): boolean {
  return process.env.GLOBAL_RECONCILE_APPLY !== 'false'
}

export function getGlobalReconcileMinAgeMinutes(): number {
  const raw = process.env.GLOBAL_RECONCILE_MIN_AGE_MINUTES
  const value = Number(raw)
  return raw && Number.isInteger(value) && value >= 1 ? value : DEFAULT_MIN_AGE_MINUTES
}

export function makeReconcileGlobalStampsUseCase(): ReconcileGlobalStampsUseCase {
  return new ReconcileGlobalStampsUseCase({
    repo: new DrizzleGlobalInvoiceRepository(),
    lookup: new FacturamaIssuedCfdiLookup(),
    minAgeMinutes: getGlobalReconcileMinAgeMinutes(),
    logger,
  })
}
