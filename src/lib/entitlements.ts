// ─────────────────────────────────────────────────────────────
// Entitlements — store-limit / plan layer (P3)
// ─────────────────────────────────────────────────────────────
// Server-usable lib (imported by server actions; never shipped to the client
// bundle). The single source of truth for "can this business add another store?"
//
// The numeric store limit is DERIVED from the plan tier via TIER_FEATURES
// (src/lib/subscription/types.ts) — the exact model the pricing UI renders — so
// the server gate (createStore) and the client UI (StoresSection) can never
// disagree. A business's current tier + a comp/dev "unlimited" override live in
// the business_entitlements table (20260604020000). A business with no row is
// 'free' (1 store).
//
// Dev/owner bypass — Liam's account must never be store-capped. Two levers:
//   1. business_entitlements.is_unlimited = true   (per-business, in the DB), or
//   2. KARUTE_UNLIMITED_BUSINESS_IDS env (comma-separated business_ids) — a
//      zero-migration switch Anthony/Liam can flip on Vercel for the dev account.

import { getSynqedClient } from '@/lib/synqed/client'
import { TIER_FEATURES, type SubscriptionTier } from '@/lib/subscription/types'

export interface Entitlement {
  tier: SubscriptionTier
  /** Derived from the tier. A finite number, or 'unlimited' for paid tiers. */
  storeLimit: number | 'unlimited'
  /** Live count of stores in this business. */
  storeCount: number
  /** True when never store-capped (DB override or env allowlist). */
  isUnlimited: boolean
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

/** Store limit for a tier, straight from the pricing model. */
export function storeLimitFor(tier: SubscriptionTier): number | 'unlimited' {
  return TIER_FEATURES[tier].stores
}

/** Pure decision — shared so the server gate and the client UI agree. */
export function canAddStoreFor(args: {
  tier: SubscriptionTier
  isUnlimited: boolean
  storeCount: number
}): boolean {
  if (args.isUnlimited) return true
  const limit = storeLimitFor(args.tier)
  return limit === 'unlimited' || args.storeCount < limit
}

/** business_ids that are never store-capped, from a server-only env allowlist. */
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
  // Tier + unlimited override and the live store count both come from synqed-core
  // now (the entitlement + stores tables moved there). The client is business-
  // scoped to the session, which is the businessId passed in.
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
    canAddStore: canAddStoreFor({ tier, isUnlimited, storeCount }),
  }
}
