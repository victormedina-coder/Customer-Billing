/**
 * PaymentBucket — dominio puro.
 *
 * Clasificación de pagos usada por la facturación global mensual para
 * decidir CON QUÉ forma de pago se timbra el CFDI global de cada tienda/mes
 * (un CFDI global por bucket, ver PaymentBucketPolicy). Deliberadamente más
 * angosto que GatewayPaymentClass: 'transferencia' y gateways no reconocidos
 * no tienen bucket propio (ver PaymentBucketPolicy.classify).
 */
export type PaymentBucket = 'credito' | 'debito' | 'efectivo'
