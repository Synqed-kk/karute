/**
 * Coaching access gate — proves the paywall + owner-toggle + dev/test-bypass logic.
 * Coaching runs ONLY when entitled (paid tier or unlimited override) AND enabled
 * (owner toggle on). Pure function, no I/O.
 */
import { coachingAccessFor, coachingEntitledForTier } from '@/lib/karute/coaching/access'

describe('coaching access gate', () => {
  it('paid tier + enabled → can use', () => {
    expect(coachingAccessFor({ tier: 'professional', isUnlimited: false, enabled: true })).toMatchObject({
      entitled: true,
      canUse: true,
      reason: 'ok',
    })
  })

  it('free tier is behind the paywall — not entitled even when enabled', () => {
    expect(coachingAccessFor({ tier: 'free', isUnlimited: false, enabled: true })).toMatchObject({
      entitled: false,
      canUse: false,
      reason: 'not_entitled',
    })
  })

  it('paid tier but the owner toggle is off → disabled, no coaching', () => {
    expect(coachingAccessFor({ tier: 'professional', isUnlimited: false, enabled: false })).toMatchObject({
      entitled: true,
      canUse: false,
      reason: 'disabled',
    })
  })

  it('unlimited override entitles even a free tier (Liam test-account bypass)', () => {
    expect(coachingAccessFor({ tier: 'free', isUnlimited: true, enabled: true })).toMatchObject({
      entitled: true,
      canUse: true,
      reason: 'ok',
    })
  })

  it('the bypass still respects the owner toggle — off is off', () => {
    expect(coachingAccessFor({ tier: 'free', isUnlimited: true, enabled: false })).toMatchObject({
      entitled: true,
      canUse: false,
      reason: 'disabled',
    })
  })

  it('tier entitlement matches the pricing model', () => {
    expect(coachingEntitledForTier('professional')).toBe(true)
    expect(coachingEntitledForTier('enterprise')).toBe(true)
    expect(coachingEntitledForTier('free')).toBe(false)
  })
})
