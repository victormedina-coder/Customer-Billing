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
      <p style={STYLES.lastUpdated}>Última actualización: 3 de julio de 2026</p>

      <p style={STYLES.paragraph}>
        En cumplimiento con lo dispuesto por los artículos 15 y 16 de la Ley Federal de Protección
        de Datos Personales en Posesión de los Particulares (LFPDPPP), Grupo Quince 22, S.A. de C.V.,
        con domicilio en Mariano Otero 1915 Local E-2, Plaza del Sol, C.P. 45060, Zapopan, Jalisco,
        México, es responsable del tratamiento de sus datos personales, del uso que se les dé y de
        su adecuada protección.
      </p>

      <p style={STYLES.paragraph}>
        El presente Aviso de Privacidad aplica al <strong>portal de facturación</strong>, a
        través del cual usted puede generar por su cuenta el Comprobante Fiscal Digital por Internet
        (CFDI) de una compra realizada en nuestras marcas.
      </p>

      <h2 style={STYLES.sectionHeading}>Datos personales que recabamos</h2>
      <p style={STYLES.paragraph}>
        Para prestarle el servicio de facturación recabamos únicamente los datos necesarios para
        emitir su CFDI:
      </p>
      <ul style={STYLES.list}>
        <li style={STYLES.listItem}>Registro Federal de Contribuyentes (RFC).</li>
        <li style={STYLES.listItem}>Nombre o razón social.</li>
        <li style={STYLES.listItem}>Régimen fiscal.</li>
        <li style={STYLES.listItem}>Código postal del domicilio fiscal.</li>
        <li style={STYLES.listItem}>Uso del CFDI.</li>
        <li style={STYLES.listItem}>Correo electrónico (para el envío de su comprobante).</li>
        <li style={STYLES.listItem}>
          Datos de la compra a facturar (folio del ticket e importe), utilizados únicamente para
          localizar la operación.
        </li>
      </ul>

      <hr style={STYLES.divider} />

      <h2 style={STYLES.sectionHeading}>Finalidades del tratamiento</h2>
      <p style={STYLES.paragraph}>
        Sus datos se utilizan exclusivamente para las siguientes finalidades primarias, necesarias
        para brindarle el servicio:
      </p>
      <ul style={STYLES.list}>
        <li style={STYLES.listItem}>
          Generar, emitir y timbrar el Comprobante Fiscal Digital por Internet (CFDI) de su compra.
        </li>
        <li style={STYLES.listItem}>
          Enviar su comprobante (archivos PDF y XML) al correo electrónico que nos proporcione.
        </li>
      </ul>
      <p style={STYLES.paragraph}>
        <strong>No utilizamos</strong> sus datos con fines de mercadotecnia, publicidad, prospección
        comercial ni envío de boletines. El tratamiento se limita a la emisión de su factura.
      </p>

      <hr style={STYLES.divider} />

      <h2 style={STYLES.sectionHeading}>Transferencia de datos personales</h2>
      <p style={STYLES.paragraph}>
        Para poder emitir y certificar su CFDI, es necesario transferir los datos fiscales
        estrictamente indispensables a los siguientes terceros:
      </p>
      <ul style={STYLES.list}>
        <li style={STYLES.listItem}>
          <strong>Proveedor Autorizado de Certificación (PAC)</strong>, que opera bajo la marca
          «Facturama», autorizado por el SAT para el timbrado de comprobantes fiscales.
        </li>
        <li style={STYLES.listItem}>
          <strong>Servicio de Administración Tributaria (SAT)</strong>, para la certificación y
          registro del comprobante conforme a la legislación fiscal aplicable.
        </li>
      </ul>
      <p style={STYLES.paragraph}>
        Estas transferencias son necesarias para la emisión de su comprobante y para dar
        cumplimiento a disposiciones legales, por lo que, conforme al artículo 37 de la LFPDPPP,
        <strong> no requieren de su consentimiento</strong>. Fuera de lo anterior, no realizamos
        transferencias de sus datos personales a terceros, salvo aquellas requeridas por autoridades
        competentes, debidamente fundadas y motivadas.
      </p>

      <hr style={STYLES.divider} />

      <h2 style={STYLES.sectionHeading}>Conservación de la información</h2>
      <p style={STYLES.paragraph}>
        Los datos asociados a los comprobantes emitidos se conservan durante los plazos que
        establece la legislación fiscal aplicable para efectos de comprobación y, en su caso, para
        la atención de aclaraciones o requerimientos de autoridad.
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
        personales, así como a revocar el consentimiento que, en su caso, nos haya otorgado. Para
        ejercer estos derechos, deberá comunicarse con nuestra Área de Privacidad a través del correo
        electrónico:{' '}
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
        La negativa a proporcionar los datos fiscales solicitados o su cancelación puede impedir la
        emisión de su comprobante, al ser información indispensable para ese fin.
      </p>

      <hr style={STYLES.divider} />

      <h2 style={STYLES.sectionHeading}>Modificaciones al aviso de privacidad</h2>
      <p style={STYLES.paragraph}>
        Grupo Quince 22, S.A. de C.V. se reserva el derecho de realizar cambios o actualizaciones al
        presente Aviso de Privacidad en cualquier momento. Cualquier modificación será debidamente
        comunicada a través de este portal.
      </p>
    </div>
  )
}
