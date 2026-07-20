// Client auth module for the mobile bundle (packet-01 point 1, composition).
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
  /** Purge partitioned caches + secure store on sign-out (see session-lifecycle). */
  purgeLocalCaches: () => Promise<void>
  /** Boot timeout before falling through to the recovering state. Default 4000ms. */
  bootTimeoutMs?: number
}

export interface MobileAuth {
  /** The auth plane — the ONLY supabase client surface in the mobile bundle. */
  auth: GoTrueClient
  /** Run at first paint. Never blocks longer than bootTimeoutMs. */
  boot(): Promise<BootState<Session>>
  /** Wire background-resume to the app-state source. Call once after boot. */
  bindLifecycle(): ResumeCoordinator
  /** Sign out: remote revoke (best-effort) + unconditional local purge. When
   *  the remote revoke fails, ALSO forces a local sign-out (storage-key
   *  removal + onSessionState('signed-out')) — GoTrueClient's own signOut
   *  early-returns without removing its storage or emitting SIGNED_OUT on a
   *  non-401/403/404 remote error (offline/5xx), so nothing else would flip
   *  the session store (F1, packet 12 fix batch). */
  signOut(): Promise<SignOutResult>
}

const SESSION_STORAGE_KEY = 'karute.auth.session'

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
    boot() {
      // Never `await getSession()` unbounded — the spike proved it hangs offline.
      return bootSessionGate<Session>(
        recoverOnce,
        opts.bootTimeoutMs ?? 4000,
        opts.onSessionState,
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
      })
      // Single-flighted inside the coordinator: rapid foregrounds → one recovery.
      opts.appState.onActive(() => {
        void coordinator.onAppActive()
      })
      return coordinator
    },
    async signOut() {
      const result = await signOutAndPurge({
        signOutRemote: async () => {
          // auth-js reports remote revocation failures IN-BAND — rethrow so
          // signOutAndPurge records remoteOk: false truthfully (purge still runs).
          const { error } = await auth.signOut()
          if (error) throw error
        },
        purgeLocal: opts.purgeLocalCaches,
      })
      if (!result.remoteOk) {
        // FAIL-CLOSED LOCAL SIGN-OUT (F1, packet 12 fix batch — verified
        // against the installed @supabase/auth-js): GoTrueClient's own
        // signOut() early-returns on any non-401/403/404 remote error
        // (offline, 5xx) WITHOUT removing its storage key and WITHOUT
        // emitting SIGNED_OUT — so without this, nothing would flip the
        // session store and the token would sit in storage. Remove the SAME
        // THREE keys GoTrue's _removeSession does (installed @supabase/
        // auth-js, GoTrueClient.js ~2249-2258): the storage key itself, its
        // PKCE code-verifier sibling, and its `-user` sibling (only
        // populated when a separate userStorage is configured — not wired
        // today, but mirrored now so the Keychain-storage migration, a
        // named future item, doesn't have to rediscover this list) — via
        // the injected storage adapter. auth-js reads the session FROM
        // storage on every call, so a missing key makes getSession()/
        // autorefresh/resume all resolve null, no private API needed. Then
        // flip the store ourselves, since no SIGNED_OUT event will arrive
        // to do it. Each removal is attempted INDEPENDENTLY (allSettled,
        // Greptile #572): one failed delete must not retain the sibling
        // credentials — and the whole step stays best-effort (a broken
        // adapter must not block the fail-closed sign-out this exists for);
        // onSessionState ALWAYS fires.
        await Promise.allSettled([
          opts.storage.removeItem(SESSION_STORAGE_KEY),
          opts.storage.removeItem(`${SESSION_STORAGE_KEY}-code-verifier`),
          opts.storage.removeItem(`${SESSION_STORAGE_KEY}-user`),
        ])
        opts.onSessionState({ status: 'signed-out' })
      }
      return result
    },
  }
}
