import { normalizeOrderReference, parseOrderReference } from '../orders/OrderReference'
import type { IssuedCfdiRef } from './ports/IssuedCfdiLookup'
import { normalizeGlobalCorrelationKey } from './globalCorrelationKey'

/** CFDI global activo que no pertenece a un header conocido ni a un pedido. */
export function findUnexplainedGlobals(
  items: readonly IssuedCfdiRef[],
  knownGlobalFacturamaIds: ReadonlySet<string>,
  knownGlobalCorrelationKeys: ReadonlySet<string> = new Set(),
): IssuedCfdiRef[] {
  return items.filter(item => {
    if (!item.active || knownGlobalFacturamaIds.has(item.facturamaId)) return false
    const globalKey = normalizeGlobalCorrelationKey(item.orderNumber)
    if (globalKey) return !knownGlobalCorrelationKeys.has(globalKey)
    if (item.rfc !== 'XAXX010101000') return false
    const parsed = item.orderNumber ? parseOrderReference(item.orderNumber) : null
    if (!parsed) return true
    const normalized = normalizeOrderReference(item.orderNumber ?? '')
    return !normalized || !/^#\d+(?:\s|$)/.test(normalized)
  })
}
