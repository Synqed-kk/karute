/**
 * @jest-environment jsdom
 *
 * Unit coverage for the subscription state layer added in PR #95 (replay/21).
 * Exercises the localStorage-backed useSyncExternalStore read hook, the pure
 * helpers (monthlyTotalJpy / canAddStore), the TIER_PRICE_JPY table, and every
 * mutation (startTrial / upgradeTo / cancel / add+remove seat / payment / status).
 */
import { renderHook, act } from '@testing-library/react'
import {
  useSubscription,
  useSubscriptionMutations,
  monthlyTotalJpy,
  canAddStore,
} from '@/lib/subscription/hooks'
import {
  TIER_PRICE_JPY,
  subscriptionMockSeed,
  type PaymentMethodSummary,
  type SubscriptionState,
} from '@/lib/subscription/types'

const STORAGE_KEY = 'synqed-karute-subscription'

function seed(over: Partial<SubscriptionState>) {
  const state: SubscriptionState = { ...subscriptionMockSeed, ...over }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  return state
}

function setup() {
  return renderHook(() => ({
    sub: useSubscription(),
    ...useSubscriptionMutations(),
  }))
}

function stored(): SubscriptionState {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY)!) as SubscriptionState
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('types — TIER_PRICE_JPY / subscriptionMockSeed', () => {
  it('prices the paid tiers and zeroes trial/free/enterprise', () => {
    expect(TIER_PRICE_JPY.standard).toBe(5980)
    expect(TIER_PRICE_JPY.professional).toBe(11980)
    expect(TIER_PRICE_JPY.trial).toBe(0)
    expect(TIER_PRICE_JPY.free).toBe(0)
    expect(TIER_PRICE_JPY.enterprise).toBe(0)
  })

  it('mock seed is a single-store trial', () => {
    expect(subscriptionMockSeed.tier).toBe('trial')
    expect(subscriptionMockSeed.status).toBe('trialing')
    expect(subscriptionMockSeed.storeCount).toBe(1)
    expect(subscriptionMockSeed.pricePerStoreJpy).toBe(0)
  })
})

describe('monthlyTotalJpy', () => {
  it('multiplies per-store price by store count', () => {
    expect(
      monthlyTotalJpy({ ...subscriptionMockSeed, pricePerStoreJpy: 5980, storeCount: 3 }),
    ).toBe(17940)
  })

  it('is zero on a free/trial seed', () => {
    expect(monthlyTotalJpy(subscriptionMockSeed)).toBe(0)
  })
})

describe('canAddStore', () => {
  it('allows trial / standard / professional', () => {
    expect(canAddStore({ ...subscriptionMockSeed, tier: 'trial', status: 'trialing' })).toBe(true)
    expect(canAddStore({ ...subscriptionMockSeed, tier: 'standard', status: 'active' })).toBe(true)
    expect(canAddStore({ ...subscriptionMockSeed, tier: 'professional', status: 'active' })).toBe(true)
  })

  it('blocks free once it already has one store', () => {
    expect(canAddStore({ ...subscriptionMockSeed, tier: 'free', status: 'free', storeCount: 1 })).toBe(false)
    expect(canAddStore({ ...subscriptionMockSeed, tier: 'free', status: 'free', storeCount: 0 })).toBe(true)
  })

  it('blocks enterprise (routes through sales)', () => {
    expect(canAddStore({ ...subscriptionMockSeed, tier: 'enterprise', status: 'active' })).toBe(false)
  })

  it('blocks any canceled subscription', () => {
    expect(canAddStore({ ...subscriptionMockSeed, tier: 'standard', status: 'canceled' })).toBe(false)
  })
})

describe('useSubscription', () => {
  it('defaults to the mock seed when nothing is stored', () => {
    const { result } = setup()
    expect(result.current.sub).toEqual(subscriptionMockSeed)
  })

  it('reads a seeded state', () => {
    seed({ tier: 'professional', status: 'active', pricePerStoreJpy: 11980, storeCount: 2 })
    const { result } = setup()
    expect(result.current.sub.tier).toBe('professional')
    expect(result.current.sub.storeCount).toBe(2)
  })

  it('falls back to the mock seed on malformed JSON', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json')
    const { result } = setup()
    expect(result.current.sub).toEqual(subscriptionMockSeed)
  })
})

