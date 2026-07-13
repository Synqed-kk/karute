/**
 * Paywall tiers — proves the enforceable structure: feature gating, staff limits,
 * and the setup-fee-vs-branch-fee rule, with Liam's unlimited account bypassing all.
 */
import {
  tierHasFeature,
  entitlementHasFeature,
  canAddStaffFor,
  staffLimitFor,
} from '@/lib/subscription/gating'
import { resolveStoreAddFee, STORE_SETUP_FEE_JPY } from '@/lib/subscription/fees'
import { TIER_PRICE_JPY } from '@/lib/subscription/types'

describe('feature gating by tier', () => {
  it('free is below the coaching paywall; professional is above it', () => {
    expect(tierHasFeature('free', 'coachingInsights')).toBe(false)
    expect(tierHasFeature('standard', 'coachingInsights')).toBe(false)
    expect(tierHasFeature('professional', 'coachingInsights')).toBe(true)
  })
  it('the unlimited override (Liam) unlocks every feature regardless of tier', () => {
    expect(entitlementHasFeature({ tier: 'free', isUnlimited: true }, 'coachingInsights')).toBe(true)
    expect(entitlementHasFeature({ tier: 'free', isUnlimited: false }, 'coachingInsights')).toBe(false)
  })
})

describe('staff limits by tier', () => {
  it('free caps staff; professional is unlimited', () => {
    expect(staffLimitFor('free')).toBe(2)
    expect(staffLimitFor('standard')).toBe(10)
    expect(staffLimitFor('professional')).toBe('unlimited')
  })
  it('canAddStaff enforces the cap + honours the unlimited bypass', () => {
    expect(canAddStaffFor({ tier: 'free', isUnlimited: false, staffCount: 1 })).toBe(true)
    expect(canAddStaffFor({ tier: 'free', isUnlimited: false, staffCount: 2 })).toBe(false)
    expect(canAddStaffFor({ tier: 'free', isUnlimited: true, staffCount: 99 })).toBe(true)
    expect(canAddStaffFor({ tier: 'professional', isUnlimited: false, staffCount: 500 })).toBe(true)
  })
})

describe('store-add fee: setup fee vs branch fee', () => {
  it('a DIFFERENT business type → one-time setup fee + a seat', () => {
    const fee = resolveStoreAddFee({
      tier: 'standard',
      isUnlimited: false,
      orgPrimaryType: 'hair_salon',
      newStoreType: 'dental_clinic',
    })
    expect(fee.kind).toBe('setup_fee')
    expect(fee.oneTimeJpy).toBe(STORE_SETUP_FEE_JPY)
    expect(fee.monthlyJpy).toBe(TIER_PRICE_JPY.standard)
  })
  it('a SAME-type branch → no setup fee, just an extra monthly seat', () => {
    const fee = resolveStoreAddFee({
      tier: 'standard',
      isUnlimited: false,
      orgPrimaryType: 'hair_salon',
      newStoreType: 'hair_salon',
    })
    expect(fee.kind).toBe('branch_fee')
    expect(fee.oneTimeJpy).toBe(0)
    expect(fee.monthlyJpy).toBe(TIER_PRICE_JPY.standard)
  })
  it('Liam’s unlimited account is never charged', () => {
    const fee = resolveStoreAddFee({
      tier: 'free',
      isUnlimited: true,
      orgPrimaryType: 'hair_salon',
      newStoreType: 'dental_clinic',
    })
    expect(fee).toMatchObject({ kind: 'none', oneTimeJpy: 0, monthlyJpy: 0 })
  })
})
