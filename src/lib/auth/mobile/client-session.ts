// Client auth module for the mobile bundle (packet-01 point 1, composition).
//
// ⚠ SAFEGUARD (this is a classifier-sensitive auth seam — see the karute
// phase-2 Fable→Opus flag incident): NEVER read, decode, print, or log an
// auth-token VALUE here — not in code, not in a test, not in debug output. The
// sign-out capture below lifts access_token + user.id off storage and threads
// the token ONLY into the remote revoke; it is never logged. Session reads on
// the fail-closed path use the pure disk/store source, never auth.getSession()
// (which serializes behind navigator.locks and can fire an unbounded refresh).
//
// The bundled iOS app has no Next.js server, so login runs on-device with plain
// auth-js (web keeps @supabase/ssr cookie auth, untouched). This module
// composes: the parameterized client + Keychain-backed storage + the loud-boot
// gate + background-resume single-flight + sign-out purge.
//
// Capacitor plugin concretions (@capacitor/app for foreground events, the
// Keychain SecureStorage plugin) are NOT imported here — they are PORTS the
// scaffold packet (02) provides, because that packet owns the @capacitor install
// and the binary. That keeps this module tsc-clean and testable off-device and
// matches PLAN §3's platform-neutral ports mandate.

// GoTrueClient from auth-js DIRECTLY, not supabase-js's createClient: the
// mobile bundle uses ONLY the auth plane (data rides the facade DataPort,
// storage rides the recording port), and the full SupabaseClient hard-wires
// realtime-js — which ships no `sideEffects` field, so it survives
// tree-shaking exactly like the §1.5 vendor leak (~+115 KB over the thin
// budget, measured). auth-js is not a declared dependency but is version-
// locked as supabase-js's own dependency (2.99.1 = installed supabase-js);
// the construction below mirrors SupabaseClient._initSupabaseAuthClient
// byte-for-byte (url path, apikey/Authorization headers, auth options).
import { GoTrueClient, type Session } from '@supabase/auth-js'
import type { AuthClientConfig } from './config'
import type { SupportsStorage } from './secure-storage'
import { bootSessionGate, type BootState } from './boot-gate'
import {
  createResumeCoordinator,
  createSingleFlight,
  type ResumeCoordinator,
} from './background-resume'
import { signOutAndPurge, type SignOutResult } from './session-lifecycle'

/** Foreground-event port. Scaffold binds it to
 *  `App.addListener('appStateChange', s => s.isActive && cb())`. */
export interface AppStateSource {
  onActive(cb: () => void): void
}

export interface MobileAuthOptions {
  config: AuthClientConfig
  /** Keychain-backed storage adapter (createKeychainSessionStorage(secureStore)). */
  storage: SupportsStorage
  /** Foreground-event source (@capacitor/app in the scaffold). */
  appState: AppStateSource
  /** Quiesce identity/store/query/mutations before a resume recovery. */
  onQuiesce?: () => void
  /** Re-enable the data planes after boot/resume settles. */
  onSessionState: (state: BootState<Session>) => void
  /** Purge partitioned caches + secure store on sign-out (see
   *  session-lifecycle). `uid` is the outgoing user, captured before purge —
   *  threaded explicitly so the wipe never depends on session-store timing. */
  purgeLocalCaches: (uid: string | undefined) => Promise<void>
  /** Boot timeout before falling through to the recovering state. Default 4000ms. */
  bootTimeoutMs?: number
  /** Session-store generation accessor (packet 14 P1-b), injected so a
   *  background-resume that races a sign-out/sign-in is fenced out. The thin
   *  binding wires session-store's `currentGeneration`; omitted in unit tests →
   *  resume is unfenced (unchanged behaviour). */
  generation?: () => number
}

