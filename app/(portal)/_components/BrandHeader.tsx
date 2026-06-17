interface BrandHeaderProps {
  storeName: string
  tagline: string
}

export function BrandHeader({ storeName, tagline }: BrandHeaderProps) {
  return (
    <header style={{
      background: '#ffffff', borderBottom: '1px solid #d4dade',
      padding: '0 24px', height: 64,
      display: 'flex', alignItems: 'center', gap: 14,
      position: 'sticky', top: 0, zIndex: 20, flexShrink: 0,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 11, background: '#108474',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, boxShadow: '0 4px 12px rgba(16,132,116,0.28)',
      }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/>
          <line x1="7" y1="7" x2="7.01" y2="7"/>
        </svg>
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 900, fontSize: 17, letterSpacing: '-0.03em', lineHeight: 1.1 }}>{storeName}</div>
        <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, letterSpacing: '0.01em' }}>{tagline}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#f5f8f7', border: '1px solid #d4dade', borderRadius: 20, padding: '6px 13px' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#108474', flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: '#0b6359', whiteSpace: 'nowrap' }}>Portal de autofacturación</span>
      </div>
    </header>
  )
}
