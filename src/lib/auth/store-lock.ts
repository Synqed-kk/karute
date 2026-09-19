// THE PURE STORE-LOCK PREDICATES — the by-id WRITE rule and the predicate it
// rests on, in a module with NO session imports of any kind.
//
// WHY ITS OWN FILE (⚖ Liam 2026-09-16, fold round). These three symbols used to
// live in src/lib/auth/store-scope.ts, and every write door that reached them
// dragged that module's graph along: store-scope.ts imports @/actions/stores,
// which reads `cookies()`. Three of those doors —
// src/lib/appointments/mutations.ts, src/lib/recording/discard.ts and
// src/lib/settings/recording-autostart.ts — are loaded by BEARER-ONLY facade
// routes, whose own clamp says in so many words that "this path must never
// touch the cookie session" (src/lib/app-api/store-clamp.ts). Nothing called a
// cookie at runtime, but a Bearer route had no business loading the module that
// can, and one test mock had already noticed (store-scope mints an
// unstable_cache at load).
//
// So: the RULE lives here, pure, and the RESOLVERS stay where they are —
// resolveStoreScope (cookie session, store-scope.ts) and resolveStoreForRequest
// (Bearer, app-api/store-clamp.ts) each hand their answer to this one
// predicate. Same split store-clamp.ts already keeps for the same reason.
//
// The ONLY import is AppApiError, which is the classified-error contract and
// costs node:crypto and nothing else. recordEditableInScope, the screen twin,
// sits here too and for the same reason: the facade screens route reads it.

import { AppApiError } from '@/lib/app-api/errors'

/**
 * Does a store-scoped RECORD (its own `store_id`, not a roster the actor is
 * picking from) fall outside the actor's clamp? Same predicate class as
 * customerLensFor/menuStoresForScope (store-scope.ts) — pure, no I/O. Born as karute
 * reassign's R3-1 source-store clamp (src/actions/karute.ts,
 * PACKET-F4-FIXROUND3-2026-09-02.md): a clamped actor must be refused a
 * WRITE (or a roster/picker) keyed off a record that itself sits in a store
 * they're not assigned to, independent of whatever destination the caller
 * supplied. Reused by that reassign core + roster AND the reassign-options
 * facade route (both need the identical refusal).
 *
 *   - `viewAll: true`          → false (never clamped). ponytail: dead in
 *     practice — every caller's scope already carries `allowedStoreIds:
 *     null` whenever `viewAll` is true (resolveStoreScope's own contract;
 *     callers that hand-build the scope object, e.g. the facade route,
 *     preserve it), so the `!allowedStoreIds` arm below already returns
 *     false first. Kept anyway as an invariant backstop — same house
 *     pattern as customerLensFor's dead `null` arm (store-scope.ts): if that
 *     pairing ever broke, this is the line that keeps a viewAll actor from
 *     being wrongly clamped.
 *   - `allowedStoreIds: null`  → false — floating actor, unclamped.
 *   - `record.store_id: null`  → true — R5-1 (Greptile #759 round-2
 *     adjudication, 2026-08-23): a clamped actor's OWN membership in a
 *     legacy unlabeled record is unprovable, so the write/roster proof
 *     fails closed on it. This is deliberately STRICTER than the read
 *     plane: resolveKaruteStoreId's appointment clamp (also in
 *     src/actions/karute.ts) keeps null-store records unclamped for
 *     reads — the 全店舗/null-store convention still holds there. The
 *     write plane is allowed to be narrower than the read plane
 *     (established precedent: the menus write clamp, `records.delete` not
 *     being universal) and no ⚖ ruling requires clamped staff to be able
 *     to reassign an unlabeled record — every DEFAULT `records.reassign`
 *     holder (owner/manager/senior presets) also holds `stores.viewAll`,
 *     so this arm only bites custom-granted clamped staff.
 *   - otherwise                → true iff the record's store isn't in
 *     `allowedStoreIds`.
 *
 * A `degraded` scope is NOT handled here — every caller refuses on
 * `degraded` before ever reaching this predicate, so it takes only the two
 * fields it needs.
 */
