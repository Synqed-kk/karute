// Facade fetch core — header assembly + the stranded-pin self-heal, extracted
// from data.vite.ts so jest can pin it (thin/env.ts is the only import.meta
// reader; this module must stay free of it).

import {
  getAccessToken,
  getCurrentSession,
} from '@/lib/auth/mobile/session-store'
import { clearThinActiveStore, getThinActiveStore } from '../chrome/store-pref'

export async function facadeApiFetch(
  toUrl: (path: string) => string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers)
  // App-RELATIVE paths only: toUrl passes absolute URLs through untouched, and
  // the session token must never ride to a foreign origin (latent exfiltration
  // footgun — security lens F-4).
  let lensedStore: string | null = null
  let lensOwner: string | null = null
  if (!/^https?:\/\//i.test(path)) {
    // Bearer from the session-store: SYNC read (never await getSession on the
    // hot path — boot-gate rationale), kept fresh by onAuthStateChange. No
    // token → no header → the facade 401s honestly and the screen shows its
    // message.
    const token = getAccessToken()
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`)
    }
    // The store lens — the web's active-store cookie, as the explicit
    // header the facade clamp expects. Server-side resolveStoreForRequest
    // remains the authority (fails closed on out-of-scope stores).
    const store = getThinActiveStore()
    if (store && !headers.has('store-id')) {
      headers.set('store-id', store)
      lensedStore = store
      // Non-null whenever the pref read succeeded (the pref is keyed by it) —
      // captured so the heal below can prove the response still belongs to
      // the session that attached the lens.
      lensOwner = getCurrentSession()?.user?.id ?? null
    }
  }
  const res = await fetch(toUrl(path), { ...init, headers })

  // Stranded-pin self-heal. A pinned store the clamp now rejects (store
  // deleted/swapped, role restricted later) 403s EVERY facade call — chrome
  // included, so the switcher is gone and the pin survives sign-out by
  // design: no in-app recovery without this. Only when the lens came from
  // the caller's OWN pref (never a caller-set store-id header): drop the pin
  // and retry once unlensed — the server default (assignment/primary
  // semantics) applies, and the clamp stays the authority on the retry.
  // Safe for writes too: the clamp rejects BEFORE any read/write, so nothing
  // happened server-side on the 403.
  if (!lensedStore || res.status !== 403) return res
  // Ownership gate: a response can outlive its user on a shared device (sign
  // out mid-flight, another staff signs in). Healing then would delete the
  // CURRENT user's matching pin and re-send the DEAD session's Bearer — so
  // unless the session that attached the lens is still the one signed in
  // (getCurrentSession: live-or-last-known, null once signed out), return the
  // 403 untouched; it lands in a tree that no longer renders.
  if (getCurrentSession()?.user?.id !== lensOwner) return res
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as { error?: { code?: string } } | null
  if (body?.error?.code !== 'store_forbidden') return res
  clearThinActiveStore(lensedStore)
  // Fresh Headers for the retry — the first instance already rode fetch #1.
  const retryHeaders = new Headers(headers)
  retryHeaders.delete('store-id')
  return fetch(toUrl(path), { ...init, headers: retryHeaders })
}
