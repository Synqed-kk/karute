'use client'

import { useTranslations } from 'next-intl'
import { Store, Plus, Lock } from 'lucide-react'
import type { OrgSettings } from '@/actions/org-settings'

// TODO(multi-store): replace the placeholder card with a real `stores` table
// joined to `profiles`. Schema sketch:
//   stores(id PK, business_id FK, name, address, is_primary, created_at)
//   profiles.store_id FK -> stores.id (nullable for owner-level access)
// Owner permissions: every owner sees all stores; staff are scoped to one.

const MULTI_STORE_ENABLED =
  process.env.NEXT_PUBLIC_FEATURE_MULTI_STORE === 'true'

interface StoresSectionProps {
  orgSettings: OrgSettings | null
}

export function StoresSection({ orgSettings }: StoresSectionProps) {
  const t = useTranslations('settings')

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">{t('stores')}</h3>
        <p className="text-sm text-muted-foreground">{t('storesDescription')}</p>
      </div>

      <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
        <p className="font-medium">{t('planProfessional')}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{t('stores1')}</p>
      </div>

      <div className="rounded-lg border border-border/40 bg-card/40 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="rounded-md bg-muted p-2">
              <Store className="size-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="font-medium truncate">
                {orgSettings?.salon_name || '—'}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                  {t('activeStore')}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('mainStore')}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        disabled={!MULTI_STORE_ENABLED}
        title={!MULTI_STORE_ENABLED ? t('comingSoon') : undefined}
        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border/60 bg-card/30 px-3 py-2 text-sm text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
      >
        {MULTI_STORE_ENABLED ? (
          <Plus className="size-4" />
        ) : (
          <Lock className="size-4" />
        )}
        {t('addStore')}
      </button>

      <p className="text-xs text-muted-foreground border-t border-border/30 pt-4">
        {t('singleStoreNote')}
      </p>
    </div>
  )
}
