// ─────────────────────────────────────────────────────────────
// Billing enforcement — the arming switch + pure entitlement resolution
// ─────────────────────────────────────────────────────────────
// Guards the production-safety contract: while KARUTE_BILLING_ENFORCEMENT is
// off, NOTHING binds (core has no entitlement rows for real businesses — the
// 'free' fallback must stay harmless). Armed, the caps bind exactly as the
// pricing model says, and the unlimited overrides still bypass everything.

import {
  billingEnforced,
  devForcedTier,
  resolveEntitlement,
} from '@/lib/subscription/entitlement-resolve'
import { TIER_FEATURES } from '@/lib/subscription/types'

const env = (vars: Record<string, string>) => vars as NodeJS.ProcessEnv

describe('billingEnforced', () => {
  it('is OFF by default (unset / empty / junk)', () => {
    expect(billingEnforced(env({}))).toBe(false)
    expect(billingEnforced(env({ KARUTE_BILLING_ENFORCEMENT: '' }))).toBe(false)
    expect(billingEnforced(env({ KARUTE_BILLING_ENFORCEMENT: 'off' }))).toBe(false)
    expect(billingEnforced(env({ KARUTE_BILLING_ENFORCEMENT: '0' }))).toBe(false)
    expect(billingEnforced(env({ KARUTE_BILLING_ENFORCEMENT: 'banana' }))).toBe(false)
  })

  it('arms on the accepted spellings, case/space-insensitive', () => {
    expect(billingEnforced(env({ KARUTE_BILLING_ENFORCEMENT: 'on' }))).toBe(true)
    expect(billingEnforced(env({ KARUTE_BILLING_ENFORCEMENT: ' ON ' }))).toBe(true)
    expect(billingEnforced(env({ KARUTE_BILLING_ENFORCEMENT: 'true' }))).toBe(true)
    expect(billingEnforced(env({ KARUTE_BILLING_ENFORCEMENT: '1' }))).toBe(true)
  })
})

describe('devForcedTier', () => {
  it('returns null unless set to a real tier', () => {
    expect(devForcedTier(env({}))).toBeNull()
    expect(devForcedTier(env({ KARUTE_DEV_FORCE_TIER: '' }))).toBeNull()
    expect(devForcedTier(env({ KARUTE_DEV_FORCE_TIER: 'banana' }))).toBeNull()
  })

  it('accepts every valid tier (trimmed)', () => {
    expect(devForcedTier(env({ KARUTE_DEV_FORCE_TIER: 'free' }))).toBe('free')
    expect(devForcedTier(env({ KARUTE_DEV_FORCE_TIER: ' professional ' }))).toBe(
      'professional',
    )
  })
})

describe('resolveEntitlement', () => {
  const base = {
    fetchedTier: 'free' as const,
    rowUnlimited: false,
    envAllowlisted: false,
    forcedTier: null,
    fetchFailed: false,
    storeCount: 1, // free tier's cap
  }

  it('DISARMED: the free fallback never blocks (production-safety contract)', () => {
    const ent = resolveEntitlement({ ...base, enforced: false })
    expect(ent.enforced).toBe(false)
    expect(ent.canAddStore).toBe(true) // at the free cap, still allowed
    expect(ent.tier).toBe('free') // display stays honest
  })

  it('ARMED: free tier binds at its store cap', () => {
    const ent = resolveEntitlement({ ...base, enforced: true })
    expect(ent.canAddStore).toBe(false)
    expect(resolveEntitlement({ ...base, enforced: true, storeCount: 0 }).canAddStore).toBe(
      true,
    )
  })

  it('ARMED: unlimited overrides (DB row / env allowlist) bypass the cap', () => {
    expect(
      resolveEntitlement({ ...base, enforced: true, rowUnlimited: true }).canAddStore,
    ).toBe(true)
    expect(
      resolveEntitlement({ ...base, enforced: true, envAllowlisted: true }).canAddStore,
    ).toBe(true)
  })

  it('forcedTier replaces the tier AND drops the unlimited override (QA lever)', () => {
    const ent = resolveEntitlement({
      ...base,
      fetchedTier: 'professional',
      rowUnlimited: true,
      forcedTier: 'free',
      enforced: true,
    })
    expect(ent.tier).toBe('free')
    expect(ent.isUnlimited).toBe(false)
    expect(ent.features).toEqual(TIER_FEATURES.free)
    expect(ent.canAddStore).toBe(false)
  })

  it('ARMED + read failure (degraded): permissive — an outage never locks anyone', () => {
    const ent = resolveEntitlement({ ...base, enforced: true, fetchFailed: true })
    expect(ent.degraded).toBe(true)
    expect(ent.canAddStore).toBe(true) // would be false if the row really said free-at-cap
  })

  it('absent-row free (fetch SUCCEEDED) is NOT degraded — armed caps bind', () => {
    const ent = resolveEntitlement({ ...base, enforced: true, fetchFailed: false })
    expect(ent.degraded).toBe(false)
    expect(ent.canAddStore).toBe(false)
  })

  it('display fields derive from the tier even while disarmed', () => {
    const ent = resolveEntitlement({
      ...base,
      fetchedTier: 'standard',
      enforced: false,
      storeCount: 3,
    })
    expect(ent.staffLimit).toBe(10)
    expect(ent.storeLimit).toBe('unlimited')
    expect(ent.features).toEqual(TIER_FEATURES.standard)
  })
})
