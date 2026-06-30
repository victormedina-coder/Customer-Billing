/**
 * Tipos de salida de FiscalCalculator.
 * Representan los valores numéricos finales por línea y totales globales
 * — sin ninguna serialización ni dependencia de Facturama.
 *
 * Los valores ya incluyen el cent-fix: son los números definitivos que
 * cfdiPayloadBuilder serializa a strings para Facturama.
 */

export interface LineBreakdown {
  /** Importe lista SIN IVA (Subtotal CFDI) */
  subtotal: number
  /** Descuento SIN IVA (Discount CFDI, 0 si no aplica) */
  discount: number
  /** Base gravable = subtotal − discount */
  base: number
  /** IVA de la línea = base × 0.16 */
  iva: number
  /** Total de la línea con IVA = base + iva */
  total: number
  /**
   * Precio unitario SIN IVA a 6 decimales.
   * Invariante: round2(unitPriceSinIva × quantity) === subtotal
   */
  unitPriceSinIva: number
  /** Cantidad de unidades (copiada del pedido para conveniencia del serializer) */
  quantity: number
  /** Indica si el item lleva descuento (para que el serializer incluya el campo) */
  hasDiscount: boolean
}

export interface FiscalBreakdown {
  porLinea: LineBreakdown[]
  totales: {
    subtotalSinIVA: number
    descuento: number
    iva: number
    total: number
  }
}
