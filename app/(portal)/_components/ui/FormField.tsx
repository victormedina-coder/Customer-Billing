'use client'
import { useId } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  hint?: ReactNode
  badge?: ReactNode
}

export function FormField({ label, error, hint, badge, ...inputProps }: FormFieldProps) {
  const generatedId = useId()
  const id = inputProps.id ?? generatedId
  const errorId = `${id}-error`

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 7 }}>
        <label
          htmlFor={id}
          style={{ fontSize: 11, fontWeight: 800, color: '#6b7280', letterSpacing: '0.07em', textTransform: 'uppercase' as const }}
        >
          {label}
        </label>
        {badge}
      </div>
      <input
        {...inputProps}
        id={id}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        style={{
          width: '100%', height: 50,
          border: `2px solid ${error ? '#fca5a5' : 'var(--border-default)'}`,
          borderRadius: 11, padding: '0 15px',
          fontSize: 15, fontWeight: 700, color: '#1a1a1a',
          outline: 'none', background: '#fff',
          transition: 'border-color 0.15s',
          ...inputProps.style,
        }}
        onFocus={(e) => {
          e.target.style.borderColor = 'var(--brand-primary)'
          inputProps.onFocus?.(e)
        }}
        onBlur={(e) => {
          e.target.style.borderColor = error ? '#fca5a5' : 'var(--border-default)'
          inputProps.onBlur?.(e)
        }}
      />
      {hint}
      {error && (
        <div id={errorId} style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', marginTop: 6 }}>
          {error}
        </div>
      )}
    </div>
  )
}
