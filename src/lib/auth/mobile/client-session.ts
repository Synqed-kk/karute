// Client auth module for the mobile bundle (packet-01 point 1, composition).
//
// The bundled iOS app has no Next.js server, so login runs on-device with plain
// supabase-js (web keeps @supabase/ssr cookie auth, untouched). This module
// composes: the parameterized client + Keychain-backed storage + the loud-boot
// gate + background-resume single-flight + sign-out purge.
//
// Capacitor plugin concretions (@capacitor/app for foreground events, the
// Keychain SecureStorage plugin) are NOT imported here — they are PORTS the
// scaffold packet (02) provides, because that packet owns the @capacitor install
// and the binary. That keeps this module tsc-clean and testable off-device and
// matches PLAN §3's platform-neutral ports mandate.

import {
  createClient,
  type SupabaseClient,
  type Session,
} from '@supabase/supabase-js'
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
  client: SupabaseClient
  /** Run at first paint. Never blocks longer than bootTimeoutMs. */
  boot(): Promise<BootState<Session>>
  /** Wire background-resume to the app-state source. Call once after boot. */
  bindLifecycle(): ResumeCoordinator
  /** Sign out: remote revoke (best-effort) + unconditional local purge. */
  signOut(): Promise<SignOutResult>
}

const SESSION_STORAGE_KEY = 'karute.auth.session'

export function createMobileAuth(opts: MobileAuthOptions): MobileAuth {
  const client = createClient(opts.config.url, opts.config.anonKey, {
    auth: {
      storage: opts.storage,
      storageKey: SESSION_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      // capacitor://localhost has no URL-based auth callback; reset/invite flows
      // stay on the HTTPS site in v1 (PLAN §11 Codex R1 #19).
      detectSessionInUrl: false,
    },
  })

  const recover = async (): Promise<Session | null> => {
    const { data } = await client.auth.getSession()
    return data.session
  }

  return {
    client,
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
          await client.auth.signOut()
        },
        purgeLocal: opts.purgeLocalCaches,
      })
    },
  }
}
