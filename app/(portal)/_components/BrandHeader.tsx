import Image from 'next/image'

interface BrandHeaderProps {
  storeName: string
  tagline: string
}

export function BrandHeader({ storeName, tagline }: BrandHeaderProps) {
  return (
    <header className="brand-header">
      <Image
        src="/assets/logoGQ1522.png"
        alt={storeName}
        width={105}
        height={32}
        priority
        className="brand-logo"
      />
      <div className="brand-tagline-wrap">
        <div className="brand-tagline">{tagline}</div>
      </div>
      <div className="brand-badge">
        <span className="brand-badge-dot" aria-hidden="true" />
        <span className="brand-badge-text brand-badge-text--full">Portal de facturación</span>
        <span className="brand-badge-text brand-badge-text--short">Facturación</span>
      </div>
    </header>
  )
}
