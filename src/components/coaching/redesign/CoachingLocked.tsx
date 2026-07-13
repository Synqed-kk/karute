'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowRight, GraduationCap, Lock } from 'lucide-react'
import { WebOnly } from '@/components/shell/WebOnly'

// ─────────────────────────────────────────────────────────────
// Coaching — locked / upsell state
// ─────────────────────────────────────────────────────────────
// Coaching is a paid module. When a business isn't entitled (its
// plan tier doesn't include coaching AND it's not on the unlimited
// override), the whole /coaching/* section renders this instead of
// the dashboard. Gated once in coaching/layout.tsx so every
// sub-route shows it. Liam's unlimited account never lands here —
// it keys on the same isUnlimited flag as the live multi-store gate.
export function CoachingLocked() {
  const t = useTranslations('coaching.locked')
  const locale = useLocale()

  return (
    <main className="mx-auto flex w-full max-w-[720px] flex-col items-center px-4 py-16 md:py-24">
      <div className="w-full rounded-2xl border border-border bg-card p-8 text-center shadow-sm md:p-10">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
          <GraduationCap className="size-7" aria-hidden />
        </div>

        <div className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
          <Lock className="size-3" aria-hidden />
          {t('badge')}
        </div>

        <h1 className="mt-4 text-[20px] font-bold tracking-tight text-foreground md:text-[22px]">
          {t('title')}
        </h1>
        <p className="mx-auto mt-3 max-w-[46ch] text-[13.5px] leading-relaxed text-muted-foreground">
          {t('body')}
        </p>

        {/* App-store canon: no plan-steering CTA inside the native shell —
            the locked info above stays, the button is web-only (never SSR'd,
            so it can't flash in the shell either). */}
        <WebOnly>
          <Link
            href={`/${locale}/settings`}
            className="mt-7 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 text-[14px] font-semibold text-white transition-colors hover:bg-indigo-700"
          >
            {t('cta')}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
          <p className="mt-3 text-[11.5px] text-muted-foreground">{t('ctaHint')}</p>
        </WebOnly>
      </div>
    </main>
  )
}
