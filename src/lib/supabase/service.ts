import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client — bypasses RLS.
 * Use ONLY in server-side contexts that run without user auth
 * (cron jobs, webhooks, background tasks).
 */
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}
