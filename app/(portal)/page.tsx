'use client'
import { usePortal } from './_hooks/usePortal'
import { useToast } from './_hooks/useToast'
import { useRfcValidation } from './_hooks/useRfcValidation'
import { BrandHeader } from './_components/BrandHeader'
import { Stepper } from './_components/Stepper'
import { Toast } from './_components/Toast'
import { StepTicket } from './_components/steps/StepTicket'
import { StepFiscal } from './_components/steps/StepFiscal'
import { StepConfirm } from './_components/steps/StepConfirm'
import { StepSuccess } from './_components/steps/StepSuccess'

const STORE_NAME = 'Stetson México'
const TAGLINE = 'Facturación electrónica · CFDI 4.0'

export default function PortalPage() {
  const toast = useToast()
  const portal = usePortal(toast.show)
  const rfcVal = useRfcValidation()
  const { state } = portal

  const handleRfcBlur = (rfc: string) => {
    rfcVal.validate(rfc, (razon, regimen) => {
      if (!state.fiscal.razon) portal.setFiscal('razon', razon)
      if (!state.fiscal.regimen) portal.setFiscal('regimen', regimen)
      portal.setRfcRazon(razon)
    })
  }

  return (
    <>
      <BrandHeader storeName={STORE_NAME} tagline={TAGLINE} />
      <Stepper current={state.step} />

      <main style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px 72px' }}>
        <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>

          {state.step === 'ticket' && (
            <StepTicket
              folio={state.folio}
              total={state.total}
              busy={state.busy}
              lookupError={state.lookupError}
              ticket={state.ticket}
              showFolioHelp={state.showFolioHelp}
              onFolioChange={portal.setFolio}
              onTotalChange={portal.setTotal}
              onToggleFolioHelp={portal.toggleFolioHelp}
              onLookup={portal.lookup}
              onDismissError={portal.dismissError}
              onFillDemo={portal.fillDemo}
              onScanQR={() => toast.show('Cámara no disponible en el demo — captura el folio manualmente')}
              onDownloadPdf={portal.downloadPdf}
            />
          )}

          {state.step === 'fiscal' && state.ticket && (
            <StepFiscal
              ticket={state.ticket}
              fiscal={state.fiscal}
              touched={state.touched}
              rfcValidation={rfcVal.state}
              rfcRazon={rfcVal.rfcRazon}
              onBack={() => { portal.goTo('ticket'); rfcVal.reset() }}
              onFiscalChange={portal.setFiscal}
              onRfcBlur={handleRfcBlur}
              onContinue={() => portal.goConfirm(rfcVal.state)}
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

      <Toast message={toast.message} visible={toast.visible} />
    </>
  )
}
