// ─────────────────────────────────────────────────────────────
// Subscription — store-add fees (setup fee vs branch fee)
// ─────────────────────────────────────────────────────────────
// Liam's rule: adding a store of a DIFFERENT business type than your own is a new
// vertical → charge a one-time SETUP FEE (plus its monthly seat). Adding a SAME-type
// BRANCH of your existing business is just an extra monthly seat (optionally a
// multiple). Liam's own account (isUnlimited) is never charged.
//
// Every number here is CONFIG and adjustable — the point right now is the structure,
// not the final prices. Ties into the add-store flow's setup-fee slot (#397) and,
// when Anthony wires it, a Stripe one-time charge (setup fee) + a seat quantity bump
// (monthly). Currency stays JPY here but the shape is money-as-data — swap to a
// per-region price table without touching the resolver.

import { TIER_PRICE_JPY, type SubscriptionTier } from './types'

export type StoreAddFeeKind = 'setup_fee' | 'branch_fee' | 'none'

export interface StoreAddFee {
  kind: StoreAddFeeKind
  /** One-time charge at add time (the setup fee). 0 for a branch or a comped org. */
  oneTimeJpy: number
  /** Recurring monthly seat this new store adds to the subscription. */
  monthlyJpy: number
  /** Machine reason — drives the UI copy + the audit-log row. */
  reason: 'different_business_type' | 'same_type_branch' | 'comped'
}

// ── Config — ADJUSTABLE (prices change later; this is the structure) ──
/** One-time fee to onboard a store whose business type differs from the org's
 *  primary vertical — a new vertical needs its own setup. */
export const STORE_SETUP_FEE_JPY = 30000
/** Multiplier on the per-store monthly seat for a SAME-type branch. 1 = a normal
 *  seat; set to 2 for Liam's "double the amount" option — one number to flip. */
export const BRANCH_SEAT_MULTIPLIER = 1

/**
 * What does adding a store cost? A different business type → a one-time setup fee
 * plus a monthly seat; a same-type branch → just an extra monthly seat (× the
 * branch multiplier). A comped/unlimited org (Liam's account) is never charged.
 */
export function resolveStoreAddFee(args: {
  tier: SubscriptionTier
  isUnlimited: boolean
  orgPrimaryType: string
  newStoreType: string
}): StoreAddFee {
  if (args.isUnlimited) {
    return { kind: 'none', oneTimeJpy: 0, monthlyJpy: 0, reason: 'comped' }
  }
  const seat = TIER_PRICE_JPY[args.tier]
  const differentType = Boolean(args.newStoreType) && args.newStoreType !== args.orgPrimaryType
  if (differentType) {
    return {
      kind: 'setup_fee',
      oneTimeJpy: STORE_SETUP_FEE_JPY,
      monthlyJpy: seat,
      reason: 'different_business_type',
    }
  }
  return {
    kind: 'branch_fee',
    oneTimeJpy: 0,
    monthlyJpy: seat * BRANCH_SEAT_MULTIPLIER,
    reason: 'same_type_branch',
  }
}
