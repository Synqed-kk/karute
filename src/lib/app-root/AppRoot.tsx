'use client'

// AppRoot — the ONE platform-neutral provider contract (packet-02 build #3).
//
// The thin target never renders src/app/layout.tsx, which supplies far more than
// splash+fonts. AppRoot re-assembles that provider set so a screen mounted inside
// the shell behaves identically to the same screen on the web:
//
//   • theme       — ThemeProvider (next-themes) + the StatusBarSync handshake
//   • notifications — sonner <Toaster/>, gated to the signed-in session so a
//                   late toast can never render over LoginScreen (F2, packet
//                   12 fix batch — see SessionGatedToaster below)
//   • data        — DataPortProvider (facade fetch in the shell, same-origin on web)
//   • error       — ErrorBoundary (fatal recovery; the global-error.tsx parity)
//   • locale      — NextIntlClientProvider (caller supplies messages + locale)
//   • safe-area / lang / theme attrs — applyDocumentSetup on mount
//
// Mounts a useful shell SYNCHRONOUSLY. First paint is NOT gated on auth (packet
// 01's boot gate owns that) — children render immediately; data arrives after.

import { useEffect, useState, type ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { Toaster, toast } from 'sonner'
import { ThemeProvider } from '@/components/providers/theme-provider'
import type { DataPort } from '@/lib/ports/types'
import { DataPortProvider } from '@/lib/ports/data-port'
import {
  getSessionState,
  hasKnownSession,
  subscribeSessionState,
} from '@/lib/auth/mobile/session-store'
import { ErrorBoundary } from './ErrorBoundary'
import { applyDocumentSetup } from './document-setup'

/** Mirrors AuthGate's (thin/AuthGate.tsx) live-app contract EXACTLY:
 *  signed-in, or 'recovering' WITH a known session (an offline resume).
 *  AuthGate never locks a mid-shift user out for a resume blip — a
 *  stricter (signed-in-only) toaster gate would black out every toast
 *  app-wide during exactly that blip, including the autosave-failed toast
 *  whose whole point is "never silently lose a take", and a save is most
 *  likely to fail during the blip that causes 'recovering' in the first
 *  place (B1, packet 12 fix batch round 3). */
function isLiveSession(): boolean {
  const state = getSessionState()
  return state.status === 'signed-in' || (state.status === 'recovering' && hasKnownSession())
}

/**
 * Toaster, gated to the live-app session state (F2, packet 12 fix batch).
 *
 * sonner's Toaster used to mount as a bare SIBLING of {children} — it
 * outlives the AuthGate's demote to LoginScreen, so any late toast (a
 * ProcessingIndicator autosave resolving after sign-out, a mutation toast
 * with a customer's name in it) rendered OVER the login screen, and its
 * action could push a stale route the next signed-in user would land on.
 * AppRoot is thin-only (no web usage) so this session-store import is safe.
 *
 * Renders <Toaster/> only while isLiveSession(); on a transition AWAY from
 * live, dismiss whatever sonner is holding — same shared-device privacy
 * class as the logout wipe: nothing buffered may replay into the next
 * user's session. Dismiss fires ONLY entering the gated-off state (was
 * live, now isn't) — NOT on the way back in. A prior round (F2 round 2)
 * dismissed both directions on the theory that sonner "replays" a toast
 * buffered while unmounted to the next mounted Toaster; that premise is
 * false against the installed sonner: Observer.subscribe only registers
 * the new SUBSCRIBER, it never replays already-queued toasts, and
 * Toaster's own list starts from useState([]) at mount — a toast fired
 * with no Toaster mounted simply never renders. Dismissing on entry
 * protected nothing, while it also fired on every live signed-in↔recovering
 * blip, wiping a still-signed-in user's own in-flight toasts.
 */
function SessionGatedToaster() {
  const [signedIn, setSignedIn] = useState(isLiveSession)
  useEffect(() => {
    return subscribeSessionState(() => {
      const next = isLiveSession()
      setSignedIn((was) => {
        if (was && !next) toast.dismiss()
        return next
      })
    })
  }, [])
  return signedIn ? <Toaster /> : null
}

export type AppRootProps = {
  dataPort: DataPort
  locale: string
  messages: Record<string, unknown>
  timeZone?: string
  onError?: (error: Error) => void
  children: ReactNode
}

export function AppRoot({
  dataPort,
  locale,
  messages,
  timeZone = 'Asia/Tokyo',
  onError,
  children,
}: AppRootProps) {
  useEffect(() => {
    applyDocumentSetup(document)
  }, [])

  return (
    <ErrorBoundary onError={onError}>
      <NextIntlClientProvider
        locale={locale}
        messages={messages}
        timeZone={timeZone}
      >
        <ThemeProvider>
          <DataPortProvider value={dataPort}>{children}</DataPortProvider>
          <SessionGatedToaster />
        </ThemeProvider>
      </NextIntlClientProvider>
    </ErrorBoundary>
  )
}
