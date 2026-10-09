import { describe, expect, it } from 'vitest'
import { matchBlockedOrdersToGlobalItems } from '../src/domain/global/matchBlockedOrdersToGlobalItems'
import { receiptTail } from '../src/domain/orders/OrderReference'

describe('matchBlockedOrdersToGlobalItems', () => {
  const blocked = [
    { orderId: '1', reference: '#1 2-1266', tail: receiptTail('87008247993-2-1266') },
    { orderId: '2', reference: '#2 5-2155', tail: '5-2155' },
    { orderId: '3', reference: '#3', tail: '3' },
  ]

  it('reports exact matches, missing orders and ambiguity across distinct CFDIs', () => {
    const results = matchBlockedOrdersToGlobalItems(blocked, [
      { facturamaId: 'a', serieFolio: 'G-1', items: [' 2-1266 ', '5-2155'] },
      { facturamaId: 'b', serieFolio: 'G-2', items: ['2-1266', '05-2155', '3A'] },
    ])
    expect(results[0]).toEqual({ ...blocked[0], foundIn: [{ facturamaId: 'a', serieFolio: 'G-1' }, { facturamaId: 'b', serieFolio: 'G-2' }], ambiguous: true })
    expect(results[1].foundIn).toEqual([{ facturamaId: 'a', serieFolio: 'G-1' }])
    expect(results[1].ambiguous).toBe(false)
    expect(results[2].foundIn).toEqual([])
  })

  it('does not match an empty tail and preserves case and leading zeros', () => {
    expect(matchBlockedOrdersToGlobalItems([{ orderId: 'x', reference: '#x', tail: ' ' }], [
      { facturamaId: 'a', items: [''] },
    ])[0].foundIn).toEqual([])
    expect(matchBlockedOrdersToGlobalItems([{ orderId: 'x', reference: '#x', tail: 'A-01' }], [
      { facturamaId: 'a', items: ['a-01', 'A-1'] },
    ])[0].foundIn).toEqual([])
  })
})
