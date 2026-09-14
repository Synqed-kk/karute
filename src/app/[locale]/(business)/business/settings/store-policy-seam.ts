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

/** core `new_client_session_minutes`. ⚖ D-15 (2026-09-13) — THE WIRE IS A PLAIN
 *  POSITIVE INTEGER, no list, no cap, no step. Core's own WRITE side is still
 *  the 15-value union `SetStoreBookingPolicyInput.new_client_session_minutes?:
 *  60 | 75 | 90` (`@synqed-kk/client` 1.34.0, `types.d.ts:1074`) — that is the
 *  debt CORE-10's correction (PLAN-R3-FREE-DURATIONS.md §6) removes. Until it
 *  lands, the seam accepts any positive integer and the play-phase fixture
 *  stands in for the wire; the reconnect swaps `liveFieldsFrom`'s body and
 *  nothing downstream moves — the whole point of this file. */

/** What the two live fields are, together — core's own shape, narrowed to the
 *  two this room owns. `StorePolicyClient.get()` returns a superset of it (the
 *  acceptance family: booking_open_days / cutoff_minutes / the cancel terms),
 *  which is a DIFFERENT dial family and a later round's screens. */
export interface LiveStorePolicy {
  gap_guard_mode: GapGuardMode
  new_client_session_minutes: number
  /** no core column yet — DRAFT-ANTHONY-ASK-SETTINGS-FIELDS.md ⚡ 9/13 */
  auto_release_before?: AutoReleaseBefore
}

/** ⚖ D-15 — THE ONE HOME OF THE THREE REFUSALS. Every duration in a SYNQED
 *  product is a per-store setting holding ANY positive number of minutes; the
 *  only meaningless values are non-finite, non-integer, ≤ 0, or longer than a
 *  bound the caller derives (never a number this file invents). Every wire
 *  read and every row commit goes through this function.
 *
 *  `ceiling`: `null` for a field with no honest derivation from the store's
 *  hours (a 「minutes before start」/「days ahead」 field — a 1-week cut-off is a
 *  real business's choice); a number for a LENGTH, where the caller has already
 *  derived it from the store's own operating day. */
export function readMinutes(raw: unknown, ceiling: number | null): number | null {
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null
  if (ceiling !== null && n > ceiling) return null
  return n
}

/** The write, in core's own input shape. `acting_staff_id` is required by
 *  `SetStoreBookingPolicyInput`, and the `audit` event commits with the change —
 *  so the record of WHO moved a store's 確保 rules is audit-ready by
 *  construction rather than by a caller remembering to log it.
 *
 *  `changes` mirrors `LiveStorePolicy` by construction (`Partial<…>`), so
 *  `auto_release_before` rides along the day the wire adds it — nothing here
 *  needs its own edit. */
export interface WriteStorePolicy {
  storeId: string
  changes: Partial<LiveStorePolicy>
  acting_staff_id: string
  audit: { action: string; summary: string }
}

/** core's wire spelling for ⚖ D-11's auto-release dial (⚡ CONTRACTS-R2 §1),
 *  widened under ⚖ D-15: `'linked'` (the default) follows `lead_time_min` at
 *  read time; `'never'` = 解除しない; any other value is a digit string of any
 *  positive minute count (`readMinutes` governs which strings are honoured —
 *  no boolean-plus-number pair, one field, one state). */
export type AutoReleaseBefore = 'linked' | 'never' | `${number}`

/** The choices, in render order — the ONE array the 設定 row's options are
 *  built from, so the order has one home. `'30'`/`'120'` are A2's own row
 *  (queued, unchanged in A1); D-15 widens what a typed digit string may say,
 *  not this list. */
export const AUTO_RELEASE_CHOICES: readonly AutoReleaseBefore[] = ['linked', 'never', '30', '120']

