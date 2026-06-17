'use client'
import type { LookupError, Ticket } from '../../_lib/types'
import { FormField } from '../ui/FormField'
import { AlertBanner } from '../ui/AlertBanner'
import { LoadingSpinner } from '../ui/LoadingSpinner'

interface StepTicketProps {
  folio: string
  total: string
  busy: boolean
  lookupError: LookupError
  ticket: Ticket | null
  showFolioHelp: boolean
  onFolioChange: (v: string) => void
  onTotalChange: (v: string) => void
  onToggleFolioHelp: () => void
  onLookup: () => void
  onDismissError: () => void
  onFillDemo: (folio: string, total: string) => void
  onScanQR: () => void
  onDownloadPdf: () => void
}

const CARD: React.CSSProperties = {
  background: '#fff',
  border: '1.5px solid #d4dade',
  borderRadius: 18,
  padding: '24px 22px',
  marginBottom: 14,
}

const BTN_PRIMARY: React.CSSProperties = {
  width: '100%', height: 52,
  background: 'var(--brand-primary)', color: '#fff',
  border: 'none', borderRadius: 13,
  fontSize: 15, fontWeight: 800,
  cursor: 'pointer', display: 'flex',
  alignItems: 'center', justifyContent: 'center',
  gap: 9, transition: 'background 0.15s',
}

const BTN_OUTLINE: React.CSSProperties = {
  flex: 1, height: 44,
  background: '#fff', color: 'var(--brand-primary)',
  border: '1.5px solid var(--brand-primary)', borderRadius: 11,
  fontSize: 13, fontWeight: 800,
  cursor: 'pointer', display: 'flex',
  alignItems: 'center', justifyContent: 'center',
  gap: 7,
}

const BTN_GHOST: React.CSSProperties = {
  flex: 1, height: 44,
  background: '#f5f8f7', color: '#6b7280',
  border: '1px solid #d4dade', borderRadius: 11,
  fontSize: 13, fontWeight: 700,
  cursor: 'pointer', display: 'flex',
  alignItems: 'center', justifyContent: 'center',
  gap: 7,
}

