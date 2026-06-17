import type { ReactNode, CSSProperties } from 'react'

type AlertVariant = 'error' | 'warning' | 'neutral'

interface AlertBannerProps {
  variant: AlertVariant
  title: string
  description?: ReactNode
  actions?: ReactNode
  icon?: ReactNode
}

const VARIANT_STYLES: Record<AlertVariant, CSSProperties> = {
  error: { background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 12, padding: '13px 15px' },
  warning: { background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 12, padding: '13px 15px' },
  neutral: { background: '#f5f8f7', border: '1.5px solid #d4dade', borderRadius: 14, padding: 16 },
}

const TITLE_COLOR: Record<AlertVariant, string> = {
  error: '#dc2626',
  warning: '#b45309',
  neutral: '#1a1a1a',
}

const DESC_COLOR: Record<AlertVariant, string> = {
  error: '#991b1b',
  warning: '#92400e',
  neutral: '#6b7280',
}

export function AlertBanner({ variant, title, description, actions, icon }: AlertBannerProps) {
  return (
    <div style={{ ...VARIANT_STYLES[variant], animation: 'fadeIn 0.25s ease both' }}>
      <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start', marginBottom: actions ? 12 : 0 }}>
        {icon}
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: TITLE_COLOR[variant] }}>{title}</div>
          {description && (
            <div style={{ fontSize: 12.5, color: DESC_COLOR[variant], fontWeight: 600, lineHeight: 1.5, marginTop: 2 }}>
              {description}
            </div>
          )}
        </div>
      </div>
      {actions}
    </div>
  )
}
