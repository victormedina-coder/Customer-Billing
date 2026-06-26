import type { CSSProperties } from 'react'

const STYLES = {
  root: {
    fontFamily: 'inherit',
    color: 'var(--text-primary)',
    lineHeight: 1.75,
  } satisfies CSSProperties,

  title: {
    fontSize: 24,
    fontWeight: 900,
    color: '#1a1a1a',
    letterSpacing: '-0.03em',
    marginBottom: 6,
  } satisfies CSSProperties,

  lastUpdated: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-muted)',
    marginBottom: 28,
  } satisfies CSSProperties,

  sectionHeading: {
    fontSize: 14,
    fontWeight: 800,
    color: '#1a1a1a',
    marginTop: 22,
    marginBottom: 8,
    letterSpacing: '-0.01em',
  } satisfies CSSProperties,

  paragraph: {
    fontSize: 13.5,
    fontWeight: 500,
    color: '#374151',
    marginBottom: 10,
    lineHeight: 1.75,
  } satisfies CSSProperties,

  list: {
    paddingLeft: 20,
    marginBottom: 10,
  } satisfies CSSProperties,

  listItem: {
    fontSize: 13.5,
    fontWeight: 500,
    color: '#374151',
    lineHeight: 1.75,
    marginBottom: 3,
  } satisfies CSSProperties,

  divider: {
    border: 'none',
    borderTop: '1px solid var(--border-light)',
    marginTop: 20,
    marginBottom: 20,
  } satisfies CSSProperties,
}

export function AvisoPrivacidadContent(): React.ReactElement {
  return (
    <div style={STYLES.root}>
      <h1 style={STYLES.title}>Aviso de privacidad</h1>
      <p style={STYLES.lastUpdated}>Última actualización: 24 de julio de 2025</p>

      <p style={STYLES.paragraph}>
        En cumplimiento con lo dispuesto por los artículos 15 y 16 de la Ley Federal de Protección
        de Datos Personales en Posesión de los Particulares, Grupo Quince 22, S.A. de C.V., con
        domicilio en Mariano Otero 1915 Local E-2, Plaza del Sol, C.P. 45060, Zapopan, Jalisco,
        México, es responsable del tratamiento de sus datos personales, del uso que se les dé y
        de su adecuada protección.
      </p>

      <p style={STYLES.paragraph}>
        La información personal que recabamos de nuestros clientes es tratada con estricta
        confidencialidad. Al proporcionarnos sus datos personales, tales como:
      </p>

      <ul style={STYLES.list}>
        <li style={STYLES.listItem}>Nombre completo</li>
        <li style={STYLES.listItem}>Teléfono</li>
        <li style={STYLES.listItem}>Correo electrónico</li>
        <li style={STYLES.listItem}>Dirección completa</li>
      </ul>

      <p style={STYLES.paragraph}>
        Estos serán utilizados para las siguientes finalidades primarias:
      </p>

      <ul style={STYLES.list}>
        <li style={STYLES.listItem}>
          Envío de información sobre nuestros servicios, ofertas, promociones, nuevos productos
          y actualizaciones (email marketing).
        </li>
        <li style={STYLES.listItem}>
          Distribución de contenido de valor a través de nuestro boletín informativo (newsletter).
        </li>
        <li style={STYLES.listItem}>Dar seguimiento a solicitudes de información.</li>
        <li style={STYLES.listItem}>Gestión del registro en nuestro sitio web.</li>
        <li style={STYLES.listItem}>Facturación y procesos de cobro.</li>
        <li style={STYLES.listItem}>Envío y entrega de productos.</li>
        <li style={STYLES.listItem}>Actividades publicitarias.</li>
      </ul>

      <hr style={STYLES.divider} />

      <h2 style={STYLES.sectionHeading}>Oposición al uso de datos personales</h2>
      <p style={STYLES.paragraph}>
        Si usted no desea que sus datos personales sean utilizados para alguno de los fines
        mencionados, puede manifestarlo en cualquier momento enviando un correo electrónico a:{' '}
        <a
          href="mailto:ecommerce@1522.mx"
          style={{ color: 'var(--brand-primary)', fontWeight: 700 }}
        >
          ecommerce@1522.mx
        </a>{' '}
        o por escrito a nuestro domicilio:
      </p>
      <p style={{ ...STYLES.paragraph, paddingLeft: 16, borderLeft: '3px solid var(--brand-primary)' }}>
        Grupo Quince 22, S.A. de C.V.<br />
        Mariano Otero 1915 Local E-2, Plaza del Sol, C.P. 45060, Zapopan, Jalisco, México.
      </p>
      <p style={STYLES.paragraph}>
        La negativa al uso de sus datos personales para fines secundarios no será motivo para
        negarle los servicios y productos que solicite o contrate con nosotros.
      </p>

      <hr style={STYLES.divider} />

      <h2 style={STYLES.sectionHeading}>Transferencia de datos personales</h2>
      <p style={STYLES.paragraph}>
        Le informamos que no realizamos transferencias de sus datos personales a terceros, salvo
        aquellas necesarias para cumplir requerimientos de autoridades competentes, debidamente
        fundados y motivados.
      </p>

      <hr style={STYLES.divider} />

      <h2 style={STYLES.sectionHeading}>Medidas de seguridad</h2>
      <p style={STYLES.paragraph}>
        Con el fin de evitar el acceso no autorizado a su información y asegurar su correcto
        tratamiento, hemos implementado medidas técnicas, físicas y administrativas para proteger
        sus datos personales.
      </p>

      <hr style={STYLES.divider} />

      <h2 style={STYLES.sectionHeading}>
        Derechos ARCO (Acceso, Rectificación, Cancelación y Oposición)
      </h2>
      <p style={STYLES.paragraph}>
        Usted tiene derecho a acceder, rectificar, cancelar u oponerse al tratamiento de sus datos
        personales. Para ejercer estos derechos, deberá comunicarse con nuestra Área de Privacidad
        a través del correo electrónico:{' '}
        <a
          href="mailto:ecommerce@1522.mx"
          style={{ color: 'var(--brand-primary)', fontWeight: 700 }}
        >
          ecommerce@1522.mx
        </a>
        .
      </p>
      <p style={STYLES.paragraph}>
        También podrá solicitar la actualización de sus datos personales y especificar el medio
        por el cual desea recibir información. En caso de no contar con dicha especificación,
        Grupo Quince 22, S.A. de C.V. podrá utilizar el canal de comunicación que considere
        más adecuado.
      </p>

      <hr style={STYLES.divider} />

      <h2 style={STYLES.sectionHeading}>Modificaciones al aviso de privacidad</h2>
      <p style={STYLES.paragraph}>
        Grupo Quince 22, S.A. de C.V. se reserva el derecho de realizar cambios o actualizaciones
        al presente Aviso de Privacidad en cualquier momento. Cualquier modificación será
        debidamente comunicada a través del sitio web, correo electrónico, teléfono u otros medios
        de contacto que se tengan registrados.
      </p>
    </div>
  )
}
