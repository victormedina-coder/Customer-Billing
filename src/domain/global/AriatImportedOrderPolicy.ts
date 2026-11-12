/**
 * AriatImportedOrderPolicy — dominio puro.
 *
 * Ariat migró a la tienda `ariat-1522` importando pedidos (Matrixify,
 * `sourceName = 'pos-ariat-int'`) sin `sourceIdentifier`, así que la global los
 * descarta como no-POS. Las ventas del 1–3 nov existen SOLO como importados y
 * traen el recibo POS original en el atributo `Ticket` (`<terminal>-<folio>`).
 * Desde el corte, ese Ticket hace las veces de cola POS; lo anterior al corte
 * ya se facturó desde la tienda vieja y sigue fuera.
 */

/** 31-oct 21:00 MX: inicio del periodo de noviembre (ADR-009). */
export const ARIAT_IMPORT_CUTOFF = '2026-11-01T03:00:00.000Z'

const IMPORTED_SOURCE_NAME = 'pos-ariat-int'
const TICKET_PATTERN = /^\d+-\d+$/

export function importedPosTicket(
  brandKey: string,
  sourceName: string | null,
  processedAt: string,
  ticket: string | null | undefined,
): string | null {
  if (brandKey !== 'ariat' || sourceName !== IMPORTED_SOURCE_NAME) return null
  // NaN (fecha inválida) no pasa la comparación → queda fuera, como hoy.
  if (!(Date.parse(processedAt) >= Date.parse(ARIAT_IMPORT_CUTOFF))) return null
  const value = ticket?.trim()
  return value && TICKET_PATTERN.test(value) ? value : null
}
