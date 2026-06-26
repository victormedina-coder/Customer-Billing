import { Footer } from './_components/Footer'

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-app)' }}>
      <div style={{ flex: 1 }}>
        {children}
      </div>
      <Footer />
    </div>
  )
}
