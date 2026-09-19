import 'server-only'

import { createServiceClient } from '@/lib/supabase/service'

/** Login emails already attached to this business — a pending invite matching
 *  one is a ghost (best-effort: an empty set just means no 接続済み badges).
 *  Exported for the facade GET (same truth on the shell). */
export async function memberEmailsForBusiness(businessId: string): Promise<Set<string>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = createServiceClient() as any
    const { data } = await service.from('profiles').select('email').eq('customer_id', businessId)
    return new Set(
      ((data ?? []) as { email: string | null }[])
        .map((r) => r.email?.toLowerCase())
        .filter((e): e is string => !!e),
    )
  } catch {
    return new Set()
  }
}
