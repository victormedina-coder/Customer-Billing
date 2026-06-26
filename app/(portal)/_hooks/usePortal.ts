'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import type { PortalState, PortalStep, FiscalData, Ticket, GeneratedInvoice } from '../_lib/types'
import { validateFiscal } from '../_lib/validators'
import { DEMO_TICKETS } from '../_lib/constants'

const INITIAL_FISCAL: FiscalData = { rfc: '', razon: '', regimen: '', cp: '', uso: '', email: '' }

const INITIAL_STATE: PortalState = {
  step: 'ticket',
  folio: '',
  busy: false,
  lookupError: '',
  ticket: null,
  fiscal: INITIAL_FISCAL,
  touched: false,
  rfcRazon: '',
  showFolioHelp: false,
  factura: null,
  privacyAccepted: false,
}

// ─────────────────────────────────────────────────────────────────────────────
// sessionStorage persistence
//
// Usamos sessionStorage (y NO localStorage) deliberadamente:
//   - Su alcance es la pestaña/sesión. Al cerrar la pestaña los datos fiscales
//     (RFC, correo, etc.) desaparecen automáticamente, sin acumulación entre
//     sesiones de distintos usuarios en el mismo dispositivo.
//   - Es ideal para el round-trip "portal → aviso de privacidad → portal":
//     la página se remonta pero la sesión de pestaña sigue activa.
// ─────────────────────────────────────────────────────────────────────────────
const SESSION_KEY = 'portal:state'

/** Campos que se persisten. busy, touched y showFolioHelp son UI-transient. */
type PersistedSnapshot = Pick<
  PortalState,
  'step' | 'folio' | 'ticket' | 'fiscal' | 'factura' | 'privacyAccepted' | 'rfcRazon' | 'lookupError'
>

function readSnapshot(): PersistedSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as PersistedSnapshot) : null
  } catch {
    return null
  }
}

function writeSnapshot(s: PortalState): void {
  if (typeof window === 'undefined') return
  try {
    const snapshot: PersistedSnapshot = {
      step: s.step,
      folio: s.folio,
      ticket: s.ticket,
      fiscal: s.fiscal,
      factura: s.factura,
      privacyAccepted: s.privacyAccepted,
      rfcRazon: s.rfcRazon,
      lookupError: s.lookupError,
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(snapshot))
  } catch {
    // quota exceeded o modo privado muy restrictivo — no fatal
  }
}

function clearSnapshot(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lookup: real vs mock
//
// En producción (NEXT_PUBLIC_LOOKUP_MOCK !== 'true') se llama a la API real.
// Con NEXT_PUBLIC_LOOKUP_MOCK=true se usa DEMO_TICKETS para navegar sin
// credenciales de Shopify configuradas.
// ─────────────────────────────────────────────────────────────────────────────
const USE_MOCK = process.env.NEXT_PUBLIC_LOOKUP_MOCK === 'true'

async function fetchTicket(folio: string): Promise<Ticket | null> {
  if (USE_MOCK) {
    // Fallback de mock: simula latencia y consulta DEMO_TICKETS
    await new Promise<void>((resolve) => setTimeout(resolve, 600))
    return DEMO_TICKETS[folio] ?? null
  }

  // Camino real: POST /api/invoice/lookup
  const res = await fetch('/api/invoice/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folio }),
  })

  if (res.status === 404) return null

  if (!res.ok) {
    let errorCode = 'SHOPIFY_ERROR'
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      errorCode = body?.error?.code ?? errorCode
    } catch {
      // ignore
    }
    // Propagar el código de error para que el caller lo maneje
    throw new Error(errorCode)
  }

  const data = (await res.json()) as { ticket: Ticket }
  return data.ticket
}