describe('useSubscriptionMutations', () => {
  it('startTrial from a free tier flips to trialing with a 14-day window', () => {
    seed({ tier: 'free', status: 'free', pricePerStoreJpy: 0, trialEndsAt: null })
    const { result } = setup()
    act(() => result.current.startTrial())
    expect(result.current.sub.tier).toBe('trial')
    expect(result.current.sub.status).toBe('trialing')
    expect(result.current.sub.trialEndsAt).not.toBeNull()
    const days =
      (new Date(result.current.sub.trialEndsAt!).getTime() - Date.now()) /
      (24 * 60 * 60 * 1000)
    expect(Math.round(days)).toBe(14)
  })

  it('startTrial is a no-op when already trialing', () => {
    seed({ tier: 'trial', status: 'trialing', trialEndsAt: '2026-06-15T00:00:00Z' })
    const before = window.localStorage.getItem(STORAGE_KEY)
    const { result } = setup()
    act(() => result.current.startTrial())
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(before)
  })

  it('startTrial is a no-op on a paid (standard) tier', () => {
    seed({ tier: 'standard', status: 'active', pricePerStoreJpy: 5980 })
    const before = window.localStorage.getItem(STORAGE_KEY)
    const { result } = setup()
    act(() => result.current.startTrial())
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(before)
  })

  it('upgradeTo("professional") sets active status, price, and a next-billing date', () => {
    seed({ tier: 'trial', status: 'trialing' })
    const { result } = setup()
    act(() => result.current.upgradeTo('professional'))
    expect(result.current.sub.tier).toBe('professional')
    expect(result.current.sub.status).toBe('active')
    expect(result.current.sub.pricePerStoreJpy).toBe(11980)
    expect(result.current.sub.trialEndsAt).toBeNull()
    expect(result.current.sub.nextBillingDate).not.toBeNull()
  })

  it('upgradeTo("free") sets free status with no billing date', () => {
    const { result } = setup()
    act(() => result.current.upgradeTo('free'))
    expect(result.current.sub.tier).toBe('free')
    expect(result.current.sub.status).toBe('free')
    expect(result.current.sub.pricePerStoreJpy).toBe(0)
    expect(result.current.sub.nextBillingDate).toBeNull()
  })

  it('upgradeTo("enterprise") is active but has no next-billing date', () => {
    const { result } = setup()
    act(() => result.current.upgradeTo('enterprise'))
    expect(result.current.sub.tier).toBe('enterprise')
    expect(result.current.sub.status).toBe('active')
    expect(result.current.sub.nextBillingDate).toBeNull()
  })

  it('cancelSubscription downgrades to free and floors store count at 1', () => {
    seed({ tier: 'professional', status: 'active', pricePerStoreJpy: 11980, storeCount: 4 })
    const { result } = setup()
    act(() => result.current.cancelSubscription())
    expect(result.current.sub.tier).toBe('free')
    expect(result.current.sub.status).toBe('free')
    expect(result.current.sub.pricePerStoreJpy).toBe(0)
    expect(result.current.sub.storeCount).toBe(1)
    expect(result.current.sub.nextBillingDate).toBeNull()
  })

  it('addStoreSeat increments and returns true when allowed', () => {
    seed({ tier: 'professional', status: 'active', storeCount: 2 })
    const { result } = setup()
    let ok: boolean | undefined
    act(() => {
      ok = result.current.addStoreSeat()
    })
    expect(ok).toBe(true)
    expect(result.current.sub.storeCount).toBe(3)
  })

  it('addStoreSeat returns false and does not write when blocked (free at limit)', () => {
    seed({ tier: 'free', status: 'free', storeCount: 1 })
    const before = window.localStorage.getItem(STORAGE_KEY)
    const { result } = setup()
    let ok: boolean | undefined
    act(() => {
      ok = result.current.addStoreSeat()
    })
    expect(ok).toBe(false)
    expect(result.current.sub.storeCount).toBe(1)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(before)
  })

  it('removeStoreSeat decrements above the floor', () => {
    seed({ tier: 'professional', status: 'active', storeCount: 3 })
    const { result } = setup()
    act(() => result.current.removeStoreSeat())
    expect(result.current.sub.storeCount).toBe(2)
  })

  it('removeStoreSeat is a no-op at the floor of 1', () => {
    seed({ tier: 'professional', status: 'active', storeCount: 1 })
    const before = window.localStorage.getItem(STORAGE_KEY)
    const { result } = setup()
    act(() => result.current.removeStoreSeat())
    expect(result.current.sub.storeCount).toBe(1)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(before)
  })

  it('setPaymentMethod persists the card summary', () => {
    const card: PaymentMethodSummary = {
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
    }
    const { result } = setup()
    act(() => result.current.setPaymentMethod(card))
    expect(result.current.sub.paymentMethod).toEqual(card)
    expect(stored().paymentMethod).toEqual(card)
  })

  it('setStatus flips status without touching tier', () => {
    seed({ tier: 'professional', status: 'active' })
    const { result } = setup()
    act(() => result.current.setStatus('past_due'))
    expect(result.current.sub.status).toBe('past_due')
    expect(result.current.sub.tier).toBe('professional')
  })
})
