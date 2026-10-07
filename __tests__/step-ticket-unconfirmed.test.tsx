import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StepTicket } from '../app/(portal)/_components/steps/StepTicket'

vi.mock('next/image', () => ({ default: () => null }))

describe('StepTicket — factura en verificación', () => {
  it('muestra el aviso específico y el correo de facturación', () => {
    const noop = () => undefined
    const html = renderToStaticMarkup(
      <StepTicket
        folio="" amount="" busy={false} lookupError="unconfirmed"
        contactEmail="facturas@example.com" ticket={null} showFolioHelp={false}
        onFolioChange={noop} onAmountChange={noop} onToggleFolioHelp={noop}
        onLookup={noop} onProceed={noop} onDismissError={noop}
      />
    )

    expect(html).toContain('Tu factura está en verificación')
    expect(html).toContain('24 horas')
    expect(html).toContain('mailto:facturas@example.com')
    expect(html).not.toContain('Este pedido ya fue facturado')
  })
})