export interface MobileAuth {
  /** The auth plane — the ONLY supabase client surface in the mobile bundle. */
  auth: GoTrueClient
  /** Run at first paint. Never blocks longer than bootTimeoutMs. `onSettled`
   *  (packet 25 fix F1), when passed, replaces `opts.onSessionState` as the
   *  LATE-settle callback (recovery resolving after a timeout fall-through) —
   *  the caller can route it through its own guard instead of writing the
   *  store unconditionally. Omitted → unchanged (opts.onSessionState). */
  boot(onSettled?: (state: BootState<Session>) => void): Promise<BootState<Session>>
  /** Wire background-resume to the app-state source. Call once after boot. */
  bindLifecycle(): ResumeCoordinator
  /** Sign out: purge local state UNCONDITIONALLY (storage-key removal +
   *  onSessionState('signed-out')) FIRST, then best-effort remote revoke
   *  with the token captured before the purge (packet 13 — fail-closed is
   *  now the only path, not a fallback on remote failure). */
  signOut(): Promise<SignOutResult>
}

export const SESSION_STORAGE_KEY = 'karute.auth.session'

export function createMobileAuth(opts: MobileAuthOptions): MobileAuth {
  const auth = new GoTrueClient({
    url: `${opts.config.url.replace(/\/+$/, '')}/auth/v1`,
    headers: {
      Authorization: `Bearer ${opts.config.anonKey}`,
      apikey: opts.config.anonKey,
    },
    storage: opts.storage,
    storageKey: SESSION_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    // capacitor://localhost has no URL-based auth callback; reset/invite flows
    // stay on the HTTPS site in v1 (PLAN §11 Codex R1 #19).
    detectSessionInUrl: false,
  })

  const recover = async (): Promise<Session | null> => {
    const { data, error } = await auth.getSession()
    // A failed session READ is not a logout. Surfacing the in-band error as a
    // reject makes the boot gate hold `recovering` — only an explicit null
    // session may sign the UI out (the gate's core invariant).
    if (error && !data.session) throw error
    return data.session
  }
  // ONE in-flight recovery across boot AND resume: a visibilitychange during
  // the boot window (the iOS mic-permission prompt foregrounds the app) must
  // JOIN boot's getSession, not race a second one into GoTrueClient's
  // per-instance lock queue (correctness lens F-2).
  const recoverOnce = createSingleFlight(recover)

  return {
    auth,
    boot(onSettled) {
      // Never `await getSession()` unbounded — the spike proved it hangs offline.
      return bootSessionGate<Session>(
        recoverOnce,
        opts.bootTimeoutMs ?? 4000,
        onSettled ?? opts.onSessionState,
      )
    },
    bindLifecycle() {
      const coordinator = createResumeCoordinator<Session>({
        recover: recoverOnce,
        onQuiesce: opts.onQuiesce,
        onResumed: opts.onSessionState,
        // Same bound as boot — a hung resume falls through to `recovering`,
        // never leaves the app silently quiesced.
        timeoutMs: opts.bootTimeoutMs,
        // Fence resume writes: a sign-out/sign-in during recovery drops the
        // stale re-enable rather than resurrecting the outgoing session.
        generation: opts.generation,
      })
      // Single-flighted inside the coordinator: rapid foregrounds → one recovery.
      opts.appState.onActive(() => {
        void coordinator.onAppActive()
      })
      return coordinator
    },
    async signOut() {
      // Stop auth-js's autorefresh ticker BEFORE the purge (packet 14 P1-b): a
      // surviving 30s tick — or its in-flight refresh — would _saveSession a
      // refreshed token back into the storage we are about to empty and
      // _notifyAllSubscribers('TOKEN_REFRESHED') → session resurrection
      // (installed @supabase/auth-js 2.99.1: _autoRefreshTokenTick
      // GoTrueClient.js:2376 → _callRefreshToken:2135 → _saveSession:2153 +
      // notify:2154). stopAutoRefresh() (GoTrueClient.js:2369 → _stopAutoRefresh
      // :2322) clears the ticker; the session-store generation fence backstops
      // any write that still slips through. NOTE: stopAutoRefresh also removes
      // auth-js's managed visibility callback, so the ticker is re-armed on the
      // next SIGNED_IN in thin/auth/session.ts (shared iPad — the next staff
      // member signs in on this same client with no page reload).
      await auth.stopAutoRefresh()
      // Remove the SAME three keys GoTrue's own _removeSession does (installed
      // @supabase/auth-js 2.99.1, GoTrueClient.js:2249-2258): the storage key
      // itself, its PKCE code-verifier sibling, and its `-user` sibling (only
      // populated when a separate userStorage is configured — not wired today,
      // but mirrored so the Keychain-storage migration, a named future item,
      // doesn't have to rediscover this list). auth-js reads the session FROM
      // storage on every call, so a missing key makes getSession()/autorefresh/
      // resume all resolve null, no private API needed. Each removal is attempted
      // INDEPENDENTLY (allSettled, Greptile #572): one failed delete must not
      // retain the sibling credentials — best-effort (a broken adapter must not
      // block the sign-out this exists for). Hoisted to a named local so the
      // packet-15 P3 belt below can re-run the IDENTICAL removal after the revoke.
      const purgeTokenTrio = async () => {
        await Promise.allSettled([
          opts.storage.removeItem(SESSION_STORAGE_KEY),
          opts.storage.removeItem(`${SESSION_STORAGE_KEY}-code-verifier`),
          opts.storage.removeItem(`${SESSION_STORAGE_KEY}-user`),
        ])
      }
      const result = await signOutAndPurge({
        captureSession: async () => {
          // PURE disk read of the persisted session — NOT auth.getSession().
          // getSession() serializes behind a navigator.locks mutex and, on a
          // token within EXPIRY_MARGIN_MS (90s) of expiry, fires an UNBOUNDED
          // network refresh (installed @supabase/auth-js 2.99.1: getSession()
          // GoTrueClient.js:1264 → _acquireLock → __loadSession:1351, which at
          // :1405 calls _callRefreshToken → a bare fetch in lib/fetch.js with NO
          // timeout/AbortController). Capturing through it would reopen the
          // REV-81 kill-window this packet closes — the "unconditional first"
          // local purge would stall behind that refresh on flaky wifi. Instead
          // read the SAME storage the client persists to (_saveSession stores
          // the full session as JSON under storageKey, GoTrueClient.js:2242-2243,
          // no userStorage configured) and lift access_token + user.id off it —
          // lock-free, network-free, fail-closed instant. SAFEGUARD: the parsed
          // token VALUE is threaded ONLY to revokeRemote (as before), NEVER
          // logged/printed/decoded here.
          const raw = await opts.storage.getItem(SESSION_STORAGE_KEY)
          if (!raw) return { accessToken: null, uid: undefined }
          try {
            const session = JSON.parse(raw) as {
              access_token?: string
              user?: { id?: string }
            }
            return { accessToken: session.access_token ?? null, uid: session.user?.id }
          } catch {
            // malformed storage → nothing to revoke; purge/flip still run
            return { accessToken: null, uid: undefined }
          }
        },
        wipeLocal: opts.purgeLocalCaches,
        // UNCONDITIONAL now (packet 13 — fail-closed is the only path, not a
        // fallback on remote failure): the token trio comes off disk regardless
        // of the remote revoke's outcome. purgeTokenTrio is the hoisted removal
        // above; the P3 belt re-runs it after the revoke settles.
        purgeStorage: purgeTokenTrio,
        // No SIGNED_OUT event drives this anymore (we never call
        // auth.signOut()) — flip ourselves, and only after purgeStorage
        // above resolves, so the visible demote never precedes the disk
        // purge landing. Always fires — the whole point of fail-closed.
        flip: () => opts.onSessionState({ status: 'signed-out' }),
        // LAST and best-effort, riding the token captured above. Never
        // auth.signOut() here: it would re-run __loadSession against the
        // storage this just purged and silently find nothing to revoke. Bounded
        // by the same few-second idiom as boot (a hung revoke must not keep
        // signOut() pending for the page lifetime — packet 14 P2).
        revokeRemote: (accessToken) =>
          revokeGoTrueSession(opts.config, accessToken, opts.bootTimeoutMs ?? 4000),
      })
      // P3 belt (packet 15 — at-rest re-persist window): stopAutoRefresh clears
      // the ticker but CANNOT abort an already in-flight _callRefreshToken
      // (installed @supabase/auth-js 2.99.1 has no AbortController on the refresh
      // fetch; _stopAutoRefresh GoTrueClient.js:2325-2337 only clears the timers),
      // and purgeTokenTrio bypasses auth-js's storage lock. A refresh that lands
      // AFTER the purge above re-writes the session key via _saveSession
      // (GoTrueClient.js:2156 → 2246) — the store flip is fenced, the at-rest
      // copy is not, and the next cold boot would read it back. Now the revoke
      // has settled (signOutAndPurge's last step, bounded by the AbortController
      // timeout), re-run the IDENTICAL trio removal once more to sweep such a
      // late re-persist. HONEST LIMIT: this NARROWS the window, it does not close
      // it — an unbounded in-flight refresh can still land after this re-purge;
      // full closure would need aborting in-flight refreshes, which auth-js does
      // not expose. A successful scope=global revoke already kills the
      // re-persisted session server-side, so the residual needs a revoke FAILURE
      // and a late-landing refresh together.
      await purgeTokenTrio()
      return result
    },
  }
}

