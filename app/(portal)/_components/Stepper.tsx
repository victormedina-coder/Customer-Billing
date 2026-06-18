import type { PortalStep } from '../_lib/types'

const STEPS: { key: PortalStep; label: string }[] = [
  { key: 'ticket', label: 'Ticket' },
  { key: 'fiscal', label: 'Datos fiscales' },
  { key: 'confirm', label: 'Confirmar' },
  { key: 'success', label: 'Listo' },
]

interface StepperProps {
  current: PortalStep
}

export function Stepper({ current }: StepperProps) {
  const currentIdx = STEPS.findIndex(s => s.key === current)

  return (
    <div className="stepper">
      {STEPS.map((step, i) => {
        const done = i < currentIdx
        const active = i === currentIdx
        const state = done ? 'done' : active ? 'active' : 'upcoming'
        return (
          <div key={step.key} className="step">
            {i > 0 && (
              <div
                className={`step-connector${i <= currentIdx ? ' step-connector--filled' : ''}`}
                aria-hidden="true"
              />
            )}
            <div className="step-inner">
              <div className={`step-circle step-circle--${state}`} aria-current={active ? 'step' : undefined}>
                {done ? '✓' : i + 1}
              </div>
              <span className={`step-label step-label--${state}`}>{step.label}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
