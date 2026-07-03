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

  link: {
    color: 'var(--brand-primary)',
    fontWeight: 700,
  } satisfies CSSProperties,
}

export function TerminosCondicionesContent(): React.ReactElement {
  return (
    <div style={STYLES.root}>
      <h1 style={STYLES.title}>Términos y Condiciones de Servicio</h1>
      <p style={STYLES.lastUpdated}>Última actualización: 3 de julio de 2026</p>

      <h2 style={STYLES.sectionHeading}>Información general</h2>
      <p style={STYLES.paragraph}>
        Este portal de facturación es operado por <strong>Grupo Quince 22, S.A. de C.V.</strong> En
        todo el sitio, los términos “nosotros”, “nos” y “nuestro” se refieren a Grupo Quince 22,
        S.A. de C.V. El portal permite a nuestros clientes generar por su cuenta el Comprobante
        Fiscal Digital por Internet (CFDI) correspondiente a una compra realizada en nuestras marcas.
      </p>
      <p style={STYLES.paragraph}>
        Al acceder o utilizar cualquier parte del portal, aceptas quedar sujeto a los presentes
        Términos y Condiciones de Servicio (“Términos”), incluyendo todas las políticas referenciadas
        en este documento. Si no estás de acuerdo con la totalidad de estos Términos, no deberás
        acceder ni utilizar el portal.
      </p>
      <p style={STYLES.paragraph}>
        Cualquier función o herramienta nueva que se añada al portal también quedará sujeta a estos
        Términos. Nos reservamos el derecho de actualizar, cambiar o reemplazar cualquier parte de
        estos Términos mediante la publicación de los cambios en esta página. Es tu responsabilidad
        revisarla periódicamente; el uso continuo del portal después de la publicación de cualquier
        cambio constituye la aceptación de dichos cambios.
      </p>

      <hr style={STYLES.divider} />

      <h2 style={STYLES.sectionHeading}>1. Uso del portal</h2>
      <p style={STYLES.paragraph}>
        Al utilizar este portal declaras que cuentas con la mayoría de edad legal en tu estado o país
        de residencia. Te comprometes a no utilizar el portal con fines ilegales o no autorizados, ni
        a violar las leyes aplicables en tu jurisdicción, incluyendo —sin limitarse a— las leyes de
        propiedad intelectual o derechos de autor.
      </p>
      <p style={STYLES.paragraph}>
        Asimismo, te comprometes a no transmitir virus, malware, gusanos ni ningún tipo de código
        malicioso que pueda dañar o interferir con el funcionamiento del portal. El incumplimiento de
        cualquiera de estas disposiciones dará lugar a la terminación inmediata de tu acceso al
        servicio.
      </p>

      <hr style={STYLES.divider} />

      <h2 style={STYLES.sectionHeading}>2. Condiciones generales</h2>
      <p style={STYLES.paragraph}>
        Nos reservamos el derecho de rechazar el servicio a cualquier persona, por cualquier motivo y
        en cualquier momento, a nuestra entera discreción. Te comprometes a no reproducir, duplicar,
        copiar, vender, revender ni explotar cualquier parte del portal o su acceso, sin autorización
        expresa y por escrito de nuestra parte. Los encabezados de estos Términos se utilizan
        únicamente para facilitar su lectura y no limitan ni afectan su interpretación.
      </p>

      <hr style={STYLES.divider} />

      <h2 style={STYLES.sectionHeading}>3. Exactitud de la información del portal</h2>
      <p style={STYLES.paragraph}>
        No garantizamos que la información disponible en este portal sea exacta, completa o
        actualizada. Todo el contenido se proporciona únicamente con fines informativos y su uso es
        bajo tu propio riesgo. Nos reservamos el derecho de modificar los contenidos del portal en
        cualquier momento, sin estar obligados a actualizar información alguna.
      </p>

      <hr style={STYLES.divider} />

      <h2 style={STYLES.sectionHeading}>4. Modificaciones al servicio</h2>
      <p style={STYLES.paragraph}>
        Nos reservamos el derecho de modificar o descontinuar el servicio, o cualquier parte del
        portal, en cualquier momento y sin notificación previa. No asumimos responsabilidad alguna
        frente a ti ni frente a terceros por cualquier modificación, suspensión o interrupción del
        servicio.
      </p>

      <hr style={STYLES.divider} />

      <h2 style={STYLES.sectionHeading}>5. Emisión de comprobantes fiscales (CFDI)</h2>
      <p style={STYLES.paragraph}>
        El portal te permite generar por tu cuenta el CFDI de una compra. La factura se emite
        <strong> con los datos fiscales que tú proporcionas</strong> (RFC, nombre o razón social,
        régimen fiscal, código postal y uso del CFDI). Eres el único responsable de la veracidad,
        exactitud y vigencia de dichos datos; una vez timbrado, el comprobante refleja exactamente la
        información que capturaste, por lo que te recomendamos verificarla antes de confirmar.
      </p>
      <p style={STYLES.paragraph}>
        <strong>Vigencia para facturar:</strong> solo puedes generar la factura de una compra dentro
        del <strong>mes calendario en curso</strong> en que se realizó (conforme a la zona horaria del
        centro de México). Transcurrido ese plazo, no será posible emitir la factura por este medio.
      </p>
      <p style={STYLES.paragraph}>
        Cada compra puede facturarse <strong>una sola vez</strong>; no es posible emitir comprobantes
        duplicados de la misma operación. La emisión, corrección o cancelación de un CFDI se realiza
        conforme a la normatividad vigente del Servicio de Administración Tributaria (SAT). Nos
        reservamos el derecho de rechazar o limitar solicitudes de facturación que, a nuestro juicio,
        resulten indebidas, fraudulentas o automatizadas.
      </p>

      <hr style={STYLES.divider} />

      <h2 style={STYLES.sectionHeading}>6. Herramientas y servicios de terceros</h2>
      <p style={STYLES.paragraph}>
        Para prestar el servicio, el portal se apoya en herramientas y servicios de terceros —entre
        ellos el Proveedor Autorizado de Certificación (PAC) que opera bajo la marca «Facturama» y el
        SAT— para el timbrado y la certificación de los comprobantes. Dichos servicios se ofrecen
        “tal cual” y “según disponibilidad”; no los supervisamos ni controlamos, y no asumimos
        responsabilidad alguna derivada de su uso. Te recomendamos familiarizarte con los términos y
        condiciones de dichos proveedores.
      </p>

      <hr style={STYLES.divider} />

      <h2 style={STYLES.sectionHeading}>7. Información personal</h2>
      <p style={STYLES.paragraph}>
        El tratamiento de la información personal que nos proporciones a través del portal se rige por
        nuestro{' '}
        <a href="/aviso-privacidad" style={STYLES.link}>
          Aviso de Privacidad
        </a>
        , el cual forma parte integral de estos Términos. Te recomendamos revisarlo para conocer cómo
        recopilamos, usamos, protegemos y transferimos tus datos personales.
      </p>

      <hr style={STYLES.divider} />

      <h2 style={STYLES.sectionHeading}>8. Errores, inexactitudes y omisiones</h2>
      <p style={STYLES.paragraph}>
        Es posible que ocasionalmente exista información en el portal que contenga errores
        tipográficos, inexactitudes u omisiones. Nos reservamos el derecho de corregir dichos errores
        y de modificar o actualizar la información, o de cancelar solicitudes, en cualquier momento y
        sin previo aviso. No asumimos obligación alguna de actualizar o corregir información, salvo
        cuando lo exija la ley.
      </p>

      <hr style={STYLES.divider} />

      <h2 style={STYLES.sectionHeading}>9. Usos prohibidos</h2>
      <p style={STYLES.paragraph}>
        Además de otras prohibiciones establecidas en estos Términos, queda estrictamente prohibido
        utilizar el portal o su contenido para:
      </p>
      <ul style={STYLES.list}>
        <li style={STYLES.listItem}>(a) Cualquier fin ilegal o para solicitar a otros que realicen actos ilícitos;</li>
        <li style={STYLES.listItem}>
          (b) Violar leyes, normas, reglamentos u ordenanzas locales, estatales, nacionales o
          internacionales;
        </li>
        <li style={STYLES.listItem}>(c) Infringir nuestros derechos de propiedad intelectual o los de terceros;</li>
        <li style={STYLES.listItem}>(d) Proporcionar información falsa o engañosa;</li>
        <li style={STYLES.listItem}>
          (e) Subir o transmitir virus u otro código malicioso que afecte el funcionamiento del
          portal o del servicio;
        </li>
        <li style={STYLES.listItem}>(f) Recopilar o rastrear información personal de otros sin consentimiento;</li>
        <li style={STYLES.listItem}>(g) Enviar spam, o realizar phishing, pharming, pretexting, crawling o scraping;</li>
        <li style={STYLES.listItem}>
          (h) Interferir con o eludir las medidas de seguridad del portal o de cualquier servicio
          relacionado.
        </li>
      </ul>
      <p style={STYLES.paragraph}>
        Nos reservamos el derecho de suspender o cancelar tu acceso al servicio si incurres en
        cualquiera de estos usos prohibidos.
      </p>

      <hr style={STYLES.divider} />

      <h2 style={STYLES.sectionHeading}>10. Exclusión de garantías; limitación de responsabilidad</h2>
      <p style={STYLES.paragraph}>
        No garantizamos que el uso del servicio será ininterrumpido, puntual, seguro o libre de
        errores, ni que los resultados obtenidos serán precisos o confiables. El servicio se
        proporciona “tal cual” y “según disponibilidad”, sin representación, garantía o condición de
        ningún tipo, expresa o implícita.
      </p>
      <p style={STYLES.paragraph}>
        En ningún caso Grupo Quince 22, S.A. de C.V., ni sus directores, funcionarios, empleados,
        afiliados, agentes, contratistas, proveedores o prestadores de servicios serán responsables
        por ningún daño directo, indirecto, incidental, punitivo, especial o consecuente que resulte
        del uso del servicio, incluso si se advirtió sobre la posibilidad de tales daños. En las
        jurisdicciones que no permitan estas limitaciones, nuestra responsabilidad se limitará en la
        medida máxima permitida por la ley aplicable.
      </p>

      <hr style={STYLES.divider} />

      <h2 style={STYLES.sectionHeading}>11. Indemnización</h2>
      <p style={STYLES.paragraph}>
        Aceptas indemnizar, defender y eximir de toda responsabilidad a Grupo Quince 22, S.A. de C.V.,
        así como a sus afiliados, socios, directores, funcionarios, empleados, agentes, contratistas,
        licenciantes, proveedores y prestadores de servicios, frente a cualquier reclamo o demanda,
        incluyendo honorarios razonables de abogados, derivados de tu incumplimiento de estos
        Términos, tu uso indebido del portal o del servicio, o tu violación de cualquier ley o de los
        derechos de un tercero. Esta obligación subsistirá aun después de terminado tu acceso al
        servicio.
      </p>

      <hr style={STYLES.divider} />

      <h2 style={STYLES.sectionHeading}>12. Divisibilidad</h2>
      <p style={STYLES.paragraph}>
        En caso de que alguna disposición de estos Términos sea considerada ilegal, nula o inaplicable
        por cualquier motivo, dicha disposición será, no obstante, exigible en la máxima medida
        permitida por la ley aplicable, y la parte no exigible se considerará separada de estos
        Términos, sin que ello afecte la validez y aplicabilidad de las disposiciones restantes.
      </p>

      <hr style={STYLES.divider} />

      <h2 style={STYLES.sectionHeading}>13. Terminación</h2>
      <p style={STYLES.paragraph}>
        Las obligaciones y responsabilidades asumidas por las partes con anterioridad a la fecha de
        terminación seguirán vigentes tras la finalización de estos Términos para todos los efectos
        legales correspondientes. Nos reservamos el derecho de dar por terminada esta relación en
        cualquier momento, sin previo aviso, si a nuestro juicio incumples, o sospechamos que has
        incumplido, alguna disposición de estos Términos, en cuyo caso podremos negarte el acceso al
        servicio.
      </p>

      <hr style={STYLES.divider} />

      <h2 style={STYLES.sectionHeading}>14. Acuerdo completo</h2>
      <p style={STYLES.paragraph}>
        Estos Términos, junto con cualquier política publicada por nosotros en el portal o en relación
        con el servicio, constituyen el acuerdo completo entre tú y Grupo Quince 22, S.A. de C.V., y
        rigen el uso que hagas del servicio, reemplazando cualquier acuerdo o comunicación previa. El
        hecho de que no ejerzamos o hagamos valer cualquier derecho o disposición de estos Términos no
        constituirá una renuncia a tal derecho o disposición.
      </p>

      <hr style={STYLES.divider} />

      <h2 style={STYLES.sectionHeading}>15. Ley aplicable y jurisdicción</h2>
      <p style={STYLES.paragraph}>
        Estos Términos se regirán e interpretarán de conformidad con las leyes de los Estados Unidos
        Mexicanos. Para su interpretación, cumplimiento y ejecución, las partes se someten
        expresamente a las leyes y tribunales competentes de la Ciudad de México, renunciando a
        cualquier otra jurisdicción que pudiera corresponderles en razón de su domicilio presente o
        futuro.
      </p>

      <hr style={STYLES.divider} />

      <h2 style={STYLES.sectionHeading}>16. Cambios en los Términos</h2>
      <p style={STYLES.paragraph}>
        Nos reservamos el derecho de actualizar, modificar o reemplazar cualquier parte de estos
        Términos publicando los cambios en esta página. Es tu responsabilidad revisarla periódicamente.
        El uso continuo del portal después de la publicación de cualquier modificación constituye tu
        aceptación de dichos cambios. La versión más reciente estará siempre disponible en esta página.
      </p>

      <hr style={STYLES.divider} />

      <h2 style={STYLES.sectionHeading}>17. Información de contacto</h2>
      <p style={STYLES.paragraph}>
        Para cualquier duda, comentario o solicitud relacionada con estos Términos, puedes contactarnos
        a través del correo electrónico:{' '}
        <a href="mailto:ecommerce@1522.mx" style={STYLES.link}>
          ecommerce@1522.mx
        </a>
        .
      </p>
      <p style={{ ...STYLES.paragraph, paddingLeft: 16, borderLeft: '3px solid var(--brand-primary)' }}>
        Grupo Quince 22, S.A. de C.V.<br />
        Mariano Otero 1915 Local E-2, Plaza del Sol, C.P. 45060, Zapopan, Jalisco, México.
      </p>
    </div>
  )
}