/**
 * Direct GoTrue logout call, bypassing GoTrueClient entirely — auth.signOut()
 * would re-read the token from storage this module has already purged by the
 * time this runs. Request shape verified against the installed
 * @supabase/auth-js 2.99.1 dist: GoTrueAdminApi.signOut()
 * (GoTrueAdminApi.js:49-58) hits `POST ${url}/logout?scope=${scope}` with
 * `noResolveJson`; `_request` (lib/fetch.js:67-75) overrides the base
 * Authorization header with `Bearer ${jwt}` when a jwt is passed, keeping
 * `apikey` from the base headers. `url` there is the SAME `settings.url` this
 * client constructs `auth` with (GoTrueClient.js:118-123, `this.admin = new
 * GoTrueAdminApi({ url: settings.url, headers: settings.headers, ... })`) —
 * i.e. `${config.url}/auth/v1`. Scope defaults to 'global'
 * (lib/types.js:19, `SIGN_OUT_SCOPES[0]`) — the same default `auth.signOut()`
 * used, never configured differently today.
 *
 * `accessToken` null (nothing was ever captured) skips the network call
 * entirely — mirrors _signOut() itself (GoTrueClient.js:1758-1759), which
 * only calls admin.signOut when a session token was found.
 *
 * Bounded by an AbortController `timeoutMs` (packet 14 P2): lib/fetch.js is a
 * bare fetch with no timeout, so a stalled-not-erroring connection would keep
 * this — and therefore signOut()'s promise — pending for the page lifetime. On
 * timeout the abort rejects → the caller's try/catch yields remoteOk:false;
 * the local purge/flip already ran, so this never blocks the sign-out. Status
 * handling mirrors auth-js _signOut (GoTrueClient.js:1762-1766): 401/403/404 are
 * signed-out-equivalent (expired/absent user is already logged out) — only a
 * genuine failure (5xx, network) is remoteOk:false (packet 14 P3).
 */
async function revokeGoTrueSession(
  config: AuthClientConfig,
  accessToken: string | null,
  timeoutMs: number,
): Promise<void> {
  if (!accessToken) return
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${config.url.replace(/\/+$/, '')}/auth/v1/logout?scope=global`, {
      method: 'POST',
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      signal: controller.signal,
    })
    if (!res.ok && ![401, 403, 404].includes(res.status)) {
      throw new Error(`GoTrue logout failed: ${res.status}`)
    }
  } finally {
    clearTimeout(timer)
  }
}
