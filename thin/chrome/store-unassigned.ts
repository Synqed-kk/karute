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

/** The server no longer refuses this user — clear their mark. Compare-and-
 *  clear, like `markStoreUnassigned`'s own match: only fires when the marked
 *  user is STILL this one, so a sign-out/switch racing the probe (⚖ Liam
 *  2026-09-16, G-1 fold) can never clear a DIFFERENT user's mark. */
export function clearStoreUnassigned(userId: string | null): void {
  if (!userId || unassignedFor !== userId) return
  unassignedFor = null
  notify()
}

/**
 * Re-probes the server for this user and clears the mark once it no longer
 * refuses. `probe` is a light facade call (the caller's choice — the
 * `/screens/chrome` fetch is fine) that resolves `true` once the server
 * answers normally, `false` on any refusal. This module stays fetch-free on
 * purpose (see the header comment): the probe is INJECTED so a phone's own
 * `facadeApiFetch` funnel can re-mark independently, never imported back here.
 *
 * A network error / thrown probe is the same UNKNOWN `markStoreUnassigned`
 * already refuses to treat as "assigned" — never cleared, only a genuine
 * success does (⚖ reversible-by-default: leaving the mark set costs nothing,
 * clearing it wrongly stands up a shell that will 403 on its very next call).
 */
export async function recheckStoreUnassigned(
  userId: string | null,
  probe: () => Promise<boolean>,
): Promise<void> {
  if (!userId) return
  let ok: boolean
  try {
    ok = await probe()
  } catch {
    ok = false
  }
  if (ok) clearStoreUnassigned(userId)
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
