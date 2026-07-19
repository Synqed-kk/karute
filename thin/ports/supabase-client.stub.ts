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

import { getCurrentSession } from '@/lib/auth/mobile/session-store'

export function createClient() {
  return {
    auth: {
      getSession: async () => ({ data: { session: getCurrentSession() }, error: null }),
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
