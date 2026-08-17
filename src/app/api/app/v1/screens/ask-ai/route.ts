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
import { ASK_AI_REQUIRED_CAPABILITIES } from '@/lib/auth/permissions'
import { newSynqedClient } from '@/lib/synqed/client'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'

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
  // Shared Ask-AI rule (permissions.ts, H0) — the scope counts summarize
  // customer/karute/booking data; same effective rule as every Ask-AI surface.
  for (const capability of ASK_AI_REQUIRED_CAPABILITIES) {
    ensureCapability(ctx.identity.capabilities, capability)
  }

  const synqed = newSynqedClient(ctx.identity.businessId)
  const nowIso = new Date().toISOString()

  // Store clamp BEFORE any data read — its store_forbidden throws must reach
  // the client as 403, so it stays outside the upstream_unavailable catch
  // below (same posture as the customers/appointments screen routes).
  const clamp = await resolveStoreForRequest({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    requestedStoreId: ctx.req.headers.get('store-id'),
  })
  // Guarded lens (canonical, both Ask-AI chat routes): filter ONLY when the
  // caller is actually clamped (allowedStoreIds non-null). A viewAll caller
  // with a tenant-verified store-id header still gets allowedStoreIds: null —
  // that header must not narrow their business-wide counts.
  const lens = clamp.allowedStoreIds !== null ? (clamp.storeId ?? undefined) : undefined

  let karuteRes: { total?: number; karute_records?: Array<{ transcript?: string | null }> }
  let customerList: { total?: number }
  let apptList: { total?: number }
  let rawSettings: { settings?: Record<string, unknown> } | null
  let userName: string
  try {
    ;[karuteRes, customerList, apptList, rawSettings, userName] = await Promise.all([
      synqed.karuteRecords.list({ page_size: 200, store_id: lens }),
      synqed.customers.list({ page_size: 1, store_id: lens }),
      synqed.appointments.list({ from: nowIso, page_size: 1, store_id: lens }),
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
