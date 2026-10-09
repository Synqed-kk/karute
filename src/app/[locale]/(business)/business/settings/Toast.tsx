'use client'

/** ⚖ S60 R207 — the room's ONE toast, a sibling of Dialog.tsx / Switch.tsx.
 *  Business has no shared toast (Today, Customers, Reservations each hold a
 *  private one) and sonner is off the isolation guard's allowlist, so the room
 *  owns this small primitive: the text, the timer and the host element.
 *  - `show(text)` puts the text up and (re)starts ONE timer of TOAST_MS; a second
 *    call while one is showing replaces the text and restarts the timer.
 *  - When the timer ends only `is-on` goes; the words stay and fade out with it
 *    (the mock removes only its class).
 *  - The host is always in the DOM, empty until the first show, so the live
 *    region is there before it speaks. The span is keyed by a counter, so the
 *    same sentence twice is a new node and is announced again.
 *  - Text only, no action button: the room's undo is the section's own undo button (R209). */

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import './toast.css'

export const TOAST_MS = 2600

export function useToast(): { show: (text: string) => void; host: ReactElement } {
  const [t, setT] = useState({ text: '', on: false, n: 0 })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback((text: string) => {
    setT((s) => ({ text, on: true, n: s.n + 1 }))
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      setT((s) => ({ ...s, on: false }))
    }, TOAST_MS)
  }, [])

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current)
  }, [])

  const host = (
    <div className={'st-toast' + (t.on ? ' is-on' : '')} role="status" aria-live="polite" aria-atomic="true">
      <span key={t.n}>{t.text}</span>
    </div>
  )
  return { show, host }
}