export function StepTicket({
  folio, total, busy, lookupError, ticket, showFolioHelp,
  onFolioChange, onTotalChange, onToggleFolioHelp,
  onLookup, onDismissError, onFillDemo, onScanQR, onDownloadPdf,
}: StepTicketProps) {
  return (
    <div style={{ width: '100%', maxWidth: 480, animation: 'fadeIn 0.3s ease both' }}>

      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{
          width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, var(--brand-primary), var(--brand-dark))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 14px', boxShadow: '0 8px 24px rgba(16,132,116,0.28)',
        }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: '#1a1a1a', letterSpacing: '-0.03em', marginBottom: 6 }}>
          Factura tu compra
        </h1>
        <p style={{ fontSize: 13.5, color: '#6b7280', fontWeight: 600, lineHeight: 1.5 }}>
          Ingresa los datos de tu ticket para generar tu CFDI 4.0
        </p>
      </div>

      {/* QR / Folio card */}
      <div style={CARD}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#1a1a1a', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#108474" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
            <line x1="14" y1="14" x2="14" y2="14"/><line x1="17" y1="14" x2="17" y2="14"/><line x1="20" y1="14" x2="20" y2="14"/>
            <line x1="14" y1="17" x2="14" y2="17"/><line x1="17" y1="17" x2="17" y2="17"/><line x1="20" y1="17" x2="20" y2="17"/>
            <line x1="14" y1="20" x2="14" y2="20"/><line x1="17" y1="20" x2="17" y2="20"/><line x1="20" y1="20" x2="20" y2="20"/>
          </svg>
          Localiza tu ticket
        </div>

        {/* QR button */}
        <button type="button" onClick={onScanQR} style={{
          width: '100%', height: 50, background: '#f5f8f7',
          border: '1.5px dashed #d4dade', borderRadius: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 10, cursor: 'pointer', marginBottom: 18,
          fontSize: 13.5, fontWeight: 700, color: '#6b7280',
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#108474" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 7 23 1 17 1"/><line x1="16" y1="8" x2="23" y2="1"/>
            <polyline points="1 17 1 23 7 23"/><line x1="8" y1="16" x2="1" y2="23"/>
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
          </svg>
          Escanear código QR del ticket
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div style={{ flex: 1, height: 1, background: '#e2e7e6' }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>o ingresa manualmente</span>
          <div style={{ flex: 1, height: 1, background: '#e2e7e6' }} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Folio field */}
          <FormField
            label="Folio del ticket"
            value={folio}
            onChange={(e) => onFolioChange(e.target.value)}
            placeholder="Ej. A1522-0847"
            badge={
              <button
                type="button"
                onClick={onToggleFolioHelp}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 11, fontWeight: 700, color: 'var(--brand-primary)',
                  display: 'flex', alignItems: 'center', gap: 4, padding: 0,
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
                </svg>
                ¿Dónde está el folio?
              </button>
            }
          />

          {/* Folio help tooltip */}
          {showFolioHelp && (
            <div style={{
              background: '#f5f8f7', border: '1.5px solid #d4dade',
              borderRadius: 12, padding: 14, animation: 'fadeIn 0.2s ease both',
            }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#1a1a1a', marginBottom: 8 }}>
                Ejemplo de ticket
              </div>
              {/* Simulated ticket */}
              <div style={{
                background: '#fff', border: '1px solid #e2e7e6',
                borderRadius: 10, padding: '12px 14px',
                fontFamily: 'monospace', fontSize: 11,
              }}>
                <div style={{ textAlign: 'center', marginBottom: 8 }}>
                  <div style={{ fontWeight: 900, fontSize: 12 }}>GRUPO 1522</div>
                  <div style={{ color: '#6b7280', fontSize: 10 }}>Plaza Central · Sucursal 01</div>
                </div>
                <div style={{ borderTop: '1px dashed #d4dade', margin: '8px 0' }} />
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  padding: '4px 0', color: 'var(--brand-primary)', fontWeight: 900, fontSize: 12,
                }}>
                  <span>FOLIO:</span>
                  <span style={{
                    background: '#d1fae5', border: '2px solid var(--brand-primary)',
                    borderRadius: 4, padding: '1px 6px',
                  }}>A1522-0847</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10, color: '#6b7280' }}>
                  <span>Fecha:</span><span>14/06/2026 18:42</span>
                </div>
                <div style={{ borderTop: '1px dashed #d4dade', margin: '8px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, fontSize: 12 }}>
                  <span>TOTAL:</span><span>$2,499.00</span>
                </div>
              </div>
              <p style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, marginTop: 8 }}>
                El folio aparece en la parte superior de tu ticket impreso.
              </p>
            </div>
          )}

          {/* Importe field */}
          <FormField
            label="Importe total (opcional)"
            value={total}
            onChange={(e) => onTotalChange(e.target.value)}
            placeholder="0.00"
            type="number"
            min="0"
            step="0.01"
            hint={
              <div style={{ fontSize: 11.5, color: '#9ca3af', fontWeight: 600, marginTop: 5 }}>
                Para verificar que el ticket coincide. Puedes dejarlo en blanco.
              </div>
            }
          />
        </div>
      </div>

      {/* Error states */}
      {lookupError === 'notfound' && (
        <div style={{ marginBottom: 14 }}>
          <AlertBanner
            variant="error"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            }
            title="Ticket no encontrado"
            description="Verifica el folio. Recuerda que el folio tiene el formato A####-#### (letras y guión)."
            actions={
              <button type="button" onClick={onDismissError} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 800, color: '#dc2626', padding: 0,
                textDecoration: 'underline',
              }}>
                Intentar con otro folio
              </button>
            }
          />
        </div>
      )}

      {lookupError === 'mismatch' && (
        <div style={{ marginBottom: 14 }}>
          <AlertBanner
            variant="warning"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            }
            title="El importe no coincide"
            description="El importe ingresado no coincide con el total de este ticket. Verifica la cantidad o deja el campo en blanco."
            actions={
              <button type="button" onClick={onDismissError} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 800, color: '#b45309', padding: 0,
                textDecoration: 'underline',
              }}>
                Corregir importe
              </button>
            }
          />
        </div>
      )}

      {lookupError === 'invoiced' && ticket && (
        <div style={{ marginBottom: 14 }}>
          <AlertBanner
            variant="neutral"
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#108474" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <polyline points="14 2 14 8 20 8"/><polyline points="9 15 12 18 15 15"/><line x1="12" y1="10" x2="12" y2="18"/>
              </svg>
            }
            title="Este ticket ya fue facturado"
            description={
              <>
                Folio: <strong>{ticket.facturaFolio}</strong> · Timbrado: {ticket.fechaTimbrado}
              </>
            }
            actions={
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button type="button" onClick={onDownloadPdf} style={BTN_OUTLINE}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  Descargar factura
                </button>
                <button type="button" onClick={onDismissError} style={BTN_GHOST}>
                  Usar otro ticket
                </button>
              </div>
            }
          />
        </div>
      )}

      {/* CTA button */}
      <button
        type="button"
        onClick={onLookup}
        disabled={busy}
        style={{ ...BTN_PRIMARY, opacity: busy ? 0.85 : 1, marginBottom: 14 }}
      >
        {busy ? (
          <>
            <LoadingSpinner size={17} />
            Buscando ticket…
          </>
        ) : (
          <>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            Buscar y continuar
          </>
        )}
      </button>

      {/* Footer note */}
      <div style={{ textAlign: 'center', fontSize: 12, color: '#9ca3af', fontWeight: 600, marginBottom: 22 }}>
        Tu factura será timbrada ante el SAT en unos segundos
      </div>

      {/* Demo helper */}
      <div style={{
        background: '#f0f9ff', border: '1px solid #bae6fd',
        borderRadius: 13, padding: '14px 16px',
      }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#0369a1', marginBottom: 10 }}>
          Ejemplos de demo (solo para pruebas)
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => onFillDemo('A1522-0847', '2499')}
            style={{
              flex: 1, minWidth: 140, height: 38,
              background: '#fff', border: '1px solid #bae6fd', borderRadius: 9,
              fontSize: 12, fontWeight: 700, color: '#0369a1',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <span style={{ fontFamily: 'monospace', fontSize: 11 }}>A1522-0847</span>
            <span style={{ color: '#9ca3af' }}>·</span>
            <span>$2,499</span>
          </button>
          <button
            type="button"
            onClick={() => onFillDemo('A1522-1203', '1799')}
            style={{
              flex: 1, minWidth: 140, height: 38,
              background: '#fff', border: '1px solid #fcd34d', borderRadius: 9,
              fontSize: 12, fontWeight: 700, color: '#b45309',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <span style={{ fontFamily: 'monospace', fontSize: 11 }}>A1522-1203</span>
            <span style={{ color: '#9ca3af' }}>·</span>
            <span>Ya facturado</span>
          </button>
        </div>
      </div>
    </div>
  )
}
