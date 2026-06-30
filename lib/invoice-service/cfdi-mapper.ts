/**
 * PUENTE — re-exporta desde src/infrastructure/facturama/cfdiPayloadBuilder.ts.
 *
 * Los imports existentes (cfdi-mapper.test.ts, FacturamaInvoiceService, etc.)
 * siguen funcionando sin cambios. Este puente se elimina en el Paso 9 del
 * refactor DDD.
 *
 * Separación introducida en el Paso 5:
 *   - Cálculo numérico puro  → src/domain/fiscal/FiscalCalculator.ts
 *   - Tipos de breakdown     → src/domain/fiscal/FiscalBreakdown.ts
 *   - Serialización Facturama → src/infrastructure/facturama/cfdiPayloadBuilder.ts
 */
export { buildCfdiPayload } from '../../src/infrastructure/facturama/cfdiPayloadBuilder'
export type {
  CfdiPayload,
  CfdiItem,
  CfdiTax,
  CfdiReceiver,
} from '../../src/infrastructure/facturama/cfdiPayloadBuilder'
