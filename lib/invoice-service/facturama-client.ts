/**
 * PUENTE — re-exporta desde src/infrastructure/facturama/facturamaClient.ts.
 * Los imports existentes siguen funcionando sin cambios.
 * Este puente se elimina en el Paso 9 del refactor DDD.
 */
export type { FacturamaCfdiResponse, ReceptorValidation, SendEmailResult } from '../../src/infrastructure/facturama/facturamaClient'
export {
  isFacturamaConfigured,
  validarRfc,
  validarReceptor,
  emitirCFDI,
  obtenerCFDI,
  descargarArchivo,
  enviarCFDIEmail,
  cancelarCFDI,
} from '../../src/infrastructure/facturama/facturamaClient'
