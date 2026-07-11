// ─────────────────────────────────────────────────────────────
// Subscription — types (mirrors design-spike pricing model)
// ─────────────────────────────────────────────────────────────
// Lifted from synqed-karute-design-spike/src/mock/subscription.ts.
// Per-store seat model: each store on the org's account = one
// subscription seat. Tier determines the per-seat monthly price.

export type SubscriptionTier =
  /** 14-day Professional trial — auto on signup */
  | 'trial'
  /** Free-forever with hard limits (1 store, 15 customers, 10 recordings/mo) */
  | 'free'
  /** ¥5,980 / store / month */
  | 'standard'
  /** ¥11,980 / store / month — main margin tier */
  | 'professional'
  /** Contact-sales, priced per deal */
  | 'enterprise'

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'free'

/** Per-tier price in JPY per store per month. Single source of
 *  truth for every price the UI renders. */
export const TIER_PRICE_JPY: Record<SubscriptionTier, number> = {
  trial: 0,
  free: 0,
  standard: 5980,
  professional: 11980,
  enterprise: 0,
}

export const FREE_TIER_LIMITS = {
  stores: 1,
  staff: 2,
  customers: 15,
  recordingsPerMonth: 10,
  aiKaruteGeneration: false,
  customerMemoryAutoExtract: false,
  aiOutreachDrafts: false,
  coachingInsights: false,
  advancedCoachingAnalytics: false,
  prioritySupport: false,
} as const

export interface TierFeatures {
  stores: number | 'unlimited'
  /** Max staff accounts across the org. Cheaper tiers are capped; pro/enterprise
   *  are unlimited. Prices/limits are all adjustable — this is the structure. */
  staff: number | 'unlimited'
  customers: number | 'unlimited'
  recordingsPerMonth: number | 'unlimited'
  aiKaruteGeneration: boolean
  customerMemoryAutoExtract: boolean
  aiOutreachDrafts: boolean
  coachingInsights: boolean
  advancedCoachingAnalytics: boolean
  prioritySupport: boolean
}

export const TIER_FEATURES: Record<SubscriptionTier, TierFeatures> = {
  trial: {
    stores: 1,
    staff: 'unlimited',
    customers: 'unlimited',
    recordingsPerMonth: 'unlimited',
    aiKaruteGeneration: true,
    customerMemoryAutoExtract: true,
    aiOutreachDrafts: true,
    coachingInsights: true,
    advancedCoachingAnalytics: true,
    prioritySupport: false,
  },
  free: { ...FREE_TIER_LIMITS },
  standard: {
    stores: 'unlimited',
    staff: 10,
    customers: 200,
    recordingsPerMonth: 200,
    aiKaruteGeneration: true,
    customerMemoryAutoExtract: true,
    aiOutreachDrafts: true,
    coachingInsights: false,
    advancedCoachingAnalytics: false,
    prioritySupport: false,
  },
  professional: {
    stores: 'unlimited',
    staff: 'unlimited',
    customers: 'unlimited',
    recordingsPerMonth: 'unlimited',
    aiKaruteGeneration: true,
    customerMemoryAutoExtract: true,
    aiOutreachDrafts: true,
    coachingInsights: true,
    advancedCoachingAnalytics: true,
    prioritySupport: true,
  },
  enterprise: {
    stores: 'unlimited',
    staff: 'unlimited',
    customers: 'unlimited',
    recordingsPerMonth: 'unlimited',
    aiKaruteGeneration: true,
    customerMemoryAutoExtract: true,
    aiOutreachDrafts: true,
    coachingInsights: true,
    advancedCoachingAnalytics: true,
    prioritySupport: true,
  },
}

export interface PaymentMethodSummary {
  brand: 'visa' | 'mastercard' | 'amex' | 'jcb'
  last4: string
  /** MM portion of card expiry. */
  expMonth: number
  /** Full year (e.g. 2027) portion of card expiry. */
  expYear: number
}

export interface InvoiceRow {
  id: string
  /** Localized display date (e.g. "2026年5月15日"). */
  issuedDate: string
  /** Tax-inclusive total in JPY. Spike includes consumption tax;
   *  prod computes via Stripe tax. */
  amountJpy: number
  status: 'paid' | 'pending' | 'failed'
  /** How many seats this invoice billed for. */
  storeCount: number
  tier: SubscriptionTier
  /** Spike: mock URL. Prod: signed Stripe hosted invoice URL. */
  downloadHref?: string
}

export interface SubscriptionState {
  tier: SubscriptionTier
  status: SubscriptionStatus
  pricePerStoreJpy: number
  storeCount: number
  /** ISO date when the next charge happens. Null on free / canceled / enterprise. */
  nextBillingDate: string | null
  /** ISO date when the trial ends. Non-null only when status === 'trialing'. */
  trialEndsAt: string | null
  /** ISO date — initial sign-up. */
  createdAt: string
  paymentMethod: PaymentMethodSummary | null
  /** Most recent invoices, newest first. Spike caps at 6; prod
   *  paginates via Stripe. */
  recentInvoices: InvoiceRow[]
}

/** Initial state — Professional on trial. Matches spike default
 *  so the dev preview shows the most interesting tier. Anthony's
 *  real wiring reads this from Stripe via Supabase. */
export const subscriptionMockSeed: SubscriptionState = {
  tier: 'trial',
  status: 'trialing',
  pricePerStoreJpy: 0,
  storeCount: 1,
  nextBillingDate: null,
  trialEndsAt: (() => {
    // Default to ~14 days from a fixed date so SSR ↔ client
    // hydrate identically. Real impl reads from Stripe.
    return new Date('2026-06-15T00:00:00Z').toISOString()
  })(),
  createdAt: '2026-05-15T00:00:00Z',
  paymentMethod: null,
  recentInvoices: [],
}
