import type { OrderSource } from './types'
import { ShopifyOrderSource } from './shopify'
import { NetSuiteOrderSource } from './netsuite'

export function getOrderSource(): OrderSource {
  return process.env.ORDER_SOURCE === 'netsuite' ? new NetSuiteOrderSource() : new ShopifyOrderSource()
}

export type { OrderSource, NormalizedOrder, OrderLine } from './types'
