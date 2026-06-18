'use client'
import type { LookupError, Ticket } from '../../_lib/types'
import { formatMXN } from '../../_lib/formatters'
import { FormField } from '../ui/FormField'
import { AlertBanner } from '../ui/AlertBanner'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import Image from 'next/image'

interface StepTicketProps {
  folio: string
  busy: boolean
  lookupError: LookupError
  ticket: Ticket | null
  showFolioHelp: boolean
  onFolioChange: (v: string) => void
  onToggleFolioHelp: () => void
  onLookup: () => void
  onProceed: () => void
  onDismissError: () => void
  onFillDemo: (folio: string) => void
  onScanQR: () => void
  onDownloadPdf: () => void
}

const CARD: React.CSSProperties = {
  background: '#fff',
  border: '1.5px solid var(--border-default)',
  borderRadius: 18,
  padding: '24px 22px',
  marginBottom: 14,
}

const BTN_PRIMARY: React.CSSProperties = {
  width: '100%', height: 52,
  background: 'var(--brand-primary)', color: '#000000',
  border: 'none', borderRadius: 13,
  fontSize: 15, fontWeight: 800,
  cursor: 'pointer', display: 'flex',
  alignItems: 'center', justifyContent: 'center',
  gap: 9, transition: 'background 0.15s',
}

const BTN_OUTLINE: React.CSSProperties = {
  flex: 1, height: 44,
  background: '#fff', color: '#000000',
  border: '1.5px solid var(--border-default)', borderRadius: 11,
  fontSize: 13, fontWeight: 800,
  cursor: 'pointer', display: 'flex',
  alignItems: 'center', justifyContent: 'center',
  gap: 7,
}

const BTN_GHOST: React.CSSProperties = {
  flex: 1, height: 44,
  background: '#f5f5f5', color: '#6b7280',
  border: '1px solid var(--border-default)', borderRadius: 11,
  fontSize: 13, fontWeight: 700,
  cursor: 'pointer', display: 'flex',
  alignItems: 'center', justifyContent: 'center',
  gap: 7,
}

