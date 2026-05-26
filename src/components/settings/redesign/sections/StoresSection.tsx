'use client'

// ─────────────────────────────────────────────────────────────
// StoresSection — multi-store admin
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/settings/StoresSettings.tsx
// Replaces the prior single-store placeholder with the full
// multi-store chrome:
//   - SubscriptionSummaryCard banner (trial / active / past_due / free)
//   - Owner permissions banner
//   - Stores list with switch-to / edit per row
//   - Add-store flow: AddStoreSubscriptionDialog → StoreFormDialog
//
// ACTIVE STORE
//
// The "switch" affordance changes the locally-rendered active
// store id. This is a client-side scaffold today — until Anthony
// wires session-scoped active_store_id at the API layer, the
// rest of karute (customers, appointments, karute records) does
// NOT actually filter by active store. The toggle is render-only.
//
// ANTHONY: when active_store_id lands, this becomes a server
// action that writes session.activeStoreId + invalidates the
// queries scoped to it. Single-flag swap in the click handler.
//
// DATA
//
// Today: synthesizes a primary store from orgSettings.salon_name.
// Additional stores are null until the `stores` table exists.
// Free-tier limits + canAddStore live in src/lib/subscription
// — the add button auto-disables when the tier blocks it.

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Building2, Check, Crown, MapPin, Pencil, Plus, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { OrgSettings } from '@/actions/org-settings'

import { AddStoreSubscriptionDialog } from './stores/AddStoreSubscriptionDialog'
import {
  StoreFormDialog,
  type StoreFormMode,
} from './stores/StoreFormDialog'
import { SubscriptionSummaryCard } from './stores/SubscriptionSummaryCard'
import type { Store, StoreFormValues } from './stores/types'

interface StoresSectionProps {
  orgSettings: OrgSettings | null
  /** Whether the viewer is an owner. Add/edit affordances are
   *  owner-only; staff get the read-only list. */
  isOwner?: boolean
}

