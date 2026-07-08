'use client'

// ─────────────────────────────────────────────────────────────
// PlanComparisonGrid — the approved 4-tier paywall
// ─────────────────────────────────────────────────────────────
// Rebuilt to Liam's approved paywall-preview artifact: four equal
// columns (Free / Standard / Professional highlighted / Enterprise)
// + the 店舗を追加するとき fee box underneath. Every number derives
// from the live plan model — TIER_PRICE_JPY, TIER_FEATURES,
// staffLimitFor, STORE_SETUP_FEE_JPY — so this surface and the
// server gates can never disagree.
//
// No self-serve checkout exists yet, so every plan-change CTA is an
// honest mailto to sales — never a faked mutation. The old
// localStorage subscription mock is gone from this component.

import { Building2, Check, Crown, Star, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  TIER_FEATURES,
  TIER_PRICE_JPY,
  type SubscriptionTier,
} from '@/lib/subscription/types'
import { staffLimitFor } from '@/lib/subscription/gating'
import { STORE_SETUP_FEE_JPY } from '@/lib/subscription/fees'

const SALES_MAILTO = 'mailto:sales@synqed.jp?subject=Karute%20plan%20change'
const ENTERPRISE_MAILTO =
  'mailto:sales@synqed.jp?subject=Enterprise%20plan%20inquiry'

/** Half-width ¥ + ja grouping, matching the approved artifact ("¥5,980"). */
const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

interface PlanComparisonGridProps {
  /** Live tier from the real entitlement (marks the current plan). */
  currentTier?: SubscriptionTier
  /** Unlimited / comped account — banner + inert CTAs + the owner-free
   *  fee row; no tier gets the "current" highlight (tier is orthogonal
   *  to the unlimited override). */
  isUnlimited?: boolean
}

interface FeatureRow {
  label: string
  on: boolean
  /** The staff-limit row — emphasized, per the artifact. */
  staff?: boolean
  /** Professional's coaching row — emphasized, per the artifact. */
  strong?: boolean
}

