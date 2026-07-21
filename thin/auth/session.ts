// Thin-shell binding for packet-01's mobile auth module (packet-09 F-5 cause 1
// — the module existed, tested, with zero importers; this file is the wiring).
//
// Composition only: config from the validated thin env, concrete storage +
// app-state ports, session state routed into the session-store the AuthGate
// and DataPort read. All auth LOGIC stays in src/lib/auth/mobile/*.

import { createMobileAuth, type MobileAuth } from '@/lib/auth/mobile/client-session'
import { loadAuthClientConfig } from '@/lib/auth/mobile/config'
import type { SupportsStorage } from '@/lib/auth/mobile/secure-storage'
import {
  applyTokenRotation,
  currentGeneration,
  getCurrentSession,
  setSessionState,
} from '@/lib/auth/mobile/session-store'
import { wipeSessionVault } from '@/lib/karute/logout-wipe'
import { getThinEnv } from '../env'

// localStorage-backed session storage. WKWebView localStorage survives
// force-quit and cold launch (auth spike + packet-10 W3, both proven on
// device), so the session outlives restarts exactly like the web's.
// ponytail: at-rest UNENCRYPTED — the Keychain adapter in secure-storage.ts is
// the named upgrade, blocked on the npm token for the native plugin (Anthony).
const localStorageSessionStore: SupportsStorage = {
  getItem: async (key) => window.localStorage.getItem(key),
  setItem: async (key, value) => {
    window.localStorage.setItem(key, value)
  },
  removeItem: async (key) => {
    window.localStorage.removeItem(key)
  },
}

let auth: MobileAuth | undefined

export function getMobileAuth(): MobileAuth {
  if (auth) return auth
  const env = getThinEnv()
  auth = createMobileAuth({
    config: loadAuthClientConfig({
      AUTH_SUPABASE_URL: env.supabaseUrl,
      AUTH_SUPABASE_ANON_KEY: env.supabaseAnonKey,
    }),
    storage: localStorageSessionStore,
    // No @capacitor/app in the binary (npm token dead): visibilitychange fires
    // on every WKWebView foreground — the same signal, no plugin needed.
    // Listener is deliberately never removed: this singleton lives for the
    // whole page lifetime (bindLifecycle runs once from the entry), and the
    // coordinator single-flights, so even a duplicate bind coalesces.
    // ponytail: swap to App.appStateChange when the plugin can be installed.
    appState: {
      onActive: (cb) => {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') cb()
        })
      },
    },
    onSessionState: setSessionState,
    // Generation fence (packet 14 P1-b): lets the background-resume coordinator
    // drop a re-enable that raced a sign-out/sign-in instead of resurrecting the
    // outgoing session.
    generation: currentGeneration,
    // onQuiesce deliberately unwired: the thin bundle has no global query
    // cache to pause, and in-flight ScreenBoundary fetches self-resolve via
    // their `alive` flag — there is nothing to quiesce yet.
    // The one logout wipe (packet-10): recorder/pipeline singletons + takes +
    // draft — routed here exactly as REV-48 planned for the packet-01 wiring.
    // uid comes threaded from signOut()'s own pre-purge capture now (packet
    // 13) rather than this module's session-store read.
    purgeLocalCaches: (uid) => wipeSessionVault({ uid }),
  })
  // Token rotation truth: auth-js emits SIGNED_IN / TOKEN_REFRESHED with the
  // fresh session — mirror into the store so the DataPort's Bearer never goes
  // stale. A null session flips the store ONLY on an explicit SIGNED_OUT;
  // anything else (INITIAL_SESSION pre-boot, transient nulls) is the boot
  // gate's call — a network hiccup must never look like a logout. The
  // subscription handle is deliberately dropped: exactly one subscription per
  // app lifetime (this module is a cached singleton), never torn down.
  //
  // A within-epoch TOKEN_REFRESHED / USER_UPDATED goes through
  // applyTokenRotation, which mirrors the fresh token IFF the store still holds
  // THIS user's session (packet 15 P1). It drops the write on a signed-out or
  // other-user store, so a stale in-flight refresh — e.g. one that resolves
  // AFTER the sign-out flip — cannot resurrect the signed-out session or
  // cross-apply it under the next staff member on a shared device. The rule is
  // by IDENTITY, not by generation, so it cannot desync against the
  // authoritative writes (boot/resume settles, LoginScreen's belt-and-braces)
  // that the removed epoch fence miscounted.
  const client = auth.auth
  client.onAuthStateChange((event, session) => {
    if (session) {
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        applyTokenRotation(session)
      } else {
        // SIGNED_IN / INITIAL_SESSION / PASSWORD_RECOVERY — authoritative.
        setSessionState({ status: 'signed-in', session })
        if (event === 'SIGNED_IN') {
          // Re-arm autorefresh: the sign-out path calls auth.stopAutoRefresh(),
          // which also removes auth-js's managed visibility callback. On a
          // shared iPad the next staff member signs in on the SAME client with
          // NO page reload, so nothing would otherwise restart the ticker — a
          // long continuous-foreground recording would then cross token expiry
          // with no refresh. startAutoRefresh restores it (GoTrueClient.js:2357).
          // INITIAL_SESSION is excluded: cold boot already has the ticker
          // running from auth-js _initialize.
          void client.startAutoRefresh()
        }
      }
    } else if (event === 'SIGNED_OUT') {
      // Capture the OUTGOING uid SYNCHRONOUSLY, before nulling the store
      // below (F3, packet 12 fix batch): clearOwnTakes' currentUserId()
      // reads FROM this store on the thin path, so it would otherwise
      // resolve null for every SERVER-driven sign-out (failed refresh,
      // password reset, admin revoke) — silently no-op'ing and leaving the
      // leaving staff member's takes on the shared device.
      const outgoingUid = getCurrentSession()?.user?.id
      setSessionState({ status: 'signed-out' })
      // This branch fires ONLY on a SERVER-driven session death: auth-js emits
      // SIGNED_OUT from _removeSession (a non-retryable failed refresh, admin
      // revoke, or password reset). The in-app sign-out BUTTON does NOT reach
      // here — getMobileAuth().signOut() never calls auth.signOut() (it would
      // re-read the storage it just purged), so no SIGNED_OUT is emitted; that
      // path already wipes twice (ProfilePageView's pre-wipe + signOutAndPurge's
      // composed purgeLocalCaches). This listener is the catch-all for the
      // no-button case: without it a server-driven death would never purge, and
      // the previous staff's live recorder/pipeline singletons (audio,
      // transcript) would stay armed for the next sign-in on a shared device
      // (packet-10 leak class). Best-effort by design: the UI demotes first,
      // the wipe follows.
      void wipeSessionVault({ uid: outgoingUid }).catch(() => {})
    }
  })
  return auth
}

/** Run once from the thin entry, after the env gate, before render. Never
 *  blocks first paint: boot resolves ≤ bootTimeoutMs and the store starts in
 *  'recovering' (a renderable state) until it does. */
export function bootMobileAuth(): void {
  const a = getMobileAuth()
  // boot() RESOLVES the fast path; onSessionState (already wired) reports only
  // the late settle after a timeout fall-through — both must reach the store.
  void a.boot().then(setSessionState)
  a.bindLifecycle()
}
