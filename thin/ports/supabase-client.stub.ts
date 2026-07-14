// `@/lib/supabase/client` drop-in for the thin bundle (packet 08 Decision 2). The
// browser supabase-js session has NO thin equivalent (Bearer auth owns identity;
// no NEXT_PUBLIC_* define mapping), and keeping supabase-js OUT of the Vite bundle
// is exactly what the recording pipeline port kills. The vite config aliases
// `@/lib/supabase/client` here so every thin importer resolves to this stub.
//
// - auth.getSession() → a NULL session: draft.ts's owner check reads it, so a
//   recovered draft is never restored in thin (fail-closed for a shared device;
//   take durability + real thin session recovery is packet-10, not this batch).
// - storage.* → throws if ever reached: the recording port replaces the web
//   upload leg, so the thin pipeline never touches supabase storage.

export function createClient() {
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
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
