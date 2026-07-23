// /data-export screen facade GET (design-parity packet 23). The Bearer-path
// twin of the page's server assembly (src/app/[locale]/(app)/data-export/
// page.tsx): 3 page_size=1 scope totals + the recipient email, threaded onto
// a business-scoped synqed client instead of the cookie session.
//
// ensureCapability('customers.view') is the screens-route floor (welcome/
// customers/profile precedent) — STATED DIVERGENCE, same family rule as
// every other screens/* route: web's page itself checks NOTHING (only
// /api/export enforces data.export), the floor exists so an unauthenticated-
// for-customers-view caller can't even see the scope counts. The export
// TWIN (src/app/api/app/v1/export/route.ts) is the real gate, exactly
// mirroring web where the page is ungated and the route enforces.
//
// FAILURE CONTRACT — a DELIBERATE divergence from the screens-family default
// (ask-ai/customers propagate any read failure as 502): this route mirrors
// the WEB PAGE's own posture instead, because that is what the packet asks
// for verbatim ("3 × page_size=1, store clamp, fail-closed zeros"). The page
// catches a failed store-scope resolution AND swallows each count read to
// zero (`.catch(() => zero)`) so a transient upstream blip renders an
// honest-if-empty screen rather than a hard error the user can't self-serve
// past. Store-scope resolution failing here (resolveStoreForRequest throws)
// is the facade's ONLY equivalent of web's `storeScope === null` case (the
// module never returns an ambiguous non-null-viewAll/null-storeId state by
// construction — see store-clamp.ts's header comment) — so ONE catch site
// covers what web needed two checks for.
//
// No FACADE_AUDIT_MAP row (deny-default = skip) — matches EVERY other
// screens/* route; list/count reads never log (Liam 2026-07-17 ruling).

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { DataExportScreenDTO } from '@/lib/app-api/data-export-screen-dto'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'

export const runtime = 'nodejs'

const ZERO = { total: 0 }

export const GET = facadeHandler('screens.dataExport', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')

  const synqed = newSynqedClient(ctx.identity.businessId)

  let storeId: string | undefined
  let scopeFailed = false
  try {
    const clamp = await resolveStoreForRequest({
      synqed,
      authUserId: ctx.identity.authUserId,
      capabilities: ctx.identity.capabilities,
      requestedStoreId: ctx.req.headers.get('store-id'),
    })
    const enforceStore = clamp.allowedStoreIds != null
    storeId = enforceStore ? (clamp.storeId ?? undefined) : undefined
  } catch {
    scopeFailed = true
  }

  const [customers, bookings, karute] = await Promise.all([
    scopeFailed
      ? ZERO
      : synqed.customers.list({ page_size: 1, store_id: storeId }).catch(() => ZERO),
    scopeFailed
      ? ZERO
      : synqed.appointments.list({ page_size: 1, store_id: storeId }).catch(() => ZERO),
    scopeFailed
      ? ZERO
      : synqed.karuteRecords.list({ page_size: 1, store_id: storeId }).catch(() => ZERO),
  ])

  const dto = DataExportScreenDTO.parse({
    totals: {
      customers: customers.total ?? 0,
      bookings: bookings.total ?? 0,
      karute: karute.total ?? 0,
    },
    // Bearer parity source for web's supabase.auth.getUser().email (identity.ts).
    recipientEmail: ctx.identity.email ?? 'owner@example.com',
  })
  return ok(ctx, dto)
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
