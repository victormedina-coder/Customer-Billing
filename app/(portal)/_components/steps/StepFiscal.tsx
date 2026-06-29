'use client'
import { useState } from 'react'
import type { Ticket, FiscalData, RfcValidationState } from '../../_lib/types'
// privacyAccepted se maneja en usePortal y se persiste en sessionStorage para
// sobrevivir el round-trip portal → aviso de privacidad → portal.
import { formatMXN } from '../../_lib/formatters'
import { validateFiscal } from '../../_lib/validators'
import { REGIMENES, USOS_CFDI, METODO_PAGO_LABEL } from '../../_lib/constants'
import { FormField } from '../ui/FormField'
import { FormSelect } from '../ui/FormSelect'
import { BackButton } from '../ui/BackButton'
import { AlertBanner } from '../ui/AlertBanner'
import { AvisoPrivacidadContent } from '../legal/AvisoPrivacidadContent'

interface StepFiscalProps {
  ticket: Ticket
  fiscal: FiscalData
  touched: boolean
  privacyAccepted: boolean
  rfcValidation: RfcValidationState
  /** true cuando la validación de identidad SAT (Continuar) falló. Anti-oráculo: no indica qué campo. */
  satError?: boolean
  validating?: boolean
  onBack: () => void
  onFiscalChange: <K extends keyof FiscalData>(key: K, value: FiscalData[K]) => void
  onRfcBlur: (rfc: string) => void
  onPrivacyAcceptedChange: (accepted: boolean) => void
  onContinue: () => void
}

const CARD: React.CSSProperties = {
  background: '#fff',
  border: '1.5px solid var(--border-default)',
  borderRadius: 18,
  padding: '22px 20px',
  marginBottom: 14,
}

const BTN_PRIMARY: React.CSSProperties = {
  flex: 2, height: 52,
  background: 'var(--brand-primary)', color: '#000000',
  border: 'none', borderRadius: 13,
  fontSize: 15, fontWeight: 800,
  cursor: 'pointer', display: 'flex',
  alignItems: 'center', justifyContent: 'center', gap: 8,
  transition: 'background 0.15s',
}

// Anti-oráculo: el badge SOLO refleja el formato local del RFC, nunca su
// existencia o registro en el SAT. La verificación real ocurre al pulsar
// Continuar y se colapsa en un error genérico (ver banner satError abajo).
function RfcBadge({ state }: { state: RfcValidationState }) {
  if (state === 'valid-format') return (
    <span style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', background: '#f5f5f5', border: '1px solid var(--border-default)', borderRadius: 20, padding: '3px 9px' }}>
      Formato válido
    </span>
  )
  if (state === 'invalid') return (
    <span style={{ fontSize: 10, fontWeight: 700, color: '#dc2626', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 20, padding: '3px 9px' }}>
      Formato de RFC inválido
    </span>
  )
  return null
}

