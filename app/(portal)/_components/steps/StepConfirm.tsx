'use client'
import type { Ticket, FiscalData } from '../../_lib/types'
import { formatMXN, calcSubtotal, calcIva } from '../../_lib/formatters'
import { METODO_PAGO_LABEL, REGIMENES, USOS_CFDI } from '../../_lib/constants'
import { BackButton } from '../ui/BackButton'
import { LoadingSpinner } from '../ui/LoadingSpinner'

interface StepConfirmProps {
  ticket: Ticket
  fiscal: FiscalData
  busy: boolean
  onBack: () => void
  onGenerate: () => void
}

const CARD: React.CSSProperties = {
  background: '#fff',
  border: '1.5px solid var(--border-default)',
  borderRadius: 18,
  padding: '20px 20px',
  marginBottom: 14,
}

const LABEL: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: '#9ca3af',
  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3,
}

const VALUE: React.CSSProperties = {
  fontSize: 13.5, fontWeight: 700, color: '#1a1a1a', lineHeight: 1.3,
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={LABEL}>{label}</div>
      <div style={VALUE}>{value}</div>
    </div>
  )
}

export function StepConfirm({ ticket, fiscal, busy, onBack, onGenerate }: StepConfirmProps) {
  const regimenLabel = REGIMENES.find(r => r.code === fiscal.regimen)?.label ?? fiscal.regimen
  const usoLabel = USOS_CFDI.find(u => u.code === fiscal.uso)?.label ?? fiscal.uso
  const subtotal = calcSubtotal(ticket.total)
  const iva = calcIva(ticket.total)

  return (
    <div style={{ width: '100%', maxWidth: 520, animation: 'fadeIn 0.3s ease both' }}>
      <BackButton onClick={onBack} />

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 21, fontWeight: 900, color: '#1a1a1a', letterSpacing: '-0.03em', marginBottom: 4 }}>
          Confirma tu factura
        </h2>
        <p style={{ fontSize: 13, color: '#6b7280', fontWeight: 600 }}>
          Revisa los datos antes de timbrar ante el SAT
        </p>
      </div>

      {/* Receptor card */}
      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: '#1a1a1a', display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#000000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
            </svg>
            Receptor (tú)
          </div>
          <button
            type="button"
            onClick={onBack}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 800, color: '#000000',
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            Editar
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <DataRow label="RFC" value={fiscal.rfc} />
          <DataRow label="Código postal" value={fiscal.cp} />
          <div style={{ gridColumn: '1 / -1' }}>
            <DataRow label="Nombre / Razón social" value={fiscal.razon} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <DataRow label="Régimen fiscal" value={regimenLabel} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <DataRow label="Uso del CFDI" value={usoLabel} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <DataRow label="Correo electrónico" value={fiscal.email} />
          </div>
        </div>
      </div>

      {/* Concepts card */}
      <div style={CARD}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: '#1a1a1a', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#000000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
            <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
          </svg>
          Conceptos · Folio {ticket.folio}
        </div>

        {/* Items */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          {ticket.items.map((item) => (
            <div key={item.sku} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: '#f9fafb', borderRadius: 10, padding: '10px 13px',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', marginBottom: 2 }}>{item.desc}</div>
                <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>
                  SKU: {item.sku} · Cant: {item.qty}
                </div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#1a1a1a', flexShrink: 0, marginLeft: 12 }}>
                {formatMXN(item.qty * item.unit)}
              </div>
            </div>
          ))}
        </div>

        {/* Payments */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <div style={{ background: '#f5f5f5', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Forma de pago</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1a1a' }}>{ticket.formaPago}</div>
          </div>
          <div style={{ background: '#f5f5f5', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Método de pago</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1a1a' }}>{METODO_PAGO_LABEL}</div>
          </div>
        </div>

        {/* Totals */}
        <div style={{ borderTop: '1px solid var(--border-default)', paddingTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#6b7280' }}>Subtotal (sin IVA)</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>{formatMXN(subtotal)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#6b7280' }}>IVA 16%</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>{formatMXN(iva)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', background: 'var(--brand-primary)', borderRadius: 11, padding: '11px 14px' }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: '#000000' }}>Total</span>
            <span style={{ fontSize: 16, fontWeight: 900, color: '#000000' }}>{formatMXN(ticket.total)}</span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          type="button"
          onClick={onBack}
          style={{
            flex: 1, height: 52,
            background: '#fff', color: '#6b7280',
            border: '1.5px solid var(--border-default)', borderRadius: 13,
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}
        >
          Atrás
        </button>
        <button
          type="button"
          onClick={onGenerate}
          disabled={busy}
          style={{
            flex: 2, height: 52,
            background: 'var(--brand-primary)', color: '#000000',
            border: 'none', borderRadius: 13,
            fontSize: 15, fontWeight: 800,
            cursor: busy ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
            opacity: busy ? 0.85 : 1,
          }}
        >
          {busy ? (
            <>
              <LoadingSpinner size={17} />
              Generando factura…
            </>
          ) : (
            <>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#000000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              Confirmar y generar factura
            </>
          )}
        </button>
      </div>
    </div>
  )
}
