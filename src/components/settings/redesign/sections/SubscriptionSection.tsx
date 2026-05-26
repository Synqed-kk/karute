'use client'

// ─────────────────────────────────────────────────────────────
// SubscriptionSection — settings 契約 tab
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/settings/SubscriptionSettings.tsx
// Owner-only. Five sections, top to bottom:
//
//   1. Status banner (reuses SubscriptionSummaryCard so the
//      owner sees identical state signaling on Settings > 店舗
//      and Settings > 契約)
//   2. Plan comparison grid (tier switching)
//   3. Payment method (display + update stub)
//   4. Invoice history (last 6, newest first)
//   5. Demo status toggle (dev-only — env-gated)
//   6. Cancel-subscription row (paid tiers only)
//
// ANTHONY: this tab is the end-user contract with Stripe. Every
// surface maps to a Stripe object documented in
// src/lib/subscription/hooks.ts header.
//
// DEMO STATUS TOGGLE — gated on the same dev-preview env flag
// as the coaching DevPreviewToggle (NODE_ENV === 'development'
// OR NEXT_PUBLIC_ENABLE_COACHING_PREVIEW === 'true'). Lets the
// pitcher walk through past_due / canceled visuals during demos.
// Production tree-shakes the toggle out.

import { useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  CreditCard,
  Download,
  RefreshCw,
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { isDevPreviewEnabled } from '@/lib/coaching-dev-preview/hooks'
import {
  useSubscription,
  useSubscriptionMutations,
} from '@/lib/subscription/hooks'
import type { SubscriptionStatus } from '@/lib/subscription/types'

import { SubscriptionSummaryCard } from './stores/SubscriptionSummaryCard'
import { CancelConfirmDialog } from './subscription/CancelConfirmDialog'
import { PaymentUpdateDialog } from './subscription/PaymentUpdateDialog'
import { PlanComparisonGrid } from './subscription/PlanComparisonGrid'

const YEN = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  maximumFractionDigits: 0,
})

