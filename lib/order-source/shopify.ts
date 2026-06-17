import type { OrderSource, NormalizedOrder } from './types'

export class ShopifyOrderSource implements OrderSource {
  async findOrder(_params: { orderNumber: string; verifier: string }): Promise<NormalizedOrder | null> {
    throw new Error('ShopifyOrderSource: not implemented (Etapa 2)')
  }
}
