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
  const [state, setState] = useState<PortalState>(INITIAL_STATE)
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Ref espejo del state para que los callbacks lean siempre el valor más reciente
  // sin quedar atrapados en un closure obsoleto.
  const stateRef = useRef<PortalState>(INITIAL_STATE)
  useEffect(() => { stateRef.current = state }, [state])

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

  // fillDemo rellena el folio Y dispara el lookup (sin avanzar): el usuario ve
  // el resultado (monto / alerta) y luego decide continuar.
  const fillDemo = useCallback((folio: string) => {
    set({ folio, lookupError: '', ticket: null })
    runLookup(folio)
  }, [set, runLookup])

  // ── Step 2: Fiscal ──────────────────────────────────────────────────────
  const setFiscal = useCallback(<K extends keyof FiscalData>(key: K, value: FiscalData[K]) =>
    setState(prev => ({ ...prev, fiscal: { ...prev.fiscal, [key]: value } })), [])

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
      set({ busy: false, step: 'success', factura: data.factura })
    } catch {
      flash('Error de conexión. Verifica tu internet e intenta de nuevo.')
      set({ busy: false })
    }
  }, [set, flash])

  // ── Navigation ───────────────────────────────────────────────────────────
  const goTo = useCallback((step: PortalStep) => set({ step }), [set])

  const reset = useCallback(() => setState(INITIAL_STATE), [])

  // ── Download helpers ─────────────────────────────────────────────────────
  /**
   * Dispara la descarga de un archivo desde la ruta same-origin usando un
   * anchor programático. La ruta ya envía Content-Disposition: attachment,
   * por lo que el navegador descarga sin navegar fuera de la página.
   */
  const triggerDownload = useCallback((facturamaId: string, format: 'pdf' | 'xml') => {
    const url = `/api/invoice/download/${encodeURIComponent(facturamaId)}/${format}`
    const a = document.createElement('a')
    a.href = url
    a.download = ''
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }, [])

  const downloadPdf = useCallback(() => {
    const facturamaId = stateRef.current.factura?.facturamaId
    if (!facturamaId) { flash('No hay factura para descargar'); return }
    flash('Descargando PDF…')
    triggerDownload(facturamaId, 'pdf')
  }, [flash, triggerDownload])

  const downloadXml = useCallback(() => {
    const facturamaId = stateRef.current.factura?.facturamaId
    if (!facturamaId) { flash('No hay factura para descargar'); return }
    flash('Descargando XML…')
    triggerDownload(facturamaId, 'xml')
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
    // Step 1
    setFolio, toggleFolioHelp, lookup, proceed, dismissError, fillDemo,
    // Step 2
    setFiscal, setTouched, goConfirm,
    // Step 3
    generate,
    // Navigation
    goTo, reset,
    // Actions
    downloadPdf, downloadXml, resendEmail,
  }
}