export function SubscriptionSection() {
  const t = useTranslations('settings.subscription.page')
  const tTier = useTranslations('settings.subscription.tierLabels')
  const locale = useLocale()
  const subscription = useSubscription()
  const { cancelSubscription } = useSubscriptionMutations()

  const [cancelOpen, setCancelOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)

  const isPaidTier =
    subscription.tier === 'standard' || subscription.tier === 'professional'
  const canCancel =
    (isPaidTier || subscription.status === 'trialing') &&
    subscription.status !== 'canceled'

  return (
    <div className="space-y-6">
      <SubscriptionSummaryCard />

      {/* Plan comparison */}
      <section className="space-y-2">
        <h3 className="text-[15px] font-semibold text-foreground">
          {t('plansTitle')}
        </h3>
        <p className="text-[12px] text-muted-foreground">{t('plansDesc')}</p>
        <div className="pt-2">
          <PlanComparisonGrid />
        </div>
      </section>

      {/* Payment method */}
      {subscription.paymentMethod && (
        <section className="space-y-2">
          <h3 className="text-[15px] font-semibold text-foreground">
            {t('paymentTitle')}
          </h3>
          <div className="flex items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-black/5 dark:ring-white/10">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-700 dark:bg-white/[0.06] dark:text-gray-300">
              <CreditCard className="size-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium text-foreground">
                {brandLabel(subscription.paymentMethod.brand)} ••••{' '}
                {subscription.paymentMethod.last4}
              </div>
              <div className="mt-0.5 text-[12px] tabular-nums text-muted-foreground">
                {t('expires')}{' '}
                {String(subscription.paymentMethod.expMonth).padStart(2, '0')} /{' '}
                {subscription.paymentMethod.expYear}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPaymentOpen(true)}
              className="inline-flex h-9 shrink-0 items-center rounded-md px-3 text-[12px] font-medium text-foreground ring-1 ring-black/10 transition-colors hover:bg-gray-50 dark:ring-white/15 dark:hover:bg-white/[0.05]"
            >
              {t('updateCard')}
            </button>
          </div>
        </section>
      )}

      {/* Invoice history */}
      {subscription.recentInvoices.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-[15px] font-semibold text-foreground">
            {t('invoicesTitle')}
          </h3>
          <div className="overflow-hidden rounded-xl bg-card ring-1 ring-black/5 dark:ring-white/10">
            <div className="divide-y divide-black/5 dark:divide-white/10">
              {subscription.recentInvoices.map((inv) => (
                <div key={inv.id} className="flex items-center gap-3 px-4 py-3">
                  <InvoiceStatusIcon status={inv.status} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium tabular-nums text-foreground">
                      {formatInvoiceDate(inv.issuedDate, locale)}
                    </div>
                    <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                      {inv.tier === 'trial'
                        ? t('trialInvoice')
                        : t('invoiceLine', {
                            tier: tTier(inv.tier),
                            stores: inv.storeCount,
                          })}
                    </div>
                  </div>
                  <div className="shrink-0 text-[13px] font-semibold tabular-nums text-foreground">
                    {YEN.format(inv.amountJpy)}
                  </div>
                  <button
                    type="button"
                    aria-label={t('download')}
                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-gray-50 hover:text-foreground dark:hover:bg-white/[0.05]"
                  >
                    <Download className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Demo status toggle — dev only (same env gate as DevPreviewToggle) */}
      {isDevPreviewEnabled() && <DemoStatusToggle />}

      {/* Cancel — only when applicable */}
      {canCancel && (
        <section className="space-y-2">
          <h3 className="text-[15px] font-semibold text-foreground">
            {t('dangerTitle')}
          </h3>
          <button
            type="button"
            onClick={() => setCancelOpen(true)}
            className="flex w-full items-center gap-3 rounded-xl bg-red-50/40 px-4 py-3 text-left ring-1 ring-red-200/70 transition-colors hover:bg-red-50 dark:bg-red-500/[0.05] dark:ring-red-500/25 dark:hover:bg-red-500/[0.08]"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300">
              <AlertCircle className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-red-900 dark:text-red-200">
                {t('cancelTitle')}
              </div>
              <div className="text-[11px] leading-relaxed text-red-800/90 dark:text-red-300/85">
                {t('cancelBody')}
              </div>
            </div>
            <ChevronRight className="size-4 shrink-0 text-red-700 dark:text-red-300" />
          </button>
        </section>
      )}

      <CancelConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => {
          cancelSubscription()
          setCancelOpen(false)
        }}
      />
      <PaymentUpdateDialog
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Invoice status icon
// ─────────────────────────────────────────────────────────────

function InvoiceStatusIcon({
  status,
}: {
  status: 'paid' | 'pending' | 'failed'
}) {
  if (status === 'paid') {
    return (
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300">
        <CheckCircle2 className="size-4" aria-hidden />
      </div>
    )
  }
  if (status === 'pending') {
    return (
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
        <Clock className="size-4" aria-hidden />
      </div>
    )
  }
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300">
      <AlertCircle className="size-4" aria-hidden />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Demo status toggle — dev only
// ─────────────────────────────────────────────────────────────

function DemoStatusToggle() {
  const t = useTranslations('settings.subscription.demo')
  const subscription = useSubscription()
  const { setStatus } = useSubscriptionMutations()

  const STATUS_OPTIONS: SubscriptionStatus[] = [
    'active',
    'trialing',
    'past_due',
    'canceled',
    'free',
  ]

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <RefreshCw className="size-3.5 text-muted-foreground" aria-hidden />
        <h3 className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('title')}
        </h3>
      </div>
      <div className="rounded-xl bg-gray-50/60 p-4 ring-1 ring-dashed ring-black/10 dark:bg-white/[0.02] dark:ring-white/15">
        <p className="mb-3 text-[12px] leading-relaxed text-muted-foreground">
          {t('body')}
        </p>
        <label className="flex items-center gap-2">
          <span className="shrink-0 text-[12px] font-medium text-foreground">
            {t('statusLabel')}
          </span>
          <select
            value={subscription.status}
            onChange={(e) => setStatus(e.target.value as SubscriptionStatus)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function brandLabel(brand: 'visa' | 'mastercard' | 'jcb' | 'amex'): string {
  switch (brand) {
    case 'visa':
      return 'Visa'
    case 'mastercard':
      return 'Mastercard'
    case 'jcb':
      return 'JCB'
    case 'amex':
      return 'American Express'
  }
}

function formatInvoiceDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(
      locale === 'en' ? 'en-US' : 'ja-JP',
      { year: 'numeric', month: 'short', day: 'numeric' },
    )
  } catch {
    return iso
  }
}
