/**
 * GatewayPaymentClassification — dominio puro.
 *
 * Fuente única (single source of truth) para clasificar el nombre de gateway
 * de Shopify en una clase de forma de pago. Antes esta tabla vivía duplicada
 * implícitamente dentro de mapPaymentForm (infraestructura, Facturama). Se
 * extrae aquí para que:
 *   - `mapPaymentForm` (src/infrastructure/facturama/cfdiPayloadBuilder.ts)
 *     derive la clave SAT de PaymentForm a partir de la clase.
 *   - `PaymentBucketPolicy` (facturación global mensual) derive el bucket
 *     credito/debito/efectivo a partir de la misma clase.
 *
 * IMPORTANTE: el orden de las reglas replica el if/else-if original de
 * mapPaymentForm — primer match gana. No reordenar sin revisar ambos
 * consumidores.
 */

/** Clase de gateway. 'transferencia' no tiene bucket de facturación global
 *  (PaymentBucket solo conoce credito/debito/efectivo) pero sí clave SAT. */
export type GatewayPaymentClass = 'efectivo' | 'transferencia' | 'credito' | 'debito'

interface ClassificationRule {
  readonly gatewayClass: GatewayPaymentClass
  readonly matches: (normalizedGateway: string) => boolean
}

// Orden = prioridad de match (primer match gana), idéntico al original.
const CLASSIFICATION_RULES: readonly ClassificationRule[] = [
  {
    gatewayClass: 'efectivo',
    matches: (g) => g.includes('cash') || g.includes('efectivo'),
  },
  {
    gatewayClass: 'transferencia',
    matches: (g) => g.includes('transfer') || g.includes('transferencia') || g === 'bogus',
  },
  {
    gatewayClass: 'credito',
    matches: (g) =>
      g.includes('credit') ||
      g.includes('crédito') ||
      g.includes('credito') ||
      g.includes('paypal') ||
      // Gateway genérico "Tarjeta" de la terminal POS Ariat (pre separación
      // crédito/débito de jun-2026, sin distinguir forma) — finanzas
      // 2026-07-10: esos pedidos históricos van a la global de CRÉDITO
      // (misma decisión conservadora que la regla de pagos mixtos). Match
      // exacto (no substring) para no capturar futuros gateways más
      // específicos como "tarjeta de débito".
      g === 'tarjeta',
  },
  {
    gatewayClass: 'debito',
    matches: (g) => g.includes('debit') || g.includes('débito') || g.includes('debito'),
  },
]

/**
 * Clasifica el nombre de gateway (case-insensitive) en una GatewayPaymentClass.
 * Gateway vacío/no reconocido → 'unmapped'.
 */
export function classifyGateway(gateway: string): GatewayPaymentClass | 'unmapped' {
  const normalized = gateway.toLowerCase()
  const rule = CLASSIFICATION_RULES.find((r) => r.matches(normalized))
  return rule?.gatewayClass ?? 'unmapped'
}
