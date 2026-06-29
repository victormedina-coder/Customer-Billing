/**
 * Comparación de montos al centavo para el segundo factor de validación.
 *
 * Por qué existe este módulo:
 *   - Los montos llegan del cliente como `number` (JSON) o eventualmente como
 *     `string` con formato localizado ("$1,234.56"). Para evitar errores de
 *     punto flotante (0.1 + 0.2 ≠ 0.3), convertimos ambos lados a centavos
 *     enteros (round) antes de comparar con ===.
 *   - Centralizar la conversión evita que lookup y emit diverjan en la lógica.
 */

/**
 * Convierte un valor de monto a centavos enteros.
 *
 * Acepta:
 *   - number  → multiplica por 100 y redondea
 *   - string  → elimina símbolos de moneda ($, MXN, espacios, comas)
 *               antes de parsear como número
 *
 * Lanza si el resultado no es un número finito positivo.
 */
export function toCents(value: number | string): number {
  let num: number

  if (typeof value === 'string') {
    // Normalizar: quitar símbolos de moneda y separadores de miles
    const cleaned = value.replace(/[$MXNmxn,\s]/g, '').trim()
    num = parseFloat(cleaned)
  } else {
    num = value
  }

  if (!Number.isFinite(num) || num < 0) {
    throw new RangeError(`Monto inválido: ${JSON.stringify(value)}`)
  }

  return Math.round(num * 100)
}

/**
 * Devuelve true si `clientAmount` coincide exactamente al centavo con
 * `orderTotal` (el campo `total` del NormalizedOrder).
 *
 * Ambos se convierten a centavos enteros antes de comparar para evitar
 * diferencias de punto flotante (ej. 1234.50 === 1234.50 pero
 * 1234.1 + 0.4 podría ≠ 1234.5 sin redondeo).
 */
export function amountMatches(
  clientAmount: number | string,
  orderTotal: number,
): boolean {
  try {
    return toCents(clientAmount) === toCents(orderTotal)
  } catch {
    // Si el parseo falla, el monto del cliente es inválido → no coincide
    return false
  }
}
