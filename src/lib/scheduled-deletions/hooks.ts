'use client'

// ─────────────────────────────────────────────────────────────
// Scheduled deletions — state layer (localStorage scaffold)
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: src/lib/scheduled-deletions.ts
// APPI-aligned 30-day soft-delete window. When an owner deletes
// a customer:
//   - `deleted_at` set (soft delete)
//   - `scheduled_hard_deletes` row inserted with scheduled_for +30d
//   - Within the window: banner shown, destructive actions
//     (new karute, recording, photo upload) blocked
//   - Undo restores within the window
//   - After the window: cron job hard-deletes the record + cascades
//
// PROD SWAP (ANTHONY)
//
//   // schedule:
//   await supabase.from('customers')
//     .update({ deleted_at: new Date().toISOString() })
//     .eq('id', customerId)
//   await supabase.from('scheduled_hard_deletes').insert({
//     entity_type: 'customer',
//     entity_id: customerId,
//     scheduled_for: addDays(now, 30),
//     cancelable_until: addDays(now, 30),
//   })
//   await logAudit({ category: 'privacy',
//                    action: 'privacy.customer_delete_scheduled', ... })
//
//   // undo (within window only):
//   await supabase.from('customers')
//     .update({ deleted_at: null })
//     .eq('id', customerId)
//   await supabase.from('scheduled_hard_deletes')
//     .update({ canceled_at: new Date().toISOString() })
//     .eq('entity_id', customerId).is('canceled_at', null)
//   await logAudit({ action: 'privacy.customer_delete_canceled', ... })
//
//   // cron (nightly):
//   select * from scheduled_hard_deletes
//   where scheduled_for <= now() and canceled_at is null
//   // cascade hard delete: customers + karute + memory + photos + recordings

import { useCallback, useSyncExternalStore } from 'react'

import {
  SCHEDULED_DELETION_WINDOW_DAYS,
  type ScheduledDeletion,
  type ScheduledDeletionStatus,
} from './types'

const STORAGE_KEY = 'synqed-karute-scheduled-deletions'

// ─── Pub/sub ───────────────────────────────────────────────────

const listeners = new Set<() => void>()
function notify() {
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

// Stable empty reference — useSyncExternalStore compares snapshots
// via Object.is, so returning a fresh `{}` per call infinite-loops.
const EMPTY_MAP: Record<string, ScheduledDeletion> = Object.freeze(
  {},
) as Record<string, ScheduledDeletion>

let cachedRaw: string | null = null
let cachedParsed: Record<string, ScheduledDeletion> = EMPTY_MAP

function readAll(): Record<string, ScheduledDeletion> {
  if (typeof window === 'undefined') return EMPTY_MAP
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    cachedRaw = null
    cachedParsed = EMPTY_MAP
    return EMPTY_MAP
  }
  if (raw === cachedRaw) return cachedParsed
  try {
    const parsed = JSON.parse(raw) as Record<string, ScheduledDeletion>
    cachedRaw = raw
    cachedParsed = parsed
    return parsed
  } catch {
    cachedRaw = null
    cachedParsed = EMPTY_MAP
    return EMPTY_MAP
  }
}

function writeAll(next: Record<string, ScheduledDeletion>) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  notify()
}

function computeStatus(
  scheduled: ScheduledDeletion | undefined,
): ScheduledDeletionStatus {
  if (!scheduled) {
    return {
      isScheduled: false,
      scheduledAt: null,
      daysRemaining: null,
      hardDeleteAt: null,
    }
  }
  const scheduledMs = new Date(scheduled.scheduledAt).getTime()
  const hardDeleteMs =
    scheduledMs + SCHEDULED_DELETION_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const msRemaining = hardDeleteMs - Date.now()
  const daysRemaining = Math.max(
    0,
    Math.ceil(msRemaining / (24 * 60 * 60 * 1000)),
  )
  return {
    isScheduled: true,
    scheduledAt: scheduled.scheduledAt,
    daysRemaining,
    hardDeleteAt: new Date(hardDeleteMs).toISOString(),
  }
}

// ─── Hooks ─────────────────────────────────────────────────────

/** Read-only status for one customer. Reactive across tabs. */
export function useCustomerDeletionStatus(
  customerId: string,
): ScheduledDeletionStatus {
  const all = useSyncExternalStore(subscribe, readAll, () => EMPTY_MAP)
  return computeStatus(all[customerId])
}

/** Mutation hook — schedule + undo. */
export function useScheduledDeletions() {
  const all = useSyncExternalStore(subscribe, readAll, () => EMPTY_MAP)

  const scheduleDeletion = useCallback(
    (customerId: string, scheduledBy = 'current-staff') => {
      const next = { ...readAll() }
      next[customerId] = {
        customerId,
        scheduledAt: new Date().toISOString(),
        scheduledBy,
      }
      writeAll(next)
    },
    [],
  )

  const cancelDeletion = useCallback((customerId: string) => {
    const next = { ...readAll() }
    delete next[customerId]
    writeAll(next)
  }, [])

  return {
    all,
    scheduleDeletion,
    cancelDeletion,
  }
}

export { SCHEDULED_DELETION_WINDOW_DAYS }
