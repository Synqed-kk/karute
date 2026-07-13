'use client'

// AppRoot — the ONE platform-neutral provider contract (packet-02 build #3).
//
// The thin target never renders src/app/layout.tsx, which supplies far more than
// splash+fonts. AppRoot re-assembles that provider set so a screen mounted inside
// the shell behaves identically to the same screen on the web:
//
//   • theme       — ThemeProvider (next-themes) + the StatusBarSync handshake
//   • notifications — sonner <Toaster/>
//   • data        — DataPortProvider (facade fetch in the shell, same-origin on web)
//   • error       — ErrorBoundary (fatal recovery; the global-error.tsx parity)
//   • locale      — NextIntlClientProvider (caller supplies messages + locale)
//   • safe-area / lang / theme attrs — applyDocumentSetup on mount
//
// Mounts a useful shell SYNCHRONOUSLY. First paint is NOT gated on auth (packet
// 01's boot gate owns that) — children render immediately; data arrives after.

import { useEffect, type ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { Toaster } from 'sonner'
import { ThemeProvider } from '@/components/providers/theme-provider'
import type { DataPort } from '@/lib/ports/types'
import { DataPortProvider } from '@/lib/ports/data-port'
import { ErrorBoundary } from './ErrorBoundary'
import { applyDocumentSetup } from './document-setup'

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
          <Toaster />
        </ThemeProvider>
      </NextIntlClientProvider>
    </ErrorBoundary>
  )
}
