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
import { getSessionState, subscribeSessionState } from '@/lib/auth/mobile/session-store'
import { ErrorBoundary } from './ErrorBoundary'
import { applyDocumentSetup } from './document-setup'

/**
 * Toaster, gated to the signed-in session (F2, packet 12 fix batch).
 *
 * sonner's Toaster used to mount as a bare SIBLING of {children} — it
 * outlives the AuthGate's demote to LoginScreen, so any late toast (a
 * ProcessingIndicator autosave resolving after sign-out, a mutation toast
 * with a customer's name in it) rendered OVER the login screen, and its
 * action could push a stale route the next signed-in user would land on.
 * AppRoot is thin-only (no web usage) so this session-store import is safe.
 *
 * Renders <Toaster/> only while signed-in; on any transition AWAY from
 * signed-in, dismiss whatever sonner is holding — same shared-device
 * privacy class as the logout wipe: nothing buffered may replay into the
 * next user's session.
 */
function SessionGatedToaster() {
  const [signedIn, setSignedIn] = useState(
    () => getSessionState().status === 'signed-in',
  )
  useEffect(() => {
    return subscribeSessionState(() => {
      const next = getSessionState().status === 'signed-in'
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
