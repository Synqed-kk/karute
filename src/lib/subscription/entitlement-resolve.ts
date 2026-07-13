// ─────────────────────────────────────────────────────────────
// Entitlement resolution — pure core of the paywall (P4)
// ─────────────────────────────────────────────────────────────
// PURE (no I/O, no synqed client) so the money-path logic is jest-testable —
// same split as gating.ts. entitlements.ts is the thin server loader that
// fetches live data and feeds it through resolveEntitlement().
//
// THE ARMING SWITCH — why walls ship disarmed
//
// Core's business_entitlements has NO rows for real businesses yet (absent
// row = 'free': 1 store, 2 staff, no AI generation) and signup seeds nothing.
// If the walls bound immediately, every live salon would be capped to the
// free tier the moment this deploys. So every wall consults `enforced`:
//
//   KARUTE_BILLING_ENFORCEMENT=on   (server env, Vercel)
//
// stays OFF until Anthony's Stripe webhook seeds real tiers. Off = today's
// permissive behavior, byte-for-byte. Walls render nothing, gates allow.
// NOTE this also disarms the pre-existing createStore cap (it used to bind
// even pre-billing) — deliberate: nothing should enforce a plan nobody
// could buy yet. Flagged in the PR for review.

import {
  ALL_TIERS,
  TIER_FEATURES,
  type SubscriptionTier,
  type TierFeatures,
} from './types'
import { canAddStoreFor, staffLimitFor, storeLimitFor } from './gating'

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
  /** Walls armed? False until Stripe billing goes live — every gate and every
   *  paywall surface keys off this, so the whole system arms with one env flip. */
  enforced: boolean
  /** True when the entitlement READ failed (core outage) — distinct from an
   *  absent row (core answers 'free' for those). Armed gates treat degraded as
   *  permissive: a transient read failure must never lock a paying salon out
   *  of features mid-outage. */
  degraded: boolean
}

/** Is billing enforcement armed? Server env only — the client learns this via
 *  Entitlement.enforced, never its own env read. */
export function billingEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.KARUTE_BILLING_ENFORCEMENT ?? '').trim().toLowerCase()
  return raw === 'on' || raw === 'true' || raw === '1'
}

/** QA lever: force the resolved tier (and drop the unlimited override) so
 *  locked states can be rendered locally without touching core data. Combine
 *  with KARUTE_BILLING_ENFORCEMENT=on to see armed walls. Local dev only —
 *  never set on prod/preview. */
export function devForcedTier(
  env: NodeJS.ProcessEnv = process.env,
): SubscriptionTier | null {
  const raw = (env.KARUTE_DEV_FORCE_TIER ?? '').trim()
  return (ALL_TIERS as readonly string[]).includes(raw)
    ? (raw as SubscriptionTier)
    : null
}

/** Fold live data + overrides + the arming switch into the one Entitlement
 *  every gate and surface shares. Pure — all inputs explicit. */
export function resolveEntitlement(args: {
  /** Tier as core reported it (already validated against ALL_TIERS). */
  fetchedTier: SubscriptionTier
  /** business_entitlements.is_unlimited from core. */
  rowUnlimited: boolean
  /** KARUTE_UNLIMITED_BUSINESS_IDS allowlist hit. */
  envAllowlisted: boolean
  /** devForcedTier() — non-null replaces the tier AND drops unlimited. */
  forcedTier: SubscriptionTier | null
  /** billingEnforced(). */
  enforced: boolean
  /** The entitlement read THREW (core outage) — not the absent-row default. */
  fetchFailed: boolean
  storeCount: number
}): Entitlement {
  const tier = args.forcedTier ?? args.fetchedTier
  const isUnlimited = args.forcedTier
    ? false
    : args.rowUnlimited || args.envAllowlisted
  const degraded = args.forcedTier ? false : args.fetchFailed
  return {
    tier,
    storeLimit: storeLimitFor(tier),
    storeCount: args.storeCount,
    isUnlimited,
    features: TIER_FEATURES[tier],
    staffLimit: staffLimitFor(tier),
    canAddStore:
      !args.enforced ||
      degraded ||
      canAddStoreFor({ tier, isUnlimited, storeCount: args.storeCount }),
    enforced: args.enforced,
    degraded,
  }
}
