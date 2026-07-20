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
//   the binary's FIRST in-app sign-out): that adapter is
//   signOutAndPurge(remote GoTrueClient.signOut + purgeLocalCaches) —
//   ALWAYS purges locally regardless of remote outcome (session-lifecycle.ts,
//   covered by mobile-client-session.test.ts's sign-out-adapter suite). The
//   remote revoke firing SIGNED_OUT is what flips the AuthGate to LoginScreen
//   via the onAuthStateChange listener already wired in thin/auth/session.ts
//   — nothing extra to do here. ProfilePageView's handleSignOut awaits the
//   call and never inspects the return value, so the supabase-shaped
//   `{ error }` result only needs to resolve, never throw.

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
