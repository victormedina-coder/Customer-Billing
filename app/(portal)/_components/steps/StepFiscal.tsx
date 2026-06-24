'use client'
import type { Ticket, FiscalData, RfcValidationState } from '../../_lib/types'
import { formatMXN } from '../../_lib/formatters'
import { validateFiscal } from '../../_lib/validators'
import { REGIMENES, USOS_CFDI, METODO_PAGO_LABEL } from '../../_lib/constants'
import { FormField } from '../ui/FormField'
import { FormSelect } from '../ui/FormSelect'
import { BackButton } from '../ui/BackButton'

interface StepFiscalProps {
  ticket: Ticket
  fiscal: FiscalData
  touched: boolean
  rfcValidation: RfcValidationState
  satErrors?: Partial<Record<'rfc' | 'razon' | 'regimen' | 'cp', string>>
  validating?: boolean
  onBack: () => void
  onFiscalChange: <K extends keyof FiscalData>(key: K, value: FiscalData[K]) => void
  onRfcBlur: (rfc: string) => void
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

function RfcBadge({ state }: { state: RfcValidationState }) {
  if (state === 'idle') return (
    <span style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', background: '#f5f5f5', border: '1px solid var(--border-default)', borderRadius: 20, padding: '3px 9px' }}>
      Validación SAT
    </span>
  )
  if (state === 'checking') return (
    <span style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', background: '#f5f5f5', border: '1px solid var(--border-default)', borderRadius: 20, padding: '3px 9px', display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 10, height: 10, border: '1.5px solid rgba(0,0,0,0.15)', borderTopColor: '#000000', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
      Verificando…
    </span>
  )
  if (state === 'registered') return (
    <span style={{ fontSize: 10, fontWeight: 700, color: '#000000', background: 'var(--brand-primary)', border: '1px solid var(--brand-primary)', borderRadius: 20, padding: '3px 9px' }}>
      ✓ Registrado en SAT
    </span>
  )
  if (state === 'format') return (
    <span style={{ fontSize: 10, fontWeight: 700, color: '#b45309', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 20, padding: '3px 9px' }}>
      RFC válido · No registrado
    </span>
  )
  if (state === 'invalid') return (
    <span style={{ fontSize: 10, fontWeight: 700, color: '#dc2626', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 20, padding: '3px 9px' }}>
      Formato inválido
    </span>
  )
  return null
}

export function StepFiscal({
  ticket, fiscal, touched, rfcValidation, satErrors = {}, validating = false,
  onBack, onFiscalChange, onRfcBlur, onContinue,
}: StepFiscalProps) {
  // Fusión: errores locales de formato primero, luego errores SAT (coherencia con el servidor).
  const errors = { ...(touched ? validateFiscal(fiscal) : {}), ...satErrors }

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
          disabled={validating}
          className="btn-press"
          style={{
            ...BTN_PRIMARY,
            opacity: validating ? 0.6 : 1,
            cursor: validating ? 'not-allowed' : 'pointer',
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
