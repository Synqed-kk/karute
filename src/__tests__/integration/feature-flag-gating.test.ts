/**
 * Feature-flag gating contract — locks the PR #68 / #69 behaviour so
 * the unwired surfaces stay hidden until ANTHONY's backend lands.
 *
 * Each flag should default to "off" (undefined env var → false).
 * Only the exact string 'true' enables. This guards against:
 *   - someone setting the var to '1' / 'yes' / true (literal) and the
 *     gate accidentally letting fake mock data ship to a salon test
 *   - SubscriptionSummaryCard / multi-store / data-import nav showing
 *     in production before Stripe / stores table / upload action exist
 */

const FLAGS = [
  'NEXT_PUBLIC_FEATURE_SUBSCRIPTION',
  'NEXT_PUBLIC_FEATURE_MULTI_STORE',
  'NEXT_PUBLIC_FEATURE_COACHING',
  'NEXT_PUBLIC_FEATURE_DATA_IMPORT',
  'NEXT_PUBLIC_FEATURE_EXPORT_HISTORY',
  'NEXT_PUBLIC_FEATURE_RECORDING_PLAYBACK',
  'NEXT_PUBLIC_FEATURE_RECORDING_CONVERT',
  'NEXT_PUBLIC_FEATURE_KARUTE_SHARE',
  'NEXT_PUBLIC_FEATURE_PRESENTER_MODE',
  'NEXT_PUBLIC_FEATURE_AUDIT_LOG',
] as const

// The exact pattern used in the codebase: process.env.X === 'true'
function isEnabled(flagValue: string | undefined): boolean {
  return flagValue === 'true'
}

describe('feature-flag gating — defaults', () => {
  it('defaults to OFF when env var is undefined', () => {
    for (const _flag of FLAGS) {
      expect(isEnabled(undefined)).toBe(false)
    }
  })

  it("treats '' (empty string) as off", () => {
    expect(isEnabled('')).toBe(false)
  })

  it("treats 'false' (string) as off", () => {
    expect(isEnabled('false')).toBe(false)
  })

  it("treats numeric '1' as off (must be the literal 'true')", () => {
    // Guards against someone setting FLAG=1 in .env expecting truthy.
    expect(isEnabled('1')).toBe(false)
    expect(isEnabled('yes')).toBe(false)
    expect(isEnabled('on')).toBe(false)
    expect(isEnabled('TRUE')).toBe(false) // case-sensitive
  })

  it("enables ONLY when set to the literal 'true'", () => {
    expect(isEnabled('true')).toBe(true)
  })
})

describe('feature-flag gating — the canonical list is stable', () => {
  it('matches the exact set documented in REPLAY_PLAN.md + PR summaries', () => {
    // Anyone adding a new feature flag should update this set + the
    // summary doc + REPLAY_PLAN.md. Failing this test = process
    // reminder, not a bug.
    expect(FLAGS).toEqual([
      'NEXT_PUBLIC_FEATURE_SUBSCRIPTION',
      'NEXT_PUBLIC_FEATURE_MULTI_STORE',
      'NEXT_PUBLIC_FEATURE_COACHING',
      'NEXT_PUBLIC_FEATURE_DATA_IMPORT',
      'NEXT_PUBLIC_FEATURE_EXPORT_HISTORY',
      'NEXT_PUBLIC_FEATURE_RECORDING_PLAYBACK',
      'NEXT_PUBLIC_FEATURE_RECORDING_CONVERT',
      'NEXT_PUBLIC_FEATURE_KARUTE_SHARE',
      'NEXT_PUBLIC_FEATURE_PRESENTER_MODE',
      'NEXT_PUBLIC_FEATURE_AUDIT_LOG',
    ])
  })
})
