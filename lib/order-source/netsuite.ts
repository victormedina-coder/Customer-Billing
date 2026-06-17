import type { OrderSource, NormalizedOrder } from './types'

export class NetSuiteOrderSource implements OrderSource {
  async findOrder(_params: { orderNumber: string; verifier: string }): Promise<NormalizedOrder | null> {
    throw new Error('NetSuiteOrderSource: API not available yet (Etapa 10)')
  }
}
