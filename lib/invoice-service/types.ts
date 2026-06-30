/**
 * PUENTE — re-exporta desde src/domain/invoicing/ports/InvoiceStampingService.ts.
 * Los imports existentes siguen funcionando sin cambios.
 * Este puente se elimina en el Paso 9 del refactor DDD.
 *
 * Alias de compatibilidad:
 *   InvoiceService = InvoiceStampingService  (nombre canónico en domain)
 */
export type { EmitResult, InvoiceStampingService, InvoiceService } from '../../src/domain/invoicing/ports/InvoiceStampingService'
export type { FiscalInput } from '../../src/domain/fiscal/FiscalInput'
