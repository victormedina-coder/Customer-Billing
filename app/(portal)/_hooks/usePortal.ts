'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import type { PortalState, PortalStep, FiscalData, Ticket, GeneratedInvoice, ToastType } from '../_lib/types'
import { validateFiscal } from '../_lib/validators'
import { DEMO_TICKETS } from '../_lib/constants'

const INITIAL_FISCAL: FiscalData = { rfc: '', razon: '', regimen: '', cp: '', uso: '', email: '' }

const INITIAL_STATE: PortalState = {
  step: 'ticket',
  folio: '',
  amount: '',
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
  'step' | 'folio' | 'amount' | 'ticket' | 'fiscal' | 'factura' | 'privacyAccepted' | 'rfcRazon' | 'lookupError'
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
      amount: s.amount,
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

async function fetchTicket(folio: string, amount: number): Promise<Ticket | null> {
  if (USE_MOCK) {
    // Fallback de mock: simula latencia y valida folio + monto exacto contra DEMO_TICKETS.
    // El error es genérico (VALIDATION_FAILED) sin importar cuál de los dos falló,
    // igual que el backend real — para que el flujo de un solo paso sea coherente en dev.
    await new Promise<void>((resolve) => setTimeout(resolve, 600))
    const demo = DEMO_TICKETS[folio]
    if (!demo || demo.total !== amount) throw new Error('VALIDATION_FAILED')
    return demo
  }

  // Camino real: POST /api/invoice/lookup — segundo factor: folio + monto
  const res = await fetch('/api/invoice/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folio, amount }),
  })

  if (!res.ok) {
    let errorCode = 'SHOPIFY_ERROR'
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      errorCode = body?.error?.code ?? errorCode
    } catch {
      // ignore
    }
    // Propagar el código para que el caller lo clasifique
    throw new Error(errorCode)
  }

  const data = (await res.json()) as { ticket: Ticket }
  return data.ticket
}

