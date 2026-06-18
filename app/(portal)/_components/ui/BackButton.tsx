'use client'

interface BackButtonProps {
  onClick: () => void
  label?: string
}

export function BackButton({ onClick, label = 'Regresar' }: BackButtonProps) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: 'none', border: 'none', cursor: 'pointer',
        fontSize: 13, fontWeight: 800, color: '#000000', padding: 0, marginBottom: 18,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
      </svg>
      {label}
    </button>
  )
}