export function usePortal(flash: (msg: string) => void) {
  // IMPORTANTE (hydration): el primer render —tanto en SSR como en el primer
  // render del cliente— SIEMPRE usa INITIAL_STATE para que el HTML del servidor
  // coincida con el del cliente. Leer sessionStorage en el valor inicial (incluso
  // con lazy initializer) provoca hydration mismatch, porque el initializer SÍ
  // corre en el servidor (devuelve INITIAL) y en el cliente (devuelve el snapshot).
  // La restauración del snapshot ocurre DESPUÉS del montaje (useEffect de abajo).
  const [state, setState] = useState<PortalState>(INITIAL_STATE)
  // hydrated=false hasta restaurar el snapshot tras el montaje. La UI muestra un
  // spinner mientras tanto para NO parpadear el paso 1 antes de saltar al paso
  // restaurado (mejor UX que pintar la pantalla equivocada y luego redirigir).
  const [hydrated, setHydrated] = useState(false)
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Ref espejo del state para que los callbacks lean siempre el valor más reciente
  // sin quedar atrapados en un closure obsoleto.
  const stateRef = useRef<PortalState>(INITIAL_STATE)
  // Salta la PRIMERA escritura (la del montaje) para no pisar el snapshot guardado
  // con INITIAL_STATE antes de alcanzar a hidratarlo.
  const skipFirstPersist = useRef(true)
  useEffect(() => { stateRef.current = state }, [state])

  // ── Hidratación desde sessionStorage (post-montaje, evita hydration mismatch) ─
  useEffect(() => {
    const snap = readSnapshot()
    if (snap) {
      // Hidratación post-montaje desde sessionStorage: caso legítimo de setState en
      // un effect — leer el storage en el render provocaría hydration mismatch.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(prev => ({
        ...prev,
        step: snap.step,
        folio: snap.folio,
        ticket: snap.ticket,
        fiscal: snap.fiscal,
        factura: snap.factura,
        privacyAccepted: snap.privacyAccepted,
        rfcRazon: snap.rfcRazon,
        lookupError: snap.lookupError,
      }))
    }
    // Listo para pintar el paso correcto: el restore (si lo hubo) y este flag se
    // baten en el mismo render, así no se ve el paso 1 antes de saltar al restaurado.
    setHydrated(true)
  }, [])

  // ── Persistencia reactiva: escribe en sessionStorage cuando cambia el estado ─
  useEffect(() => {
    if (skipFirstPersist.current) {
      skipFirstPersist.current = false
      return
    }
    writeSnapshot(state)
  }, [state])

  useEffect(() => () => {
    if (lookupTimer.current) clearTimeout(lookupTimer.current)
  }, [])

  const set = useCallback((patch: Partial<PortalState>) =>
    setState(prev => ({ ...prev, ...patch })), [])

  // ── Step 1: Ticket ──────────────────────────────────────────────────────
  // runLookup es la búsqueda EXPLÍCITA (Enter o botón "Buscar"): no se busca al
  // escribir para evitar matches transitorios con folios de longitud variable
  // (p.ej. A1522-1000 vs A1522-10000) y no golpear la API en cada tecla.
  // No avanza de paso: al encontrar el ticket lo carga y muestra el monto;
  // luego el usuario pulsa "Continuar".
  const runLookup = useCallback((folioRaw: string) => {
    const normalizedFolio = folioRaw.trim().toUpperCase()
    if (lookupTimer.current) clearTimeout(lookupTimer.current)

    if (!normalizedFolio) {
      flash('Ingresa el folio de tu ticket')
      set({ busy: false, ticket: null, lookupError: '' })
      return
    }

    set({ busy: true, lookupError: '', folio: normalizedFolio, ticket: null })

    // Pequeño debounce para evitar doble-click / submit accidental
    lookupTimer.current = setTimeout(() => {
      fetchTicket(normalizedFolio)
        .then((ticket) => {
          if (!ticket) {
            set({ busy: false, ticket: null, lookupError: 'notfound' })
            return
          }
          if (ticket.status === 'invoiced') {
            set({ busy: false, ticket, lookupError: 'invoiced' })
            return
          }
          // Ticket válido: se carga y se queda en el paso Ticket para ver el monto.
          set({ busy: false, ticket, lookupError: '' })
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.message === 'FULLY_REFUNDED') {
            // Pedido reembolsado en su totalidad — no se puede facturar.
            // No se muestra flash genérico: el banner 'refunded' comunica el motivo.
            set({ busy: false, ticket: null, lookupError: 'refunded' })
            return
          }
          if (err instanceof Error && err.message === 'DEADLINE_EXCEEDED') {
            // Pedido encontrado pero fuera de la ventana de facturación del mes en curso.
            // No se muestra flash genérico: el banner 'deadline' comunica el motivo.
            set({ busy: false, ticket: null, lookupError: 'deadline' })
            return
          }
          // Error de Shopify u otro error de servidor (todas las tiendas fallaron,
          // sin marcas configuradas, etc.)
          flash('Error al consultar el pedido. Intenta de nuevo.')
          set({ busy: false, ticket: null, lookupError: '' })
        })
    }, 200)
  }, [set, flash])

  // setFolio solo actualiza el campo. Editar el folio invalida el ticket cargado
  // (oculta "Continuar") para que no quede un monto obsoleto de otra búsqueda.
  const setFolio = useCallback((v: string) =>
    set({ folio: v, lookupError: '', ticket: null, busy: false }), [set])

  const toggleFolioHelp = useCallback(() =>
    setState(prev => ({ ...prev, showFolioHelp: !prev.showFolioHelp })), [])

  // lookup explícito (Enter / botón "Buscar ticket").
  const lookup = useCallback(() => {
    runLookup(stateRef.current.folio)
  }, [runLookup])

  // proceed: avanza a Datos fiscales solo si ya hay un ticket válido cargado.
  const proceed = useCallback(() => {
    const t = stateRef.current.ticket
    if (!t || t.status !== 'ok') { flash('Busca tu ticket primero'); return }
    set({ step: 'fiscal' })
  }, [set, flash])

  const dismissError = useCallback(() =>
    set({ lookupError: '', ticket: null, folio: '' }), [set])

  // ── Step 2: Fiscal ──────────────────────────────────────────────────────
  const setFiscal = useCallback(<K extends keyof FiscalData>(key: K, value: FiscalData[K]) =>
    setState(prev => ({ ...prev, fiscal: { ...prev.fiscal, [key]: value } })), [])

  const setPrivacyAccepted = useCallback((accepted: boolean) =>
    set({ privacyAccepted: accepted }), [set])

  /**
   * goConfirm: valida solo los campos locales (formato).
   * La validación de coherencia con el SAT (validarReceptor) ocurre en page.tsx
   * antes de llamar a esta función.
   */
  const goConfirm = useCallback(() => {
    if (!stateRef.current.ticket) { flash('Verifica tu ticket primero'); return }
    const errors = validateFiscal(stateRef.current.fiscal)
    if (Object.keys(errors).length) {
      set({ touched: true })
      flash('Revisa los campos marcados')
      return
    }
    set({ step: 'confirm', touched: false })
  }, [set, flash])

  // ── Step 3: Confirm ──────────────────────────────────────────────────────
  const generate = useCallback(async () => {
    const current = stateRef.current
    if (!current.ticket) { flash('Verifica tu ticket primero'); return }
    set({ busy: true })

    try {
      const res = await fetch('/api/invoice/emit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folio: current.ticket.folio, fiscal: current.fiscal }),
      })

      if (!res.ok) {
        let code = 'EMIT_ERROR'
        try {
          const b = (await res.json()) as { error?: { code?: string } }
          code = b?.error?.code ?? code
        } catch { /* ignore */ }

        if (code === 'ALREADY_INVOICED') {
          set({ busy: false, step: 'ticket', ticket: null, folio: '', lookupError: 'invoiced' })
        } else if (code === 'FULLY_REFUNDED') {
          set({ busy: false, step: 'ticket', ticket: null, folio: '', lookupError: 'refunded' })
        } else if (code === 'DEADLINE_EXCEEDED') {
          flash('El periodo de facturación de este ticket ya venció')
          set({ busy: false })
        } else if (code === 'FISCAL_INVALID') {
          flash('Datos fiscales inválidos — regresa y verifica los campos')
          set({ busy: false })
        } else {
          flash('Error al generar la factura. Intenta de nuevo más tarde.')
          set({ busy: false })
        }
        return
      }

      const data = (await res.json()) as { factura: GeneratedInvoice }
      // Factura generada con éxito: limpiar snapshot para no dejar datos pegados
      // si otro usuario usa el mismo navegador/dispositivo más tarde.
      clearSnapshot()
      set({ busy: false, step: 'success', factura: data.factura })
    } catch {
      flash('Error de conexión. Verifica tu internet e intenta de nuevo.')
      set({ busy: false })
    }
  }, [set, flash])

  // ── Navigation ───────────────────────────────────────────────────────────
  const goTo = useCallback((step: PortalStep) => set({ step }), [set])

  const reset = useCallback(() => {
    // Inicio de un ticket nuevo: limpiar snapshot para que los datos fiscales
    // del flujo anterior no reaparezcan en una facturación distinta.
    clearSnapshot()
    setState(INITIAL_STATE)
  }, [])

  // ── Download helpers ─────────────────────────────────────────────────────
  /**
   * Sanitiza una cadena para usarla como nombre de archivo:
   * conserva [A-Za-z0-9-_], reemplaza todo lo demás por "_".
   * Si el resultado está vacío devuelve "factura".
   */
  const sanitizeFilename = (raw: string): string => {
    const clean = raw.replace(/[^A-Za-z0-9\-_]/g, '_')
    return clean.length > 0 ? clean : 'factura'
  }

  /**
   * Descarga un archivo via fetch → Blob → object URL para que el navegador
   * no lo marque como descarga sospechosa y el nombre de archivo sea legible.
   */
  const triggerDownload = useCallback(async (
    facturamaId: string,
    format: 'pdf' | 'xml',
    filenameBase: string,
  ): Promise<void> => {
    const url = `/api/invoice/download/${encodeURIComponent(facturamaId)}/${format}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = `Factura_${sanitizeFilename(filenameBase)}.${format}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
  }, [])

  const downloadPdf = useCallback(async () => {
    const factura = stateRef.current.factura
    if (!factura?.facturamaId) { flash('No hay factura para descargar'); return }
    flash('Descargando PDF…')
    try {
      await triggerDownload(factura.facturamaId, 'pdf', factura.serieFolio)
    } catch {
      flash('No se pudo descargar el archivo. Intenta de nuevo.')
    }
  }, [flash, triggerDownload])

  const downloadXml = useCallback(async () => {
    const factura = stateRef.current.factura
    if (!factura?.facturamaId) { flash('No hay factura para descargar'); return }
    flash('Descargando XML…')
    try {
      await triggerDownload(factura.facturamaId, 'xml', factura.serieFolio)
    } catch {
      flash('No se pudo descargar el archivo. Intenta de nuevo.')
    }
  }, [flash, triggerDownload])

  const resendEmail = useCallback(async () => {
    const factura = stateRef.current.factura
    const email   = stateRef.current.fiscal.email
    if (!factura?.facturamaId) { flash('No hay factura para reenviar'); return }

    flash('Enviando factura por correo…')
    try {
      const res = await fetch('/api/invoice/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facturamaId: factura.facturamaId,
          email,
          serieFolio: factura.serieFolio,
        }),
      })
      if (res.ok) {
        flash('Factura enviada a ' + email)
      } else {
        flash('No se pudo enviar el correo. Intenta de nuevo.')
      }
    } catch {
      flash('No se pudo enviar el correo. Intenta de nuevo.')
    }
  }, [flash])

  const setTouched = useCallback((touched: boolean) => set({ touched }), [set])

  return {
    state,
    hydrated,
    // Step 1
    setFolio, toggleFolioHelp, lookup, proceed, dismissError,
    // Step 2
    setFiscal, setPrivacyAccepted, setTouched, goConfirm,
    // Step 3
    generate,
    // Navigation
    goTo, reset,
    // Actions
    downloadPdf, downloadXml, resendEmail,
  }
}
