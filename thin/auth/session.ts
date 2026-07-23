// Thin-shell binding for packet-01's mobile auth module (packet-09 F-5 cause 1
// — the module existed, tested, with zero importers; this file is the wiring).
//
// Composition only: config from the validated thin env, concrete storage +
// app-state ports, session state routed into the session-store the AuthGate
// and DataPort read. All auth LOGIC stays in src/lib/auth/mobile/*.

import type { Session } from '@supabase/supabase-js'
import {
  createMobileAuth,
  SESSION_STORAGE_KEY,
  type MobileAuth,
} from '@/lib/auth/mobile/client-session'
import { loadAuthClientConfig } from '@/lib/auth/mobile/config'
import type { SupportsStorage } from '@/lib/auth/mobile/secure-storage'
import {
  applyTokenRotation,
  currentGeneration,
  getCurrentSession,
  getSessionState,
  hasKnownSession,
  seedKnownSession,
  setSessionState,
  subscribeSessionState,
  type SessionState,
} from '@/lib/auth/mobile/session-store'
import { wipeSessionVault } from '@/lib/karute/logout-wipe'
import { getThinEnv } from '../env'
import { emitRefresh, hasRefreshListeners } from '../ports/nav.vite'

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
        // SIGNED_IN / INITIAL_SESSION / PASSWORD_RECOVERY — authoritative,
        // but IDENTITY-GUARDED (fix F2-2, P1): GoTrue's constructor-launched
        // _recoverAndRefresh can notify SIGNED_IN with a session captured
        // BEFORE a concurrent sign-out purge lands (installed auth-js 2.99.1:
        // stopAutoRefresh only clears the ticker, in-flight chains survive;
        // signOut's flip() lands after several awaits) — an unconditional
        // write here would resurrect the signed-out user's Bearer or clobber
        // a second user's fresh sign-in on a shared device. VERIFIED SAFE TO
        // GUARD: LoginScreen.tsx:39 writes the store DIRECTLY from
        // signInWithPassword's response, so real logins never depend on this
        // event. NOT a plain settleBoot (recovering-only): that would rely on
        // event delivery order and drop a legitimate same-user echo/refresh
        // once already signed-in.
        const storeState = getSessionState()
        const sameUser =
          storeState.status === 'signed-in' && storeState.session.user?.id === session.user?.id
        if (storeState.status === 'recovering' || sameUser) {
          setSessionState({ status: 'signed-in', session })
        }
        if (event === 'SIGNED_IN') {
          // Re-arm autorefresh REGARDLESS of whether the write above applied
          // (packet 15's shared-iPad re-arm must survive even a DROPPED
          // SIGNED_IN — a second staff member's login event can arrive while
          // the store is still signed-out in one legal ordering; a ticker
          // started against already-purged storage is a harmless no-op,
          // verified). The sign-out path calls auth.stopAutoRefresh(), which
          // also removes auth-js's managed visibility callback. On a shared
          // iPad the next staff member signs in on the SAME client with NO
          // page reload, so nothing would otherwise restart the ticker — a
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

/** Pre-boot synchronous seed (perf packet 25 PR-B): read the SAME storage key
 *  GoTrue persists to, DIRECTLY off window.localStorage (not the async
 *  storage adapter above — the whole point is seeding before first render).
 *  Absent key / malformed JSON / missing required fields → skip silently, no
 *  log (a signed-out device has no key, so cold signed-out boot is
 *  unchanged). The refresh_token/expires_at presence checks (fix F5) are
 *  PARITY with installed @supabase/auth-js 2.99.1's own _isValidSession shape
 *  check for those two fields ONLY (presence, not type) — the
 *  access_token/user.id checks below are STRICTER than auth-js (typed, not
 *  just present), so this is not a full _isValidSession port, just agreement
 *  on the two fields auth-js also gates on.
 *  Deliberately no expiry check — seeding a near/past-expiry token is the
 *  design; the recovering contract plus armSettleRefresh below heal it, and
 *  a truly-dead session still settles signed-out via boot exactly as today,
 *  just with the splash held a beat less.
 *  ⚠ SAFEGUARD: never log/print/decode/slice the token value — parse, hand
 *  the object to seedKnownSession, done.
 *  CRASH GUARD (fix F2-1, P1): `JSON.parse('null')` returns JS `null`, which
 *  passes the try/catch above but then throws on property access
 *  (`typeof null === 'object'`, so a typeof-only check would NOT catch it) —
 *  bootMobileAuth has no wrapper of its own (unlike getThinEnv), so an
 *  uncaught throw here is a white screen until the +8s native failsafe. Two
 *  layers: the explicit null/non-object check right after the parse (mirrors
 *  auth-js's own _isValidSession null guard), AND the whole function body
 *  wrapped in try/catch — this function's own contract is "skip silently",
 *  so no shape this ever sees should be able to escape that contract. */
function seedFromPersistedSession(): void {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) return
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    if (parsed === null || typeof parsed !== 'object') return
    const candidate = parsed as {
      access_token?: unknown
      user?: { id?: unknown }
      refresh_token?: unknown
      expires_at?: unknown
    }
    if (
      typeof candidate.access_token !== 'string' ||
      typeof candidate.user?.id !== 'string' ||
      !('refresh_token' in candidate) ||
      !('expires_at' in candidate)
    )
      return
    const seededToken = candidate.access_token
    const wasKnown = hasKnownSession()
    seedKnownSession(parsed as Session)
    // Only arm the settle-refresh below if this call actually flipped the
    // store from unknown to known — seedKnownSession itself may still no-op
    // (store already settled/signed-out by the time this runs).
    if (!wasKnown && hasKnownSession()) armSettleRefresh(seededToken)
  } catch {
    // Belt: the seed's own contract is "skip silently" — a malformed or
    // unexpected persisted value must never be able to crash bootMobileAuth.
  }
}

