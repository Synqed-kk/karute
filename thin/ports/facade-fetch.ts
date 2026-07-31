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
  let authAttached = false
  if (!/^https?:\/\//i.test(path)) {
    // Bearer from the session-store: SYNC read (never await getSession on the
    // hot path — boot-gate rationale), kept fresh by onAuthStateChange. No
    // token → no header → the facade 401s honestly and the screen shows its
    // message.
    const token = getAccessToken()
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`)
      authAttached = true
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
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as { error?: { code?: string; reason?: string } } | null
  // Heal ONLY on the clamp's own VERDICT (reason: 'store_header' = "the
  // store-id you sent is un-servable for you"). store_forbidden is also
  // thrown WITHOUT the marker for two classes that must never heal: resource
  // ownership (karute save: "this booking belongs to a store you are not
  // assigned to" — healing would wipe a multi-store staff's deliberate pin
  // over one bad record reference and silently re-lens them onto assigned[0],
  // the wrong branch) and the clamp's fail-CLOSED lookup error (transient
  // blip — the pin may be fine, and an unlensed retry re-hits the same
  // lookup, so healing could never help).
  if (body?.error?.code !== 'store_forbidden') return res
  if (body?.error?.reason !== 'store_header') return res
  // Ownership gate — checked AFTER the last await so it holds at decision
  // time (a gate before the json() await leaves a suspension window a session
  // switch can slip through). A response can outlive its user on a shared
  // device (sign out mid-flight, another staff signs in); healing then would
  // delete the CURRENT user's matching pin and re-send the DEAD session's
  // Bearer — so unless the session that attached the lens is still the one
  // signed in (getCurrentSession: live-or-last-known, null once signed out),
  // return the 403 untouched; it lands in a tree that no longer renders.
  if (getCurrentSession()?.user?.id !== lensOwner) return res
  clearThinActiveStore(lensedStore)
  // Mid-session convergence (fleet round 2, P1): the heal fixes THIS request,
  // but a 'ready' chrome keeps displaying the dead store until relaunch while
  // every read runs unlensed — and a walk-in save could write store_id null.
  // Boot-time heals converge through the chrome fetch itself; mid-session
  // heals need this nudge (re-fetch → seed re-pins → screens re-scope).
  // Dynamic import: keeps this module's static graph jest-lean and cycle-proof.
  // Fire-and-forget — recovery must never delay the retry.
  void import('../chrome/chrome-store')
    .then((m) => m.resyncChromeAfterHeal())
    .catch(() => {})
  // Fresh Headers for the retry — the first instance already rode fetch #1.
  const retryHeaders = new Headers(headers)
  // Ride the CURRENT lens state, not "always unlensed" (fleet round 2 — two
  // lenses independently): a concurrent heal's re-seed or a mid-flight
  // switcher tap can have established a fresh valid pin while this response
  // was in flight; stripping it would render this one response mis-scoped.
  // Post-clear the pin can only be absent or a DIFFERENT value than the one
  // that failed (compare-and-clear), so re-403 loops stay impossible.
  const pinNow = getThinActiveStore()
  if (pinNow) retryHeaders.set('store-id', pinNow)
  else retryHeaders.delete('store-id')
  // Re-read the Bearer we attached (never a caller-set one): a TOKEN_REFRESHED
  // landing while fetch #1 was in flight rotated the session token, and the
  // recovery retry should ride the CURRENT credential, not the captured one.
  // The ownership gate above proves it is still the same user's session.
  const freshToken = authAttached ? getAccessToken() : null
  if (freshToken) retryHeaders.set('Authorization', `Bearer ${freshToken}`)
  return fetch(toUrl(path), { ...init, headers: retryHeaders })
}
