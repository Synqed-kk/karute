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

/** S111-5: the read-side second net. The break taken off a guessed lane must
 *  be meaningful against THIS day's open minutes: a finite integer ≥ 0 and
 *  below openMinutes → itself; otherwise the default if it fits the day;
 *  otherwise 0. The bound comes from the store's hours, never a cap constant. */
export function effectiveBreakMinutes(breakMinutes: number, openMinutes: number): number {
  return Number.isInteger(breakMinutes) && breakMinutes >= 0 && breakMinutes < openMinutes
    ? breakMinutes
    : DEFAULT_BREAK_MINUTES < openMinutes ? DEFAULT_BREAK_MINUTES : 0
}
