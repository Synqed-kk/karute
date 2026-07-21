// ─────────────────────────────────────────────────────────────
// Entitlements — the live plan loader (P3/P4)
// ─────────────────────────────────────────────────────────────
// Server-usable lib (imported by server actions; never shipped to the client
// bundle). Loads a business's live tier + counts and folds them through the PURE
// resolution in ./subscription/entitlement-resolve (which owns the Entitlement
// shape, the KARUTE_BILLING_ENFORCEMENT arming switch, and the dev force-tier
// QA lever) plus the PURE gating decisions in ./subscription/gating — all
// re-exported here so existing '@/lib/entitlements' imports keep working.
//
// Numeric limits + feature flags are DERIVED from the plan tier via TIER_FEATURES
// (src/lib/subscription/types.ts) — the exact model the pricing UI renders — so the
// server gate (createStore) and the client UI (StoresSection) can never disagree.
//
// Dev/owner bypass — Liam's account must never be capped or charged. Two levers:
//   1. business_entitlements.is_unlimited = true   (per-business, in the DB), or
//   2. KARUTE_UNLIMITED_BUSINESS_IDS env (comma-separated business_ids) — a
//      zero-migration switch Anthony/Liam can flip on Vercel for the dev account.

import type { SynqedClient } from '@synqed-kk/client'
import { getSynqedClient } from '@/lib/synqed/client'
import { ALL_TIERS, type SubscriptionTier } from '@/lib/subscription/types'
import {
  billingEnforced,
  devForcedTier,
  resolveEntitlement,
  type Entitlement,
} from '@/lib/subscription/entitlement-resolve'

// Re-export the pure surfaces so callers can keep importing from here.
export {
  storeLimitFor,
  canAddStoreFor,
  staffLimitFor,
  canAddStaffFor,
  tierHasFeature,
  entitlementHasFeature,
} from '@/lib/subscription/gating'
export type { EntitlementFeature } from '@/lib/subscription/gating'
export {
  billingEnforced,
  resolveEntitlement,
} from '@/lib/subscription/entitlement-resolve'
export type { Entitlement } from '@/lib/subscription/entitlement-resolve'

/** business_ids that are never capped, from a server-only env allowlist. */
function envUnlimited(businessId: string): boolean {
  const raw = process.env.KARUTE_UNLIMITED_BUSINESS_IDS ?? ''
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(businessId)
}

/** Client-threaded core of loadEntitlement (facade Bearer path, design-parity
 *  packet 12 §B-3 S2 — same WithClient split as orgSettingsWithClient).
 *  Fully tolerant (never throws): a degraded read still resolves an
 *  Entitlement with `degraded: true` so armed gates stay permissive. */
export async function loadEntitlementWithClient(
  synqed: Pick<SynqedClient, 'entitlements' | 'stores'>,
  businessId: string,
): Promise<Entitlement> {
  let fetchedTier: SubscriptionTier = 'free'
  let rowUnlimited = false
  let fetchFailed = false
  try {
    const ent = await synqed.entitlements.get()
    if (ALL_TIERS.includes(ent.tier as SubscriptionTier)) {
      fetchedTier = ent.tier as SubscriptionTier
    }
    rowUnlimited = !!ent.is_unlimited
  } catch {
    /* core unavailable → 'free' for display, degraded=true so armed gates
       stay permissive (an outage must never lock a paying salon out) */
    fetchFailed = true
  }

  let storeCount = 0
  try {
    storeCount = (await synqed.stores.list()).stores.length
  } catch {
    /* core unavailable → 0 */
  }

  return resolveEntitlement({
    fetchedTier,
    rowUnlimited,
    envAllowlisted: envUnlimited(businessId),
    forcedTier: devForcedTier(),
    enforced: billingEnforced(),
    fetchFailed,
    storeCount,
  })
}

/** Load the live entitlement for a business. Graceful: an absent row (or a
 *  pre-migration DB without the table/column) degrades to 'free', so nothing
 *  throws on the preview before the migration is applied — and the arming
 *  switch (Entitlement.enforced) keeps that fallback harmless until billing
 *  actually exists. NOTE: builds its client from the cookie session, NOT from
 *  `businessId` — that param only feeds the env-allowlist check below (a
 *  pre-existing quirk, preserved as-is; both resolve to the same business in
 *  practice). */
export async function loadEntitlement(businessId: string): Promise<Entitlement> {
  const synqed = await getSynqedClient()
  return loadEntitlementWithClient(synqed, businessId)
}
