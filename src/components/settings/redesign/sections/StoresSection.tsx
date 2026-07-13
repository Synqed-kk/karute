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
// Seeded primary renders instantly; refresh() replaces it with the real rows.
// Plan limits are real (P3): getEntitlement() (server) derives the store cap
// from the tier via TIER_FEATURES — the add button disables when the business
// is at its limit, and createStore enforces it server-side. Dev/owner accounts
// are never capped (is_unlimited / KARUTE_UNLIMITED_BUSINESS_IDS).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Building2, Check, Crown, MapPin, Pencil, Plus, Users } from 'lucide-react'

import { businessTypeLabel } from '@/lib/welcome/business-types'

import { Button } from '@/components/ui/button'
import type { OrgSettings } from '@/actions/org-settings'
import { listStores, createStore, updateStore, setActiveStore, getActiveStoreId, type StoreRow } from '@/actions/stores'
import { getEntitlement } from '@/actions/entitlements'
import type { Entitlement } from '@/lib/entitlements'
import { WebOnly } from '@/components/shell/WebOnly'

import { AddStoreSubscriptionDialog } from './stores/AddStoreSubscriptionDialog'
import {
  StoreFormDialog,
  type StoreFormMode,
} from './stores/StoreFormDialog'
import { PlanComparisonDialog } from './stores/PlanComparisonDialog'
import type { Store, StoreFormValues } from './stores/types'

interface StoresSectionProps {
  orgSettings: OrgSettings | null
  /** Whether the viewer is an owner. Add/edit affordances are
   *  owner-only; staff get the read-only list. */
  isOwner?: boolean
  /** Real stores fetched on the server. When present the list renders complete
   *  on first paint (no placeholder-then-pop-in) and only the entitlement is
   *  fetched on mount. Absent → fall back to the old full client fetch. */
  initialStores?: StoreRow[]
  initialActiveStoreId?: string | null
  /** Entitlement fetched on the server — the plan row + add-store gate paint
   *  with the page (no pop-in). Null/absent → client fetch fallback. */
  initialEntitlement?: Entitlement | null
}

// StoreRow (synqed-core shape) → the Store the UI renders.
function mapStoreRows(rows: StoreRow[]): Store[] {
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    address: r.address ?? '',
    phone: r.phone ?? '',
    staffCount: r.staffCount,
    customerCount: r.customerCount,
    active: r.active,
    isPrimary: r.isPrimary,
    businessType: r.businessType,
  }))
}

