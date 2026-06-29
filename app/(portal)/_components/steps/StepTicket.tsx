'use client'
import type { LookupError, Ticket } from '../../_lib/types'
import { formatMXN } from '../../_lib/formatters'
import { FormField } from '../ui/FormField'
import { AlertBanner } from '../ui/AlertBanner'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import Image from 'next/image'

interface StepTicketProps {
  folio: string
  /** String crudo que teclea el usuario, ej. "8,900.00" o "$1899" */
  amount: string
  busy: boolean
  lookupError: LookupError
  ticket: Ticket | null
  showFolioHelp: boolean
  onFolioChange: (v: string) => void
  onAmountChange: (v: string) => void
  onToggleFolioHelp: () => void
  onLookup: () => void
  onProceed: () => void
  onDismissError: () => void
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
  folio, amount, busy, lookupError, ticket, showFolioHelp,
  onFolioChange, onAmountChange, onToggleFolioHelp,
  onLookup, onProceed, onDismissError, onDownloadPdf,
}: StepTicketProps) {
  // Ticket válido cargado (sin error) — puede ocurrir al hidratarse desde sessionStorage.
  const hasOkTicket = !!ticket && ticket.status === 'ok' && lookupError === ''

  // Enter en cualquiera de los dos campos dispara la validación.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); onLookup() }
  }

  return (
    <div style={{ width: '100%', maxWidth: 480, animation: 'fadeIn 0.3s ease both' }}>

      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        {/* Brand logos strip — 3 marcas con proporciones reales preservadas */}
        <p className="brand-logos-label">Facturación para nuestras marcas</p>
        <div className="brand-logos" role="list" aria-label="Marcas disponibles">
          {/* Stetson: 1500×500 → ratio 3:1, wordmark horizontal */}
          <div className="brand-logos-item" role="listitem">
            <div className="brand-logos-img-wrap brand-logos-img-wrap--stetson">
              <Image
                src="/assets/Stetson_logo.png"
                alt="Stetson"
                fill
                sizes="(max-width: 380px) 108px, (max-width: 640px) 144px, 192px"
              />
            </div>
          </div>
          {/* Ariat: 801×801 → ratio 1:1, cuadrado */}
          <div className="brand-logos-item" role="listitem">
            <div className="brand-logos-img-wrap brand-logos-img-wrap--ariat">
              <Image
                src="/assets/Ariat_logo.png"
                alt="Ariat"
                fill
                sizes="(max-width: 380px) 36px, (max-width: 640px) 48px, 64px"
              />
            </div>
          </div>
          {/* Western Brothers: 4000×2250 → ratio ~1.78:1 */}
          <div className="brand-logos-item" role="listitem">
            <div className="brand-logos-img-wrap brand-logos-img-wrap--wb">
              <Image
                src="/assets/logo_wb_Negro.png"
                alt="Western Brothers"
                fill
                sizes="(max-width: 380px) 64px, (max-width: 640px) 85px, 114px"
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

      {/* Aviso: ventana de facturación (mes en curso) + fecha del CFDI */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 9,
        background: '#f5f5f5', border: '1.5px solid var(--border-default)',
        borderRadius: 12, padding: '11px 14px', marginBottom: 16,
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <p style={{ fontSize: 12, color: '#6b7280', fontWeight: 600, lineHeight: 1.45, margin: 0 }}>
          Recuerda que solo puedes facturar consumos del mismo mes. La fecha de la factura será la del día en que la realices.
        </p>
      </div>

      {/* QR / Folio card — folio + importe en un solo formulario */}
      <div style={CARD}>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Folio field */}
          <FormField
            label="Folio del ticket"
            value={folio}
            onChange={(e) => onFolioChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ej. 15-5333"
            autoComplete="off"
            badge={
              <button
                type="button"
                onClick={onToggleFolioHelp}
                className="btn-press"
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
              {/* Simulated ticket — replica la estructura de un ticket real (tienda) */}
              <div style={{
                background: '#fff', border: '1px solid var(--border-default)',
                borderRadius: 10, padding: '12px 14px',
                fontFamily: 'monospace', fontSize: 11, color: '#1a1a1a',
              }}>
                {/* Encabezado de tienda */}
                <div style={{ textAlign: 'center', marginBottom: 8 }}>
                  <div style={{ fontWeight: 900, fontSize: 13, letterSpacing: '0.18em' }}>ARIAT</div>
                  <div style={{ color: '#6b7280', fontSize: 9.5, lineHeight: 1.45 }}>
                    Ariat Ecuestre Nogales<br />Zapopan, Jalisco · México
                  </div>
                </div>

                {/* Caja TOTAL */}
                <div style={{
                  border: '1.5px solid var(--border-default)', borderRadius: 8,
                  padding: '6px 8px', textAlign: 'center', margin: '8px 0',
                }}>
                  <div style={{ fontSize: 9, color: '#6b7280', letterSpacing: '0.12em' }}>TOTAL</div>
                  <div style={{ fontWeight: 900, fontSize: 14 }}>1,898.00 $</div>
                </div>

                {/* Artículos */}
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#6b7280', fontSize: 9.5, marginBottom: 3 }}>
                  <span>Artículos</span><span>Precio</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}>
                  <span>Playera Ariat Snake M</span><span>899.00 $</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}>
                  <span>Gorra Ariat Arena</span><span>999.00 $</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}>
                  <span>Bolsa de pellón</span><span>0.00 $</span>
                </div>

                <div style={{ borderTop: '1px dashed var(--border-default)', margin: '8px 0' }} />

                {/* Totales */}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0', fontSize: 10, color: '#6b7280' }}>
                  <span>Subtotal</span><span>1,898.00 $</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0', fontSize: 10, color: '#6b7280' }}>
                  <span>IVA (16%)</span><span>261.79 $</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0', fontWeight: 900 }}>
                  <span>Total</span><span>1,898.00 $</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0', fontSize: 10, color: '#6b7280' }}>
                  <span>Tarjeta</span><span>1,898.00 $</span>
                </div>

                <div style={{ borderTop: '1px dashed var(--border-default)', margin: '8px 0' }} />

                {/* Fecha + Recibo (= FOLIO) */}
                <div style={{ textAlign: 'center', color: '#6b7280', fontSize: 9.5, marginBottom: 6 }}>
                  17 jun 2026, 16:57
                </div>
                <div style={{
                  background: 'var(--brand-primary)', borderRadius: 6,
                  padding: '5px 8px', textAlign: 'center',
                }}>
                  <span style={{ fontWeight: 900, fontSize: 12, color: '#000000' }}>Recibo #15-5333</span>
                </div>
                <div style={{ textAlign: 'center', fontSize: 9, fontWeight: 800, color: '#000000', marginTop: 4, letterSpacing: '0.04em' }}>
                  ↑ ESTE ES TU FOLIO
                </div>
              </div>
              <p style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, marginTop: 8 }}>
                Tu folio es el número de <strong>Recibo</strong> (ej. <strong>15-5333</strong>) que aparece al final de tu ticket.
              </p>
            </div>
          )}

          {/* Importe total — ahora EDITABLE: el usuario lo teclea tal como aparece en su ticket.
              El error es genérico (no se revela si fue el folio o el monto el que falló). */}
          <FormField
            label="Importe total del ticket"
            value={amount}
            onChange={(e) => onAmountChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ej. 1,898.00"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            hint={
              <div style={{ fontSize: 11.5, color: '#6b7280', fontWeight: 600, marginTop: 5 }}>
                Tal como aparece como Total en tu ticket.
              </div>
            }
          />
        </div>
      </div>

      {/* Ticket OK (hidratado desde sessionStorage): banner informativo antes de avanzar */}
      {hasOkTicket && ticket && (
        <div style={{ marginBottom: 14 }}>
          <AlertBanner
            variant="success"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#15803d" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            }
            title="Ticket validado"
            description={
              <>
                {ticket.sucursal} · {ticket.fecha} · Total <strong>{formatMXN(ticket.total)}</strong>
              </>
            }
          />
        </div>
      )}

      {/* Error: folio o monto incorrecto (VALIDATION_FAILED — genérico a propósito) */}
      {lookupError === 'invalid' && (
        <div style={{ marginBottom: 14 }}>
          <AlertBanner
            variant="error"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            }
            title="No pudimos validar tu ticket"
            description="El folio o el monto no coinciden con un ticket facturable. Verifica los datos de tu ticket e intenta de nuevo."
            actions={
              <button type="button" onClick={onDismissError} className="btn-press" style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 800, color: '#dc2626', padding: 0,
                textDecoration: 'underline',
              }}>
                Intentar de nuevo
              </button>
            }
          />
        </div>
      )}

      {/* Error legado notfound — conservado por si algún estado viejo está en sessionStorage */}
      {lookupError === 'notfound' && (
        <div style={{ marginBottom: 14 }}>
          <AlertBanner
            variant="error"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            }
            title="No pudimos validar tu ticket"
            description="El folio o el monto no coinciden con un ticket facturable. Verifica los datos de tu ticket e intenta de nuevo."
            actions={
              <button type="button" onClick={onDismissError} className="btn-press" style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 800, color: '#dc2626', padding: 0,
                textDecoration: 'underline',
              }}>
                Intentar de nuevo
              </button>
            }
          />
        </div>
      )}

      {/* Error: demasiados intentos (RATE_LIMITED) */}
      {lookupError === 'ratelimited' && (
        <div style={{ marginBottom: 14 }}>
          <AlertBanner
            variant="warning"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            }
            title="Demasiados intentos"
            description="Espera unos minutos e inténtalo de nuevo."
            actions={
              <button type="button" onClick={onDismissError} className="btn-press" style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 800, color: '#b45309', padding: 0,
                textDecoration: 'underline',
              }}>
                Entendido
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
                <button type="button" onClick={onDownloadPdf} className="btn-press" style={BTN_OUTLINE}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  Descargar factura
                </button>
                <button type="button" onClick={onDismissError} className="btn-press" style={BTN_GHOST}>
                  Usar otro ticket
                </button>
              </div>
            }
          />
        </div>
      )}

      {lookupError === 'deadline' && (
        <div style={{ marginBottom: 14 }}>
          <AlertBanner
            variant="warning"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            }
            title="Periodo de facturación vencido"
            description="Este ticket ya no puede facturarse en línea: solo se puede facturar dentro del mes de la compra."
            actions={
              <button type="button" onClick={onDismissError} className="btn-press" style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 800, color: '#b45309', padding: 0,
                textDecoration: 'underline',
              }}>
                Usar otro ticket
              </button>
            }
          />
        </div>
      )}

      {lookupError === 'refunded' && (
        <div style={{ marginBottom: 14 }}>
          <AlertBanner
            variant="error"
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            }
            title="Pedido reembolsado"
            description="Este pedido fue reembolsado en su totalidad y no puede facturarse."
            actions={
              <button type="button" onClick={onDismissError} className="btn-press" style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 800, color: '#dc2626', padding: 0,
                textDecoration: 'underline',
              }}>
                Usar otro ticket
              </button>
            }
          />
        </div>
      )}

      {/* CTA único: "Continuar" dispara la validación folio+monto en un solo paso.
          Si hay un ticket OK hidratado (sessionStorage), el botón avanza directamente. */}
      <button
        type="button"
        onClick={hasOkTicket ? onProceed : onLookup}
        disabled={busy}
        className="btn-press"
        style={{ ...BTN_PRIMARY, opacity: busy ? 0.85 : 1, marginBottom: 14 }}
        aria-busy={busy}
      >
        {busy ? (
          <>
            <LoadingSpinner size={17} />
            Validando…
          </>
        ) : (
          <>
            {hasOkTicket ? 'Continuar' : 'Continuar'}
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#000000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
            </svg>
          </>
        )}
      </button>

      {/* Footer note */}
      <div style={{ textAlign: 'center', fontSize: 12, color: '#6b7280', fontWeight: 600, marginBottom: 22 }}>
        Tu factura será timbrada ante el SAT en unos segundos
      </div>

    </div>
  )
}
