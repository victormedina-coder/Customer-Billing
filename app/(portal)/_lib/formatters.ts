export function formatMXN(amount: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(amount)
}

export function calcSubtotal(total: number): number {
  return total / 1.16
}

export function calcIva(total: number): number {
  return total - calcSubtotal(total)
}
