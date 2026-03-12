import 'server-only'
import { createClient } from '@supabase/supabase-js'

let serviceClient: ReturnType<typeof createClient> | null = null

/**
 * Returns a Supabase client using the service role key.
 * This bypasses RLS and should only be used server-side.
 */
export function getServiceClient() {
  if (!serviceClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!url || !key) {
      throw new Error(
        'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables'
      )
    }

    serviceClient = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }

  return serviceClient
}
