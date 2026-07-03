export function formatMXN(amount: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(amount)
}

/**
 * Formatea en vivo lo que el usuario teclea en el campo de importe: agrega
 * "$" y comas de separador de miles. Puramente visual — el parseo
 * (`parseFloat(amountRaw.replace(/[$,\s]/g, ''))` en usePortal) ya ignora
 * "$", comas y espacios, así que el valor formateado sigue validando igual.
 */
export function formatAmountInput(raw: string): string {
  let cleaned = raw.replace(/[^\d.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot !== -1) {
    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
  }
  if (!cleaned) return ''
  const [intPart, decPart] = cleaned.split('.')
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return '$' + withCommas + (decPart !== undefined ? '.' + decPart : '')
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}
