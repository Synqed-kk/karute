'use client'

// ─────────────────────────────────────────────────────────────
// Notifications state layer — v1 (real derived feed)
// ─────────────────────────────────────────────────────────────
// The feed is now DERIVED on the server (buildNotificationFeed) and delivered
// via NotificationsProvider (context.tsx). This layer:
//   • useNotifications()  → the server feed (from context), stable reference.
//   • useUnreadCount()    → # of NEW booking items since the staff member last
//                           saw the panel (a single per-staff lastSeen scalar
//                           in localStorage). ONLY category==='booking' drives
//                           the badge — digests / roll-ups are standing info.
//   • useNotificationMutations() → markAllRead / close → setLastSeen(now).
//
// WHY A SINGLE lastSeen SCALAR (not per-item read flags):
//   The feed is derived & ephemeral — items don't have stable server ids we
//   can persist read_at against, and a derived item can vanish/reappear as the
//   underlying data shifts. A monotonic "last time this staff opened the bell"
//   timestamp is the honest unread model for a derived feed: anything newer
//   than it is unread. (When Anthony lands a real notifications table with
//   per-row read_at, this swaps back to per-item — the panel API is unchanged.)
//
// useSyncExternalStore INVARIANT (preserved): read() MUST return a stable
// reference when there's nothing to report, or React's Object.is snapshot
// check loops forever. The lastSeen store's getSnapshot returns a primitive
// (string|null) so it's inherently stable; the feed comes from context (a
// memoized array), so it's stable too.
//
// PHASE-2 / PROD SWAP (ANTHONY): when the notifications table ships, point
// useNotifications() at a realtime subscription + per-row read_at, and replace
// the lastSeen scalar with a server-side read cursor. The component surface
// (markRead/markAllRead/clearAll) is intentionally unchanged so the swap is
// one PR.

import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { useNotificationsContext } from './context'
import type { NotificationItem } from './types'

// Per-staff key: each staff member on a shared salon device gets their own
// unread baseline. Falls back to a shared key when there's no staff id.
const LAST_SEEN_PREFIX = 'synqed-karute-notifications-last-seen'
function lastSeenKey(staffId: string | null): string {
  return staffId ? `${LAST_SEEN_PREFIX}:${staffId}` : LAST_SEEN_PREFIX
}

/** Badge cap — staff don't need an exact count past "a lot". */
const BADGE_CAP_LABEL = '9+'
const BADGE_CAP = 9

// ─────────────────────────────────────────────────────────────
// lastSeen store — a single localStorage scalar behind useSyncExternalStore
// so the badge reacts the instant markAllRead / panel-close writes it.
// ─────────────────────────────────────────────────────────────

const listeners = new Set<() => void>()
function notifyAll() {
  for (const fn of listeners) fn()
}

function subscribe(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith(LAST_SEEN_PREFIX)) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

function readLastSeen(staffId: string | null): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(lastSeenKey(staffId))
  } catch {
    return null
  }
}

function writeLastSeen(staffId: string | null, iso: string) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(lastSeenKey(staffId), iso)
  } catch {
    // Storage unavailable (private mode / quota) — degrade silently; the badge
    // just won't persist the "seen" state across reloads.
  }
  notifyAll()
}

/** Reactive read of the per-staff lastSeen scalar. Snapshot is a primitive
 *  (string|null), so it's referentially stable by construction — no infinite
 *  loop. SSR returns null (server has no localStorage). */
function useLastSeen(staffId: string | null): string | null {
  return useSyncExternalStore(
    subscribe,
    () => readLastSeen(staffId),
    () => null,
  )
}

// ─────────────────────────────────────────────────────────────
// Public hooks
// ─────────────────────────────────────────────────────────────

/** The server-derived feed. Stable reference (memoized array in context). */
export function useNotifications(): NotificationItem[] {
  return useNotificationsContext().feed
}

/** Unread badge count = # of booking items created AFTER the staff member last
 *  saw the panel. Booking is the only badge-driving category; standing digests
 *  / roll-ups never raise the badge. */
export function useUnreadCount(): number {
  const { feed, staffId } = useNotificationsContext()
  const lastSeen = useLastSeen(staffId)
  return useMemo(() => {
    const since = lastSeen ? new Date(lastSeen).getTime() : 0
    let count = 0
    for (const n of feed) {
      if (n.category !== 'booking') continue
      if (new Date(n.createdAt).getTime() > since) count += 1
    }
    return count
  }, [feed, lastSeen])
}

/** Format the badge with the "9+" cap. Exposed for the bell components so the
 *  cap lives in one place. */
export function formatUnreadBadge(count: number): string {
  return count > BADGE_CAP ? BADGE_CAP_LABEL : String(count)
}

/** The set of item ids the badge currently counts (new booking items since
 *  lastSeen). The panel uses this to render the per-row unread dot/weight so
 *  the row styling matches the badge exactly — no second read model. */
export function useUnreadIds(): Set<string> {
  const { feed, staffId } = useNotificationsContext()
  const lastSeen = useLastSeen(staffId)
  return useMemo(() => {
    const since = lastSeen ? new Date(lastSeen).getTime() : 0
    const ids = new Set<string>()
    for (const n of feed) {
      if (n.category !== 'booking') continue
      if (new Date(n.createdAt).getTime() > since) ids.add(n.id)
    }
    return ids
  }, [feed, lastSeen])
}

// ─────────────────────────────────────────────────────────────
// Mutations — same surface the panel already calls (markRead / markAllRead /
// clearAll). For the derived feed, "read" means "advance the lastSeen cursor".
// markRead / clearAll are no-op-safe (a derived item has no per-row read
// state); they stay so the panel compiles + the prod swap is drop-in.
// ─────────────────────────────────────────────────────────────

export function useNotificationMutations() {
  const { staffId } = useNotificationsContext()

  const setLastSeen = useCallback(
    (iso: string = new Date().toISOString()) => {
      writeLastSeen(staffId, iso)
    },
    [staffId],
  )

  // Opening the panel does NOT auto-clear (intentional — see panel header).
  // markAllRead (and panel close, which calls setLastSeen) advances the cursor.
  const markAllRead = useCallback(() => {
    writeLastSeen(staffId, new Date().toISOString())
  }, [staffId])

  // No-op-safe in the derived model: there's no per-row read_at to flip. Kept
  // so NotificationsPanel's onClick compiles unchanged; the prod table swap
  // gives this real behavior.
  const markRead = useCallback((_id: string) => {
    // intentionally no-op for the derived feed
  }, [])

  // No-op-safe: nothing to remove from a derived feed (it reflects live data).
  // Kept for API parity with the prod swap.
  const clearAll = useCallback(() => {
    // intentionally no-op for the derived feed
  }, [])

  return { markRead, markAllRead, clearAll, setLastSeen }
}
