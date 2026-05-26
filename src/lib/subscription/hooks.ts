'use client'

// ─────────────────────────────────────────────────────────────
// Subscription — state layer (localStorage scaffold)
// ─────────────────────────────────────────────────────────────
// Mirrors the spike's per-store-seat subscription model. Same
// useSyncExternalStore + localStorage pattern as
// coaching-consent/hooks.ts and coaching-dev-preview/hooks.ts —
// swap-ready for Anthony when Stripe + webhook + Supabase land.
//
// PROD SWAP (ANTHONY)
//
// Every mutation becomes a Stripe API call via an edge function
// (subscription-change-tier, subscription-add-seat, etc.). The
// hook interface stays the same; only the body changes.
//
//   upgradeTo('professional'):
//     await supabase.functions.invoke('subscription-change-tier', {
//       body: { newTier: 'professional' },
//     })
//     // edge fn → stripe.subscriptions.update(subId, {
//     //   items: [{ id, price: PRICE_PROFESSIONAL_JPY }],
//     //   proration_behavior: 'create_prorations',
//     // })
//     // webhook invoice.upcoming → audit_log row
//     // returns updated subscription row → React Query invalidates
//
//   addStoreSeat():
//     await supabase.functions.invoke('subscription-add-seat')
//     // stripe.subscriptions.update(subId, {
//     //   items: [{ id, quantity: q + 1 }],
//     //   proration_behavior: 'create_prorations',
//     // })
//     // webhook → stores table insert
//
//   setPaymentMethod():
//     // Redirect to Stripe Checkout or in-app Elements form.
//     // Returned PaymentMethod id attached to the customer via
//     // stripe.paymentMethods.attach()
//
// Every mutation writes an audit_log row per the spike's
// SECURITY_HARDENING.md:
//   category: 'settings'
//   action:   'subscription.tier_changed'
//           | 'subscription.seat_added'
//           | 'subscription.seat_removed'
//           | 'subscription.canceled'
//           | 'subscription.payment_updated'

import { useCallback, useSyncExternalStore } from 'react'

import {
  TIER_PRICE_JPY,
  subscriptionMockSeed,
  type PaymentMethodSummary,
  type SubscriptionState,
  type SubscriptionStatus,
  type SubscriptionTier,
} from './types'

const STORAGE_KEY = 'synqed-karute-subscription'
const TRIAL_DAYS = 14

// ─── Pub/sub + parse cache ────────────────────────────────────

const listeners = new Set<() => void>()
function notify() {
  for (const fn of listeners) fn()
}

function subscribe(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

let cachedRaw: string | null = null
let cachedParsed: SubscriptionState = subscriptionMockSeed

function read(): SubscriptionState {
  if (typeof window === 'undefined') return subscriptionMockSeed
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    cachedRaw = null
    cachedParsed = subscriptionMockSeed
    return subscriptionMockSeed
  }
  if (raw === cachedRaw) return cachedParsed
  try {
    const parsed = JSON.parse(raw) as SubscriptionState
    cachedRaw = raw
    cachedParsed = parsed
    return parsed
  } catch {
    cachedRaw = null
    cachedParsed = subscriptionMockSeed
    return subscriptionMockSeed
  }
}

function write(next: SubscriptionState) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  notify()
}

// ─── Reactive read hook ───────────────────────────────────────

export function useSubscription(): SubscriptionState {
  return useSyncExternalStore(subscribe, read, () => subscriptionMockSeed)
}

/** Convenience: monthly total = pricePerStore × storeCount.
 *  Same calculation used by SubscriptionSummaryCard and
 *  AddStoreSubscriptionDialog so both surfaces agree. */
export function monthlyTotalJpy(state: SubscriptionState): number {
  return state.pricePerStoreJpy * state.storeCount
}

/** True when the subscription allows adding another store seat.
 *  Free hits the limit at 1; trial / standard / professional
 *  can add. Enterprise routes through sales. */
export function canAddStore(state: SubscriptionState): boolean {
  if (state.tier === 'free') return state.storeCount < 1
  if (state.tier === 'enterprise') return false
  if (state.status === 'canceled') return false
  return true
}

// ─── Mutations ────────────────────────────────────────────────

export function useSubscriptionMutations() {
  /** Start the 14-day Professional trial. No-op if already on a
   *  paid tier or already trialing. */
  const startTrial = useCallback(() => {
    const current = read()
    if (
      current.status === 'trialing' ||
      current.tier === 'professional' ||
      current.tier === 'standard'
    ) {
      return
    }
    const now = new Date()
    const trialEnd = new Date(now)
    trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS)
    write({
      ...current,
      tier: 'trial',
      status: 'trialing',
      pricePerStoreJpy: 0,
      trialEndsAt: trialEnd.toISOString(),
      nextBillingDate: trialEnd.toISOString(),
    })
  }, [])

  /** Switch to a paid tier. In prod this hits Stripe and prorates. */
  const upgradeTo = useCallback((tier: SubscriptionTier) => {
    const current = read()
    write({
      ...current,
      tier,
      status: tier === 'free' ? 'free' : 'active',
      pricePerStoreJpy: TIER_PRICE_JPY[tier],
      trialEndsAt: null,
      nextBillingDate:
        tier === 'free' || tier === 'enterprise' ? null : nextBillingDateIso(),
    })
  }, [])

  /** Cancel + downgrade to free. Keeps past data accessible
   *  (read-only in prod). */
  const cancelSubscription = useCallback(() => {
    const current = read()
    write({
      ...current,
      tier: 'free',
      status: 'free',
      pricePerStoreJpy: 0,
      nextBillingDate: null,
      trialEndsAt: null,
      storeCount: Math.min(current.storeCount, 1),
    })
  }, [])

  /** Add one store seat. Returns true on success, false when
   *  blocked (free at limit, canceled, enterprise). */
  const addStoreSeat = useCallback((): boolean => {
    const current = read()
    if (!canAddStore(current)) return false
    write({ ...current, storeCount: current.storeCount + 1 })
    return true
  }, [])

  /** Remove one store seat. Floors at 1 — drop to 0 = cancel. */
  const removeStoreSeat = useCallback(() => {
    const current = read()
    if (current.storeCount <= 1) return
    write({ ...current, storeCount: current.storeCount - 1 })
  }, [])

  /** Update the displayed payment method summary. Spike just
   *  writes; prod routes through Stripe Elements. */
  const setPaymentMethod = useCallback((method: PaymentMethodSummary) => {
    const current = read()
    write({ ...current, paymentMethod: method })
  }, [])

  /** Flip status for demo purposes. Used on the 契約 tab so the
   *  owner can preview past_due / canceled states during demos. */
  const setStatus = useCallback((status: SubscriptionStatus) => {
    const current = read()
    write({ ...current, status })
  }, [])

  return {
    startTrial,
    upgradeTo,
    cancelSubscription,
    addStoreSeat,
    removeStoreSeat,
    setPaymentMethod,
    setStatus,
  }
}

// ─── Helpers ──────────────────────────────────────────────────

function nextBillingDateIso(): string {
  const d = new Date()
  d.setDate(d.getDate() + 30)
  return d.toISOString()
}