export function PlanComparisonGrid({
  currentTier,
  isUnlimited = false,
}: PlanComparisonGridProps = {}) {
  const t = useTranslations('settings.subscription.plans')

  const highlightTier: SubscriptionTier | null = isUnlimited
    ? null
    : (currentTier ?? null)

  const staffRow = (tier: SubscriptionTier): FeatureRow => {
    const n = staffLimitFor(tier)
    return {
      label:
        n === 'unlimited' ? t('staffUnlimited') : t('staffUpTo', { n }),
      on: true,
      staff: true,
    }
  }
  const quotaLabel = (tier: SubscriptionTier): string => {
    const f = TIER_FEATURES[tier]
    // Both quotas are numeric on the capped tiers (free/standard); the
    // uncapped tiers use the all-unlimited row instead of this one.
    return t('quotaLimited', {
      customers: f.customers as number,
      recordings: f.recordingsPerMonth as number,
    })
  }

  const featuresFor = (tier: SubscriptionTier): FeatureRow[] => {
    switch (tier) {
      case 'free':
        return [
          staffRow('free'),
          { label: t('storesLimited', { n: TIER_FEATURES.free.stores as number }), on: true },
          { label: quotaLabel('free'), on: true },
          { label: t('featAiKarte'), on: false },
          { label: t('featCoaching'), on: false },
        ]
      case 'standard':
        return [
          staffRow('standard'),
          { label: t('storesUnlimited'), on: true },
          { label: quotaLabel('standard'), on: true },
          { label: t('featAiSuite'), on: true },
          { label: t('featCoaching'), on: false },
        ]
      case 'professional':
        return [
          staffRow('professional'),
          { label: t('quotaAllUnlimited'), on: true },
          { label: t('featAiSuite'), on: true },
          { label: t('featCoachingPlus'), on: true, strong: true },
          { label: t('featPrioritySupport'), on: true },
        ]
      default:
        return [
          staffRow('enterprise'),
          { label: t('entVolume'), on: true },
          { label: t('entAllPro'), on: true },
          { label: t('entSupport'), on: true },
        ]
    }
  }

  const actionLabelFor = (tier: SubscriptionTier): string => {
    if (isUnlimited) return t('actionUnlimited')
    if (highlightTier === tier) return t('actionCurrent')
    if (tier === 'enterprise') return t('actionContact')
    return t('actionUpgrade', { tier: TIER_NAMES[tier] })
  }

  const handleAction = (tier: SubscriptionTier) => {
    if (typeof window === 'undefined') return
    window.location.href = tier === 'enterprise' ? ENTERPRISE_MAILTO : SALES_MAILTO
  }

  return (
    <div className="space-y-5">
      {isUnlimited && (
        <div className="flex items-start gap-3 rounded-xl bg-amber-50/70 p-4 ring-1 ring-amber-200/70 dark:bg-amber-500/[0.08] dark:ring-amber-500/25">
          <Crown
            className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-300"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-amber-900 dark:text-amber-200">
              {t('unlimitedBannerTitle')}
            </div>
            <p className="mt-0.5 text-[12px] leading-relaxed text-amber-800/90 dark:text-amber-300/85">
              {t('unlimitedBannerBody')}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3.5 pt-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {(['free', 'standard', 'professional', 'enterprise'] as const).map(
          (tier) => (
            <PlanCard
              key={tier}
              tier={tier}
              price={
                tier === 'enterprise'
                  ? t('priceCustom')
                  : yen(TIER_PRICE_JPY[tier])
              }
              priceSuffix={
                tier === 'standard' || tier === 'professional'
                  ? t('perStoreMonth')
                  : undefined
              }
              pitch={t(`${tier}Pitch`)}
              features={featuresFor(tier)}
              isCurrent={highlightTier === tier}
              disabled={isUnlimited || highlightTier === tier}
              actionLabel={actionLabelFor(tier)}
              onAction={() => handleAction(tier)}
              mostPopular={tier === 'professional' ? t('mostPopular') : undefined}
              currentPill={t('currentPill')}
            />
          ),
        )}
      </div>

      {/* 店舗を追加するとき — the add-store fee rules, driven by fees.ts */}
      <div className="rounded-xl border border-amber-300/50 bg-amber-50/50 p-4 md:p-5 dark:border-amber-500/25 dark:bg-amber-500/[0.07]">
        <h3 className="text-[13.5px] font-semibold text-amber-700 dark:text-amber-300">
          {t('feesTitle')}
        </h3>
        <p className="mb-3 mt-0.5 text-[11.5px] text-muted-foreground">
          {t('feesIntro')}
        </p>
        <div className="space-y-2.5">
          <FeeRow
            tagClass="bg-rose-500/10 text-rose-700 dark:text-rose-300"
            tag={t('feeSetupTag')}
            lead={t('feeSetupLead')}
            rest={t('feeSetupRest', { fee: yen(STORE_SETUP_FEE_JPY) })}
          />
          <FeeRow
            tagClass="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            tag={t('feeBranchTag')}
            lead={t('feeBranchLead')}
            rest={t('feeBranchRest')}
          />
          {/* Owner-free rule — real customers never see another account's
           *  comp status, so this row renders only on the unlimited account. */}
          {isUnlimited && (
            <FeeRow
              tagClass="bg-muted text-muted-foreground"
              tag={t('feeOwnerTag')}
              rest={t('feeOwnerBody')}
            />
          )}
        </div>
      </div>
    </div>
  )
}

const TIER_NAMES: Record<SubscriptionTier, string> = {
  trial: 'Trial',
  free: 'Free',
  standard: 'Standard',
  professional: 'Professional',
  enterprise: 'Enterprise',
}

interface PlanCardProps {
  tier: SubscriptionTier
  price: string
  priceSuffix?: string
  pitch: string
  features: FeatureRow[]
  isCurrent: boolean
  disabled: boolean
  actionLabel: string
  onAction: () => void
  mostPopular?: string
  currentPill: string
}

function PlanCard({
  tier,
  price,
  priceSuffix,
  pitch,
  features,
  isCurrent,
  disabled,
  actionLabel,
  onAction,
  mostPopular,
  currentPill,
}: PlanCardProps) {
  const highlight = tier === 'professional'

  return (
    <div
      className={`relative flex h-full flex-col rounded-2xl bg-card p-5 ${
        highlight
          ? 'ring-2 ring-indigo-500 shadow-[0_8px_30px_-12px_rgba(79,70,229,0.35)] dark:ring-indigo-400/70'
          : 'ring-1 ring-black/[0.07] dark:ring-white/10'
      }`}
    >
      {highlight && mostPopular && (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-indigo-600 px-2.5 py-0.5 text-[10.5px] font-bold text-white">
          {mostPopular}
        </span>
      )}
      {isCurrent && (
        <span
          className={`absolute -top-2.5 ${highlight ? 'right-3' : 'left-1/2 -translate-x-1/2'} whitespace-nowrap rounded-full bg-sage-800 px-2.5 py-0.5 text-[10.5px] font-bold text-white`}
        >
          {currentPill}
        </span>
      )}

      <div className="flex items-center gap-1.5 text-[15px] font-semibold text-foreground">
        {tier === 'professional' && (
          <Star className="size-4 text-indigo-600 dark:text-indigo-300" aria-hidden />
        )}
        {tier === 'enterprise' && (
          <Building2 className="size-4 text-amber-600 dark:text-amber-300" aria-hidden />
        )}
        {TIER_NAMES[tier]}
      </div>

      <div className="mt-2.5 text-[26px] font-bold tracking-tight tabular-nums text-foreground">
        {price}
        {priceSuffix && (
          <span className="ml-1 text-xs font-medium text-muted-foreground">
            {priceSuffix}
          </span>
        )}
      </div>

      <p className="mb-3 mt-1 min-h-8 text-[11.5px] leading-relaxed text-muted-foreground">
        {pitch}
      </p>

      <ul className="flex-1 space-y-1.5">
        {features.map((f) => (
          <li
            key={f.label}
            className={`flex items-start gap-1.5 text-[12px] leading-relaxed ${
              !f.on
                ? 'text-muted-foreground opacity-70'
                : f.staff
                  ? 'font-semibold text-indigo-700 dark:text-indigo-300'
                  : f.strong
                    ? 'font-semibold text-foreground'
                    : 'text-foreground/90'
            }`}
          >
            {f.on ? (
              <Check
                className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                aria-hidden
              />
            ) : (
              <X className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span>{f.label}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onAction}
        disabled={disabled}
        className={`mt-4 inline-flex h-10 w-full items-center justify-center rounded-lg px-3 text-[12.5px] font-semibold transition-colors ${
          disabled
            ? 'cursor-not-allowed bg-muted text-muted-foreground'
            : highlight
              ? 'bg-indigo-600 text-white hover:bg-indigo-700'
              : 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-400/30 dark:hover:bg-indigo-500/20'
        }`}
      >
        {actionLabel}
      </button>
    </div>
  )
}

function FeeRow({
  tag,
  tagClass,
  lead,
  rest,
}: {
  tag: string
  tagClass: string
  lead?: string
  rest: string
}) {
  return (
    <div className="flex items-start gap-2.5 text-[12.5px] leading-relaxed">
      <span
        className={`mt-0.5 shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold ${tagClass}`}
      >
        {tag}
      </span>
      <div className="min-w-0 text-muted-foreground">
        {lead && <b className="font-semibold text-foreground">{lead} </b>}
        {rest}
      </div>
    </div>
  )
}
