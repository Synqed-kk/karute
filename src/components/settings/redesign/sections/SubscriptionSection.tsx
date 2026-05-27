'use client'

import { useTranslations } from 'next-intl'
import { Check, Lock } from 'lucide-react'

const BILLING_ENABLED = process.env.NEXT_PUBLIC_FEATURE_BILLING === 'true'
const SALES_EMAIL = 'sales@synqed.jp'

interface PlanDef {
  id: 'free' | 'standard' | 'professional'
  labelKey: string
  priceMonthly: string
  features: string[]
}

const PLANS: PlanDef[] = [
  {
    id: 'free',
    labelKey: 'planFree',
    priceMonthly: '¥0',
    features: ['Single store', '3 staff', 'Standard recording'],
  },
  {
    id: 'standard',
    labelKey: 'planStandard',
    priceMonthly: '¥9,800',
    features: ['Single store', '10 staff', 'High-quality recording', 'Email support'],
  },
  {
    id: 'professional',
    labelKey: 'planProfessional',
    priceMonthly: '¥29,800',
    features: ['Multi-store', 'Unlimited staff', 'Audit log', 'Priority support'],
  },
]

export function SubscriptionSection() {
  const t = useTranslations('settings')

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">{t('subscription')}</h3>
        <p className="text-sm text-muted-foreground">
          {t('subscriptionDescription')}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {PLANS.map((plan) => {
          const isCurrent = plan.id === 'free'
          return (
            <div
              key={plan.id}
              className={`rounded-lg border p-4 ${
                isCurrent
                  ? 'border-primary bg-primary/5'
                  : 'border-border/40 bg-card/30'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold">{t(plan.labelKey)}</p>
                {isCurrent && (
                  <span className="rounded-full bg-primary text-primary-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                    {t('planCurrent')}
                  </span>
                )}
              </div>
              <p className="text-2xl font-bold">{plan.priceMonthly}</p>
              <p className="text-xs text-muted-foreground mb-3">/month</p>
              <ul className="space-y-1.5 mb-4">
                {plan.features.map((f) => (
                  <li
                    key={f}
                    className="flex items-start gap-1.5 text-xs text-muted-foreground"
                  >
                    <Check className="size-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              {!isCurrent && (
                <a
                  href={`mailto:${SALES_EMAIL}?subject=Upgrade%20to%20${t(plan.labelKey)}`}
                  className="block text-center rounded-md border border-foreground/20 bg-foreground text-background px-3 py-1.5 text-xs font-medium hover:bg-foreground/90"
                >
                  {t('contactSales')}
                </a>
              )}
            </div>
          )
        })}
      </div>

      {!BILLING_ENABLED && (
        <div className="flex items-start gap-3 rounded-lg border border-border/40 bg-muted/30 px-4 py-3">
          <Lock className="size-4 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">{t('comingSoon')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Payment method and invoice history will be available when billing
              launches. Contact{' '}
              <a
                href={`mailto:${SALES_EMAIL}`}
                className="underline hover:text-foreground"
              >
                {SALES_EMAIL}
              </a>{' '}
              for upgrades.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
