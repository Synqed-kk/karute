// ─────────────────────────────────────────────────────────────
// Subscription gating — PURE tier decisions
// ─────────────────────────────────────────────────────────────
// Every paywall decision as a pure function of the tier — no I/O, no synqed client,
// so it's client-, server-, and test-safe. The server loader that reads a business's
// live tier is entitlements.ts, which re-exports all of these (so existing
// '@/lib/entitlements' imports keep working). One source of truth for "what does
// this tier allow", shared by the server gate and the plan UI so they can't diverge.

import { TIER_FEATURES, type SubscriptionTier } from './types'

/** The boolean capability flags a tier can gate on (the non-numeric TierFeatures). */
export type EntitlementFeature =
  | 'aiKaruteGeneration'
  | 'customerMemoryAutoExtract'
  | 'aiOutreachDrafts'
  | 'coachingInsights'
  | 'advancedCoachingAnalytics'
  | 'prioritySupport'

/** Store limit for a tier, straight from the pricing model. */
export function storeLimitFor(tier: SubscriptionTier): number | 'unlimited' {
  return TIER_FEATURES[tier].stores
}

/** Can this business add another store? isUnlimited (Liam's account) always can. */
export function canAddStoreFor(args: {
  tier: SubscriptionTier
  isUnlimited: boolean
  storeCount: number
}): boolean {
  if (args.isUnlimited) return true
  const limit = storeLimitFor(args.tier)
  return limit === 'unlimited' || args.storeCount < limit
}

/** Staff-account limit for a tier. */
export function staffLimitFor(tier: SubscriptionTier): number | 'unlimited' {
  return TIER_FEATURES[tier].staff
}

/** Can this business add another staff account? The caller passes the count it has. */
export function canAddStaffFor(args: {
  tier: SubscriptionTier
  isUnlimited: boolean
  staffCount: number
}): boolean {
  if (args.isUnlimited) return true
  const limit = staffLimitFor(args.tier)
  return limit === 'unlimited' || args.staffCount < limit
}

/** Does the tier include this capability? The paywall for a feature — same source as
 *  the plan UI, so the gate and the pricing grid can never disagree. */
export function tierHasFeature(tier: SubscriptionTier, feature: EntitlementFeature): boolean {
  return TIER_FEATURES[tier][feature] === true
}

/** The single gate any capability checks. isUnlimited (Liam's account / comped)
 *  unlocks everything, exactly like the store + staff gates. */
export function entitlementHasFeature(
  ent: { tier: SubscriptionTier; isUnlimited: boolean },
  feature: EntitlementFeature,
): boolean {
  return ent.isUnlimited || tierHasFeature(ent.tier, feature)
}
