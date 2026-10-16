import { normalizeOrderReference, parseOrderReference } from '../orders/OrderReference'

export interface PeriodGlobalOrder {
  readonly orderId: string
  readonly reference: string
  readonly tail: string
}

export interface PeriodGlobal {
  readonly facturamaId: string
  readonly serieFolio?: string
  readonly items: readonly string[]
}

export interface PeriodGlobalMatch {
  readonly held: boolean
  readonly serieFolios: readonly string[]
}

export interface PeriodGlobalMatches {
  readonly matches: Map<string, PeriodGlobalMatch>
  readonly unrecognized: readonly { facturamaId: string; value: string }[]
}

/**
 * Un empate por referencia excluye ese pedido. Para una cola suelta, E cuenta
 * todos los pedidos con esa cola, incluidos los empatados por referencia:
 * la cola suelta podría ser una repetición de cualquiera de ellos.
 */
export function matchOrdersToPeriodGlobals(
  orders: readonly PeriodGlobalOrder[],
  globals: readonly PeriodGlobal[],
): PeriodGlobalMatches {
  const ordersByReference = new Map<string, PeriodGlobalOrder[]>()
  for (const order of orders) {
    const reference = normalizeOrderReference(order.reference)
    if (!reference) continue
    const group = ordersByReference.get(reference) ?? []
    group.push(order)
    ordersByReference.set(reference, group)
  }

  const matches = new Map<string, PeriodGlobalMatch>()
  const unrecognized: { facturamaId: string; value: string }[] = []
  const tailOccurrences = new Map<string, { count: number; serieFolios: Set<string> }>()

  for (const global of globals) {
    for (const item of global.items) {
      const value = item.trim()
      if (value.startsWith('#')) {
        const parsed = parseOrderReference(value)
        const reference = parsed?.sourceIdentifier ? normalizeOrderReference(value) : null
        if (!reference) {
          unrecognized.push({ facturamaId: global.facturamaId, value })
          continue
        }

        for (const order of ordersByReference.get(reference) ?? []) {
          const current = matches.get(order.orderId)
          const serieFolios = current ? [...current.serieFolios] : []
          if (global.serieFolio && !serieFolios.includes(global.serieFolio)) {
            serieFolios.push(global.serieFolio)
          }
          matches.set(order.orderId, { held: false, serieFolios })
        }
        continue
      }

      if (!value) {
        unrecognized.push({ facturamaId: global.facturamaId, value })
        continue
      }

      const occurrence = tailOccurrences.get(value) ?? {
        count: 0,
        serieFolios: new Set<string>(),
      }
      occurrence.count += 1
      if (global.serieFolio) occurrence.serieFolios.add(global.serieFolio)
      tailOccurrences.set(value, occurrence)
    }
  }

  const ordersByTail = new Map<string, PeriodGlobalOrder[]>()
  for (const order of orders) {
    const tail = order.tail.trim()
    if (!tail) continue
    const group = ordersByTail.get(tail) ?? []
    group.push(order)
    ordersByTail.set(tail, group)
  }

  for (const [tail, occurrence] of tailOccurrences) {
    const ordersWithTail = ordersByTail.get(tail) ?? []
    const held = ordersWithTail.length > occurrence.count
    for (const order of ordersWithTail) {
      if (matches.has(order.orderId)) continue
      matches.set(order.orderId, {
        held,
        serieFolios: [...occurrence.serieFolios],
      })
    }
  }

  return { matches, unrecognized }
}
