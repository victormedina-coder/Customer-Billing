'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import type { ToastType } from '../_lib/types'

export function useToast() {
  const [message, setMessage] = useState('')
  const [type, setType] = useState<ToastType>('info')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const show = useCallback((msg: string, toastType: ToastType = 'info') => {
    setMessage(msg)
    setType(toastType)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setMessage(''), 2800)
  }, [])

  return { message, type, visible: !!message, show }
}
