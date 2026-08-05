'use client'

// ─────────────────────────────────────────────────────────────
// AddStoreSubscriptionDialog — pricing-delta confirm step
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/settings/AddStoreSubscriptionDialog.tsx
// Sits between "Add store" click and the actual StoreFormDialog.
// Four branches keyed by subscription state:
//
//   1. paid tier + allowed → "Adds +¥X/month, next bill goes from
//      ¥A → ¥B. Confirm?"
//   2. trial → "Billing starts when trial ends on <date>."
//   3. free at limit → upgrade CTA (no confirm path)
//   4. canceled / past_due → "Fix billing first" pointer
//
// Owner-only — StoresSection hides the "+ Add" button entirely
// for non-owners, so this dialog assumes owner.
//
// ANTHONY: in prod the confirm calls
//   supabase.functions.invoke('subscription-add-seat')
// which runs stripe.subscriptions.update with quantity + 1 and
// proration_behavior: 'create_prorations'. UI keeps the same
// interface; only the body changes.

import Link from 'next/link'
import { AlertTriangle, ArrowRight, CreditCard, Sparkles } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  canAddStore,
  monthlyTotalJpy,
  useSubscription,
  useSubscriptionMutations,
} from '@/lib/subscription/hooks'
import { STORE_SETUP_FEE_JPY } from '@/lib/subscription/types'

const YEN = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  maximumFractionDigits: 0,
})

interface AddStoreSubscriptionDialogProps {
  open: boolean
  onClose: () => void
  /** Fires after the seat is added so the parent can chain into
   *  the actual StoreFormDialog for the store-detail step. */
  onConfirmed: () => void
}

export function AddStoreSubscriptionDialog({
  open,
  onClose,
  onConfirmed,
}: AddStoreSubscriptionDialogProps) {
  const t = useTranslations('settings.stores.addStoreSubscription')
  const tTier = useTranslations('settings.subscription.tierLabels')
  const locale = useLocale()
  const subscription = useSubscription()
  const { addStoreSeat } = useSubscriptionMutations()

  const freeAtLimit =
    subscription.tier === 'free' && subscription.storeCount >= 1
  const isEnterprise = subscription.tier === 'enterprise'
  const blockedByStatus =
    subscription.status === 'past_due' || subscription.status === 'canceled'
  const allowed = canAddStore(subscription) && !blockedByStatus

  const pricePerStore = subscription.pricePerStoreJpy
  const currentTotal = monthlyTotalJpy(subscription)
  const nextTotal = currentTotal + pricePerStore
  const manageHref = `/${locale}/settings?tab=subscription`

  const handleConfirm = () => {
    const ok = addStoreSeat()
    if (ok) onConfirmed()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        {/* Free at limit — upgrade prompt */}
        {freeAtLimit && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles
                  className="size-4 text-indigo-600 dark:text-indigo-300"
                  aria-hidden
                />
                {t('freeAtLimitTitle')}
              </DialogTitle>
              <DialogDescription className="pt-2 leading-relaxed">
                {t('freeAtLimitBody')}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="pt-2">
              <Button variant="outline" onClick={onClose}>
                {t('cancel')}
              </Button>
              <Link
                href={manageHref}
                className={cn(buttonVariants({ variant: 'default' }))}
              >
                {t('seePlansCta')}
                <ArrowRight className="ml-1 size-3.5" aria-hidden />
              </Link>
            </DialogFooter>
          </>
        )}

        {/* Enterprise — route through sales */}
        {!freeAtLimit && isEnterprise && (
          <>
            <DialogHeader>
              <DialogTitle>{t('enterpriseTitle')}</DialogTitle>
              <DialogDescription className="pt-2 leading-relaxed">
                {t('enterpriseBody')}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="pt-2">
              <Button variant="outline" onClick={onClose}>
                {t('cancel')}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* past_due / canceled — fix billing first */}
        {!freeAtLimit && !isEnterprise && blockedByStatus && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle
                  className="size-4 text-red-600 dark:text-red-300"
                  aria-hidden
                />
                {t('blockedStatusTitle')}
              </DialogTitle>
              <DialogDescription className="pt-2 leading-relaxed">
                {t('blockedStatusBody')}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="pt-2">
              <Button variant="outline" onClick={onClose}>
                {t('cancel')}
              </Button>
              <Link
                href={manageHref}
                className={cn(
                  buttonVariants({ variant: 'default' }),
                  'bg-red-600 hover:bg-red-700',
                )}
              >
                {t('fixBillingCta')}
              </Link>
            </DialogFooter>
          </>
        )}

        {/* Trialing — billing starts after trial ends */}
        {allowed && subscription.status === 'trialing' && (
          <>
            <DialogHeader>
              <DialogTitle>{t('trialingTitle')}</DialogTitle>
              <DialogDescription className="pt-2 leading-relaxed">
                {t('trialingBody', {
                  trialEnd: subscription.trialEndsAt
                    ? new Date(subscription.trialEndsAt).toLocaleDateString(
                        locale === 'en' ? 'en-US' : 'ja-JP',
                        { year: 'numeric', month: 'short', day: 'numeric' },
                      )
                    : '—',
                })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="pt-2">
              <Button variant="outline" onClick={onClose}>
                {t('cancel')}
              </Button>
              <Button onClick={handleConfirm}>
                {t('addSeatCta')}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Paid tier — pricing-delta confirmation */}
        {allowed && subscription.status === 'active' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CreditCard
                  className="size-4 text-indigo-600 dark:text-indigo-300"
                  aria-hidden
                />
                {t('paidTitle')}
              </DialogTitle>
              <DialogDescription className="pt-2 leading-relaxed">
                {t('paidBody', {
                  tier: tTier(subscription.tier),
                  perStore: YEN.format(pricePerStore),
                })}
              </DialogDescription>
            </DialogHeader>

            {/* Pricing delta panel */}
            <div className="mt-2 space-y-2 rounded-lg bg-muted/40 p-4 text-sm">
              <Row
                label={t('rowCurrent', { n: subscription.storeCount })}
                value={YEN.format(currentTotal)}
              />
              <Row
                label={t('rowAfter', { n: subscription.storeCount + 1 })}
                value={YEN.format(nextTotal)}
                emphasized
              />
              {/* 初期費用 — renders only once the fee amount is set (types.ts). */}
              {STORE_SETUP_FEE_JPY > 0 && (
                <Row
                  label={t('rowSetupFee')}
                  value={YEN.format(STORE_SETUP_FEE_JPY)}
                />
              )}
              <div className="border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
                {t('prorationNote')}
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button variant="outline" onClick={onClose}>
                {t('cancel')}
              </Button>
              <Button onClick={handleConfirm}>
                {t('confirmAddCta')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Row({
  label,
  value,
  emphasized,
}: {
  label: string
  value: string
  emphasized?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 tabular-nums">
      <span className={emphasized ? 'font-medium text-foreground' : 'text-muted-foreground'}>
        {label}
      </span>
      <span className={emphasized ? 'font-semibold text-foreground' : 'text-foreground/80'}>
        {value}
      </span>
    </div>
  )
}
