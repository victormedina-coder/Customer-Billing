'use client'
import { useState, useCallback } from 'react'
import { usePortal } from './_hooks/usePortal'
import { useToast } from './_hooks/useToast'
import { useRfcValidation } from './_hooks/useRfcValidation'
import { validateFiscal } from './_lib/validators'
import { BrandHeader } from './_components/BrandHeader'
import { Stepper } from './_components/Stepper'
import { Toast } from './_components/Toast'
import { StepTicket } from './_components/steps/StepTicket'
import { StepFiscal } from './_components/steps/StepFiscal'
import { StepConfirm } from './_components/steps/StepConfirm'
import { StepSuccess } from './_components/steps/StepSuccess'
import { SkeletonPortal } from './_components/SkeletonPortal'

const STORE_NAME = 'Grupo Quince 22'
const TAGLINE = 'Facturación electrónica CFDI 4.0'

export default function PortalPage() {
  const toast = useToast()
  const portal = usePortal(toast.show)
  const rfcVal = useRfcValidation()
  const { state, hydrated } = portal
  const { fiscal } = state

  // Error SAT genérico del último validateReceptor (anti-oráculo: no distingue
  // campo). Se limpia en cuanto el usuario toca cualquier dato fiscal.
  const [satError, setSatError] = useState(false)
  // Indicador de "validando contra el SAT" para el botón Continuar.
  const [validating, setValidating] = useState(false)

  // ── Blur del RFC: solo valida FORMATO local, sin red (ver useRfcValidation) ─
  const handleRfcBlur = useCallback((rfc: string) => {
    rfcVal.validateRfc(rfc)
  }, [rfcVal])

  // ── Cambio de cualquier campo fiscal: limpia el satError genérico ──────────
  const handleFiscalChange = useCallback(
    <K extends keyof typeof fiscal>(key: K, value: typeof fiscal[K]) => {
      if (satError) setSatError(false)
      portal.setFiscal(key, value)
    },
    [portal, satError]
  )

  // ── Botón Continuar en StepFiscal ─────────────────────────────────────────
  const handleContinue = useCallback(async () => {
    // (a) Validación local de formato
    const localErrors = validateFiscal(fiscal)
    if (Object.keys(localErrors).length) {
      portal.setTouched(true)
      toast.show('Revisa los campos marcados', 'warning')
      return
    }

    // (b) Validación de coherencia contra el SAT
    setValidating(true)
    try {
      const result = await rfcVal.validateReceptor(fiscal)

      if (result.serviceError) {
        // No se pudo contactar a Facturama/SAT — permitir avanzar con advertencia.
        // El timbrado es el gate final de validación.
        toast.show('No se pudo verificar con el SAT en este momento — podrás continuar; la validación final ocurre al timbrar.', 'warning')
        setSatError(false)
        portal.goConfirm()
        return
      }

      if (!result.ok) {
        // Identidad SAT no coincide — anti-oráculo: bloqueamos con un único
        // mensaje genérico, sin indicar qué campo específico falló.
        setSatError(true)
        portal.setTouched(true)
        toast.show('No pudimos validar tus datos fiscales. Revísalos.', 'error')
        return
      }

      // Todo correcto
      setSatError(false)
      portal.goConfirm()
    } finally {
      setValidating(false)
    }
  }, [fiscal, rfcVal, portal, toast])

  return (
    <>
      <BrandHeader storeName={STORE_NAME} tagline={TAGLINE} />

      {!hydrated ? (
        <SkeletonPortal />
      ) : (
      <>
      <Stepper current={state.step} />

      <main style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px 72px' }}>
        <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>

          {state.step === 'ticket' && (
            <StepTicket
              folio={state.folio}
              amount={state.amount}
              busy={state.busy}
              lookupError={state.lookupError}
              ticket={state.ticket}
              showFolioHelp={state.showFolioHelp}
              onFolioChange={portal.setFolio}
              onAmountChange={portal.setAmount}
              onToggleFolioHelp={portal.toggleFolioHelp}
              onLookup={portal.lookup}
              onProceed={portal.proceed}
              onDismissError={portal.dismissError}
            />
          )}

          {state.step === 'fiscal' && state.ticket && (
            <StepFiscal
              ticket={state.ticket}
              fiscal={state.fiscal}
              touched={state.touched}
              privacyAccepted={state.privacyAccepted}
              termsAccepted={state.termsAccepted}
              rfcValidation={rfcVal.state}
              satError={satError}
              validating={validating}
              onBack={() => { portal.goTo('ticket'); rfcVal.reset(); setSatError(false) }}
              onFiscalChange={handleFiscalChange}
              onRfcBlur={handleRfcBlur}
              onPrivacyAcceptedChange={portal.setPrivacyAccepted}
              onTermsAcceptedChange={portal.setTermsAccepted}
              onContinue={() => { void handleContinue() }}
            />
          )}

          {state.step === 'confirm' && state.ticket && (
            <StepConfirm
              ticket={state.ticket}
              fiscal={state.fiscal}
              busy={state.busy}
              onBack={() => portal.goTo('fiscal')}
              onGenerate={portal.generate}
            />
          )}

          {state.step === 'success' && state.ticket && state.factura && (
            <StepSuccess
              ticket={state.ticket}
              fiscal={state.fiscal}
              factura={state.factura}
              storeName={STORE_NAME}
              onDownloadPdf={portal.downloadPdf}
              onDownloadXml={portal.downloadXml}
              onResendEmail={portal.resendEmail}
              onNewInvoice={portal.reset}
            />
          )}
        </div>
      </main>
      </>
      )}

      <Toast message={toast.message} visible={toast.visible} type={toast.type} />
    </>
  )
}
