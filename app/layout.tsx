import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'

// Fuente local: el build de Railway falla al descargar Montserrat de Google Fonts.
const montserrat = localFont({
  src: './fonts/Montserrat-latin-variable.woff2',
  weight: '400 900',
  variable: '--font-montserrat',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Grupo Quince 22 · Portal de Facturación',
  description: 'Genera tu CFDI 4.0 en línea',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={montserrat.variable}>
      <body>{children}</body>
    </html>
  )
}