export function sourceStoreOutOfScope(
  record: { store_id: string | null },
  scope: { viewAll: boolean; allowedStoreIds: string[] | null },
): boolean {
  if (scope.viewAll) return false
  if (!scope.allowedStoreIds) return false // floating — unclamped
  return record.store_id === null || !scope.allowedStoreIds.includes(record.store_id)
}

/** What a WRITE door needs to know about its actor to answer
 *  {@link ensureRecordStoreInScope}. Both transports already produce it:
 *  web's StoreScope (resolveStoreScope) and the facade's ClampedStore
 *  (resolveStoreForRequest) are each assignable as-is — `viewAll` and
 *  `degraded` are optional because the facade clamp carries neither
 *  (it encodes viewAll as `allowedStoreIds: null` and THROWS on a failed
 *  assignment lookup before a caller ever holds a scope). */
export interface RecordStoreScope {
  viewAll?: boolean
  allowedStoreIds: string[] | null
  degraded?: boolean
}

/**
 * THE WRITE-SIDE STORE LOCK — refuse a by-id write against a record that sits
 * outside the actor's store assignment (⚖ Liam 2026-09-16: a staff member of
 * one store must never be able to change another store's records, even by
 * direct call, even when the screen hides them).
 *
 * The record-side half of ensureReassignStoreScope (src/actions/karute.ts),
 * lifted here so every by-id write door spells the refusal ONCE: the predicate
 * is sourceStoreOutOfScope just above, and the two error shapes are the ones
 * that door already shipped —
 *
 *   - `degraded` (a clamped actor whose own staff_stores lookup FAILED, web's
 *     F-A convention) → `store_forbidden`, fail-closed: a scope we cannot read
 *     vouches for nothing, and it is never widened into "every store";
 *   - out of scope → `not_found`, with the message the CALLER supplies so the
 *     refusal is byte-identical to that door's own missing-id answer. That is
 *     the whole point (R9-2, existence-oracle class): a distinct "you may not
 *     touch that one" lets a clamped actor probe ids for existence across the
 *     business by error shape alone.
 *
 * viewAll and floating actors (`allowedStoreIds: null`) pass through
 * untouched; a legacy `store_id: null` record is REFUSED for a clamped actor
 * (sourceStoreOutOfScope's R5-1 arm — an unprovable membership fails closed,
 * and the write plane is allowed to be narrower than the read plane).
 */
/** The refusal a caller hears when their OWN store assignment could not be read
 *  (web's `degraded` convention). Exported so the doors that have to spell this
 *  answer without a record in hand — createAppointment's web-side placement
 *  refusal (⚖ FRESH-EYES-P1B F4) — give the booking dialog ONE answer for one
 *  condition, instead of a second wording for the same blip. No new import: this
 *  module's purity is the reason every transport can reach it. */
export const STORE_SCOPE_UNVERIFIED = 'could not verify your store assignment (fail-closed)'

export function ensureRecordStoreInScope(
  record: { store_id: string | null },
  scope: RecordStoreScope,
  notFoundMessage: string,
): void {
  if (scope.viewAll) return
  if (scope.degraded) {
    throw new AppApiError('store_forbidden', STORE_SCOPE_UNVERIFIED)
  }
  if (sourceStoreOutOfScope(record, { viewAll: false, allowedStoreIds: scope.allowedStoreIds })) {
    throw new AppApiError('not_found', notFoundMessage)
  }
}

/**
 * THE UI TWIN of {@link ensureRecordStoreInScope} — may this viewer see the
 * EDIT controls on this record? Hide, never show-and-refuse (⚖ Liam
 * 2026-09-16): the server refusal above is the wall, and a button that only
 * ever produces it is a lie on the screen.
 *
 * One expression for both transports, so the screen and the server cannot
 * disagree about one record. Fails CLOSED on a scope that could not be read
 * at all (`null`) or a degraded one — the same direction the write door takes,
 * so the worst a blip can do is hide a control the viewer would have been
 * allowed, never show one they would be refused.
 */
export function recordEditableInScope(
  record: { store_id: string | null },
  scope: RecordStoreScope | null,
): boolean {
  if (!scope || scope.degraded) return false
  if (scope.viewAll) return true
  return !sourceStoreOutOfScope(record, { viewAll: false, allowedStoreIds: scope.allowedStoreIds })
}
