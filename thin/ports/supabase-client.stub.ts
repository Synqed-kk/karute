// `@/lib/supabase/client` drop-in for the thin bundle. Since the packet-01
// auth wiring (thin/auth/session.ts), AUTH IS REAL here: the alias delegates
// to the mobile auth client, so draft.ts's and take-store.ts's owner gates
// read the true signed-in session and the packet-10 durability layer lights
// up in the local-mode shell — exactly what this file's comment promised.
// The vite config aliases `@/lib/supabase/client` here so every thin importer
// resolves to this module.
//
// - auth → the packet-01 client's auth surface (auth-js, localStorage-
//   persisted session; one identity seam shared with the DataPort's Bearer).
// - storage.* → STILL throws if ever reached: the recording port owns the
//   upload leg (facade-minted signed URLs, tenant-prefixed paths); web
//   supabase storage must never be reachable from the bundle.

import { getMobileAuth } from '../auth/session'

export function createClient() {
  return {
    auth: getMobileAuth().auth,
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
