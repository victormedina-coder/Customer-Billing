import type { ToastType } from '../_lib/types'

interface ToastProps {
  message: string
  visible: boolean
  type?: ToastType
}

// Mismos colores que AlertBanner (success/warning/error) para consistencia visual.
const ACCENT: Record<ToastType, string> = {
  success: '#4ade80',
  warning: '#fbbf24',
  error: '#f87171',
  info: '#93c5fd',
}

function ToastIcon({ type }: { type: ToastType }) {
  const common = {
    width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none',
    stroke: ACCENT[type], strokeWidth: 2.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    style: { flexShrink: 0 },
  }
  switch (type) {
    case 'success':
      return <svg {...common}><polyline points="20 6 9 17 4 12" /></svg>
    case 'warning':
      return (
        <svg {...common}>
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      )
    case 'error':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <line x1="14.5" y1="9.5" x2="9.5" y2="14.5" />
          <line x1="9.5" y1="9.5" x2="14.5" y2="14.5" />
        </svg>
      )
    case 'info':
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <line x1="12" y1="12" x2="12" y2="16" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      )
  }
}

export function Toast({ message, visible, type = 'info' }: ToastProps) {
  return (
    <div role="status" aria-live={type === 'error' ? 'assertive' : 'polite'} aria-atomic="true">
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
          <ToastIcon type={type} />
          {message}
        </div>
      )}
    </div>
  )
}
