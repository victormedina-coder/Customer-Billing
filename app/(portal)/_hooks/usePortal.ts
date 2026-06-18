'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import type { PortalState, PortalStep, FiscalData } from '../_lib/types'
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

function randomHex(n: number): string {
  return Array.from({ length: n }, () => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('')
}
function randomUUID(): string {
  return `${randomHex(8)}-${randomHex(4)}-${randomHex(4)}-${randomHex(4)}-${randomHex(12)}`
}

export function usePortal(flash: (msg: string) => void) {
  const [state, setState] = useState<PortalState>(INITIAL_STATE)
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const generateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Ref espejo del state para que los callbacks lean siempre el valor más reciente
  // sin quedar atrapados en un closure obsoleto.
  const stateRef = useRef<PortalState>(INITIAL_STATE)
  useEffect(() => { stateRef.current = state }, [state])

  useEffect(() => () => {
    if (lookupTimer.current) clearTimeout(lookupTimer.current)
    if (generateTimer.current) clearTimeout(generateTimer.current)
  }, [])

  const set = useCallback((patch: Partial<PortalState>) =>
    setState(prev => ({ ...prev, ...patch })), [])

  // ── Step 1: Ticket ──────────────────────────────────────
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

    lookupTimer.current = setTimeout(() => {
      // TODO: en producción, llamar a POST /api/invoice/lookup
      const t = DEMO_TICKETS[normalizedFolio]
      if (!t) { set({ busy: false, ticket: null, lookupError: 'notfound' }); return }
      if (t.status === 'invoiced') { set({ busy: false, ticket: t, lookupError: 'invoiced' }); return }
      // Ticket válido: se carga y se queda en el paso Ticket para ver el monto.
      set({ busy: false, ticket: t, lookupError: '' })
    }, 600)
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

  // ── Step 2: Fiscal ──────────────────────────────────────
  const setFiscal = useCallback(<K extends keyof FiscalData>(key: K, value: FiscalData[K]) =>
    setState(prev => ({ ...prev, fiscal: { ...prev.fiscal, [key]: value } })), [])

  const setRfcRazon = useCallback((razon: string) => set({ rfcRazon: razon }), [set])

  const goConfirm = useCallback((rfcValidState: string) => {
    if (!state.ticket) { flash('Verifica tu ticket primero'); return }
    const errors = validateFiscal(state.fiscal)
    if (Object.keys(errors).length) {
      set({ touched: true })
      flash('Revisa los campos marcados')
      return
    }
    void rfcValidState
    set({ step: 'confirm', touched: false })
  }, [state.ticket, state.fiscal, set, flash])

  // ── Step 3: Confirm ──────────────────────────────────────
  const generate = useCallback(() => {
    set({ busy: true })
    if (generateTimer.current) clearTimeout(generateTimer.current)
    generateTimer.current = setTimeout(() => {
      // TODO: en producción, llamar a POST /api/invoice/emit
      const now = new Date()
      const p = (x: number) => String(x).padStart(2, '0')
      const fecha = `${p(now.getDate())}/${p(now.getMonth() + 1)}/${now.getFullYear()} ${p(now.getHours())}:${p(now.getMinutes())}`
      const folioNum = Math.floor(100000 + Math.random() * 899999)
      const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/'
      const sello = Array.from({ length: 48 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
      set({
        busy: false, step: 'success',
        factura: { uuid: randomUUID(), serieFolio: `GR-${folioNum}`, fecha, sello },
      })
    }, 1100)
  }, [set])

  // ── Navigation ───────────────────────────────────────────
  const goTo = useCallback((step: PortalStep) => set({ step }), [set])

  const reset = useCallback(() => setState(INITIAL_STATE), [])

  // ── Download actions (stubs) ──────────────────────────────
  const downloadPdf = useCallback(() => flash('Descargando PDF de la factura…'), [flash])
  const downloadXml = useCallback(() => flash('Descargando XML (CFDI) …'), [flash])
  const resendEmail = useCallback(() => flash('Factura reenviada a tu correo'), [flash])

  return {
    state,
    // Step 1
    setFolio, toggleFolioHelp, lookup, proceed, dismissError, fillDemo,
    // Step 2
    setFiscal, setRfcRazon, goConfirm,
    // Step 3
    generate,
    // Navigation
    goTo, reset,
    // Actions
    downloadPdf, downloadXml, resendEmail,
  }
}
