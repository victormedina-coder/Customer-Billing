import type { InvoiceService } from './types'

export class FacturamaInvoiceService implements InvoiceService {
  async emitir(_payload: unknown): Promise<{ facturamaId: string; uuid: string }> {
    throw new Error('not implemented')
  }
  async obtener(_facturamaId: string): Promise<unknown> {
    throw new Error('not implemented')
  }
  async descargar(_facturamaId: string, _format: 'pdf' | 'xml'): Promise<Buffer> {
    throw new Error('not implemented')
  }
  async cancelar(_facturamaId: string): Promise<void> {
    throw new Error('not implemented')
  }
}
