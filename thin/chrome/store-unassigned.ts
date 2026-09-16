// THE PHONE'S HALF OF THE UNASSIGNED GATE (⚖ Liam 2026-09-16).
//
// The server refuses every facade endpoint for a staff member with no store
// assigned, with a code of its own: `store_unassigned` (403). This is the tiny
// store that remembers having heard it, so the shell can show the SAME honest
// 「担当店舗が未設定です」 screen the web shows instead of a wall of generic
// errors. Without it the phone is the one surface where the ⚖ does not hold.
//
// Keyed by the AUTH USER, not a bare boolean: a salon iPad is shared, and the
// next person to sign in must not inherit the last person's empty screen. A
// sign-out simply stops matching — there is no clearing dance to get wrong.
//
// Module state, not localStorage: the verdict is a server fact re-learned on
// the first refused call of every launch, and persisting it would risk
// stranding somebody a manager has since assigned.

let unassignedFor: string | null = null
const subscribers = new Set<() => void>()

function notify() {
  for (const fn of subscribers) fn()
}

/** The facade answered `store_unassigned` for this user. */
export function markStoreUnassigned(userId: string | null): void {
  if (!userId || unassignedFor === userId) return
  unassignedFor = userId
  notify()
}

/** The user this shell last heard `store_unassigned` for, or null. The snapshot
 *  for `useSyncExternalStore` — a plain string, stable between notifications. */
export function unassignedUserId(): string | null {
  return unassignedFor
}

export function subscribeStoreUnassigned(fn: () => void): () => void {
  subscribers.add(fn)
  return () => {
    subscribers.delete(fn)
  }
}

/** Tests only — module state outlives a jest file's individual cases. */
export function resetStoreUnassigned(): void {
  unassignedFor = null
  notify()
}
