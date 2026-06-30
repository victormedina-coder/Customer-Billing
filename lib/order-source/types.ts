/**
 * PUENTE — re-exporta desde src/domain/orders/.
 * Los imports existentes siguen funcionando sin cambios.
 * Este puente se elimina en el Paso 9 del refactor DDD.
 *
 * Alias de compatibilidad:
 *   NormalizedOrder = Order  (nombre canónico en domain es Order)
 */
export type { OrderLine, Order, NormalizedOrder } from '../../src/domain/orders/Order'
export type { OrderSource } from '../../src/domain/orders/ports/OrderSource'
