interface WindowClosedScreenProps {
  /** Correo de facturación configurado server-side (BILLING_CONTACT_EMAIL). */
  contactEmail?: string
}

const CARD: React.CSSProperties = {
  background: '#fff',
  border: '1.5px solid var(--border-default)',
  borderRadius: 18,
  padding: '32px 24px',
  textAlign: 'center',
}

/**
 * Pantalla de bloqueo del portal (R3 — Paso 3.3): reemplaza el flujo
 * completo (stepper + pasos) cuando la ventana de facturación del mes en
 * curso ya cerró (corte de las 21:00 MX del último día — ver
 * `isPortalWindowOpen` en `src/domain/eligibility/InvoiceWindowPolicy.ts`).
 *
 * Es puramente informativa: la autoridad real vive en el servidor
 * (`lookup`/`emit` ya rechazan con el error `deadline`). Esta pantalla evita
 * que el cliente vea y complete un formulario que de todos modos sería
 * rechazado al timbrar.
 */
export function WindowClosedScreen({ contactEmail }: WindowClosedScreenProps) {
  return (
    <div style={{ width: '100%', maxWidth: 480, animation: 'fadeIn 0.3s ease both' }}>
      <div style={CARD}>
        <svg
          width="42" height="42" viewBox="0 0 24 24" fill="none"
          stroke="#b45309" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
          style={{ margin: '0 auto 16px' }}
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
          <path d="M9 16l2 2 4-4" />
        </svg>

        <h1 style={{ fontSize: 20, fontWeight: 900, color: '#1a1a1a', letterSpacing: '-0.02em', marginBottom: 10 }}>
          La ventana de facturación de este mes ya cerró
        </h1>

        <p style={{ fontSize: 13.5, color: '#6b7280', fontWeight: 600, lineHeight: 1.55, marginBottom: contactEmail ? 22 : 0 }}>
          {contactEmail
            ? 'Ya no es posible generar tu factura en línea para compras de este mes. Si necesitas ayuda para facturar tu compra, escríbenos a:'
            : 'Ya no es posible generar tu factura en línea para compras de este mes. Contacta a facturación para recibir ayuda.'}
        </p>

        {contactEmail && (
          <a
            href={`mailto:${contactEmail}`}
            className="btn-press"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              height: 48, padding: '0 22px',
              background: 'var(--brand-primary)', color: '#000000',
              borderRadius: 13, fontSize: 14.5, fontWeight: 800,
              textDecoration: 'none',
            }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#000000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="M22 6l-10 7L2 6" />
            </svg>
            {contactEmail}
          </a>
        )}
      </div>
    </div>
  )
}
