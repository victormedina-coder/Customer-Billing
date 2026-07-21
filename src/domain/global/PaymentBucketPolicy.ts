/**
 * PaymentBucketPolicy — dominio puro.
 *
 * Decide con qué PaymentBucket (credito/debito/efectivo) se debe timbrar el
 * CFDI global mensual de un pedido, a partir de sus transacciones de pago
 * exitosas ya normalizadas. El filtrado por kind/status de las transacciones
 * (p. ej. descartar "voided"/"pending") es responsabilidad del adapter que
 * las obtiene (Paso 3) — este dominio recibe pagos limpios.
 *
 * Clasificación POR FORMA DE PAGO (decisión del usuario, 2026-07-10 — supera
 * la regla por-monto del 2026-07-08):
 *   - Una sola forma de pago (todos los pagos caen en el mismo bucket, o son
 *     todos gateways desconocidos) → ese bucket.
 *   - Varias formas de pago distintas (más de un bucket entre sus
 *     transacciones, incluyendo mezcla de mapeado + desconocido) → 'credito',
 *     por decisión explícita del usuario: "si hay pedidos con varias formas
 *     de pago se deja como pago con crédito". Ejemplo: $200 efectivo + $300
 *     débito → credito (NO se suman montos, NO hay tie-break por importe).
 *   - Sin pagos → 'unmapped' (no hay pagos que clasificar).
 *
 * 'transferencia' NO tiene bucket propio en PaymentBucket, pero por decisión
 * de finanzas/contabilidad (2026-07-21) se globaliza junto con CRÉDITO. El
 * ajuste vive AQUÍ y no en GatewayPaymentClassification a propósito: el CFDI
 * individual debe seguir mandando FormaPago SAT '03' para transferencia
 * (ver GATEWAY_CLASS_TO_SAT_PAYMENT_FORM en cfdiPayloadBuilder.ts).
 *
 * El resto de gateways no reconocidos siguen contando como 'unmapped' para
 * efectos de "cuántas formas distintas" hay.
 */

import { classifyGateway } from './GatewayPaymentClassification'
import type { PaymentBucket } from './PaymentBucket'

export interface NormalizedPayment {
  gateway: string
  amount: number
}

type ClassificationResult = PaymentBucket | 'unmapped'

function toBucket(gateway: string): ClassificationResult {
  const gatewayClass = classifyGateway(gateway)
  if (gatewayClass === 'credito' || gatewayClass === 'debito' || gatewayClass === 'efectivo') {
    return gatewayClass
  }
  //correccion para casos de transferencia, que no tiene bucket propio pero se globaliza con credito
  if (gatewayClass === 'transferencia') return 'credito'
  return 'unmapped'
}

export const PaymentBucketPolicy = {
  /**
   * Clasifica una lista de pagos según cuántas formas de pago DISTINTAS
   * aparecen (no por monto). Lista vacía → 'unmapped'.
   */
  classify(payments: readonly NormalizedPayment[]): ClassificationResult {
    if (payments.length === 0) return 'unmapped'

    const buckets = new Set<ClassificationResult>(payments.map((p) => toBucket(p.gateway)))

    if (buckets.size === 1) return [...buckets][0]

    // Varias formas de pago distintas → credito (decisión del usuario 2026-07-10).
    return 'credito'
  },
}
