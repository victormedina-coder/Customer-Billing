'use client'

import { useRouter } from 'next/navigation'
import type { CSSProperties } from 'react'

const BACK_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 13,
  fontWeight: 800,
  color: '#000000',
  textDecoration: 'none',
  marginBottom: 28,
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
}

export function BackButton(): React.ReactElement {
  const router = useRouter()

  function handleBack(): void {
    // Si hay historial en esta pestaña, regresa a donde estaba el usuario
    // (p. ej. el paso fiscal). Si no (pestaña nueva o entrada directa), va al portal.
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else {
      router.push('/')
    }
  }

  return (
    <button type="button" onClick={handleBack} className="btn-press" style={BACK_STYLE}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <line x1="19" y1="12" x2="5" y2="12" />
        <polyline points="12 19 5 12 12 5" />
      </svg>
      Volver al portal
    </button>
  )
}
