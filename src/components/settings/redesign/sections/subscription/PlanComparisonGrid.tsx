'use client'

// ─────────────────────────────────────────────────────────────
// PlanComparisonGrid — 3 tiers + Enterprise tile
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/settings/PlanComparisonGrid.tsx
// Three primary tiles (Free / Standard / Professional) with
// Professional highlighted as the conversion default (per Liam's
// 3-tier psychology). Enterprise sits below as a quieter
// contact-sales row.
//
// ANTHONY: upgradeTo / cancelSubscription mutations live in
// src/lib/subscription/hooks.ts — each maps to a Stripe edge
// function call. UI doesn't need to know; the hook contract
// stays the same.

import { Check, Crown, Sparkles, Star, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  useSubscription,
  useSubscriptionMutations,
} from '@/lib/subscription/hooks'
import { TIER_PRICE_JPY, type SubscriptionTier } from '@/lib/subscription/types'

const YEN = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  maximumFractionDigits: 0,
})

export function PlanComparisonGrid() {
  const t = useTranslations('settings.subscription.plans')
  const subscription = useSubscription()
  const { upgradeTo, startTrial, cancelSubscription } =
    useSubscriptionMutations()

  const currentTier = subscription.tier
  const trialAvailable =
    currentTier === 'free' && subscription.status !== 'canceled'

  const handleAction = (targetTier: SubscriptionTier) => {
    if (targetTier === 'enterprise') {
      if (typeof window !== 'undefined') {
        window.location.href =
          'mailto:sales@synqed.jp?subject=Enterprise%20plan%20inquiry'
      }
      return
    }
    if (targetTier === 'free') {
      if (typeof window === 'undefined') return
      if (!window.confirm(t('downgradeConfirm'))) return
      cancelSubscription()
      return
    }
    upgradeTo(targetTier)
  }

  const tierLabelFor = (tier: SubscriptionTier): string => {
    if (tier === 'standard') return 'Standard'
    if (tier === 'professional') return 'Professional'
    return tier
  }

  const actionLabelFor = (target: SubscriptionTier): string => {
    if (currentTier === target) return t('actionCurrent')
    if (target === 'free') return t('actionDowngradeFree')
    return t('actionUpgrade', { tier: tierLabelFor(target) })
  }

  return (
    <div className="space-y-4">
      {trialAvailable && (
        <div className="flex items-start gap-3 rounded-xl bg-blue-50/70 p-4 ring-1 ring-blue-200/70 dark:bg-blue-500/[0.08] dark:ring-blue-500/25">
          <Sparkles
            className="mt-0.5 size-5 shrink-0 text-blue-700 dark:text-blue-300"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-blue-900 dark:text-blue-200">
              {t('trialBannerTitle')}
            </div>
            <p className="mt-0.5 text-[12px] leading-relaxed text-blue-800/90 dark:text-blue-300/85">
              {t('trialBannerBody')}
            </p>
          </div>
          <button
            type="button"
            onClick={startTrial}
            className="inline-flex h-9 shrink-0 items-center rounded-md bg-blue-600 px-4 text-[13px] font-medium text-white transition-colors hover:bg-blue-700"
          >
            {t('trialBannerCta')}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <PlanCard
          tier="free"
          title={t('freeTitle')}
          price={t('freePrice')}
          pitch={t('freePitch')}
          features={[
            t('freeFeature1'),
            t('freeFeature2'),
            t('freeFeature3'),
            t('freeFeature4'),
            t('freeFeature5'),
            t('freeFeature6'),
            t('freeFeature7'),
          ]}
          currentTier={currentTier}
          actionLabel={actionLabelFor('free')}
          onAction={handleAction}
          currentPill={t('currentPill')}
        />
        <PlanCard
          tier="standard"
          title={t('standardTitle')}
          price={t('standardPrice', {
            price: YEN.format(TIER_PRICE_JPY.standard),
          })}
          pitch={t('standardPitch')}
          features={[
            t('standardFeature1'),
            t('standardFeature2'),
            t('standardFeature3'),
            t('standardFeature4'),
            t('standardFeature5'),
            t('standardFeature6'),
            t('standardFeature7'),
            t('standardFeature8'),
            t('standardFeature9'),
          ]}
          currentTier={currentTier}
          actionLabel={actionLabelFor('standard')}
          onAction={handleAction}
          currentPill={t('currentPill')}
        />
        <PlanCard
          tier="professional"
          title={t('professionalTitle')}
          price={t('professionalPrice', {
            price: YEN.format(TIER_PRICE_JPY.professional),
          })}
          pitch={t('professionalPitch')}
          features={[
            t('professionalFeature1'),
            t('professionalFeature2'),
            t('professionalFeature3'),
            t('professionalFeature4'),
            t('professionalFeature5'),
            t('professionalFeature6'),
          ]}
          currentTier={currentTier}
          actionLabel={actionLabelFor('professional')}
          onAction={handleAction}
          highlight
          mostPopular={t('mostPopular')}
          currentPill={t('currentPill')}
        />
      </div>

      {/* Enterprise — quieter, alone */}
      <div className="flex items-start gap-4 rounded-xl bg-gray-50/60 p-4 ring-1 ring-black/5 md:p-5 dark:bg-white/[0.03] dark:ring-white/10">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          <Crown className="size-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-foreground">
            {t('enterpriseTitle')}
          </div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
            {t('enterprisePitch')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => handleAction('enterprise')}
          className="inline-flex h-9 shrink-0 items-center rounded-md px-3.5 text-[13px] font-medium text-foreground ring-1 ring-black/10 transition-colors hover:bg-white dark:ring-white/15 dark:hover:bg-white/[0.05]"
        >
          {t('enterpriseCta')}
        </button>
      </div>
    </div>
  )
}

interface PlanCardProps {
  tier: SubscriptionTier
  title: string
  price: string
  pitch: string
  features: string[]
  currentTier: SubscriptionTier
  onAction: (t: SubscriptionTier) => void
  actionLabel: string
  highlight?: boolean
  mostPopular?: string
  currentPill: string
}

function PlanCard({
  tier,
  title,
  price,
  pitch,
  features,
  currentTier,
  onAction,
  actionLabel,
  highlight,
  mostPopular,
  currentPill,
}: PlanCardProps) {
  const isCurrent = tier === currentTier

  return (
    <div
      className={`relative flex h-full flex-col rounded-xl p-4 transition-colors ${
        highlight
          ? 'bg-blue-50/40 ring-2 ring-blue-400 dark:bg-blue-500/[0.08] dark:ring-blue-500/60'
          : isCurrent
            ? 'bg-indigo-50/50 ring-1 ring-indigo-600 dark:bg-white/[0.04] dark:ring-indigo-300/40'
            : 'bg-card ring-1 ring-black/5 dark:ring-white/10'
      }`}
    >
      {highlight && mostPopular && (
        <span className="absolute -top-2.5 left-4 inline-flex h-5 items-center gap-1 rounded-full bg-blue-600 px-2 text-[10px] font-semibold text-white">
          <Star className="size-2.5" aria-hidden />
          {mostPopular}
        </span>
      )}
      {isCurrent && !highlight && (
        <span className="absolute -top-2.5 left-4 inline-flex h-5 items-center gap-1 rounded-full bg-sage-800 px-2 text-[10px] font-semibold text-white">
          {currentPill}
        </span>
      )}
      {isCurrent && highlight && (
        <span className="absolute -top-2.5 right-4 inline-flex h-5 items-center gap-1 rounded-full bg-sage-800 px-2 text-[10px] font-semibold text-white">
          {currentPill}
        </span>
      )}
      <div className="text-[15px] font-semibold text-foreground">{title}</div>
      <div className="mt-2 text-[22px] font-bold tracking-tight tabular-nums text-foreground">
        {price}
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
        {pitch}
      </p>

      <ul className="mt-4 flex-1 space-y-1.5">
        {features.map((feat, i) => (
          <li
            key={i}
            className="flex items-start gap-1.5 text-[12px] leading-relaxed text-foreground/85"
          >
            {feat.startsWith('×') ? (
              <>
                <X
                  className="mt-0.5 size-3 shrink-0 text-gray-400 dark:text-gray-600"
                  aria-hidden
                />
                <span className="text-muted-foreground">
                  {feat.slice(1).trim()}
                </span>
              </>
            ) : (
              <>
                <Check
                  className="mt-0.5 size-3 shrink-0 text-green-600 dark:text-green-400"
                  aria-hidden
                />
                <span>{feat}</span>
              </>
            )}
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => onAction(tier)}
        disabled={isCurrent}
        className={`mt-4 inline-flex h-10 w-full items-center justify-center rounded-md px-4 text-[13px] font-medium transition-colors ${
          isCurrent
            ? 'cursor-not-allowed bg-gray-100 text-muted-foreground dark:bg-white/[0.06]'
            : highlight
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-sage-800 text-white hover:bg-sage-900'
        }`}
      >
        {actionLabel}
      </button>
    </div>
  )
}
