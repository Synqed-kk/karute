import type { SynqedClient } from '@synqed-kk/client'

// The SDK does not re-export its policy type; this is storePolicies.get's answer.
type StoreBookingPolicy = Awaited<ReturnType<SynqedClient['storePolicies']['get']>>

/** The named default beside the resolver — the only home of this number. */
export const DEFAULT_BREAK_MINUTES = 60

/** Guess mode's one break per inferred person, in minutes.
 *  Per-store setting; entered in SYNQED Business; core field break_minutes
 *  (pending); default until then. A finite integer ≥ 0 wins; anything else
 *  (absent, null, negative, NaN, non-integer, non-number) → the default. */
export function resolveBreakMinutes(policy: (Partial<StoreBookingPolicy> & { break_minutes?: unknown }) | null | undefined): number {
  const value = policy?.break_minutes
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : DEFAULT_BREAK_MINUTES
}
