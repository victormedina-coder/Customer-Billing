'use client'
import { useState, useRef, useCallback } from 'react'

export function useToast() {
  const [message, setMessage] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback((msg: string) => {
    setMessage(msg)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setMessage(''), 2800)
  }, [])

  return { message, visible: !!message, show }
}
