// Thin-shell binding for packet-01's mobile auth module (packet-09 F-5 cause 1
// — the module existed, tested, with zero importers; this file is the wiring).
//
// Composition only: config from the validated thin env, concrete storage +
// app-state ports, session state routed into the session-store the AuthGate
// and DataPort read. All auth LOGIC stays in src/lib/auth/mobile/*.

import { createMobileAuth, type MobileAuth } from '@/lib/auth/mobile/client-session'
import { loadAuthClientConfig } from '@/lib/auth/mobile/config'
import type { SupportsStorage } from '@/lib/auth/mobile/secure-storage'
import { getCurrentSession, setSessionState } from '@/lib/auth/mobile/session-store'
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
    // onQuiesce deliberately unwired: the thin bundle has no global query
    // cache to pause, and in-flight ScreenBoundary fetches self-resolve via
    // their `alive` flag — there is nothing to quiesce yet.
    // The one logout wipe (packet-10): recorder/pipeline singletons + takes +
    // draft — routed here exactly as REV-48 planned for the packet-01 wiring.
    purgeLocalCaches: wipeSessionVault,
  })
  // Token rotation truth: auth-js emits SIGNED_IN / TOKEN_REFRESHED with the
  // fresh session — mirror into the store so the DataPort's Bearer never goes
  // stale. A null session flips the store ONLY on an explicit SIGNED_OUT;
  // anything else (INITIAL_SESSION pre-boot, transient nulls) is the boot
  // gate's call — a network hiccup must never look like a logout. The
  // subscription handle is deliberately dropped: exactly one subscription per
  // app lifetime (this module is a cached singleton), never torn down.
  auth.auth.onAuthStateChange((event, session) => {
    if (session) {
      setSessionState({ status: 'signed-in', session })
    } else if (event === 'SIGNED_OUT') {
      // Capture the OUTGOING uid SYNCHRONOUSLY, before nulling the store
      // below (F3, packet 12 fix batch): clearOwnTakes' currentUserId()
      // reads FROM this store on the thin path, so it would otherwise
      // resolve null for every SERVER-driven sign-out (failed refresh,
      // password reset, admin revoke) — silently no-op'ing and leaving the
      // leaving staff member's takes on the shared device. The in-app
      // sign-out button is unaffected: ProfilePageView wipes BEFORE calling
      // signOut, while the uid is still alive either way.
      const outgoingUid = getCurrentSession()?.user?.id
      setSessionState({ status: 'signed-out' })
      // SIGNED_OUT is also how that server-driven session death arrives, so
      // this is the catch-all vault purge — a button-driven sign-out wipes
      // THREE times: ProfilePageView's own pre-wipe (before calling
      // signOut), signOutAndPurge's composed purgeLocalCaches (client-
      // session.ts), and this listener firing on the SIGNED_OUT it
      // produces; all three are idempotent/best-effort by design. Without
      // this listener firing too, a server-driven death (no button ever
      // pressed) would never purge at all: the previous staff's live
      // recorder/pipeline singletons (audio, transcript) would stay armed
      // for the next sign-in on a shared device (packet-10 leak class).
      // Best-effort by design: the UI demotes first, the wipe follows.
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
