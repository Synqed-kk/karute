// ⚖ Liam 9/1 (PKT-BUILD-SETTINGS, "PERSISTENCE — THE PROVEN SPLIT") — THE TWO
// FIELDS CORE ALREADY CARRIES, AND THE ONE FILE THEIR RECONNECT LANDS IN.
//
// `StoreBookingPolicy` (@synqed-kk/client 1.28, types.d.ts) has exactly two
// fields this room's dials map onto:
//
//   gap_guard_mode: 'OFF' | 'STANDARD' | 'STRICT'
//   new_client_session_minutes: number   (WRITE-CONSTRAINED — see below)
//
// and `StorePolicyClient` has `get(storeId)` plus an HQ-gated partial upsert
// `set(storeId, input)` whose `SetStoreBookingPolicyInput` requires
// `acting_staff_id` and takes an optional `audit` event. Everything else the
// room's 詳細設定 shows — the override policy, the long press, the 会員ランク
// dial, the 刻み pair, すき間の販売 — has NO core field at all today
// (⚠SETTINGS-BATCH in `fixtures-today.ts`), and rides
// DRAFT-ANTHONY-ASK-SETTINGS-FIELDS.md.
//
// ⛔ WHY THE WIRE IS NOT CALLED FROM HERE YET. Three independent machines forbid
// a core reach from Business territory during the play phase, and all three are
// owner-gated rather than ours to amend:
//
//   1. `scripts/business/check-business-data-access.mjs` — 「NO DIRECT core
//      reach, anywhere — @synqed-kk/client … No file is exempt」 and 「NO
//      writes, anywhere … Zero exemptions」. `import type` is flagged
//      DELIBERATELY, in as many words, 「so the swap point stays one file」.
//   2. `src/__tests__/integration/business-isolation.test.ts` — the import
//      ALLOWLIST, which pins `@synqed-kk/client` as an offender by name. It
//      lives OUTSIDE territory, so a Business PR may not edit it.
//   3. `scripts/business/check-business-isolation.mjs` — the CI diff gate: a
//      Business PR that touched either script above would fail for leaving
//      territory at all.
//
// Their own headers name the exit: 「Reconnection is a deliberate PR on Liam's
// word that has to amend this file, and scripts/business/ is CODEOWNER-gated,
// so that PR gets owner review by construction. That is the point.」
//
// SO THIS FILE IS THE SWAP POINT, and it is the whole of it: the shapes below
// are core's own field spellings, the room reads and writes only through them,
// and the reconnect replaces two function bodies. Nothing downstream moves.

/** core `gap_guard_mode`, on the wire. The board keeps a lowercase spelling of
 *  its own (`storeBookingPolicy.gapGuardMode`); this is the enum core states,
 *  so the mapping lives at the seam and nowhere else. */
export type GapGuardMode = 'OFF' | 'STANDARD' | 'STRICT'

/** core `new_client_session_minutes`. ⚠ THE WRITE SIDE IS AN ENUM, not a
 *  number: `SetStoreBookingPolicyInput.new_client_session_minutes?: 60 | 75 | 90`.
 *  ⚖ Liam 9/1 ruled the UI to those three fixed choices rather than widening the
 *  wire — 「3-chip 60/75/90」 — so the mock's free stepper is superseded and this
 *  type is the reason why. A value the wire cannot take must not be offerable. */
export type NewClientMinutes = 60 | 75 | 90

/** The chips, in the order they render. Derived from nothing — this IS the wire
 *  enum, written once, read by the server page (which evaluates the guard at
 *  each) and by the room's chips. */
export const MINUTE_CHOICES: readonly NewClientMinutes[] = [60, 75, 90]

/** What the two live fields are, together — core's own shape, narrowed to the
 *  two this room owns. `StorePolicyClient.get()` returns a superset of it (the
 *  acceptance family: booking_open_days / cutoff_minutes / the cancel terms),
 *  which is a DIFFERENT dial family and a later round's screens. */