export function StoresSection({
  orgSettings,
  isOwner = false,
}: StoresSectionProps) {
  const t = useTranslations('settings.stores')

  // Synthesize a primary store from orgSettings until Anthony's
  // `stores` table lands. Additional stores append to this list
  // through the local add flow.
  const seededStores = useMemo<Store[]>(() => {
    if (!orgSettings) return []
    return [
      {
        id: 'primary',
        name: orgSettings.salon_name || t('unnamedStore'),
        address: '',
        phone: '',
        staffCount: 0,
        customerCount: 0,
        active: true,
        isPrimary: true,
      },
    ]
  }, [orgSettings, t])

  const [stores, setStores] = useState<Store[]>(seededStores)
  const [subscriptionStepOpen, setSubscriptionStepOpen] = useState(false)
  const [formMode, setFormMode] = useState<StoreFormMode>(null)
  const [activeStoreId, setActiveStoreId] = useState<string>(
    seededStores[0]?.id ?? 'primary',
  )

  const handleFormSave = (values: StoreFormValues) => {
    if (formMode?.kind === 'add') {
      // ANTHONY: insert into `stores` scoped to the org. The
      // seat has already been added by AddStoreSubscriptionDialog
      // — don't double-count quantity here.
      const newStore: Store = {
        id: `store_${Date.now()}`,
        name: values.name.trim(),
        address: values.address,
        phone: values.phone,
        staffCount: 0,
        customerCount: 0,
        active: true,
        isPrimary: false,
      }
      setStores((prev) => [...prev, newStore])
      return
    }
    if (formMode?.kind === 'edit') {
      // ANTHONY: update where id = target.id, same business_id.
      const targetId = formMode.store.id
      setStores((prev) =>
        prev.map((s) =>
          s.id === targetId
            ? {
                ...s,
                name: values.name || s.name,
                address: values.address,
                phone: values.phone,
              }
            : s,
        ),
      )
    }
  }

  return (
    <div className="space-y-4">
      <AddStoreSubscriptionDialog
        open={subscriptionStepOpen}
        onClose={() => setSubscriptionStepOpen(false)}
        onConfirmed={() => {
          setSubscriptionStepOpen(false)
          setFormMode({ kind: 'add' })
        }}
      />
      <StoreFormDialog
        mode={formMode}
        onClose={() => setFormMode(null)}
        onSave={handleFormSave}
      />

      {/* SubscriptionSummaryCard hidden until Stripe wires up — the
       *  mock seed renders a fake trial banner that misleads owners
       *  (`tier: 'trial'`, countdown to 2026-06-15). Gated by the
       *  same NEXT_PUBLIC_FEATURE_SUBSCRIPTION flag that hides the
       *  subscription tab. */}
      {process.env.NEXT_PUBLIC_FEATURE_SUBSCRIPTION === 'true' && (
        <SubscriptionSummaryCard />
      )}

      {/* Owner permissions banner — only renders for owners */}
      {isOwner && (
        <div className="flex items-start gap-3 rounded-xl bg-blue-50 px-4 py-3 ring-1 ring-blue-100 dark:bg-blue-500/10 dark:ring-blue-500/15">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
            <Crown className="size-4" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-blue-900 dark:text-blue-200">
              {t('ownerView')}
            </div>
            <div className="mt-0.5 text-[12px] leading-relaxed text-blue-800/90 dark:text-blue-300/85">
              {t('ownerDesc')}
            </div>
          </div>
        </div>
      )}

      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-foreground">
            {t('title')}
          </h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {t('storesCount', { n: stores.length })}
          </p>
        </div>
        {/* "+ 店舗を追加" hidden until multi-store ships. Today the
         *  flow saves to local React useState only — owner adds Store
         *  B, switches to it, but no other route filters by
         *  active_store_id (the column doesn't exist yet either).
         *  Same flag as subscription gating since the two land
         *  together (additional seats → subscription change). */}
        {isOwner && process.env.NEXT_PUBLIC_FEATURE_MULTI_STORE === 'true' && (
          <Button
            onClick={() => setSubscriptionStepOpen(true)}
            className="h-10 gap-1.5 bg-sage-800 text-white hover:bg-sage-900"
          >
            <Plus className="size-3.5" />
            {t('addStore')}
          </Button>
        )}
      </div>

      {/* Stores list */}
      <div className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-black/5 dark:ring-white/5">
        {stores.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {t('emptyState')}
          </div>
        ) : (
          <div className="divide-y divide-black/5 dark:divide-white/5">
            {stores.map((store) => {
              const isActive = store.id === activeStoreId
              return (
                <div
                  key={store.id}
                  className="p-4 transition-colors active:bg-black/[0.02] dark:active:bg-white/[0.02]"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 ring-1 ring-blue-100 dark:bg-blue-500/10 dark:ring-blue-500/15">
                      <Building2 className="size-5 text-blue-700 dark:text-blue-300" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[15px] font-semibold text-foreground">
                          {store.name}
                        </span>
                        {store.isPrimary && (
                          <span className="inline-flex h-5 items-center rounded-full bg-blue-50 px-1.5 text-[10px] font-medium text-blue-800 ring-1 ring-blue-200/60 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20">
                            {t('primaryBadge')}
                          </span>
                        )}
                        {store.active && (
                          <span className="inline-flex h-5 items-center rounded-full bg-green-50 px-1.5 text-[10px] font-medium text-green-700 ring-1 ring-green-200/60 dark:bg-green-500/10 dark:text-green-300 dark:ring-green-500/20">
                            {t('activeBadge')}
                          </span>
                        )}
                      </div>
                      {store.address && (
                        <div className="mt-1 flex items-start gap-1 text-[12px] text-muted-foreground">
                          <MapPin
                            className="mt-0.5 size-3 shrink-0"
                            aria-hidden
                          />
                          <span className="truncate">{store.address}</span>
                        </div>
                      )}
                      <div className="mt-1 flex items-center gap-3 text-[12px] tabular-nums text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Users className="size-3" aria-hidden />
                          {t('staffUnit', { n: store.staffCount })}
                        </span>
                        <span className="text-gray-300 dark:text-gray-600">
                          ·
                        </span>
                        <span>
                          {t('customersUnit', { n: store.customerCount })}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveStoreId(store.id)}
                      className={`inline-flex h-10 flex-1 items-center justify-center gap-1 rounded-lg px-3 text-[13px] font-medium transition-colors md:h-8 md:flex-initial md:rounded-md md:text-xs ${
                        isActive
                          ? 'bg-blue-600 text-white'
                          : 'bg-card text-foreground/80 ring-1 ring-gray-200 active:bg-blue-50 active:ring-blue-300 dark:ring-white/10 dark:active:bg-blue-500/10 dark:active:ring-blue-500/40'
                      }`}
                    >
                      {isActive && <Check className="size-3.5" aria-hidden />}
                      {isActive ? t('viewing') : t('switchTo')}
                    </button>
                    {isOwner && (
                      <button
                        type="button"
                        aria-label={t('edit')}
                        onClick={() => setFormMode({ kind: 'edit', store })}
                        className="inline-flex size-10 items-center justify-center gap-1 rounded-lg bg-card text-[13px] font-medium text-foreground/80 ring-1 ring-gray-200 transition-colors hover:bg-gray-50 active:bg-blue-50 active:ring-blue-300 md:size-auto md:h-8 md:rounded-md md:px-2.5 md:text-xs dark:ring-white/10 dark:hover:bg-white/[0.04] dark:active:bg-blue-500/10 dark:active:ring-blue-500/40"
                      >
                        <Pencil className="size-3.5 md:size-3" aria-hidden />
                        <span className="hidden md:inline">{t('edit')}</span>
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer note about active-store scoping (scaffold only today) */}
      <p className="border-t border-border/30 pt-4 text-xs text-muted-foreground">
        {t('activeStoreScopeNote')}
      </p>
    </div>
  )
}
