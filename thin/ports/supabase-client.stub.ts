// `@/lib/supabase/client` drop-in for the thin bundle. Since the packet-01
// auth wiring (thin/auth/session.ts), AUTH IS REAL here: the alias delegates
// to the mobile auth client, so draft.ts's and take-store.ts's owner gates
// read the true signed-in session and the packet-10 durability layer lights
// up in the local-mode shell — exactly what this file's comment promised.
// The vite config aliases `@/lib/supabase/client` here so every thin importer
// resolves to this module.
//
// - auth.getSession() → a SYNC read of the session-store (one identity seam
//   shared with the DataPort's Bearer). NOT the live GoTrueClient: its
//   getSession() serializes behind a navigator.locks mutex and retries an
//   expired-token refresh with up to 30s of backoff when offline — the
//   draft/take owner gates calling this have no deadline and used to fail
//   closed instantly; they must keep doing so (security lens F-2).
// - storage.* → STILL throws if ever reached: the recording port owns the
//   upload leg (facade-minted signed URLs, tenant-prefixed paths); web
//   supabase storage must never be reachable from the bundle.
// - auth.signOut() → delegates to getMobileAuth().signOut() (packet 12 §B-2,
//   the binary's FIRST in-app sign-out): that adapter is signOutAndPurge, which
//   runs the SAME fail-closed sequence win or lose (packet 13/14) — capture the
//   outgoing token off storage, purge the GoTrue token trio, flip the store to
//   signed-out, wipe the per-user vault, then a best-effort remote revoke LAST
//   (session-lifecycle.ts, covered by mobile-client-session.test.ts's sign-out
//   suite). It NEVER calls auth-js's own signOut() (that would re-read the
//   storage it just purged), so NO SIGNED_OUT event is emitted — the adapter's
//   own `flip` (onSessionState('signed-out')) is what demotes the AuthGate, and
//   the remote revoke's outcome is informational only (remoteOk), never gating
//   the local sign-out. (The onAuthStateChange listener's SIGNED_OUT branch in
//   thin/auth/session.ts therefore backstops only SERVER-driven session death —
//   a failed refresh / admin revoke — not this button.) ProfilePageView's
//   handleSignOut awaits the call and never inspects the return value, so the
//   supabase-shaped `{ error }` result only needs to resolve, never throw.

import { getCurrentSession } from '@/lib/auth/mobile/session-store'
import { getMobileAuth } from '../auth/session'

export function createClient() {
  return {
    auth: {
      getSession: async () => ({ data: { session: getCurrentSession() }, error: null }),
      signOut: async () => {
        await getMobileAuth().signOut()
        return { error: null }
      },
    },
    storage: {
      from: () => ({
        upload: async () => {
          throw new Error('[thin] supabase storage unavailable — use the recording pipeline port')
        },
        createSignedUrl: async () => {
          throw new Error('[thin] supabase storage unavailable — use the recording pipeline port')
        },
        remove: async () => ({ data: null, error: null }),
      }),
    },
  }
}
