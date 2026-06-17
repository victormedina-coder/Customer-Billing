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
    <div style={{
      background: '#f5f8f7', borderBottom: '1px solid #e2e7e6',
      padding: '18px 24px', display: 'flex', alignItems: 'center',
      gap: 9, flexWrap: 'wrap', justifyContent: 'center',
    }}>
      {STEPS.map((step, i) => {
        const done = i < currentIdx
        const active = i === currentIdx
        return (
          <div key={step.key} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            {i > 0 && (
              <div style={{ width: 26, height: 2, borderRadius: 2, background: i <= currentIdx ? 'var(--brand-primary)' : '#d4dade' }} />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 27, height: 27, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 800, flexShrink: 0,
                transition: 'all 0.2s',
                ...(done
                  ? { background: 'var(--brand-primary)', color: '#fff' }
                  : active
                    ? { background: 'var(--brand-primary)', color: '#fff', boxShadow: '0 0 0 4px rgba(16,132,116,0.16)' }
                    : { background: '#eef1f0', color: '#9ca3af', border: '1.5px solid #d4dade' }
                ),
              }}>
                {done ? '✓' : i + 1}
              </div>
              <span style={{
                fontSize: 12.5, whiteSpace: 'nowrap',
                fontWeight: active || done ? 800 : 600,
                color: active ? '#1a1a1a' : done ? '#0b6359' : '#9ca3af',
              }}>
                {step.label}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
