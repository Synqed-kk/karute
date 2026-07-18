// PIN verification throttle (packet 03, gap 4). `verifyStaffPin` was unthrottled,
// so 4-digit PINs (10k space) had no attempt ceiling. This adds per-(actor,target)
// attempt limits with exponential lockout + an audit hook, and returns the SAME
// shape on lockout as on a wrong PIN so responses don't reveal whether a PIN or
// a staff row exists (enumeration-resistant).
//
// ponytail: in-memory Map — per serverless instance, resets on cold start. This
// is a BEST-EFFORT facade guard; the durable, cross-instance backstop is a
// core-side attempt counter (Anthony brief). Upgrade path when throughput needs
// it: back this with the same store core uses, same interface.

import { audit } from '@/lib/audit'

interface AttemptState {
  fails: number
  windowStart: number
  lockedUntil: number
  lockLevel: number
}

const MAX_FAILS = 5 // failures allowed inside the window before lockout
const WINDOW_MS = 60_000 // rolling window for counting failures
const BASE_LOCK_MS = 30_000 // first lockout; doubles each subsequent lockout
const MAX_LOCK_MS = 15 * 60_000 // cap the exponential backoff

const attempts = new Map<string, AttemptState>()

const keyOf = (actor: string, target: string) => `${actor}::${target}`

/** Test seam — clear all counters between cases. */
export function _resetPinThrottle(): void {
  attempts.clear()
}

/** Audit hook — now routed through the shared audit emitter (no PIN, no
 *  secrets; ids + lock level only). Design: AUDIT-LOG-DESIGN.md §3 auth. */
function auditLockout(actor: string, target: string, lockLevel: number): void {
  audit({
    category: 'auth',
    action: 'auth.pin_lockout',
    actorId: actor,
    actorType: 'staff',
    businessId: null,
    targetType: 'staff',
    targetId: target,
    severity: 'warning',
    detail: { lockLevel },
    source: 'web',
  })
}

export interface ThrottleDecision {
  allowed: boolean
  retryAfterMs?: number
}

/** Is a verify attempt currently allowed for (actor, target)? */
export function checkPinThrottle(actor: string, target: string, now = Date.now()): ThrottleDecision {
  const st = attempts.get(keyOf(actor, target))
  if (st && st.lockedUntil > now) {
    return { allowed: false, retryAfterMs: st.lockedUntil - now }
  }
  return { allowed: true }
}

/** Record a FAILED verify; escalate to an (exponential) lockout past MAX_FAILS. */
export function recordPinFailure(actor: string, target: string, now = Date.now()): void {
  const k = keyOf(actor, target)
  const st = attempts.get(k) ?? { fails: 0, windowStart: now, lockedUntil: 0, lockLevel: 0 }

  // Reset the failure count if the rolling window elapsed.
  if (now - st.windowStart > WINDOW_MS) {
    st.fails = 0
    st.windowStart = now
  }
  st.fails += 1

  if (st.fails >= MAX_FAILS) {
    st.lockLevel += 1
    const lock = Math.min(BASE_LOCK_MS * 2 ** (st.lockLevel - 1), MAX_LOCK_MS)
    st.lockedUntil = now + lock
    st.fails = 0
    st.windowStart = now
    auditLockout(actor, target, st.lockLevel)
  }
  attempts.set(k, st)
}

/** Record a SUCCESSFUL verify — clears the counter for (actor, target). */
export function recordPinSuccess(actor: string, target: string): void {
  attempts.delete(keyOf(actor, target))
}
