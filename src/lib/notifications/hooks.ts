'use client'

// ─────────────────────────────────────────────────────────────
// Notifications state layer
// ─────────────────────────────────────────────────────────────
// Lifted from spike: src/lib/notifications.ts. Same useSync-
// ExternalStore + localStorage pub/sub pattern so the UX
// behaviors (mark read, mark all read, clear all) work end-
// to-end before Anthony wires Supabase.
//
// CRITICAL DIFFERENCES FROM SPIKE
// -------------------------------
// 1. NO MOCK SEED. The spike imports `notificationMockSeed`
//    (7 pre-baked items) as the initial value. Karute's rule
//    is no fake data — the initial value here is `[]` so the
//    panel renders its empty state until real notifications
//    arrive.
// 2. localStorage is a TRANSITIONAL backend. The spike's
//    inline ANTHONY block (lines 18-62 in the spike) spells
//    out the Supabase swap line-for-line. Preserved verbatim
//    in the comment below so the swap is one PR.
//
// PROD SWAP (ANTHONY) — verbatim from spike
// ------------------------------------------
//   markRead(id):
//     await supabase.from('notifications')
//       .update({ read_at: new Date().toISOString() })
//       .eq('id', id)
//       .eq('recipient_id', user.id)
//
//   markAllRead():
//     await supabase.from('notifications')
//       .update({ read_at: new Date().toISOString() })
//       .eq('recipient_id', user.id)
//       .is('read_at', null)
//
//   clearAll():  // SOFT-HIDE — preserves audit trail
//     await supabase.from('notifications')
//       .update({ dismissed_at: new Date().toISOString() })
//       .eq('recipient_id', user.id)
//       .not('read_at', 'is', null)
//
//   useNotifications():  // realtime subscription
//     supabase.channel('notifications')
//       .on('postgres_changes', {
//         event: 'INSERT', schema: 'public', table: 'notifications',
//         filter: `recipient_id=eq.${user.id}`,
//       }, () => refetch())
//       .subscribe()
//
// Writes come from server-side flows (Stripe webhook → billing
// row; weekly coaching cron → coaching row; booking-server
// insert → booking row). Client never inserts directly.
// ─────────────────────────────────────────────────────────────

import { useCallback, useSyncExternalStore } from 'react'

import type { NotificationItem } from './types'

const STORAGE_KEY = 'synqed-karute-notifications'

// ─────────────────────────────────────────────────────────────
// Pub/sub + parse cache
// ─────────────────────────────────────────────────────────────

const listeners = new Set<() => void>()
function notifyAll() {
  for (const fn of listeners) fn()
}

function subscribe(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

// Module-level constant empty array. `read()` MUST return a stable
// reference when localStorage is empty — React's useSyncExternalStore
// detects "changed" via Object.is, so `return []` (new array per call)
// triggers an infinite re-render loop.
const EMPTY: NotificationItem[] = []

let cachedRaw: string | null = null
let cachedParsed: NotificationItem[] = EMPTY

function read(): NotificationItem[] {
  if (typeof window === 'undefined') return EMPTY
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    cachedRaw = null
    cachedParsed = EMPTY
    return EMPTY
  }
  if (raw === cachedRaw) return cachedParsed
  try {
    const parsed = JSON.parse(raw) as NotificationItem[]
    cachedRaw = raw
    cachedParsed = parsed
    return parsed
  } catch {
    cachedRaw = null
    cachedParsed = EMPTY
    return EMPTY
  }
}

function write(next: NotificationItem[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  notifyAll()
}

// ─────────────────────────────────────────────────────────────
// Reactive read hooks
// ─────────────────────────────────────────────────────────────

export function useNotifications(): NotificationItem[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY)
}

/** Convenience selector for the bell badge. */
export function useUnreadCount(): number {
  const items = useNotifications()
  return items.filter((n) => n.readAt === null).length
}

// ─────────────────────────────────────────────────────────────
// Mutations — match the spike API surface line-for-line so the
// Supabase swap doesn't touch component code.
// ─────────────────────────────────────────────────────────────

export function useNotificationMutations() {
  const markRead = useCallback((id: string) => {
    const current = read()
    const now = new Date().toISOString()
    let touched = false
    const next = current.map((n) => {
      if (n.id === id && n.readAt === null) {
        touched = true
        return { ...n, readAt: now }
      }
      return n
    })
    if (!touched) return
    write(next)
  }, [])

  const markAllRead = useCallback(() => {
    const current = read()
    const now = new Date().toISOString()
    let touched = 0
    const next = current.map((n) => {
      if (n.readAt === null) {
        touched += 1
        return { ...n, readAt: now }
      }
      return n
    })
    if (touched === 0) return
    write(next)
  }, [])

  const clearAll = useCallback(() => {
    // Only removes read items — unread stay so the user doesn't
    // accidentally wipe something they haven't seen.
    const current = read()
    const next = current.filter((n) => n.readAt === null)
    if (next.length === current.length) return
    write(next)
  }, [])

  return { markRead, markAllRead, clearAll }
}
