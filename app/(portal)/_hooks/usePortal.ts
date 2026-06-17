'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import type { PortalState, PortalStep, FiscalData } from '../_lib/types'
import { validateFiscal } from '../_lib/validators'
import { DEMO_TICKETS } from '../_lib/constants'

const INITIAL_FISCAL: FiscalData = { rfc: '', razon: '', regimen: '', cp: '', uso: '', email: '' }

const INITIAL_STATE: PortalState = {
  step: 'ticket',
  folio: '', total: '',
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

  useEffect(() => () => {
    if (lookupTimer.current) clearTimeout(lookupTimer.current)
    if (generateTimer.current) clearTimeout(generateTimer.current)
  }, [])

  const set = useCallback((patch: Partial<PortalState>) =>
    setState(prev => ({ ...prev, ...patch })), [])

  // ── Step 1: Ticket ──────────────────────────────────────
  const setFolio = useCallback((v: string) => set({ folio: v, lookupError: '' }), [set])
  const setTotal = useCallback((v: string) => set({ total: v, lookupError: '' }), [set])
  const toggleFolioHelp = useCallback(() =>
    setState(prev => ({ ...prev, showFolioHelp: !prev.showFolioHelp })), [])

  const lookup = useCallback(() => {
    const folio = state.folio.trim().toUpperCase()
    if (!folio) { flash('Ingresa el folio de tu ticket'); return }
    const totalNum = parseFloat(state.total)
    set({ busy: true, lookupError: '' })

    if (lookupTimer.current) clearTimeout(lookupTimer.current)
    lookupTimer.current = setTimeout(() => {
      // TODO: en producción, llamar a POST /api/invoice/lookup
      const t = DEMO_TICKETS[folio]
      if (!t) { set({ busy: false, lookupError: 'notfound', ticket: null }); return }
      if (state.total && !isNaN(totalNum) && Math.abs(t.total - totalNum) > 0.5) {
        set({ busy: false, lookupError: 'mismatch', ticket: null }); return
      }
      if (t.status === 'invoiced') { set({ busy: false, lookupError: 'invoiced', ticket: t }); return }
      set({ busy: false, lookupError: '', ticket: t, step: 'fiscal' })
    }, 650)
  }, [state.folio, state.total, set, flash])

  const dismissError = useCallback(() =>
    set({ lookupError: '', ticket: null, folio: '', total: '' }), [set])

  const fillDemo = useCallback((folio: string, total: string) =>
    set({ folio, total, lookupError: '', ticket: null }), [set])

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
    setFolio, setTotal, toggleFolioHelp, lookup, dismissError, fillDemo,
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