/** The board's own type — `TodayScreen`'s `autoReleaseBeforeMin`
 *  (`fixtures-today.ts`), unchanged by this file; the mapping below is the
 *  ONE place it meets the wire. */
export type AutoReleaseBoard = number | 'linked' | null

/** ⚖ D-11 — THE PRODUCT DEFAULT LIVES HERE AND NOWHERE ELSE. A store core has
 *  never written a value for (`undefined`) reads as `'linked'` — never `null`,
 *  never a copied `60` — so a later change to `leadTimeMin` and the release
 *  boundary can never drift apart. Every other value is a direct rename.
 *
 *  This is the reconnect's READ direction (CONTRACTS-R2 §1): it has no
 *  production caller until `StorePolicyClient.get(storeId)` replaces the
 *  fixture read in `page.tsx`, exactly as `gap_guard_mode`'s read has none
 *  today; it exists now so the product default has ONE home before the wire
 *  arrives. */
export function autoReleaseFromWire(w: AutoReleaseBefore | undefined): AutoReleaseBoard {
  if (w === undefined || w === 'linked') return 'linked'
  if (w === 'never') return null
  // An unreadable digit string (never written by this seam, but the wire is
  // not this file's to trust blindly) falls to the product default rather
  // than to a fabricated number.
  return readMinutes(w, null) ?? 'linked'
}

/** The inverse of `autoReleaseFromWire`. ⚖ D-15 (2026-09-13) replaces the old
 *  nearest-of-two rounding with the number itself — any positive integer round-
 *  trips as its own digit string. */
export function autoReleaseToWire(v: AutoReleaseBoard): AutoReleaseBefore {
  if (v === 'linked') return 'linked'
  if (v === null) return 'never'
  return `${v}` as AutoReleaseBefore
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
 *  ⚖ D-15 (2026-09-13) — `new_client_session_minutes` READS as the plain
 *  `number` it always was on core's read side (`types.d.ts:1060`); nothing is
 *  rounded to a nearby choice any more. The WRITE side stays the 15-value union
 *  until CORE-10's correction lands (the comment above this interface), so a
 *  store whose value the wire cannot yet re-accept is still honestly readable
 *  — this function never refuses a read. */
export function liveFieldsFrom(board: { gapGuardMode: 'off' | 'standard' | 'strict'; newClientSessionMinutes: number }): LiveStorePolicy {
  return {
    gap_guard_mode: board.gapGuardMode.toUpperCase() as GapGuardMode,
    new_client_session_minutes: board.newClientSessionMinutes,
  }
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
  //
  // ⚖ 9/1 JP native pass (JP2) — AND IT SAYS WHEN. A refusal with no when-clause
  // reads as a permanent property of the screen; the house pattern names the
  // moment the control comes alive, so the manager knows they are waiting rather
  // than blocked.
  return '見本データのため保存できません。実データの接続後に有効になります。'
}

/** ⚖ 9/1 (fix round 1 F4) — THE THIRD STATE, AND THE ONE PLACE IT IS NOT THROWN
 *  AWAY. `gap_guard_mode` is 'OFF' | 'STANDARD' | 'STRICT'; the ENGINE has two
 *  modes and no third (`createGapGuard`: 'standard' | 'strict'), so a room that
 *  asked it about an OFF store would have to invent a state for it — and the
 *  first cut of this room did exactly that, with `strict: mode === 'STRICT'`,
 *  which answers an off store as though it were running standard warnings.
 *
 *  OFF is answered BEFORE the engine instead: `null` — there is no verdict to
 *  preview, so the preview draws no card at all and the dial shows neither of
 *  its two positions. That is the store's own truth rather than a fabricated
 *  one, and the day the wire reconnects an OFF store stays OFF unless the
 *  operator moves the dial on purpose. */
export const sceneKeyFor = (mode: GapGuardMode, minutes: number): string | null =>
  mode === 'OFF' ? null : `${mode === 'STRICT' ? 'strict' : 'standard'}:${minutes}`
