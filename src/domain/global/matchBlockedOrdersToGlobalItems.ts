export interface BlockedOrderTail {
  orderId: string
  reference: string
  tail: string
}

export interface GlobalItems {
  facturamaId: string
  serieFolio?: string
  items: string[]
}

export interface BlockedOrderMatch extends BlockedOrderTail {
  foundIn: { facturamaId: string; serieFolio?: string }[]
  ambiguous: boolean
  ambiguityReason?: 'shared_tail' | 'multiple_globals'
  sharedTailOrderCount?: number
}

/** IdentificationNumber is compared exactly after trimming surrounding whitespace. */
export function matchBlockedOrdersToGlobalItems(
  blockedOrders: readonly BlockedOrderTail[],
  globals: readonly GlobalItems[],
  allPeriodTails: readonly string[],
): BlockedOrderMatch[] {
  const tailCounts = new Map<string, number>()
  for (const periodTail of allPeriodTails) {
    const tail = periodTail.trim()
    if (tail) tailCounts.set(tail, (tailCounts.get(tail) ?? 0) + 1)
  }

  return blockedOrders.map(order => {
    const tail = order.tail.trim()
    const foundIn = tail ? globals.filter(global => global.items.some(item => item.trim() === tail))
      .map(({ facturamaId, serieFolio }) => ({ facturamaId, serieFolio })) : []
    const sharedTailOrderCount = tailCounts.get(tail) ?? 0
    if (sharedTailOrderCount >= 2) {
      return { ...order, foundIn, ambiguous: true, ambiguityReason: 'shared_tail', sharedTailOrderCount }
    }
    if (new Set(foundIn.map(item => item.facturamaId)).size >= 2) {
      return { ...order, foundIn, ambiguous: true, ambiguityReason: 'multiple_globals' }
    }
    return { ...order, foundIn, ambiguous: false }
  })
}