export function StoresSection({
  orgSettings,
  isOwner = false,
  initialStores,
  initialActiveStoreId,
  initialEntitlement,
}: StoresSectionProps) {
  const t = useTranslations('settings.stores')
  const locale = useLocale()
  const tPlan = useTranslations('settings.stores.plan')
  const tTier = useTranslations('settings.subscription.tierLabels')

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
        businessType: orgSettings.business_type ?? null,
      },
    ]
  }, [orgSettings, t])

  // Server-provided rows render the real list on first paint (no pop-in). Fall
  // back to the synthesized primary only when the server didn't supply them.
  const initialMapped = useMemo<Store[]>(
    () =>
      initialStores && initialStores.length > 0
        ? mapStoreRows(initialStores)
        : seededStores,
    [initialStores, seededStores],
  )

  const [stores, setStores] = useState<Store[]>(initialMapped)
  const [subscriptionStepOpen, setSubscriptionStepOpen] = useState(false)
  const [planDialogOpen, setPlanDialogOpen] = useState(false)
  const [formMode, setFormMode] = useState<StoreFormMode>(null)
  const [entitlement, setEntitlement] = useState<Entitlement | null>(initialEntitlement ?? null)
  const [activeStoreId, setActiveStoreId] = useState<string>(
    initialActiveStoreId ??
      initialMapped.find((s) => s.isPrimary)?.id ??
      initialMapped[0]?.id ??
      'primary',
  )

  const refresh = useCallback(async () => {
    const [rows, persisted, ent] = await Promise.all([
      listStores(),
      getActiveStoreId(),
      getEntitlement(),
    ])
    setEntitlement(ent)
    if (rows.length === 0) return
    const mapped = mapStoreRows(rows)
    setStores(mapped)
    setActiveStoreId((cur) => {
      if (persisted && mapped.some((s) => s.id === persisted)) return persisted
      return mapped.some((s) => s.id === cur) ? cur : mapped[0].id
    })
  }, [])

  useEffect(() => {
    // With server-seeded stores the list is already complete on first paint, so
    // only the entitlement (add-store gating) needs a client fetch — skip the
    // store re-list that caused the placeholder-then-pop-in. Without server
    // data, fall back to the full client refresh.
    if (initialStores && initialStores.length > 0) {
      // Server-seeded entitlement → nothing to fetch; the whole section painted
      // complete with the page. Only fetch when the server pass failed.
      if (!initialEntitlement) {
        void getEntitlement()
          .then(setEntitlement)
          .catch((e) => console.error('Failed to load store entitlement', e))
      }
    } else {
      void refresh()
    }
  }, [refresh, initialStores, initialEntitlement])

  // Persist the switch (cookie via setActiveStore). Optimistic, reverts on error.
  const handleSwitch = async (storeId: string) => {
    setActiveStoreId(storeId)
    const res = await setActiveStore(storeId)
    if ('error' in res) {
      toast.error(res.error)
      void refresh()
    }
  }

  const handleFormSave = async (values: StoreFormValues) => {
    const payload = {
      name: values.name,
      address: values.address,
      phone: values.phone,
      // '' (legacy edit, type never chosen) → omit, so validation stays clean.
      business_type: values.businessType || undefined,
    }
    if (formMode?.kind === 'add') {
      const res = await createStore(payload)
      if ('error' in res) {
        toast.error(res.error === 'STORE_LIMIT_REACHED' ? t('limitReached') : res.error)
        return
      }
    } else if (formMode?.kind === 'edit') {
      const res = await updateStore(formMode.store.id, payload)
      if ('error' in res) {
        toast.error(res.error)
        return
      }
    }
    await refresh()
  }

  // Plan gate. Defaults to allowed before the entitlement loads so the
  // "limit reached" banner never flashes during the async fetch. (The add
  // button itself is gated on multiStoreEnabled below, which requires the
  // entitlement to be loaded — so this `?? true` no longer affects the button.)
  const canAdd = entitlement?.canAddStore ?? true

  // Per-business visibility gate — replaces the old global
  // NEXT_PUBLIC_FEATURE_MULTI_STORE env flag, so enabling multi-store for one
  // salon never exposes the add-store flow to every other salon. Scoped to
  // is_unlimited (dev / owner / comp) for now; the paid 'unlimited' tiers open
  // up in step 2, once switching the active store actually filters the app
  // (today that switch is still render-only).
  const multiStoreEnabled = !!entitlement && entitlement.isUnlimited

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
        defaultBusinessType={orgSettings?.business_type ?? null}
        onClose={() => setFormMode(null)}
        onSave={handleFormSave}
      />
      <PlanComparisonDialog
        open={planDialogOpen}
        onClose={() => setPlanDialogOpen(false)}
        currentTier={entitlement?.tier}
        isUnlimited={!!entitlement?.isUnlimited}
      />

      {/* Plan surface — the plan/paywall lives here in 店舗 (per Liam's
       *  IA), not a separate settings tab. Shows the REAL current plan
       *  from the entitlement (or the unlimited-account state), and the
       *  「プランを見る・変更」 button opens the tier comparison. Owner-only:
       *  plan changes are an owner action. Replaces the old
       *  SubscriptionSummaryCard, whose mock seed showed a fake trial
       *  countdown (tier: 'trial', ended 2026-06-15). */}
      {isOwner && entitlement && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card px-4 py-3.5 ring-1 ring-black/5 dark:ring-white/5">
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-muted-foreground">
              {tPlan('label')}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[15px] font-semibold text-foreground">
              {entitlement.isUnlimited ? (
                <>
                  <Crown className="size-4 text-amber-500" aria-hidden />
                  {tPlan('unlimitedLabel')}
                </>
              ) : (
                tTier(entitlement.tier)
              )}
            </div>
          </div>
          {/* App-store safety: the plan-change entry point is web-only (the
              dialog behind it is a purchase surface). WebOnly never SSRs it,
              so it can't flash in the shell pre-hydration (audit finding).
              The current-plan STATUS above stays visible everywhere. */}
          <WebOnly>
            <Button
              variant="outline"
              onClick={() => setPlanDialogOpen(true)}
              className="h-9 shrink-0"
            >
              {tPlan('viewCta')}
            </Button>
          </WebOnly>
        </div>
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
          {isOwner && !canAdd && (
            <p className="mt-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
              {t('limitReached')}
            </p>
          )}
        </div>
        {/* "+ 店舗を追加" — gated per-business via the entitlement (multiStoreEnabled),
         *  not a global env flag, so enabling it for one salon never exposes the
         *  flow to others. createStore persists to the real `stores` table and
         *  re-enforces the plan cap server-side. NOTE: switching the active store
         *  is still render-only — no route filters by it yet (step 2). */}
        {isOwner && multiStoreEnabled && (
          <Button
            onClick={() => setSubscriptionStepOpen(true)}
            disabled={!canAdd}
            title={!canAdd ? t('limitReached') : undefined}
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
                        {(() => {
                          const typeLabel = businessTypeLabel(store.businessType, locale)
                          return typeLabel ? (
                            <span className="inline-flex h-5 items-center rounded-full bg-muted px-1.5 text-[10px] font-medium text-foreground/70 ring-1 ring-border/60">
                              {typeLabel}
                            </span>
                          ) : null
                        })()}
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
                      onClick={() => handleSwitch(store.id)}
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
