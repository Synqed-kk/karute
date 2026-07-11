// ─────────────────────────────────────────────────────────────
// Entitlements — the live plan loader (P3)
// ─────────────────────────────────────────────────────────────
// Server-usable lib (imported by server actions; never shipped to the client
// bundle). Loads a business's live tier + counts and folds them through the PURE
// gating decisions in ./subscription/gating (store/staff limits, feature flags),
// which are re-exported here so existing '@/lib/entitlements' imports keep working.
//
// Numeric limits + feature flags are DERIVED from the plan tier via TIER_FEATURES
// (src/lib/subscription/types.ts) — the exact model the pricing UI renders — so the
// server gate (createStore) and the client UI (StoresSection) can never disagree.
//
// Dev/owner bypass — Liam's account must never be capped or charged. Two levers:
//   1. business_entitlements.is_unlimited = true   (per-business, in the DB), or
//   2. KARUTE_UNLIMITED_BUSINESS_IDS env (comma-separated business_ids) — a
//      zero-migration switch Anthony/Liam can flip on Vercel for the dev account.

import { getSynqedClient } from '@/lib/synqed/client'
import { TIER_FEATURES, type SubscriptionTier, type TierFeatures } from '@/lib/subscription/types'
import {
  storeLimitFor,
  canAddStoreFor,
  staffLimitFor,
} from '@/lib/subscription/gating'

// Re-export the pure gating surface so callers can keep importing from here.
export {
  storeLimitFor,
  canAddStoreFor,
  staffLimitFor,
  canAddStaffFor,
  tierHasFeature,
  entitlementHasFeature,
} from '@/lib/subscription/gating'
export type { EntitlementFeature } from '@/lib/subscription/gating'

export interface Entitlement {
  tier: SubscriptionTier
  /** Derived from the tier. A finite number, or 'unlimited' for paid tiers. */
  storeLimit: number | 'unlimited'
  /** Live count of stores in this business. */
  storeCount: number
  /** True when never capped/charged (DB override or env allowlist — Liam's account). */
  isUnlimited: boolean
  /** The tier's full feature/limit matrix — for display + the gate helpers. */
  features: TierFeatures
  /** Staff-account limit for the tier. */
  staffLimit: number | 'unlimited'
  /** The single answer both the UI and createStore gate on. */
  canAddStore: boolean
}

const VALID_TIERS: readonly SubscriptionTier[] = [
  'trial',
  'free',
  'standard',
  'professional',
  'enterprise',
]

/** business_ids that are never capped, from a server-only env allowlist. */
function envUnlimited(businessId: string): boolean {
  const raw = process.env.KARUTE_UNLIMITED_BUSINESS_IDS ?? ''
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(businessId)
}

/** Load the live entitlement for a business. Graceful: an absent row (or a
 *  pre-migration DB without the table/column) degrades to 'free', so nothing
 *  throws on the preview before the migration is applied. */
export async function loadEntitlement(businessId: string): Promise<Entitlement> {
  const synqed = await getSynqedClient()

  let tier: SubscriptionTier = 'free'
  let rowUnlimited = false
  try {
    const ent = await synqed.entitlements.get()
    if (VALID_TIERS.includes(ent.tier as SubscriptionTier)) tier = ent.tier as SubscriptionTier
    rowUnlimited = !!ent.is_unlimited
  } catch {
    /* core unavailable → treat as free */
  }

  let storeCount = 0
  try {
    storeCount = (await synqed.stores.list()).stores.length
  } catch {
    /* core unavailable → 0 */
  }

  const isUnlimited = rowUnlimited || envUnlimited(businessId)
  return {
    tier,
    storeLimit: storeLimitFor(tier),
    storeCount,
    isUnlimited,
    features: TIER_FEATURES[tier],
    staffLimit: staffLimitFor(tier),
    canAddStore: canAddStoreFor({ tier, isUnlimited, storeCount }),
  }
}