export function usePortal(flash: (msg: string, type?: ToastType) => void) {
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
        amount: snap.amount ?? '',
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
  // runLookup es la validación EXPLÍCITA (Enter o botón "Continuar"): envía folio +
  // monto juntos. El backend valida ambos en un solo paso y devuelve un error GENÉRICO
  // si cualquiera de los dos no coincide (VALIDATION_FAILED) — a propósito, para no
  // revelar cuál campo falló (prevención de enumeración de folios por terceros).
  // Si la validación es exitosa, se avanza DIRECTO al paso fiscal (no hay "ver monto
  // primero" porque el usuario ya lo ingresó).
  const runLookup = useCallback((folioRaw: string, amountRaw: string) => {
    const normalizedFolio = folioRaw.trim().toUpperCase()
    if (lookupTimer.current) clearTimeout(lookupTimer.current)

    if (!normalizedFolio) {
      flash('Ingresa el folio de tu ticket', 'warning')
      set({ busy: false, ticket: null, lookupError: '' })
      return
    }

    // Parseo del monto: quitar $, comas y espacios; aceptar "8900", "8,900.00", "$8,900.00"
    const parsedAmount = parseFloat(amountRaw.replace(/[$,\s]/g, ''))
    if (!amountRaw.trim() || isNaN(parsedAmount) || parsedAmount <= 0) {
      flash('Ingresa el importe total de tu ticket', 'warning')
      set({ busy: false, ticket: null, lookupError: '' })
      return
    }

    set({ busy: true, lookupError: '', folio: normalizedFolio, ticket: null })

    // Pequeño debounce para evitar doble-click / submit accidental
    lookupTimer.current = setTimeout(() => {
      fetchTicket(normalizedFolio, parsedAmount)
        .then((ticket) => {
          if (ticket === null) {
            // No debería ocurrir con el nuevo contrato (200 siempre trae ticket),
            // pero lo dejamos como fallback defensivo.
            set({ busy: false, ticket: null, lookupError: 'invalid' })
            return
          }
          if (ticket.status === 'invoiced') {
            set({ busy: false, ticket, lookupError: 'invoiced' })
            return
          }
          // Ticket válido + monto correcto: avanzar directo a datos fiscales.
          // No hay paso intermedio "ver monto" porque el usuario ya lo ingresó.
          set({ busy: false, ticket, lookupError: '', step: 'fiscal' })
        })
        .catch((err: unknown) => {
          const code = err instanceof Error ? err.message : ''

          if (code === 'VALIDATION_FAILED') {
            // Error genérico: folio O monto incorrecto — el backend no distingue
            // cuál falló a propósito (anti-enumeración). El banner tampoco lo insinúa.
            set({ busy: false, ticket: null, lookupError: 'invalid' })
            return
          }
          if (code === 'RATE_LIMITED') {
            // Demasiados intentos — el banner lo indica, no el flash.
            set({ busy: false, ticket: null, lookupError: 'ratelimited' })
            return
          }
          if (code === 'ALREADY_INVOICED') {
            // El pedido ya tiene un CFDI emitido — el banner lo indica, no el flash.
            set({ busy: false, ticket: null, lookupError: 'invoiced' })
            return
          }
          if (code === 'FULLY_REFUNDED') {
            // Pedido reembolsado en su totalidad — no se puede facturar.
            set({ busy: false, ticket: null, lookupError: 'refunded' })
            return
          }
          if (code === 'DEADLINE_EXCEEDED') {
            // Pedido encontrado pero fuera de la ventana de facturación del mes en curso.
            set({ busy: false, ticket: null, lookupError: 'deadline' })
            return
          }
          // Error de Shopify u otro error de servidor
          flash('Error al consultar el pedido. Intenta de nuevo.', 'error')
          set({ busy: false, ticket: null, lookupError: '' })
        })
    }, 200)
  }, [set, flash])

  // setFolio: editar el folio invalida el ticket cargado y limpia el error,
  // para que no quede un resultado obsoleto de una búsqueda anterior.
  const setFolio = useCallback((v: string) =>
    set({ folio: v, lookupError: '', ticket: null, busy: false }), [set])

  // setAmount: editar el importe también invalida el ticket cargado por la misma razón.
  const setAmount = useCallback((v: string) =>
    set({ amount: v, lookupError: '', ticket: null, busy: false }), [set])

  const toggleFolioHelp = useCallback(() =>
    setState(prev => ({ ...prev, showFolioHelp: !prev.showFolioHelp })), [])

  // lookup explícito (Enter / botón "Continuar"): toma folio y amount del estado actual.
  const lookup = useCallback(() => {
    runLookup(stateRef.current.folio, stateRef.current.amount)
  }, [runLookup])

  // proceed ya no es necesario como acción separada (la validación exitosa avanza sola),
  // pero se conserva para no romper la firma pública del hook; no hace nada nuevo.
  const proceed = useCallback(() => {
    const t = stateRef.current.ticket
    if (!t || t.status !== 'ok') { flash('Valida tu ticket primero', 'warning'); return }
    set({ step: 'fiscal' })
  }, [set, flash])

  const dismissError = useCallback(() =>
    set({ lookupError: '', ticket: null, folio: '', amount: '' }), [set])

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
    if (!stateRef.current.ticket) { flash('Verifica tu ticket primero', 'warning'); return }
    const errors = validateFiscal(stateRef.current.fiscal)
    if (Object.keys(errors).length) {
      set({ touched: true })
      flash('Revisa los campos marcados', 'warning')
      return
    }
    set({ step: 'confirm', touched: false })
  }, [set, flash])

  // ── Step 3: Confirm ──────────────────────────────────────────────────────
  const generate = useCallback(async () => {
    const current = stateRef.current
    if (!current.ticket) { flash('Verifica tu ticket primero', 'warning'); return }
    set({ busy: true })

    // Parseo del monto igual que en runLookup: el backend de emit también requiere amount.
    const parsedAmount = parseFloat(current.amount.replace(/[$,\s]/g, ''))

    try {
      const res = await fetch('/api/invoice/emit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folio: current.ticket.folio,
          amount: parsedAmount,
          fiscal: current.fiscal,
        }),
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
          flash('El periodo de facturación de este ticket ya venció', 'error')
          set({ busy: false })
        } else if (code === 'FISCAL_INVALID') {
          flash('Datos fiscales inválidos — regresa y verifica los campos', 'error')
          set({ busy: false })
        } else {
          flash('Error al generar la factura. Intenta de nuevo más tarde.', 'error')
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
      flash('Error de conexión. Verifica tu internet e intenta de nuevo.', 'error')
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
    invoiceId: string,
    format: 'pdf' | 'xml',
    filenameBase: string,
  ): Promise<void> => {
    const url = `/api/invoice/download/${encodeURIComponent(invoiceId)}/${format}`
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
    if (!factura?.invoiceId) { flash('No hay factura para descargar', 'warning'); return }
    flash('Descargando PDF…', 'info')
    try {
      await triggerDownload(factura.invoiceId, 'pdf', factura.serieFolio)
    } catch {
      flash('No se pudo descargar el archivo. Intenta de nuevo.', 'error')
    }
  }, [flash, triggerDownload])

  const downloadXml = useCallback(async () => {
    const factura = stateRef.current.factura
    if (!factura?.invoiceId) { flash('No hay factura para descargar', 'warning'); return }
    flash('Descargando XML…', 'info')
    try {
      await triggerDownload(factura.invoiceId, 'xml', factura.serieFolio)
    } catch {
      flash('No se pudo descargar el archivo. Intenta de nuevo.', 'error')
    }
  }, [flash, triggerDownload])

  const resendEmail = useCallback(async () => {
    const factura = stateRef.current.factura
    const email   = stateRef.current.fiscal.email
    if (!factura?.invoiceId) { flash('No hay factura para reenviar', 'warning'); return }

    flash('Enviando factura por correo…', 'info')
    try {
      const res = await fetch('/api/invoice/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: factura.invoiceId,
        }),
      })
      if (res.ok) {
        flash('Factura enviada a ' + email, 'success')
      } else {
        flash('No se pudo enviar el correo. Intenta de nuevo.', 'error')
      }
    } catch {
      flash('No se pudo enviar el correo. Intenta de nuevo.', 'error')
    }
  }, [flash])

  const setTouched = useCallback((touched: boolean) => set({ touched }), [set])

  return {
    state,
    hydrated,
    // Step 1
    setFolio, setAmount, toggleFolioHelp, lookup, proceed, dismissError,
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
