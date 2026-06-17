'use client'

// ─────────────────────────────────────────────────────────────
// NotificationsProvider — carries the server-computed feed to the
// client bell/panel.
// ─────────────────────────────────────────────────────────────
// The feed is DERIVED on the server (buildNotificationFeed, seeded from the
// (app) layout RSC — same pattern as the dashboard seeding packAlerts into
// PackAlertsCard). This client context just holds the already-computed array
// so useNotifications() / useUnreadCount() can read it without re-fetching.
//
// STABLE REFERENCE: the value object is memoized on the feed identity so the
// useSyncExternalStore snapshot in hooks.ts stays referentially stable across
// renders (the infinite-loop invariant the empty-array EMPTY constant guards).

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { NotificationItem } from './types'

interface NotificationsContextValue {
  feed: NotificationItem[]
  /** Current staff id — the lastSeen scalar in localStorage is keyed by this
   *  so each staff member on a shared device has their own unread baseline. */
  staffId: string | null
}

const NotificationsContext = createContext<NotificationsContextValue | null>(
  null,
)

export function NotificationsProvider({
  feed,
  staffId,
  children,
}: {
  feed: NotificationItem[]
  staffId: string | null
  children: ReactNode
}) {
  // Memoize on the feed/staffId identity so consumers don't see a new object
  // every render. The server feed is stable for the life of the RSC payload.
  const value = useMemo(() => ({ feed, staffId }), [feed, staffId])
  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  )
}

/** Read the provided context. Returns a stable empty feed when the provider
 *  isn't mounted (e.g. a surface outside the (app) layout) so hooks never
 *  crash — they just render the empty state. */
export function useNotificationsContext(): NotificationsContextValue {
  return useContext(NotificationsContext) ?? EMPTY_CONTEXT
}

// Module-level constant so the no-provider fallback is referentially stable
// (same reasoning as hooks.ts EMPTY: a fresh object would break the
// useSyncExternalStore snapshot identity check).
const EMPTY_CONTEXT: NotificationsContextValue = { feed: [], staffId: null }
