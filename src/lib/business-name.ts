// Server-only — the ONE truth chain for "what is this business called",
// shared by every surface that renders a business name outside a session
// (the /join invite screen, the lazy 本店 provision). Order matters:
//   1. org settings 事業所名 — the configured truth once /welcome ran.
//   2. The signup-captured owner-profile full_name — bootstrap sets it TO
//      the entered salon name, and until onboarding completes it is the
//      ONLY place that name exists (fresh-verify P1: the primary store
//      provisions on the FIRST authenticated render, before /welcome).
//   3. The caller's named default. Never throws — the name is chrome.
// NOT in an action ('use server') file on purpose: exporting this from one
// would mint a public RPC that leaks any business's name cross-tenant.
import type { SynqedClient } from '@synqed-kk/client'
import { orgSettingsWithClient } from '@/actions/org-settings'
import { createServiceClient } from '@/lib/supabase/service'

export async function businessDisplayName(
  synqed: Pick<SynqedClient, 'orgSettings'>,
  businessId: string,
  fallback: string,
): Promise<string> {
  try {
    const settings = await orgSettingsWithClient(synqed)
    if (settings?.salon_name) return settings.salon_name
  } catch {
    /* core unreachable — fall through to the signup-captured name */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = createServiceClient() as any
    const { data } = await service
      .from('profiles')
      .select('full_name')
      .eq('customer_id', businessId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (data?.full_name) return data.full_name
  } catch {
    /* profiles unreachable — fall through to the default */
  }
  return fallback
}
