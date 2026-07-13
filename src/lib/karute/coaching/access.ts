// ─────────────────────────────────────────────────────────────────────────
// Coaching access — the single gate: can this business use coaching?
// ─────────────────────────────────────────────────────────────────────────
// Pure decision (client-, server-, and test-safe — imports only the pricing model).
// The server loader that feeds it live data is in access-loader.ts.
//
// Coaching is a PAID, OPTIONAL module (Liam). It runs only when BOTH hold:
//   • ENTITLED — the plan tier includes coaching (the paywall, via
//     TIER_FEATURES.coachingInsights) OR the business is on the unlimited override
//     (Liam's dev/test account, via the DB flag or KARUTE_UNLIMITED_BUSINESS_IDS); AND
//   • ENABLED  — the owner has turned it on (org_settings.coaching_enabled, default
//     off; some business types won't want it).
// Off must mean off everywhere — but note this is the INTENDED contract, NOT yet
// wired: nothing in the app calls loadCoachingAccess today (coaching is dormant), so
// this gate currently decides nothing. When Anthony wires it (see access-loader.ts),
// the render gate hides every surface AND every generator checks canUse before firing,
// so a disabled store costs nothing to run (a real cost gate, not just hidden UI).
// This one function is the single answer they must all share so they can never
// disagree. Don't read it as already-enforced.

import type { SubscriptionTier } from '@/lib/subscription/types'
import { tierHasFeature } from '@/lib/subscription/gating'

export type CoachingAccessReason = 'ok' | 'not_entitled' | 'disabled'

export interface CoachingAccess {
  /** Tier includes coaching, or the business is unlimited (dev/test bypass). */
  entitled: boolean
  /** The owner's per-store on/off toggle (org_settings.coaching_enabled). */
  enabled: boolean
  /** The single answer the render gate AND every generator gate on. */
  canUse: boolean
  reason: CoachingAccessReason
}

/** Does this tier include coaching? Delegates to the ONE generic feature gate
 *  (gating.ts tierHasFeature) so the coaching gate, the pricing UI, and every
 *  other feature wall share a single source and can never diverge. */
export function coachingEntitledForTier(tier: SubscriptionTier): boolean {
  return tierHasFeature(tier, 'coachingInsights')
}

/** The pure gate decision. Entitled = paid tier OR unlimited override; canUse =
 *  entitled AND the owner toggle is on. */
export function coachingAccessFor(args: {
  tier: SubscriptionTier
  isUnlimited: boolean
  enabled: boolean
}): CoachingAccess {
  const entitled = args.isUnlimited || coachingEntitledForTier(args.tier)
  const canUse = entitled && args.enabled
  const reason: CoachingAccessReason = !entitled ? 'not_entitled' : !args.enabled ? 'disabled' : 'ok'
  return { entitled, enabled: args.enabled, canUse, reason }
}
