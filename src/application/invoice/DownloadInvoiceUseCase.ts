/**
 * DownloadInvoiceUseCase — caso de uso de descarga de CFDI (PDF o XML).
 *
 * Orquesta: buscar fila por invoiceId (token de capacidad), resolver facturamaId
 * server-side, descargar el archivo desde Facturama.
 *
 * Seguridad IDOR: el facturamaId nunca se expone al cliente; se resuelve aquí
 * a partir del invoiceId (UUID de DB) que actúa como token de capacidad.
 *
 * El handler es responsable de armar el NextResponse binario con sus headers
 * (Content-Type, Content-Disposition sanitizado, Cache-Control: no-store).
 *
 * Devuelve Result<DownloadOk, DownloadError> — nunca lanza para control de flujo.
 * NO importa 'next' ni construye NextResponse.
 */

import { ok, err } from '../shared/Result'
import type { Result } from '../shared/Result'

// ─── Tipo de resultado exitoso ────────────────────────────────────────────────

export interface DownloadOk {
  buffer: Buffer
  contentType: string
  /** Nombre base del archivo (ya con extensión, sin sanitizar — el handler sanitiza) */
  serieFolio: string
  format: 'pdf' | 'xml'
  /** UUID del CFDI para el filename (puede ser undefined si aún no se timbró) */
  uuidCfdi: string | null
  /** invoiceId de DB (fallback para filename si uuidCfdi es null) */
  invoiceId: string
}

// ─── Tipos de error ───────────────────────────────────────────────────────────

export type DownloadErrorCode =
  | 'NOT_FOUND'
  | 'DOWNLOAD_ERROR'
  | 'SERVICE_ERROR'

export interface DownloadError {
  code: DownloadErrorCode
  message: string
}

// ─── Tipo mínimo de fila ──────────────────────────────────────────────────────

export interface DownloadInvoiceRow {
  id: string
  facturamaId: string | null
  uuidCfdi: string | null
}

// ─── Ports mínimos ────────────────────────────────────────────────────────────

export interface DownloadRepo {
  findById(invoiceId: string): Promise<DownloadInvoiceRow | null>
}

export interface DownloadService {
  descargar(facturamaId: string, format: 'pdf' | 'xml'): Promise<Buffer>
}

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface DownloadInvoiceDeps {
  repo: DownloadRepo
  invoiceService: DownloadService
}

// ─── Mapa de Content-Type ─────────────────────────────────────────────────────

const CONTENT_TYPES: Record<'pdf' | 'xml', string> = {
  pdf: 'application/pdf',
  xml: 'application/xml',
}

// ─── Use Case ─────────────────────────────────────────────────────────────────

export class DownloadInvoiceUseCase {
  constructor(private readonly deps: DownloadInvoiceDeps) {}

  async execute(
    invoiceId: string,
    format: 'pdf' | 'xml'
  ): Promise<Result<DownloadOk, DownloadError>> {
    const { repo, invoiceService } = this.deps

    // ── 1. Resolver facturamaId desde la DB usando invoiceId como token ───────
    const row = await repo.findById(invoiceId)
    if (!row || !row.facturamaId) {
      return err({ code: 'NOT_FOUND', message: 'Factura no encontrada.' })
    }

    // ── 2. Descargar desde Facturama (facturamaId nunca se expone al cliente) ─
    let buffer: Buffer
    try {
      buffer = await invoiceService.descargar(row.facturamaId, format)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      const statusCode = (e as { statusCode?: number }).statusCode

      console.error('[download] Facturama:', { invoiceId, format, error: message })

      if (statusCode && statusCode >= 400 && statusCode < 500) {
        return err({ code: 'DOWNLOAD_ERROR', message: 'No se pudo obtener el archivo de la factura.' })
      }
      return err({ code: 'SERVICE_ERROR', message: 'Error al descargar el archivo. Intenta de nuevo más tarde.' })
    }

    return ok({
      buffer,
      contentType: CONTENT_TYPES[format],
      serieFolio: '',
      format,
      uuidCfdi: row.uuidCfdi,
      invoiceId: row.id,
    })
  }
}
