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
  /** Purge partitioned caches + secure store on sign-out (see
   *  session-lifecycle). `uid` is the outgoing user, captured before purge —
   *  threaded explicitly so the wipe never depends on session-store timing. */
  purgeLocalCaches: (uid: string | undefined) => Promise<void>
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
  /** Sign out: purge local state UNCONDITIONALLY (storage-key removal +
   *  onSessionState('signed-out')) FIRST, then best-effort remote revoke
   *  with the token captured before the purge (packet 13 — fail-closed is
   *  now the only path, not a fallback on remote failure). */
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
      return signOutAndPurge({
        captureSession: async () => {
          // The module's own live session accessor — reads storage ONCE,
          // before anything below purges it (installed @supabase/auth-js
          // 2.99.1, GoTrueClient.js getSession():1264 → __loadSession:1351,
          // reading getItemAsync(this.storage, this.storageKey) — the SAME
          // read _signOut():1751 itself does via _useSession). Capturing
          // AFTER the purge below would hit that same read against empty
          // storage — exactly the naive-purge-first bug the mechanism
          // constraints ruled out, where the revoke silently has no token to
          // send.
          const { data } = await auth.getSession()
          return {
            accessToken: data.session?.access_token ?? null,
            uid: data.session?.user?.id,
          }
        },
        wipeLocal: opts.purgeLocalCaches,
        purgeStorage: async () => {
          // UNCONDITIONAL now (packet 13 — fail-closed is the only path, not
          // a fallback on remote failure). Remove the SAME three keys
          // GoTrue's own _removeSession does (installed @supabase/auth-js,
          // GoTrueClient.js:2246-2255): the storage key itself, its PKCE
          // code-verifier sibling, and its `-user` sibling (only populated
          // when a separate userStorage is configured — not wired today, but
          // mirrored so the Keychain-storage migration, a named future item,
          // doesn't have to rediscover this list). auth-js reads the session
          // FROM storage on every call, so a missing key makes getSession()/
          // autorefresh/resume all resolve null, no private API needed. Each
          // removal is attempted INDEPENDENTLY (allSettled, Greptile #572):
          // one failed delete must not retain the sibling credentials — the
          // whole step stays best-effort (a broken adapter must not block
          // the sign-out this exists for).
          await Promise.allSettled([
            opts.storage.removeItem(SESSION_STORAGE_KEY),
            opts.storage.removeItem(`${SESSION_STORAGE_KEY}-code-verifier`),
            opts.storage.removeItem(`${SESSION_STORAGE_KEY}-user`),
          ])
        },
        // No SIGNED_OUT event drives this anymore (we never call
        // auth.signOut()) — flip ourselves, and only after purgeStorage
        // above resolves, so the visible demote never precedes the disk
        // purge landing. Always fires — the whole point of fail-closed.
        flip: () => opts.onSessionState({ status: 'signed-out' }),
        // LAST and best-effort, riding the token captured above. Never
        // auth.signOut() here: it would re-run __loadSession against the
        // storage this just purged and silently find nothing to revoke.
        revokeRemote: (accessToken) => revokeGoTrueSession(opts.config, accessToken),
      })
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
 */
async function revokeGoTrueSession(
  config: AuthClientConfig,
  accessToken: string | null,
): Promise<void> {
  if (!accessToken) return
  const res = await fetch(`${config.url.replace(/\/+$/, '')}/auth/v1/logout?scope=global`, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  })
  if (!res.ok) throw new Error(`GoTrue logout failed: ${res.status}`)
}
