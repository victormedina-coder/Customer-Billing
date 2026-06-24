export interface OrderLine {
  description: string
  quantity: number
  unitPrice: number
  unitPriceIncludesTax: boolean
  discount: number
  productCode: string
}

export interface NormalizedOrder {
  id: string
  orderNumber: string
  createdAt: string
  currency: string
  subtotal: number
  taxAmount: number
  total: number
  discountAmount: number
  shippingAmount: number
  lines: OrderLine[]
  customerEmail: string
  alreadyInvoiced: boolean
  storeName: string
  refundedAmount: number
  financialStatus: string
}

export interface OrderSource {
  findOrder(params: { orderNumber: string; verifier: string }): Promise<NormalizedOrder | null>
}
