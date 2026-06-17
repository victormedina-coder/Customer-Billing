'use client'
import type { InputHTMLAttributes, ReactNode } from 'react'

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  hint?: ReactNode
  badge?: ReactNode
}

export function FormField({ label, error, hint, badge, ...inputProps }: FormFieldProps) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 7 }}>
        <label style={{ fontSize: 11, fontWeight: 800, color: '#6b7280', letterSpacing: '0.07em', textTransform: 'uppercase' as const }}>
          {label}
        </label>
        {badge}
      </div>
      <input
        {...inputProps}
        style={{
          width: '100%', height: 50,
          border: `2px solid ${error ? '#fca5a5' : '#d4dade'}`,
          borderRadius: 11, padding: '0 15px',
          fontSize: 15, fontWeight: 700, color: '#1a1a1a',
          outline: 'none', background: '#fff',
          transition: 'border-color 0.15s',
          ...inputProps.style,
        }}
        onFocus={(e) => {
          e.target.style.borderColor = '#108474'
          inputProps.onFocus?.(e)
        }}
        onBlur={(e) => {
          e.target.style.borderColor = error ? '#fca5a5' : '#d4dade'
          inputProps.onBlur?.(e)
        }}
      />
      {hint}
      {error && (
        <div style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', marginTop: 6 }}>
          {error}
        </div>
      )}
    </div>
  )
}
