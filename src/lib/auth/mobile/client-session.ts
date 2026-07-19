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
import { createResumeCoordinator, type ResumeCoordinator } from './background-resume'
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
  /** Sign out: remote revoke (best-effort) + unconditional local purge. */
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

  return {
    auth,
    boot() {
      // Never `await getSession()` unbounded — the spike proved it hangs offline.
      return bootSessionGate<Session>(
        recover,
        opts.bootTimeoutMs ?? 4000,
        opts.onSessionState,
      )
    },
    bindLifecycle() {
      const coordinator = createResumeCoordinator<Session>({
        recover,
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
    signOut() {
      return signOutAndPurge({
        signOutRemote: async () => {
          // auth-js reports remote revocation failures IN-BAND — rethrow so
          // signOutAndPurge records remoteOk: false truthfully (purge still runs).
          const { error } = await auth.signOut()
          if (error) throw error
        },
        purgeLocal: opts.purgeLocalCaches,
      })
    },
  }
}
