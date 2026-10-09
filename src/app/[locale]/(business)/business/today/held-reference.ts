// 今日の運営 — THE SETTLED HELD SET, the allocator's reference (DECISIONS.md R4
// · R8e as amended by the lead, S4 PR-B).
//
// Session-scoped. Never persisted. Empty after reload. Key = `${storeId}|${date}`.
// A remount within the session (a tab switch and back) reads the same entry,
// so the board does not hop on return with no action.
//
// SERVER GUARD: this module may load during SSR, where a module map is shared
// across requests and tenants. On the server (typeof window === 'undefined')
// heldReferenceFor returns undefined and settleHeldReference is a no-op.
//
// Written ONLY from the un-staged answer, in an effect after that answer
// exists (TodayScreen). A staged answer never settles.

import { heldIdOf, type HonestHeld } from './honest-held'

const store = new Map<string, ReadonlySet<string>>()
const keyOf = (storeId: string, date: string) => `${storeId}|${date}`
const onServer = () => typeof window === 'undefined'

export function heldReferenceFor(storeId: string, date: string): ReadonlySet<string> | undefined {
  if (onServer()) return undefined
  return store.get(keyOf(storeId, date))
}

export function settleHeldReference(storeId: string, date: string, ids: ReadonlySet<string>): void {
  if (onServer()) return
  store.set(keyOf(storeId, date), ids)
}

/** Tests only: the reload. */
export function resetHeldReferenceForTests(): void {
  store.clear()
}

/** honest-held's own identity per held window — one spelling (`heldIdOf`). */
export function identitiesOf(h: HonestHeld): ReadonlySet<string> {
  return new Set(h.byLane.flatMap((l) => l.held.map((s) => heldIdOf(l.laneKey, s.windowStart))))
}
