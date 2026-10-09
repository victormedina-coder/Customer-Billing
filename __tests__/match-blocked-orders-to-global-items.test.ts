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
    ], blocked.map(order => order.tail))
    expect(results[0]).toEqual({ ...blocked[0], foundIn: [{ facturamaId: 'a', serieFolio: 'G-1' }, { facturamaId: 'b', serieFolio: 'G-2' }], ambiguous: true, ambiguityReason: 'multiple_globals' })
    expect(results[1].foundIn).toEqual([{ facturamaId: 'a', serieFolio: 'G-1' }])
    expect(results[1].ambiguous).toBe(false)
    expect(results[2].foundIn).toEqual([])
  })

  it('does not match an empty tail and preserves case and leading zeros', () => {
    expect(matchBlockedOrdersToGlobalItems([{ orderId: 'x', reference: '#x', tail: ' ' }], [
      { facturamaId: 'a', items: [''] },
    ], [' '])[0].foundIn).toEqual([])
    expect(matchBlockedOrdersToGlobalItems([{ orderId: 'x', reference: '#x', tail: 'A-01' }], [
      { facturamaId: 'a', items: ['a-01', 'A-1'] },
    ], ['A-01'])[0].foundIn).toEqual([])
  })

  it('marks a blocked order ambiguous when another period order shares its tail', () => {
    const order = { orderId: '1', reference: '#51861', tail: receiptTail('101314658668-21-7316') }
    const [result] = matchBlockedOrdersToGlobalItems([order], [
      { facturamaId: 'a', items: ['21-7316'] },
    ], [order.tail, ' 21-7316 '])

    expect(result).toEqual({
      ...order,
      foundIn: [{ facturamaId: 'a', serieFolio: undefined }],
      ambiguous: true,
      ambiguityReason: 'shared_tail',
      sharedTailOrderCount: 2,
    })
  })

  it('still reports a unique tail in one global as found', () => {
    const order = { orderId: '1', reference: '#51861', tail: receiptTail('101314658668-21-7316') }
    const [result] = matchBlockedOrdersToGlobalItems([order], [
      { facturamaId: 'a', items: [order.tail] },
    ], [order.tail, 'different-tail'])

    expect(result.foundIn).toEqual([{ facturamaId: 'a', serieFolio: undefined }])
    expect(result.ambiguous).toBe(false)
    expect(result.ambiguityReason).toBeUndefined()
  })
})
