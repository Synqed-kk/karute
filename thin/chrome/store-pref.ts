// Active-store preference — the shell's analog of the web's
// karute_active_store cookie. The DataPort sends it as the explicit
// `store-id` header on every facade call; the server clamp
// (resolveStoreForRequest) stays the authority and fails closed on a store
// the caller may not view, so a stale/forged value can never widen scope.
//
// Persisted WITH the user id that pinned it, and read back only for that
// same user (same live-or-last-known session rule as getAccessToken, so the
// lens always belongs to whoever the Bearer belongs to). Shared device: user
// B never inherits user A's lens — for another business the clamp would fail
// closed (store_forbidden) on every screen. Keying instead of clearing on
// sign-out is deliberate: a user's pinned store SURVIVES their own sign-out
// and relaunch, so their next session is lensed from its very first request
// instead of running unlensed until the async chrome fetch reseeds it.

import { getCurrentSession } from '@/lib/auth/mobile/session-store'

const KEY = 'karute-active-store'

function currentUserId(): string | null {
  return getCurrentSession()?.user?.id ?? null
}

export function getThinActiveStore(): string | null {
  const userId = currentUserId()
  if (!userId) return null
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    // Legacy unkeyed values (a bare store id) are treated as ABSENT — they
    // carry no proof of owner, and the seed rewrites them on first chrome.
    const parsed: unknown = JSON.parse(raw)
    const rec = parsed as { u?: unknown; s?: unknown }
    if (rec?.u !== userId || typeof rec.s !== 'string') return null
    return rec.s
  } catch {
    return null
  }
}

export function setThinActiveStore(id: string): void {
  const userId = currentUserId()
  if (!userId) return
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ u: userId, s: id }))
  } catch {
    /* storage unavailable — the server default (assignment/primary) applies */
  }
}
