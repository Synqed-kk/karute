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
// FAILURE CONTRACT (fixed in the fresh-eyes round — the first cut swallowed
// the clamp into 200-zeros "for web-page parity" and broke the family rule):
// the store clamp runs OUTSIDE any catch, exactly like every sibling
// screens/* route — its store_forbidden throws MUST reach the client as 403
// because facade-fetch's stranded-pin self-heal fires only on
// 403 + store_forbidden + reason:'store_header'. Swallowing it renders a
// silent 0/0/0 screen forever on a stale store pin and hides transient
// backend failures from ScreenBoundary's retry UI. What DOES keep the web
// page's zero-degrade posture is each COUNT read (`.catch(() => ZERO)`) —
// a transient count blip renders honest-if-low numbers, page parity.
//
// No FACADE_AUDIT_MAP row (deny-default = skip) — matches EVERY other
// screens/* route; list/count reads never log (Liam 2026-07-17 ruling).

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { DataExportScreenDTO } from '@/lib/app-api/data-export-screen-dto'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { resolveExportStoreId } from '@/lib/app-api/store-clamp'

export const runtime = 'nodejs'

const ZERO = { total: 0 }

export const GET = facadeHandler('screens.dataExport', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')

  const synqed = newSynqedClient(ctx.identity.businessId)

  // Export-hardened lens (fix round): floating staff see THEIR store's
  // totals, not business-wide ones — the numbers must preview what the
  // export twin will actually produce. OUTSIDE any catch — see the header's
  // failure contract (403 must reach the self-heal).
  const storeId = await resolveExportStoreId({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    requestedStoreId: ctx.req.headers.get('store-id'),
  })

  const [customers, bookings, karute] = await Promise.all([
    synqed.customers.list({ page_size: 1, store_id: storeId }).catch(() => ZERO),
    synqed.appointments.list({ page_size: 1, store_id: storeId }).catch(() => ZERO),
    synqed.karuteRecords.list({ page_size: 1, store_id: storeId }).catch(() => ZERO),
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