export function StepTicket({
  folio, busy, lookupError, ticket, showFolioHelp,
  onFolioChange, onToggleFolioHelp,
  onLookup, onProceed, onDismissError, onFillDemo, onScanQR, onDownloadPdf,
}: StepTicketProps) {
  // Ticket válido cargado (sin error) → el botón pasa de "Buscar" a "Continuar".
  const hasOkTicket = !!ticket && ticket.status === 'ok' && lookupError === ''
  return (
    <div style={{ width: '100%', maxWidth: 480, animation: 'fadeIn 0.3s ease both' }}>

      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        {/* Brand logos strip — 3 marcas con proporciones reales preservadas */}
        <p className="brand-logos-label">Facturación para nuestras marcas</p>
        <div className="brand-logos" role="list" aria-label="Marcas disponibles">
          {/* Stetson: 1500×500 → ratio 3:1, wordmark horizontal */}
          <div className="brand-logos-item" role="listitem">
            <div className="brand-logos-img-wrap">
              <Image
                src="/assets/logo_Stetson_Brown.png"
                alt="Stetson"
                fill
                sizes="(max-width: 380px) 64px, (max-width: 640px) 80px, 96px"
              />
            </div>
          </div>
          {/* Ariat: 801×801 → ratio 1:1, cuadrado */}
          <div className="brand-logos-item" role="listitem">
            <div className="brand-logos-img-wrap">
              <Image
                src="/assets/logo_ariat_degradado.png"
                alt="Ariat"
                fill
                sizes="(max-width: 380px) 24px, (max-width: 640px) 28px, 36px"
              />
            </div>
          </div>
          {/* Western Brothers: 4000×2250 → ratio ~1.78:1 */}
          <div className="brand-logos-item" role="listitem">
            <div className="brand-logos-img-wrap">
              <Image
                src="/assets/logo_wb_color.png"
                alt="Western Brothers"
                fill
                sizes="(max-width: 380px) 64px, (max-width: 640px) 80px, 96px"
              />
            </div>
          </div>
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 900, color: '#1a1a1a', letterSpacing: '-0.03em', marginBottom: 6 }}>
          Factura tu compra
        </h1>
        <p style={{ fontSize: 13.5, color: '#6b7280', fontWeight: 600, lineHeight: 1.5 }}>
          Ingresa los datos de tu ticket para generar tu CFDI.
        </p>
      </div>

      {/* QR / Folio card */}
      <div style={CARD}>
        {/* <div style={{ fontSize: 13, fontWeight: 800, color: '#1a1a1a', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#108474" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
            <line x1="14" y1="14" x2="14" y2="14"/><line x1="17" y1="14" x2="17" y2="14"/><line x1="20" y1="14" x2="20" y2="14"/>
            <line x1="14" y1="17" x2="14" y2="17"/><line x1="17" y1="17" x2="17" y2="17"/><line x1="20" y1="17" x2="20" y2="17"/>
            <line x1="14" y1="20" x2="14" y2="20"/><line x1="17" y1="20" x2="17" y2="20"/><line x1="20" y1="20" x2="20" y2="20"/>
          </svg>
          Localiza tu ticket
        </div> */}

        {/* QR button */}
        {/* <button type="button" onClick={onScanQR} style={{
          width: '100%', height: 50, background: '#f5f8f7',
          border: '1.5px dashed var(--border-default)', borderRadius: 12,
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
        </button> */}

        {/* <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div style={{ flex: 1, height: 1, background: '#e2e7e6' }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>o ingresa manualmente</span>
          <div style={{ flex: 1, height: 1, background: '#e2e7e6' }} />
        </div> */}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Folio field */}
          <FormField
            label="Folio del ticket"
            value={folio}
            onChange={(e) => onFolioChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onLookup() } }}
            placeholder="Ej. A1522-0847"
            autoComplete="off"
            badge={
              <button
                type="button"
                onClick={onToggleFolioHelp}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 11, fontWeight: 700, color: '#000000',
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
              background: '#f5f5f5', border: '1.5px solid var(--border-default)',
              borderRadius: 12, padding: 14, animation: 'fadeIn 0.2s ease both',
            }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#1a1a1a', marginBottom: 8 }}>
                Ejemplo de ticket
              </div>
              {/* Simulated ticket */}
              <div style={{
                background: '#fff', border: '1px solid var(--border-default)',
                borderRadius: 10, padding: '12px 14px',
                fontFamily: 'monospace', fontSize: 11,
              }}>
                <div style={{ textAlign: 'center', marginBottom: 8 }}>
                  <div style={{ fontWeight: 900, fontSize: 12 }}>GRUPO 1522</div>
                  <div style={{ color: '#6b7280', fontSize: 10 }}>Plaza Central · Sucursal 01</div>
                </div>
                <div style={{ borderTop: '1px dashed var(--border-default)', margin: '8px 0' }} />
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  padding: '4px 0', color: '#000000', fontWeight: 900, fontSize: 12,
                }}>
                  <span>FOLIO:</span>
                  <span style={{
                    background: 'var(--brand-primary)', border: '2px solid var(--brand-primary)',
                    color: '#000000', borderRadius: 4, padding: '1px 6px',
                  }}>A1522-0847</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10, color: '#6b7280' }}>
                  <span>Fecha:</span><span>14/06/2026 18:42</span>
                </div>
                <div style={{ borderTop: '1px dashed var(--border-default)', margin: '8px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, fontSize: 12 }}>
                  <span>TOTAL:</span><span>$2,499.00</span>
                </div>
              </div>
              <p style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, marginTop: 8 }}>
                El folio aparece en la parte superior de tu ticket impreso.
              </p>
            </div>
          )}

          {/* Importe field — solo lectura: se obtiene del ticket al buscar el folio */}
          <FormField
            label="Importe total"
            value={ticket ? formatMXN(ticket.total) : ''}
            placeholder="0.00"
            type="text"
            readOnly
            inputMode="none"
            style={{ background: '#f5f5f5', color: '#6b7280', cursor: 'not-allowed' }}
            badge={
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: '#9ca3af' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
                Automático
              </span>
            }
            hint={
              <div style={{ fontSize: 11.5, color: '#9ca3af', fontWeight: 600, marginTop: 5 }}>
                Se obtiene automáticamente al buscar tu folio.
              </div>
            }
          />
        </div>
      </div>

      {/* Ticket encontrado (válido) */}
      {hasOkTicket && ticket && (
        <div style={{ marginBottom: 14 }}>
          <AlertBanner
            variant="success"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#15803d" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            }
            title="Ticket encontrado"
            description={
              <>
                {ticket.sucursal} · {ticket.fecha} · Total <strong>{formatMXN(ticket.total)}</strong>
              </>
            }
          />
        </div>
      )}

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

      {lookupError === 'invoiced' && ticket && (
        <div style={{ marginBottom: 14 }}>
          <AlertBanner
            variant="neutral"
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
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

      {/* CTAs separados: Continuar (solo con ticket válido) + Buscar ticket (siempre) */}
      {hasOkTicket && (
        <button
          type="button"
          onClick={onProceed}
          style={{ ...BTN_PRIMARY, marginBottom: 10 }}
        >
          Continuar
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#000000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
          </svg>
        </button>
      )}

      <button
        type="button"
        onClick={onLookup}
        disabled={busy}
        style={
          hasOkTicket
            ? {
                width: '100%', height: 48,
                background: '#fff', color: '#000000',
                border: '1.5px solid var(--border-default)', borderRadius: 13,
                fontSize: 14, fontWeight: 800,
                cursor: 'pointer', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                gap: 9, marginBottom: 14, opacity: busy ? 0.85 : 1,
              }
            : { ...BTN_PRIMARY, opacity: busy ? 0.85 : 1, marginBottom: 14 }
        }
      >
        {busy ? (
          <>
            <LoadingSpinner size={17} />
            Buscando ticket…
          </>
        ) : (
          <>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#000000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            {hasOkTicket ? 'Buscar otro ticket' : 'Buscar ticket'}
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
        <div style={{ fontSize: 12, fontWeight: 800, color: '#0369a1', marginBottom: 4 }}>
          Escenarios de demo (solo para pruebas)
        </div>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 10 }}>
          Haz clic en cualquier escenario para ver el flujo completo.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>

          {/* Escenario OK */}
          <button
            type="button"
            onClick={() => onFillDemo('A1522-0847')}
            style={{
              width: '100%', height: 40,
              background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 9,
              fontSize: 12, fontWeight: 700, color: '#15803d',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
              padding: '0 12px',
            }}
          >
            <span style={{ fontSize: 16 }}>✓</span>
            <span style={{ fontFamily: 'monospace', fontSize: 11 }}>A1522-0847</span>
            <span style={{ color: '#9ca3af', fontWeight: 400 }}>·</span>
            <span>Ticket OK — avanza al formulario fiscal</span>
          </button>

          {/* Escenario Ya facturado */}
          <button
            type="button"
            onClick={() => onFillDemo('A1522-1203')}
            style={{
              width: '100%', height: 40,
              background: '#fff7ed', border: '1px solid #fcd34d', borderRadius: 9,
              fontSize: 12, fontWeight: 700, color: '#b45309',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
              padding: '0 12px',
            }}
          >
            <span style={{ fontSize: 16 }}>⚠</span>
            <span style={{ fontFamily: 'monospace', fontSize: 11 }}>A1522-1203</span>
            <span style={{ color: '#9ca3af', fontWeight: 400 }}>·</span>
            <span>Ya facturado — muestra alerta + descarga</span>
          </button>

          {/* Escenario No encontrado */}
          <button
            type="button"
            onClick={() => onFillDemo('A1522-9999')}
            style={{
              width: '100%', height: 40,
              background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 9,
              fontSize: 12, fontWeight: 700, color: '#991b1b',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
              padding: '0 12px',
            }}
          >
            <span style={{ fontSize: 16 }}>✕</span>
            <span style={{ fontFamily: 'monospace', fontSize: 11 }}>A1522-9999</span>
            <span style={{ color: '#9ca3af', fontWeight: 400 }}>·</span>
            <span>No encontrado — muestra error de folio</span>
          </button>

        </div>
      </div>
    </div>
  )
}
