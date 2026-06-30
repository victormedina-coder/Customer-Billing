/**
 * PUENTE — re-exporta desde src/infrastructure/db/invoice-repository.ts.
 * Los imports existentes siguen funcionando sin cambios.
 * Este puente se elimina en el Paso 9 del refactor DDD.
 */
export type {
  CreateInvoiceData,
  InvoiceRow,
  CreateInvoiceSuccess,
  CreateInvoiceConflict,
  CreateInvoiceResult,
} from '../../src/infrastructure/db/invoice-repository'
export {
  isAlreadyInvoiced,
  findByOrder,
  createInvoice,
  findById,
  updateInvoiceStamp,
  deleteById,
  listInvoicedOrderIds,
} from '../../src/infrastructure/db/invoice-repository'
