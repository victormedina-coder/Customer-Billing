import { isPortalWindowOpen } from '@/src/domain/eligibility/InvoiceWindowPolicy'
import { getEvaluationNow } from '@/src/infrastructure/time/getEvaluationNow'
import { PortalClient } from './PortalClient'

/**
 * OBLIGATORIO: sin esto Next prerenderiza esta página en build (era `○ Static`
 * en la tabla de rutas) y `windowClosed` quedaría CONGELADO al instante del
 * build — la pantalla de bloqueo no aparecería nunca en producción (o
 * aparecería siempre, si el deploy cayera después de un corte). La ventana
 * debe evaluarse en CADA request contra el reloj real.
 */
export const dynamic = 'force-dynamic'

/**
 * Server component: calcula server-side el estado de la ventana de
 * facturación (R3 — Paso 3.3) y lee el correo de contacto configurable.
 * `BILLING_CONTACT_EMAIL` se lee aquí (server-only) y se pasa como prop —
 * nunca se expone como `NEXT_PUBLIC_*` ni se hardcodea.
 *
 * `windowClosed` es solo la pantalla de COMUNICACIÓN: la autoridad real la
 * tiene el servidor en `lookup`/`emit` (`isWithinInvoiceWindow`, mismo
 * cutoff). Aunque un cliente evadiera este flag, la API seguiría
 * rechazando.
 */
export default function PortalPage() {
  const windowClosed = !isPortalWindowOpen(getEvaluationNow())
  const contactEmail = process.env.BILLING_CONTACT_EMAIL

  return <PortalClient windowClosed={windowClosed} contactEmail={contactEmail} />
}