/** MANDATORY second-order pin (packet 25 PR-B): a seeded EXPIRED Bearer means
 *  first-screen fetches can 401 into the error frame, and useScreenDto never
 *  re-fetches on session settle. Subscribe once and on the FIRST authoritative
 *  settle: signed-in with a DIFFERENT access_token than the one seeded (fix
 *  F3 — a SAME-token settle only means the store has LOCALLY settled, not
 *  that the token is server-verified; ScreenBoundary's own F2-3 self-escape
 *  covers the gap where a same-token settle still leaves a genuinely-expired
 *  seed 401ing) → emitRefresh() exactly once (SWR swap-not-flash of the
 *  already-mounted screen), then unsubscribe; signed-out → unsubscribe, no
 *  refresh (LoginScreen owns the tree). A 'recovering' notification (timeout
 *  fall-through) keeps the subscription armed so the LATE settle — via
 *  onSettled or onAuthStateChange's INITIAL_SESSION, both of which write the
 *  store through setSessionState, or a pre-boot applyTokenRotation heal (fix
 *  F6) — still fires it. Accepted costs (PR body): one extra background
 *  re-fetch of the mounted screen per seeded boot whose token actually
 *  rotated (invisible SWR swap); emitRefresh clears PR-A's dtoCache
 *  (by-design), which at boot is only seconds old — nothing of value lost. */
function armSettleRefresh(seededToken: string): void {
  const unsubscribe = subscribeSessionState(() => {
    const state = getSessionState()
    if (state.status === 'recovering') return
    unsubscribe()
    if (state.status === 'signed-in' && state.session.access_token !== seededToken) {
      emitWhenListening()
    }
  })
}

// Exported (fix F2-5) so tests import these instead of untethered literals.
export const REFRESH_RETRY_MS = 50
export const REFRESH_RETRY_MAX = 40 // ~2s total

/** Fix F4: the settle can resolve before any screen has mounted (and
 *  therefore before ScreenBoundary's useEffect has called subscribeRefresh),
 *  so emitting straight away would fire into an empty listener set and the
 *  stale-token screen would never re-fetch. Retry on a short timer until a
 *  listener exists; give up silently past REFRESH_RETRY_MAX — by then
 *  something else (a real navigation) will have mounted a fresh fetch. */
function emitWhenListening(tries = 0): void {
  if (hasRefreshListeners()) {
    emitRefresh()
    return
  }
  if (tries >= REFRESH_RETRY_MAX) return
  setTimeout(() => emitWhenListening(tries + 1), REFRESH_RETRY_MS)
}

/** Fix F1 (P1): both boot-settle paths — the fast `.then` resolution and the
 *  late settle via bootSessionGate's onSettled — must route through this ONE
 *  guard before writing the store. Pre-seed, an unconditional write was
 *  inert (no UI existed until the first settle). Post-seed the full app,
 *  including Profile sign-out, is live during the UNBOUNDED late-settle
 *  window (bad wifi): an intervening explicit sign-out or a second user's
 *  sign-in must not be silently overwritten when the OLD boot recovery
 *  finally resolves — that is session resurrection / a cross-user Bearer on
 *  a shared device. SEMANTIC guard, not a generation counter: boot's own
 *  legitimate timeout-recovering write and a possible INITIAL_SESSION write
 *  make raw generation fencing wrong here. Any authoritative exit from
 *  'recovering' (explicit sign-out, LoginScreen sign-in, INITIAL_SESSION)
 *  means someone already settled — boot's write is then redundant or
 *  dangerous, so it is dropped. */
const settleBoot = (state: SessionState): void => {
  if (getSessionState().status === 'recovering') setSessionState(state)
}

/** Run once from the thin entry, after the env gate, before render. Never
 *  blocks first paint: boot resolves ≤ bootTimeoutMs and the store starts in
 *  'recovering' (a renderable state) until it does. The synchronous seed
 *  above runs FIRST (before boot()), so a cold boot with a persisted session
 *  mounts the app instantly instead of waiting on the network (packet 25
 *  PR-B). On a persisted-session cold boot the store usually settles via
 *  onAuthStateChange's INITIAL_SESSION (auth-js's own lock queue) before
 *  boot()'s own resolution ever lands — boot()'s write here is the backstop
 *  for the case it doesn't, now guarded by settleBoot (fix F1) so a stale
 *  resolution can never clobber a sign-out or a later sign-in. */
export function bootMobileAuth(): void {
  const a = getMobileAuth()
  seedFromPersistedSession()
  // boot() RESOLVES the fast path; the passed callback reports only the late
  // settle after a timeout fall-through — both must reach the store, both
  // through settleBoot.
  void a.boot(settleBoot).then(settleBoot)
  a.bindLifecycle()
}