export interface LiveStorePolicy {
  gap_guard_mode: GapGuardMode
  new_client_session_minutes: NewClientMinutes
}

/** The write, in core's own input shape. `acting_staff_id` is required by
 *  `SetStoreBookingPolicyInput`, and the `audit` event commits with the change —
 *  so the record of WHO moved a store's 確保 rules is audit-ready by
 *  construction rather than by a caller remembering to log it. */
export interface WriteStorePolicy {
  storeId: string
  changes: Partial<LiveStorePolicy>
  acting_staff_id: string
  audit: { action: string; summary: string }
}

/** THE READ, and the whole of it. The board keeps its own lowercase spelling of
 *  the guard mode (`storeBookingPolicy.gapGuardMode`, whose comment promises
 *  「one mapping line at the reconnect」) — this is that line, and it lives here
 *  so the day `StorePolicyClient.get(storeId)` replaces the fixture, only this
 *  function's body changes and every reader keeps its shape.
 *
 *  A PURE MAPPER, deliberately: it reads no data of its own. The store lens is
 *  the data door's argument (`foundation.test.ts`: 「every read requires the
 *  store lens as its first argument」), so the caller does the reading and hands
 *  the values here — a second door into the fixtures would be exactly the thing
 *  that door exists to prevent.
 *
 *  ⚠ `new_client_session_minutes` is a plain `number` on the READ side of core's
 *  own type and the `60 | 75 | 90` union only on the write. A store whose stored
 *  value is off that ladder (an older row, or one HQ set another way) is
 *  therefore READABLE and not re-offerable, which is the honest reading of
 *  core's own asymmetry: the chips fall back to the nearest choice they can
 *  actually save rather than showing a value pressing them would silently
 *  change. */
export function liveFieldsFrom(board: { gapGuardMode: 'off' | 'standard' | 'strict'; newClientSessionMinutes: number }): LiveStorePolicy {
  return {
    gap_guard_mode: board.gapGuardMode.toUpperCase() as GapGuardMode,
    new_client_session_minutes: nearestChoice(board.newClientSessionMinutes),
  }
}

/** The chip a stored minute value maps onto. Exact match wins; anything else
 *  takes the nearest choice the wire will accept, and ties go to the LONGER one
 *  — a store that had been holding more time for new customers should not be
 *  quietly moved to holding less. */
export function nearestChoice(minutes: number): NewClientMinutes {
  if (!Number.isFinite(minutes)) return MINUTE_CHOICES[MINUTE_CHOICES.length - 1]
  return MINUTE_CHOICES.reduce((best, m) =>
    Math.abs(m - minutes) < Math.abs(best - minutes) || (Math.abs(m - minutes) === Math.abs(best - minutes) && m > best)
      ? m
      : best,
  )
}

/** Why a save cannot happen right now, or `null` when it could. ONE sentence,
 *  because the room prints it on the control and a reader may never be left
 *  guessing which of several reasons applied.
 *
 *  ⚖ 8/21 mistake-proofing — the AUTHORITY half is data, never a literal: the
 *  caller passes the store's OWN manager-level list (`releaseHeldRoles`, the
 *  same one 売上分析's `viewRoles` and 人件費's `laborCostRoles` are drawn from),
 *  so a store that names a different set of people changes its settings and not
 *  this file. `canReleaseHeld` in `today-interactions` is the same predicate for
 *  the same reason; this one adds the sentence, because a refusal the operator
 *  cannot read is a wall without a sign. */
export function saveRefusal(roles: readonly string[], operatorRole: string): string | null {
  if (!roles.includes(operatorRole)) return `保存できるのは${roles.join('・')}です`
  // ⛔ THE PLAY-PHASE FENCE, said out loud on the control rather than hidden.
  // The family's own standing hint for a control whose action has no wire yet
  // (BusinessTopbar's 操作履歴, BusinessSidebar's 事業切替): refuse honestly,
  // never a button that pretends (⚖ L-7).
  return '見本データのため保存できません'
}
