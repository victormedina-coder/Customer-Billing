import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Portal de Autofacturación',
  description: 'Genera tu CFDI 4.0 en línea',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
