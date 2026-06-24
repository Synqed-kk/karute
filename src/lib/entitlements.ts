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

import { createServiceClient } from '@/lib/supabase/service'
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  let tier: SubscriptionTier = 'free'
  let rowUnlimited = false
  try {
    const { data } = await service
      .from('business_entitlements')
      .select('tier, is_unlimited')
      .eq('business_id', businessId)
      .maybeSingle()
    if (data) {
      if (VALID_TIERS.includes(data.tier)) tier = data.tier as SubscriptionTier
      rowUnlimited = !!data.is_unlimited
    }
  } catch {
    /* table not present yet → treat as free */
  }

  let storeCount = 0
  try {
    const { count } = await service
      .from('stores')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
    storeCount = count ?? 0
  } catch {
    /* stores table not present yet → 0 */
  }

  // DEMO/PREVIEW ONLY: on Vercel preview deployments (private share links used to
  // demo unmerged work) treat the business as unlimited, so the founder can
  // exercise the full multi-store flow end-to-end without us touching production
  // account data. Production (VERCEL_ENV === 'production') is unaffected — there
  // the real per-business is_unlimited flag / env allowlist applies. This line
  // lives only on the throwaway preview/multi-store-demo branch and never merges.
  const isUnlimited =
    rowUnlimited || envUnlimited(businessId) || process.env.VERCEL_ENV === 'preview'
  return {
    tier,
    storeLimit: storeLimitFor(tier),
    storeCount,
    isUnlimited,
    canAddStore: canAddStoreFor({ tier, isUnlimited, storeCount }),
  }
}
