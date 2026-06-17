'use client'
import { useId } from 'react'
import type { SelectHTMLAttributes } from 'react'
import type { SelectOption } from '../../_lib/types'

interface FormSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  options: SelectOption[]
  error?: string
  placeholder?: string
}

export function FormSelect({ label, options, error, placeholder = 'Selecciona…', ...selectProps }: FormSelectProps) {
  const generatedId = useId()
  const id = selectProps.id ?? generatedId
  const errorId = `${id}-error`

  return (
    <div>
      <label
        htmlFor={id}
        style={{ display: 'block', fontSize: 11, fontWeight: 800, color: '#6b7280', letterSpacing: '0.07em', textTransform: 'uppercase' as const, marginBottom: 7 }}
      >
        {label}
      </label>
      <select
        {...selectProps}
        id={id}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        style={{
          width: '100%', height: 50,
          border: `2px solid ${error ? '#fca5a5' : '#d4dade'}`,
          borderRadius: 11, padding: '0 38px 0 15px',
          fontSize: 15, fontWeight: 600, color: '#1a1a1a',
          outline: 'none', cursor: 'pointer', backgroundColor: '#fff',
          appearance: 'none',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 14px center',
        }}
      >
        <option value="">{placeholder}</option>
        {options.map(opt => (
          <option key={opt.code} value={opt.code}>{opt.label}</option>
        ))}
      </select>
      {error && (
        <div id={errorId} style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', marginTop: 6 }}>
          {error}
        </div>
      )}
    </div>
  )
}
