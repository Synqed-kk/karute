// Ask-AI screen facade read (packet 04, inventory #1). ONE coarse screen-shaped
// GET mirroring the /ask-ai page's server fan-out (page.tsx): the 3 count-only
// synqed reads + org business type + caller display name, assembled in one wave.
// Identity comes from resolveIdentity via facadeHandler (Bearer-only) — the
// page's cookie getUser is NOT consulted here.
//
// FAILURE CONTRACT (deliberate parity break, recorded in the packet-04 report):
// the web page swallows count failures to 0 for a partial render; the facade
// must NOT — a frozen mobile cache of zeros is the exact "false empty salon"
// the packet-03 error contract exists to prevent. Any synqed failure in the
// wave → 502 upstream_unavailable.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { AskAiScreenDTO } from '@/lib/app-api/ask-ai-dto'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { createServiceClient } from '@/lib/supabase/service'

// Node runtime: the synqed SDK + node:crypto verifier are server-only.
export const runtime = 'nodejs'

/** Page parity: userName = auth user's email local-part, falling back to 'You'.
 *  Read from the caller's OWN profile row (primary-key lookup on the CONFIRMED
 *  authUserId — never a client-supplied id). Display-only → fail-open to 'You'. */
async function resolveUserName(authUserId: string): Promise<string> {
  try {
    const service = createServiceClient()
    const { data } = await service
      .from('profiles')
      .select('email')
      .eq('id', authUserId)
      .maybeSingle()
    return (data as { email?: string | null } | null)?.email?.split('@')[0] ?? 'You'
  } catch {
    return 'You'
  }
}

// GET — screen read. Reads are not in packet 01's REVOCATION_SENSITIVE_ENDPOINTS,
// so this takes the local Bearer fast-path (same ruling as customer.read).
export const GET = facadeHandler('askAi.read', async (ctx) => {
  // Baseline view capability — the scope counts summarize customer/karute/
  // booking data, the same data 'customers.view' gates everywhere else.
  ensureCapability(ctx.identity.capabilities, 'customers.view')

  const synqed = newSynqedClient(ctx.identity.businessId)
  const nowIso = new Date().toISOString()

  let karuteRes: { total?: number; karute_records?: Array<{ transcript?: string | null }> }
  let customerList: { total?: number }
  let apptList: { total?: number }
  let rawSettings: { settings?: Record<string, unknown> } | null
  let userName: string
  try {
    ;[karuteRes, customerList, apptList, rawSettings, userName] = await Promise.all([
      synqed.karuteRecords.list({ page_size: 200 }),
      synqed.customers.list({ page_size: 1 }),
      synqed.appointments.list({ from: nowIso, page_size: 1 }),
      // Two fields of org settings are needed; the shared cached reader
      // (orgSettingsByBusiness) is module-private in a 'use server' file and
      // must stay unexported — an exported businessId-keyed action would be a
      // client-invocable cross-tenant read. Direct business-scoped read instead.
      synqed.orgSettings.get(),
      resolveUserName(ctx.identity.authUserId),
    ])
  } catch {
    throw new AppApiError('upstream_unavailable', 'ask-ai screen data unavailable')
  }

  const businessType = (rawSettings?.settings as { business_type?: string } | undefined)
    ?.business_type
  const dto = AskAiScreenDTO.parse({
    scope: {
      karute: karuteRes.total ?? 0,
      customers: customerList.total ?? 0,
      bookings: apptList.total ?? 0,
      recordings: (karuteRes.karute_records ?? []).filter((r) => r.transcript != null)
        .length,
    },
    businessType: businessType || null,
    userName,
  })
  return ok(ctx, dto)
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
