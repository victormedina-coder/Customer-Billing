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
  /**
   * Tasa de IVA de la línea como fracción: 0.16 gravado, 0 tasa-cero.
   * El precio SIEMPRE incluye impuesto (retail MX). Se distingue tasa-cero
   * de exento con taxObject.
   */
  taxRate: number
  /** Objeto de impuesto CFDI: '02' gravado (incluye tasa 0) | '01' no objeto (exento). */
  taxObject: '01' | '02'
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
  /**
   * Clave de marca (brand key: 'ariat' | 'stetson' | 'western-brothers') de la
   * tienda que emitió el pedido. Resuelve la Serie fiscal del CFDI (ver
   * brandSerie.ts). Distinta de `storeName`, que en pedidos POS es el nombre de
   * la UBICACIÓN física (physicalLocation), no la marca. Opcional: fuentes sin
   * marca (tests, otras integraciones) pueden omitirla → el CFDI usa la serie
   * por defecto de la sucursal.
   */
  brand?: string
  refundedAmount: number
  financialStatus: string
  /**
   * Identificador de origen del pedido (Shopify `sourceIdentifier`), típicamente
   * `{deviceId}-{folio}` del recibo POS. Es el folio que el cliente teclea en el
   * portal. Se usa para construir la referencia de orden que se manda a Facturama
   * (ver src/domain/orders/OrderReference.ts). Opcional: fuentes distintas de
   * Shopify (o pedidos sin POS) pueden no tenerlo.
   */
  sourceIdentifier?: string | null
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
