'use client'

// THE HONEST SCREEN (⚖ Liam 2026-09-16). A staff member of a multi-store
// business whom nobody has placed in a store yet sees this, and only this —
// no nav, no store pills, no data. Liam's own words for why it says what it
// says: "they'll say I can't see anything and get assigned." So the screen
// names the state plainly and points at the one person who can fix it; it does
// not apologise, offer a retry, or hint at a permission problem.
//
// 「もう一度確認する」 (G-1 fold, Greptile) is the one exception — once a
// manager HAS assigned them, staring at this screen until sign-out/restart is
// its own dead end, so a primary re-check action sits above ログアウト. Web
// has no client-side recheck of its own (the layout gate that decides this
// screen runs server-side): a reload IS the recheck. The phone passes its own
// probe (thin/AuthGate.tsx), which also fires automatically on foreground.

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { LogOut, Store } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import { wipeSessionVault } from '@/lib/karute/logout-wipe'

export function UnassignedStoreScreen({
  onRecheck,
}: {
  /** The phone's recheck — omitted on web, where the button reloads instead. */
  onRecheck?: () => Promise<void>
} = {}) {
  const t = useTranslations('unassignedStore')
  const locale = useLocale()
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)
  const [checking, setChecking] = useState(false)
  const busy = signingOut || checking

  async function handleSignOut() {
    setSigningOut(true)
    try {
      // Same shared-device wipe the profile screen's logout performs, and the
      // same best-effort posture: a wipe failure must never block signing out.
      await wipeSessionVault().catch(() => {})
      await createClient().auth.signOut()
      router.push(`/${locale}/login`)
      router.refresh()
    } catch {
      setSigningOut(false)
    }
  }

  async function handleRecheck() {
    setChecking(true)
    if (onRecheck) {
      try {
        await onRecheck()
      } finally {
        setChecking(false)
      }
    } else {
      // The web gate is server-side ((app)/layout.tsx) — a fresh navigation
      // re-runs it, so a reload IS the recheck.
      window.location.reload()
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--color-bg)] px-6">
      <div className="w-full max-w-[420px] text-center">
        <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full bg-muted">
          <Store className="size-5 text-muted-foreground" aria-hidden />
        </div>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          {t('title')}
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
          {t('body')}
        </p>
        <button
          type="button"
          onClick={handleRecheck}
          disabled={busy}
          className="mt-8 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {checking ? t('checking') : t('checkAgain')}
        </button>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={busy}
          className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
        >
          <LogOut className="size-4" aria-hidden />
          {t('logout')}
        </button>
      </div>
    </main>
  )
}
