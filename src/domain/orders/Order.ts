/**
 * Order — entidad de dominio que representa un pedido normalizado de Shopify.
 *
 * Nombre canónico en domain. El alias NormalizedOrder se exporta desde
 * src/composition/orderSource.ts para compatibilidad con los imports existentes.
 */

export interface OrderLine {
  description: string
  quantity: number
  unitPrice: number
  unitPriceIncludesTax: boolean
  discount: number
  productCode: string
}

export interface Order {
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

/** Alias de compatibilidad — usar Order en código nuevo. */
export type NormalizedOrder = Order

/**
 * Order extendido con el campo de forma de pago de Shopify.
 * El campo es opcional para no romper otras fuentes (NetSuite, etc.).
 */
export interface NormalizedOrderWithPayment extends NormalizedOrder {
  paymentGatewayNames?: string[]
}
