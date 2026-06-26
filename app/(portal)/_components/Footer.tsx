import Link from 'next/link'

export function Footer(): React.ReactElement {
  const year = new Date().getFullYear()

  return (
    <footer className="portal-footer">
      {/* Legal links */}
      <nav className="portal-footer__links" aria-label="Vínculos legales">
        <Link href="/aviso-privacidad" className="portal-footer__link">
          Aviso de Privacidad
        </Link>
        {/* TODO: enlace a Términos y Condiciones cuando llegue su texto */}
      </nav>

      {/* Copyright */}
      <span className="portal-footer__copy">
        &copy; {year} Grupo Quince 22
      </span>

      {/* Powered by */}
      <span className="portal-footer__powered">
        Desarrollado por Grupo Quince 22
      </span>
    </footer>
  )
}