export function StepFiscal({
  ticket, fiscal, touched, privacyAccepted, rfcValidation, satError = false, validating = false,
  onBack, onFiscalChange, onRfcBlur, onPrivacyAcceptedChange, onContinue,
}: StepFiscalProps) {
  // Errores de FORMATO local por campo (de validateFiscal). Anti-oráculo: satError
  // NO se mezcla aquí — se muestra como banner genérico, sin marcar campos individuales.
  const errors = touched ? validateFiscal(fiscal) : {}

  // accordionOpen es UI-transient: no necesita sobrevivir el round-trip.
  const [accordionOpen, setAccordionOpen] = useState(false)

  return (
    <div style={{ width: '100%', maxWidth: 520, animation: 'fadeIn 0.3s ease both' }}>
      <BackButton onClick={onBack} />

      {/* Verified ticket chip */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        background: '#d1fae5', border: '1px solid #6ee7b7',
        borderRadius: 12, padding: '10px 14px', marginBottom: 18,
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: '#065f46' }}>
          Ticket verificado: <strong>{ticket.folio}</strong>
          <span style={{ color: '#047857', fontWeight: 600 }}> · {ticket.sucursal} · {formatMXN(ticket.total)}</span>
        </div>
      </div>

      {/* Error genérico de identidad SAT — anti-oráculo: nunca señala qué campo falló,
          solo recuerda la lista de datos a revisar. */}
      {satError && (
        <div style={{ marginBottom: 14 }}>
          <AlertBanner
            variant="error"
            title="No pudimos validar tus datos fiscales con el SAT"
            description="Verifica que tu RFC, nombre o razón social, código postal y régimen fiscal sean correctos e inténtalo de nuevo."
          />
        </div>
      )}

      {/* Fiscal form card */}
      <div style={CARD}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#1a1a1a', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
          </svg>
          Datos fiscales del receptor
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* RFC */}
          <FormField
            label="RFC"
            value={fiscal.rfc}
            onChange={(e) => onFiscalChange('rfc', e.target.value.toUpperCase())}
            onBlur={(e) => onRfcBlur(e.target.value)}
            placeholder="XAXX010101000"
            maxLength={13}
            error={errors.rfc}
            badge={<RfcBadge state={rfcValidation} />}
            autoCapitalize="characters"
            spellCheck={false}
            autoComplete="off"
          />

          {/* Razón social */}
          <FormField
            label="Nombre o razón social"
            value={fiscal.razon}
            onChange={(e) => onFiscalChange('razon', e.target.value)}
            placeholder="Nombre completo o razón social"
            error={errors.razon}
            hint={
              <div style={{ fontSize: 11.5, color: '#6b7280', fontWeight: 600, marginTop: 5 }}>
                Como aparece en tu Constancia de Situación Fiscal.
              </div>
            }
          />

          {/* Régimen fiscal */}
          <FormSelect
            label="Régimen fiscal"
            value={fiscal.regimen}
            onChange={(e) => onFiscalChange('regimen', e.target.value)}
            options={REGIMENES}
            error={errors.regimen}
            placeholder="Selecciona tu régimen…"
          />

          {/* CP + Uso CFDI row */}
          <div className="fiscal-cp-uso-grid">
            <FormField
              label="Código postal"
              value={fiscal.cp}
              onChange={(e) => onFiscalChange('cp', e.target.value)}
              placeholder="00000"
              maxLength={5}
              inputMode="numeric"
              error={errors.cp}
            />
            <FormSelect
              label="Uso del CFDI"
              value={fiscal.uso}
              onChange={(e) => onFiscalChange('uso', e.target.value)}
              options={USOS_CFDI}
              error={errors.uso}
              placeholder="Uso…"
            />
          </div>

          {/* Email */}
          <FormField
            label="Correo electrónico"
            value={fiscal.email}
            onChange={(e) => onFiscalChange('email', e.target.value)}
            placeholder="tu@correo.com"
            type="email"
            inputMode="email"
            autoComplete="email"
            error={errors.email}
          />

          {/* Separator */}
          <div style={{ borderTop: '1px solid var(--border-default)', paddingTop: 16 }}>
            <div className="fiscal-payment-grid">
              {/* Forma de pago (from ticket) */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#6b7280', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 7 }}>
                  Forma de pago
                </div>
                <div style={{
                  height: 50, border: '2px solid var(--border-default)',
                  borderRadius: 11, padding: '0 15px',
                  fontSize: 13, fontWeight: 700, color: '#6b7280',
                  display: 'flex', alignItems: 'center',
                  background: '#f9fafb',
                }}>
                  {ticket.formaPago}
                </div>
              </div>

              {/* Método de pago (PUE, readonly) */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#6b7280', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 7, display: 'flex', alignItems: 'center', gap: 5 }}>
                  Método de pago
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
                  </svg>
                </div>
                <div style={{
                  height: 50, border: '2px solid var(--border-default)',
                  borderRadius: 11, padding: '0 15px',
                  fontSize: 13, fontWeight: 700, color: '#6b7280',
                  display: 'flex', alignItems: 'center',
                  background: '#f9fafb',
                }}>
                  {METODO_PAGO_LABEL}
                </div>
              </div>
            </div>

            <div style={{ fontSize: 11.5, color: '#6b7280', fontWeight: 700, marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              PUE es el único método disponible para compras en punto de venta. No es editable.
            </div>
          </div>

          {/* Privacy signal */}
          <div style={{ borderTop: '1px solid var(--border-default)', paddingTop: 12, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
            </svg>
            <span style={{ fontSize: 11.5, color: '#6b7280', fontWeight: 700 }}>
              Tus datos solo se usan para generar tu factura.
            </span>
          </div>
        </div>
      </div>

      {/* ── Aviso de Privacidad — acordeón + checkbox ──────────────────────── */}
      <div style={{
        background: '#fff',
        border: '1.5px solid var(--brand-primary)',
        borderRadius: 14,
        marginBottom: 14,
        overflow: 'hidden',
      }}>
        {/* Trigger del acordeón */}
        <button
          type="button"
          aria-expanded={accordionOpen}
          aria-controls="aviso-privacidad-content"
          onClick={() => setAccordionOpen(prev => !prev)}
          className="btn-press"
          style={{
            width: '100%',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <span style={{ fontSize: 13.5, fontWeight: 800, color: '#1a1a1a', display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--brand-primary)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
            </svg>
            Aviso de Privacidad
          </span>
          {/* Chevron rotatorio */}
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#6b7280"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{
              flexShrink: 0,
              transition: 'transform 0.2s ease',
              transform: accordionOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {/* Contenido expandible */}
        <div
          id="aviso-privacidad-content"
          role="region"
          aria-label="Aviso de Privacidad"
          style={{
            maxHeight: accordionOpen ? '280px' : '0px',
            overflowY: accordionOpen ? 'auto' : 'hidden',
            opacity: accordionOpen ? 1 : 0,
            visibility: accordionOpen ? 'visible' : 'hidden',
            transition: 'max-height 0.25s ease, opacity 0.2s ease',
            borderTop: accordionOpen ? '1px solid var(--border-light)' : 'none',
            padding: accordionOpen ? '16px' : '0 16px',
          }}
        >
          <AvisoPrivacidadContent />
        </div>

        {/* Checkbox de aceptación */}
        <div style={{
          borderTop: '1px solid var(--border-light)',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
        }}>
          <input
            type="checkbox"
            id="privacy-accepted"
            checked={privacyAccepted}
            onChange={(e) => onPrivacyAcceptedChange(e.target.checked)}
            style={{
              marginTop: 2,
              width: 16,
              height: 16,
              cursor: 'pointer',
              accentColor: 'var(--brand-primary)',
              flexShrink: 0,
            }}
          />
          <label
            htmlFor="privacy-accepted"
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: '#374151',
              lineHeight: 1.5,
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            He leído y acepto el{' '}
            <a
              href="/aviso-privacidad"
              style={{ color: '#000000', fontWeight: 700, textDecoration: 'underline' }}
            >
              Aviso de Privacidad
            </a>
          </label>
        </div>

        {/* TODO: Términos y Condiciones — descomentar cuando llegue el texto
        <div style={{ borderTop: '1px solid var(--border-light)', padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <input type="checkbox" id="terms-accepted" style={{ marginTop: 2, width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--brand-primary)', flexShrink: 0 }} />
          <label htmlFor="terms-accepted" style={{ fontSize: 13, fontWeight: 600, color: '#374151', lineHeight: 1.5, cursor: 'pointer', userSelect: 'none' }}>
            He leído y acepto los{' '}
            <a href="/terminos-condiciones" target="_blank" rel="noopener noreferrer" style={{ color: '#000000', fontWeight: 700, textDecoration: 'underline' }}>
              Términos y Condiciones
            </a>
          </label>
        </div>
        */}
      </div>

      {/* Navigation buttons */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          type="button"
          onClick={onBack}
          className="btn-press"
          style={{
            flex: 1, height: 52,
            background: '#fff', color: '#6b7280',
            border: '1.5px solid var(--border-default)', borderRadius: 13,
            fontSize: 14, fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Atrás
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={validating || !privacyAccepted}
          className="btn-press"
          style={{
            ...BTN_PRIMARY,
            opacity: (validating || !privacyAccepted) ? 0.5 : 1,
            cursor: (validating || !privacyAccepted) ? 'not-allowed' : 'pointer',
          }}
        >
          {validating ? 'Verificando…' : 'Continuar'}
          {!validating && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000000" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}
