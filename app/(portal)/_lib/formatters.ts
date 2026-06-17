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
