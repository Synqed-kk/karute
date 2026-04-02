import { createClient } from '@supabase/supabase-js'

/**
 * Supabase client using service role key — bypasses RLS entirely.
 * Use ONLY for server-side operations that run without an authenticated user
 * (cron jobs, webhooks, system tasks).
 */
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
