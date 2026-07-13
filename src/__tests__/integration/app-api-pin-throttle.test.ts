// PIN throttle (packet 03, gap 4). verifyStaffPin was unthrottled; this bounds
// attempts per (actor,target) with exponential lockout. Pure logic — no mocks.
import {
  checkPinThrottle,
  recordPinFailure,
  recordPinSuccess,
  _resetPinThrottle,
} from '@/lib/auth/pin-throttle'

beforeEach(() => _resetPinThrottle())

describe('pin throttle', () => {
  it('allows attempts until the failure ceiling, then locks out', () => {
    const t0 = 1_000_000
    for (let i = 0; i < 5; i++) {
      expect(checkPinThrottle('actor', 'target', t0).allowed).toBe(true)
      recordPinFailure('actor', 'target', t0)
    }
    const decision = checkPinThrottle('actor', 'target', t0)
    expect(decision.allowed).toBe(false)
    expect(decision.retryAfterMs).toBeGreaterThan(0)
  })

  it('is scoped per (actor,target) — one target locked does not lock another', () => {
    const t0 = 2_000_000
    for (let i = 0; i < 5; i++) recordPinFailure('actor', 'targetA', t0)
    expect(checkPinThrottle('actor', 'targetA', t0).allowed).toBe(false)
    expect(checkPinThrottle('actor', 'targetB', t0).allowed).toBe(true)
  })

  it('a success clears the counter', () => {
    const t0 = 3_000_000
    for (let i = 0; i < 4; i++) recordPinFailure('actor', 'target', t0)
    recordPinSuccess('actor', 'target')
    for (let i = 0; i < 4; i++) {
      expect(checkPinThrottle('actor', 'target', t0).allowed).toBe(true)
      recordPinFailure('actor', 'target', t0)
    }
  })

  it('lockout expires after the backoff, and re-lock is longer (exponential)', () => {
    const t0 = 4_000_000
    for (let i = 0; i < 5; i++) recordPinFailure('actor', 'target', t0)
    const firstLock = checkPinThrottle('actor', 'target', t0).retryAfterMs!
    // After the first lock expires, a fresh burst locks again for LONGER.
    const t1 = t0 + firstLock + 1
    expect(checkPinThrottle('actor', 'target', t1).allowed).toBe(true)
    for (let i = 0; i < 5; i++) recordPinFailure('actor', 'target', t1)
    const secondLock = checkPinThrottle('actor', 'target', t1).retryAfterMs!
    expect(secondLock).toBeGreaterThan(firstLock)
  })
})
