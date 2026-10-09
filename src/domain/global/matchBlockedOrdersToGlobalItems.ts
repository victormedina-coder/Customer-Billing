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
}

/** IdentificationNumber is compared exactly after trimming surrounding whitespace. */
export function matchBlockedOrdersToGlobalItems(
  blockedOrders: readonly BlockedOrderTail[],
  globals: readonly GlobalItems[],
): BlockedOrderMatch[] {
  return blockedOrders.map(order => {
    const tail = order.tail.trim()
    const foundIn = tail ? globals.filter(global => global.items.some(item => item.trim() === tail))
      .map(({ facturamaId, serieFolio }) => ({ facturamaId, serieFolio })) : []
    return { ...order, foundIn, ambiguous: new Set(foundIn.map(item => item.facturamaId)).size >= 2 }
  })
}
