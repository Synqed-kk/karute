'use client'

// ⚖ R53 — ログアウト, always visible as the identity card's last row. A text
// button (never black-filled). POSTs the Business sign-out route, then a FULL
// navigation to the login page so no client router cache of the shell survives.

import { useState, type ReactNode } from 'react'

/** `icon` given = the icon-strip form (⚖ R57 V2): the strip's own language, glyph only, with
 *  S1 as aria-label and title. Without it = the text row of the open rail. */
export function BusinessSignOutButton(props: { locale: string; label: string; failed: string; icon?: ReactNode }) {
  const { locale, label, failed, icon } = props
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)

  async function signOut() {
    if (pending) return
    setPending(true)
    setError(false)
    try {
      const res = await fetch('/api/business/sign-out', { method: 'POST', credentials: 'same-origin' })
      if (res.ok) {
        window.location.assign(`/${locale}/login`)
        return
      }
    } catch {
      // A network failure lands on the same honest line as a refusal.
    }
    setPending(false)
    setError(true)
  }

  return (
    <>
      {icon ? (
        <button type="button" className="sign-out-icon" onClick={signOut} disabled={pending} aria-busy={pending} aria-label={label} title={label}>
          {icon}
        </button>
      ) : (
        <button type="button" className="sign-out" onClick={signOut} disabled={pending} aria-busy={pending}>
          {label}
        </button>
      )}
      {error && <span className="sign-out-failed" role="status">{failed}</span>}
    </>
  )
}
