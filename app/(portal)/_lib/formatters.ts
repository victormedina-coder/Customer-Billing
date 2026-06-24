// TODO: el cálculo definitivo de IVA por línea queda pendiente con el contador
const IVA_RATE = 0.16

export function formatMXN(amount: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(amount)
}

export function calcSubtotal(total: number): number {
  return total / (1 + IVA_RATE)
}

export function calcIva(total: number): number {
  return total - calcSubtotal(total)
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export interface InvoiceBreakdown {
  subtotalSinIVA: number // importe de lista, sin IVA
  descuento: number      // descuento sin IVA (0 si no hay)
  iva: number
  total: number
}

/**
 * Calcula el desglose fiscal B1 para la pantalla Confirmar y Éxito.
 *
 * Usa los montos autoritativos de Shopify (tax/discount) cuando están presentes.
 * Si no (ticket mock/demo), cae al comportamiento anterior: IVA derivado de
 * total/1.16, sin renglón de descuento.
 *
 * Para el pedido de prueba { total:480, tax:66.21, discount:320 } el resultado es:
 *   subtotalSinIVA=689.66, descuento=275.87, iva=66.21, total=480
 * que coincide exactamente con el PDF del CFDI.
 */
export function calcInvoiceBreakdown(ticket: {
  total: number
  tax?: number
  discount?: number
}): InvoiceBreakdown {
  const total = ticket.total
  const iva = ticket.tax != null ? round2(ticket.tax) : round2(calcIva(total))
  const base = round2(total - iva) // neto sin IVA (después de descuento)
  const discountRaw = ticket.discount ?? 0
  if (discountRaw > 0) {
    const listInclIVA = round2(total + discountRaw)
    const subtotalSinIVA = round2(listInclIVA / (1 + IVA_RATE))
    const descuento = round2(subtotalSinIVA - base) // cuadra exacto: base + iva = total
    return { subtotalSinIVA, descuento, iva, total }
  }
  return { subtotalSinIVA: base, descuento: 0, iva, total }
}
