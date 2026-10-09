import type { ReconciliationHeader } from './ports/GlobalInvoiceRepository'
import type { IssuedCfdiRef } from './ports/IssuedCfdiLookup'

export type ReconciliationDecision = 'confirm' | 'release' | 'wait' | 'alert_duplicate' | 'alert_cancelled' | 'alert_late_stamp'

export interface ReconciliationContext {
  now: Date
  minAgeMinutes: number
  listingHealthy: boolean
  unexplainedGlobals: number
}

export function decideReconciliation(
  header: ReconciliationHeader,
  matches: IssuedCfdiRef[],
  ctx: ReconciliationContext,
): { decision: ReconciliationDecision; reason: string } {
  const oldEnough = ctx.now.getTime() - header.createdAt.getTime() >= ctx.minAgeMinutes * 60_000
  const active = matches.filter(match => match.active)
  if (header.status === 'released') {
    return active.length > 0
      ? { decision: 'alert_late_stamp', reason: 'Facturama timbró después de liberar la reserva' }
      : { decision: 'wait', reason: 'Lápida sin timbrado tardío' }
  }
  const knownIdMatches = header.facturamaId ? matches.filter(match => match.facturamaId === header.facturamaId) : []
  if (header.facturamaId) {
    if (knownIdMatches.some(match => match.active)) return { decision: 'confirm', reason: 'CFDI activo coincide con facturamaId guardado' }
    if (knownIdMatches.length > 0) return { decision: 'alert_cancelled', reason: 'CFDI con facturamaId guardado está cancelado' }
    return { decision: 'wait', reason: 'Tiene facturamaId pero no aparece en el listado' }
  }
  if (header.status === 'pending') {
    if (active.length > 0) return { decision: 'alert_duplicate', reason: 'Reserva pendiente con CFDI activo' }
    return oldEnough && ctx.listingHealthy && ctx.unexplainedGlobals === 0
      ? { decision: 'release', reason: 'Reserva pendiente sin intento de timbrado' }
      : { decision: 'wait', reason: ctx.unexplainedGlobals > 0 ? 'Global ajena sin explicar en la ventana' : 'Reserva pendiente dentro del plazo de seguridad' }
  }

  if (active.length > 1) return { decision: 'alert_duplicate', reason: 'Más de un CFDI activo con la misma llave' }
  if (active.length === 1) return { decision: 'confirm', reason: 'Un CFDI activo coincide con la llave' }
  if (matches.length > 0) return { decision: 'alert_cancelled', reason: 'Solo hay CFDI cancelados para la llave' }
  if (oldEnough && ctx.listingHealthy && ctx.unexplainedGlobals === 0) return { decision: 'release', reason: 'Sin CFDI tras plazo de seguridad; listado sano' }
  if (ctx.unexplainedGlobals > 0) return { decision: 'wait', reason: 'Global ajena sin explicar en la ventana' }
  return { decision: 'wait', reason: oldEnough ? 'Listado incompleto o vacío' : 'Aún dentro del plazo de seguridad' }
}
