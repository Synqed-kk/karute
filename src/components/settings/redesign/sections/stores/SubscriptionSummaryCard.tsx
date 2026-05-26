'use client'

// ─────────────────────────────────────────────────────────────
// SubscriptionSummaryCard — compact banner above the stores list
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/settings/SubscriptionSummaryCard.tsx
// Five visual states keyed by subscription status + tier:
//
//   trialing  → blue banner, days-remaining countdown, plan CTA
//   active    → standard banner, monthly total + next bill
//   past_due  → red banner, urgent fix-payment CTA
//   canceled  → muted "data is safe, re-subscribe to continue"
//   free      → soft upgrade prompt
//
// Tapping the manage CTA routes to the 契約 sub-tab where the
// full subscription page lives (PR follow-up).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CreditCard, Crown, Sparkles } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import {
  monthlyTotalJpy,
  useSubscription,
} from '@/lib/subscription/hooks'

const YEN = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  maximumFractionDigits: 0,
})

export function SubscriptionSummaryCard() {
  const t = useTranslations('settings.subscription.summary')
  const tTier = useTranslations('settings.subscription.tierLabels')
  const locale = useLocale()
  const subscription = useSubscription()

  // Trial countdown ticks every minute so a long-lived session
  // sees the days-remaining update without a reload. Keeping
  // Date.now() out of render keeps React's purity rules happy.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  const total = monthlyTotalJpy(subscription)
  const manageHref = `/${locale}/settings?tab=subscription`

  // ─── past_due — alarming red ──────────────────────────────
  if (subscription.status === 'past_due') {
    return (
      <div className="flex items-start gap-3 rounded-xl bg-red-50/70 px-4 py-3 ring-1 ring-red-300/70 dark:bg-red-500/[0.08] dark:ring-red-500/30">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-red-600 text-white">
          <AlertTriangle className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-red-900 dark:text-red-200">
            {t('pastDueTitle')}
          </div>
          <div className="mt-0.5 text-[11px] leading-relaxed text-red-800/90 dark:text-red-300/85">
            {t('pastDueBody')}
          </div>
        </div>
        <Link
          href={manageHref}
          className="inline-flex h-8 shrink-0 items-center rounded-md bg-red-600 px-3 text-[12px] font-medium text-white transition-colors hover:bg-red-700"
        >
          {t('pastDueCta')}
        </Link>
      </div>
    )
  }

  // ─── trialing — blue countdown ────────────────────────────
  if (subscription.status === 'trialing') {
    const daysLeft = subscription.trialEndsAt
      ? Math.max(
          0,
          Math.ceil(
            (new Date(subscription.trialEndsAt).getTime() - now) /
              (24 * 60 * 60 * 1000),
          ),
        )
      : 0
    return (
      <div className="flex items-start gap-3 rounded-xl bg-gradient-to-br from-blue-50/70 via-white to-white px-4 py-3 ring-1 ring-blue-200/70 dark:bg-card dark:from-transparent dark:via-transparent dark:to-transparent dark:ring-blue-500/25">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
          <Sparkles className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-blue-900 dark:text-blue-200">
            {daysLeft <= 0
              ? t('trialEndedTitle')
              : t('trialTitle', { days: daysLeft })}
          </div>
          <div className="mt-0.5 text-[11px] leading-relaxed tabular-nums text-blue-800/90 dark:text-blue-300/85">
            {t('trialBody')}
          </div>
        </div>
        <Link
          href={manageHref}
          className="inline-flex h-8 shrink-0 items-center rounded-md bg-blue-600 px-3 text-[12px] font-medium text-white transition-colors hover:bg-blue-700"
        >
          {t('trialCta')}
        </Link>
      </div>
    )
  }

  // ─── free — soft upgrade prompt ───────────────────────────
  if (subscription.tier === 'free') {
    return (
      <div className="flex items-start gap-3 rounded-xl bg-gray-50/70 px-4 py-3 ring-1 ring-gray-200 dark:bg-white/[0.04] dark:ring-white/10">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-gray-700 dark:bg-white/10 dark:text-gray-300">
          <CreditCard className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-foreground">
            {t('freeTitle')}
          </div>
          <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {t('freeBody')}
          </div>
        </div>
        <Link
          href={manageHref}
          className="inline-flex h-8 shrink-0 items-center rounded-md bg-sage-800 px-3 text-[12px] font-medium text-white transition-colors hover:bg-sage-900"
        >
          {t('freeCta')}
        </Link>
      </div>
    )
  }

  // ─── active paid — monthly total + next bill ──────────────
  const tierLabel = tTier(subscription.tier)
  const isPro = subscription.tier === 'professional'
  return (
    <div className="flex items-start gap-3 rounded-xl bg-card px-4 py-3 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div
        className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
          isPro
            ? 'bg-amber-500 text-white dark:bg-amber-400'
            : 'bg-blue-600 text-white'
        }`}
      >
        {isPro ? (
          <Crown className="size-4" aria-hidden />
        ) : (
          <CreditCard className="size-4" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[13px] font-semibold text-foreground">
            {t('activeTitle', { tier: tierLabel })}
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            · {t('storeCount', { n: subscription.storeCount })}
          </span>
        </div>
        <div className="mt-0.5 text-[11px] leading-relaxed tabular-nums text-muted-foreground">
          {t('activeBody', {
            total: YEN.format(total),
            perStore: YEN.format(subscription.pricePerStoreJpy),
            nextDate: subscription.nextBillingDate
              ? formatDate(subscription.nextBillingDate, locale)
              : '—',
          })}
        </div>
      </div>
      <Link
        href={manageHref}
        className="inline-flex h-8 shrink-0 items-center rounded-md px-3 text-[12px] font-medium text-foreground ring-1 ring-black/10 transition-colors hover:bg-gray-50 dark:ring-white/15 dark:hover:bg-white/[0.05]"
      >
        {t('manageCta')}
      </Link>
    </div>
  )
}

function formatDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(
      locale === 'en' ? 'en-US' : 'ja-JP',
      { year: 'numeric', month: 'short', day: 'numeric' },
    )
  } catch {
    return iso.slice(0, 10)
  }
}
