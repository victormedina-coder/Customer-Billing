'use client'
import type { Ticket, FiscalData, GeneratedInvoice } from '../../_lib/types'
import { formatMXN, calcInvoiceBreakdown } from '../../_lib/formatters'
import { METODO_PAGO_LABEL, USOS_CFDI, REGIMENES } from '../../_lib/constants'

interface StepSuccessProps {
  ticket: Ticket
  fiscal: FiscalData
  factura: GeneratedInvoice
  storeName: string
  onDownloadPdf: () => void
  onDownloadXml: () => void
  onResendEmail: () => void
  onNewInvoice: () => void
}

const BTN_ACTION: React.CSSProperties = {
  flex: 1, minWidth: 130, height: 50,
  background: '#fff', border: '1.5px solid var(--border-default)', borderRadius: 13,
  fontSize: 13, fontWeight: 700, color: '#1a1a1a',
  cursor: 'pointer', display: 'flex',
  alignItems: 'center', justifyContent: 'center', gap: 8,
}

export function StepSuccess({
  ticket, fiscal, factura, storeName,
  onDownloadPdf, onDownloadXml, onResendEmail, onNewInvoice,
}: StepSuccessProps) {
  const usoLabel = USOS_CFDI.find(u => u.code === fiscal.uso)?.label ?? fiscal.uso
  const b = calcInvoiceBreakdown(ticket)
  const regimenLabel = REGIMENES.find(r => r.code === factura.emisor.regimen)?.label ?? factura.emisor.regimen

  return (
    <div style={{ width: '100%', maxWidth: 520, animation: 'fadeIn 0.3s ease both' }}>

      {/* Success header */}
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: 'var(--brand-primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 14px', boxShadow: '0 8px 28px rgba(65,255,191,0.4)',
        }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#000000" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: '#1a1a1a', letterSpacing: '-0.03em', marginBottom: 6 }}>
          Factura generada
        </h1>
        <p style={{ fontSize: 13.5, color: '#6b7280', fontWeight: 600 }}>
          Tu CFDI fue timbrado correctamente ante el SAT
        </p>
      </div>

      {/* CFDI document */}
      <div style={{
        background: '#fff', border: '1.5px solid var(--border-default)',
        borderRadius: 18, overflow: 'hidden', marginBottom: 16,
      }}>
        {/* Document header */}
        <div style={{ background: '#000000', padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--brand-primary)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>
                Comprobante Fiscal Digital (CFDI 4.0)
              </div>
              <div style={{ fontSize: 15, fontWeight: 900, color: '#ffffff' }}>{storeName}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--brand-primary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
                Serie / Folio
              </div>
              <div style={{ fontSize: 16, fontWeight: 900, color: '#ffffff' }}>{factura.serieFolio}</div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--brand-primary)', fontWeight: 600 }}>
            RFC Emisor: {factura.emisor.rfc || '—'} · Reg: {regimenLabel}
          </div>
        </div>

        {/* Document body */}
        <div style={{ padding: '16px 20px' }}>
          {/* UUID */}
          <div style={{ background: '#f5f5f5', borderRadius: 10, padding: '10px 13px', marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
              UUID (Folio Fiscal SAT)
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#1a1a1a', wordBreak: 'break-all' }}>
              {factura.uuid}
            </div>
          </div>

          {/* Grid info */}
          <div className="cfdi-info-grid">
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Receptor</div>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: '#1a1a1a' }}>{fiscal.razon}</div>
              <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>{fiscal.rfc}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Fecha de timbrado</div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: '#1a1a1a' }}>{factura.fecha}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Forma de pago</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1a1a' }}>{ticket.formaPago}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Método de pago</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1a1a' }}>{METODO_PAGO_LABEL}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Uso CFDI</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1a1a' }}>{usoLabel}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Correo</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1a1a', wordBreak: 'break-all' }}>{fiscal.email}</div>
            </div>
          </div>

          {/* Concepts mini-table */}
          <div style={{ borderTop: '1px solid var(--border-default)', paddingTop: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Conceptos</div>
            {ticket.items.map((item, i) => (
              <div key={`${item.sku}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <div style={{ fontSize: 12, color: '#1a1a1a', fontWeight: 600, flex: 1 }}>
                  {item.qty}× {item.desc}
                  <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}> · {item.sku}</span>
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: '#1a1a1a', flexShrink: 0, marginLeft: 12 }}>
                  {formatMXN(item.qty * item.unit)}
                </div>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div style={{ borderTop: '1px solid var(--border-default)', paddingTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>Subtotal (sin IVA)</span>
              <span style={{ fontSize: 12, fontWeight: 700 }}>{formatMXN(b.subtotalSinIVA)}</span>
            </div>
            {b.descuento > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>Descuento</span>
                <span style={{ fontSize: 12, fontWeight: 700 }}>−{formatMXN(b.descuento)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>IVA 16%</span>
              <span style={{ fontSize: 12, fontWeight: 700 }}>{formatMXN(b.iva)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900 }}>
              <span style={{ fontSize: 15, color: '#1a1a1a' }}>Total</span>
              <span style={{ fontSize: 16, color: '#000000', fontWeight: 900 }}>{formatMXN(ticket.total)}</span>
            </div>
          </div>
        </div>

        {/* Sello footer */}
        <div style={{ background: '#f5f5f5', borderTop: '1px solid var(--border-default)', padding: '10px 20px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
            Sello digital SAT (extracto)
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#6b7280', wordBreak: 'break-all', lineHeight: 1.5 }}>
            {factura.sello}…
          </div>
        </div>
      </div>

      {/* Action buttons 2×2 grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <button type="button" onClick={onDownloadPdf} className="btn-press" style={BTN_ACTION}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
          </svg>
          Descargar PDF
        </button>
        <button type="button" onClick={onDownloadXml} className="btn-press" style={BTN_ACTION}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
          </svg>
          Descargar XML
        </button>
        <button type="button" onClick={onResendEmail} className="btn-press" style={BTN_ACTION}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#000000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
            <polyline points="22,6 12,13 2,6"/>
          </svg>
          Reenviar por correo
        </button>
        <button
          type="button"
          onClick={onNewInvoice}
          className="btn-press"
          style={{ ...BTN_ACTION, background: 'var(--brand-primary)', border: 'none', color: '#000000' }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#000000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Facturar otra compra
        </button>
      </div>
    </div>
  )
}
