import type { Metadata } from 'next'
import Image from 'next/image'
import type { CSSProperties } from 'react'
import { AvisoPrivacidadContent } from '../(portal)/_components/legal/AvisoPrivacidadContent'
import { BackButton } from './BackButton'

export const metadata: Metadata = {
  title: 'Aviso de Privacidad | Grupo Quince 22',
  description:
    'Conoce cómo Grupo Quince 22, S.A. de C.V. trata y protege tus datos personales conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares.',
}

const PAGE_STYLES = {
  page: {
    minHeight: '100vh',
    background: 'var(--bg-app)',
    display: 'flex',
    flexDirection: 'column',
  } satisfies CSSProperties,

  header: {
    background: '#ffffff',
    borderBottom: '1px solid var(--border-default)',
    padding: '0 24px',
    height: 64,
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    position: 'sticky',
    top: 0,
    zIndex: 20,
    flexShrink: 0,
  } satisfies CSSProperties,

  logoWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    flex: 1,
    minWidth: 0,
  } satisfies CSSProperties,

  taglineDivider: {
    borderLeft: '1px solid var(--border-default)',
    paddingLeft: 14,
    fontSize: 12,
    color: 'var(--text-muted)',
    fontWeight: 600,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  } satisfies CSSProperties,

  main: {
    flex: 1,
    display: 'flex',
    justifyContent: 'center',
    padding: '40px 16px 64px',
  } satisfies CSSProperties,

  container: {
    width: '100%',
    maxWidth: 760,
  } satisfies CSSProperties,

  card: {
    background: '#ffffff',
    border: '1.5px solid var(--border-default)',
    borderRadius: 18,
    padding: '32px 36px',
  } satisfies CSSProperties,
} as const

export default function AvisoPrivacidadPage(): React.ReactElement {
  return (
    <div style={PAGE_STYLES.page}>
      {/* Header mínimo — no requiere contexto de portal */}
      <header style={PAGE_STYLES.header}>
        <div style={PAGE_STYLES.logoWrap}>
          <Image
            src="/assets/logo.png"
            alt="Grupo Quince 22"
            width={105}
            height={32}
            priority
            style={{ height: 32, width: 'auto', flexShrink: 0 }}
          />
          <span style={PAGE_STYLES.taglineDivider}>
            Aviso de Privacidad
          </span>
        </div>
      </header>

      <main style={PAGE_STYLES.main}>
        <div style={PAGE_STYLES.container}>
          {/* Botón volver — regresa a donde estaba el usuario (back real) */}
          <BackButton />

          {/* Contenido legal */}
          <article style={PAGE_STYLES.card}>
            <AvisoPrivacidadContent />
          </article>
        </div>
      </main>
    </div>
  )
}
