interface ToastProps {
  message: string
  visible: boolean
}

export function Toast({ message, visible }: ToastProps) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true">
      {visible && (
        <div style={{
          position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
          background: '#000000', color: '#ffffff',
          padding: '13px 20px', borderRadius: 13,
          fontSize: 13.5, fontWeight: 700,
          boxShadow: '0 12px 32px rgba(0,0,0,0.3)',
          zIndex: 60, display: 'flex', alignItems: 'center', gap: 10,
          animation: 'toastIn 0.3s cubic-bezier(.22,.68,0,1.2) both',
          maxWidth: '90vw',
        }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--brand-primary)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          {message}
        </div>
      )}
    </div>
  )
}
