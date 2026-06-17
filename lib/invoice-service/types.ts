export interface InvoiceService {
  emitir(payload: unknown): Promise<{ facturamaId: string; uuid: string }>
  obtener(facturamaId: string): Promise<unknown>
  descargar(facturamaId: string, format: 'pdf' | 'xml'): Promise<Buffer>
  cancelar(facturamaId: string): Promise<void>
}
