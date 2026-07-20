// Active-store preference — the shell's analog of the web's
// karute_active_store cookie. The DataPort sends it as the explicit
// `store-id` header on every facade call; the server clamp
// (resolveStoreForRequest) stays the authority and fails closed on a store
// the caller may not view, so a stale/forged value can never widen scope.
//
// Persisted PER USER ID and read back only for the current one (same
// live-or-last-known session rule as getAccessToken, so the lens always
// belongs to whoever the Bearer belongs to). Shared device: user B never
// inherits user A's lens — for another business the clamp would fail closed
// (store_forbidden) on every screen — and B pinning a store does not evict
// A's, so each staff on a salon's shared iPad returns to their own lens on
// their first request instead of running unlensed until chrome reseeds.
//
// Keying instead of clearing on sign-out is deliberate for the same reason:
// a pinned store must survive its owner's sign-out and app relaunch.

import { getCurrentSession } from '@/lib/auth/mobile/session-store'

const KEY = 'karute-active-store'

function currentUserId(): string | null {
  return getCurrentSession()?.user?.id ?? null
}

// ponytail: unbounded map — one short id pair per user who has ever pinned on
// this device (a shared salon iPad is tens of staff, ~50 B each). Add an LRU
// cap if a device ever accumulates enough to matter.
function readMap(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(KEY)
    // Legacy single-value shape (a bare store id, pre-#568) is treated as
    // ABSENT — it carries no proof of owner, and the seed rewrites it on the
    // first chrome fetch.
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {}
  } catch {
    return {}
  }
}

export function getThinActiveStore(): string | null {
  const userId = currentUserId()
  if (!userId) return null
  const value = readMap()[userId]
  return typeof value === 'string' ? value : null
}

export function setThinActiveStore(id: string): void {
  const userId = currentUserId()
  if (!userId) return
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...readMap(), [userId]: id }))
  } catch {
    /* storage unavailable — the server default (assignment/primary) applies */
  }
}
