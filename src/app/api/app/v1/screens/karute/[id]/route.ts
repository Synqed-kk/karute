// Session-detail (/karute/[id], inventory #5) screen facade read (packet 07
// §Build 2). The page's fan-out collapsed onto the business-scoped Bearer client,
// assembled by the SAME buildKaruteDetailScreen the web page renders from.
//
// TENANCY: the karute is the resource — readKaruteRaw proves it FIRST (a
// cross-tenant/missing id → 404 before any secondary read; a genuine upstream
// failure → 502), OUTSIDE the wave's 502 catch. RECORDING-PRIVACY ACL (#4): the
// raw transcript is withheld SERVER-side (canViewTranscript inside the builder)
// with the caller's staff id + recordings.viewAll capability — a restricted
// viewer's DTO carries transcript:null + transcriptRestricted:true.
//
// FAILURE CONTRACT (§Build 2): the page's silent degrades on the customer /
// consent / customer-list reads become a classified 502 here, never an empty-but-
// 200 DTO. PRE-RULED EXCEPTIONS: the outcome keeps null-on-failure (product
// semantics) and photos keep the page's catch→[] grace (a plain HTTP read folded
// into the DTO — the paint-timing deviation from web's Suspense stream is
// recorded, not a defect).

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { KaruteDetailScreenDTO } from '@/lib/app-api/karute-detail-screen-dto'
import { readKaruteRaw } from '@/lib/app-api/karute-facade'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { staffListByBusinessOrThrow } from '@/lib/staff'
import { listAllCustomers } from '@/lib/customers/list-all'
import { getCustomerWithClient } from '@/lib/customers/queries'
import { getKaruteOutcomeWithClient } from '@/lib/karute/outcome'
import { mapSynqedKaruteRecord } from '@/lib/supabase/karute'
import { buildKaruteDetailScreen } from '@/lib/karute/detail-screen'

// Node runtime: the synqed SDK + node:crypto verifier are server-only.
export const runtime = 'nodejs'

type Params = { id: string }

async function karuteId(ctx: FacadeContext<Params>): Promise<string> {
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'karute id is required')
  return id
}

function readLocale(ctx: FacadeContext<Params>): 'ja' | 'en' {
  const raw = new URL(ctx.req.url).searchParams.get('locale')
  return raw === 'en' ? 'en' : 'ja'
}

export const GET = facadeHandler<Params>('karute.read', async (ctx) => {
  // Same screens-route class gate as sessions/customers/profile — 'customers.view'
  // is "view customers + karute" in permissions.ts. First body statement.
  ensureCapability(ctx.identity.capabilities, 'customers.view')
  const id = await karuteId(ctx)
  const locale = readLocale(ctx)
  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)

  // Tenancy proof FIRST — cross-tenant/missing → 404, genuine upstream → 502,
  // both OUTSIDE the wave catch so they surface with their own status.
  const raw = await readKaruteRaw(synqed, id)
  const customerId = (raw.customer_id as string | null) ?? null

  try {
    const [staffList, allCustomers, outcome, gated] = await Promise.all([
      staffListByBusinessOrThrow(businessId),
      listAllCustomers(synqed, { sort_by: 'created_at', sort_order: 'asc' }),
      // Pre-ruled exception: outcome stays null-on-failure (product semantics).
      getKaruteOutcomeWithClient(synqed, id),
      customerId
        ? Promise.all([
            // Customer read (phone/email + 年齢/性別/回数/前回). Throws → 502 per
            // §Build 2 (the page's getCustomer catch→null is overridden here).
            getCustomerWithClient(synqed, customerId),
            // Consent presence. Throws → 502 (§Build 2 override of the page's
            // catch→null).
            synqed.customers.getConsent(customerId),
            // Photos folded into the DTO — page-parity graceful (catch→[]).
            synqed.customers
              .listPhotos(customerId)
              .then((r) => r.photos ?? [])
              .catch(() => [] as Array<{ id: string; signed_url: string | null; category: string; caption: string | null }>),
          ])
        : Promise.resolve(null),
    ])

    const customer = gated?.[0] ?? null
    const consent = gated?.[1] ?? null
    const photoRows = gated?.[2] ?? []

    // The caller's roster row: staff id (ACL viewer) + display role (coaching
    // panel gate). Keyed by the CONFIRMED auth user id — never client input.
    const selfRow = staffList.find((s) => s.id === ctx.identity.authUserId) ?? null
    const viewerStaffId = selfRow ? selfRow.id : null
    const viewerRole = (selfRow?.display_role ?? '') as string
    const canViewAllRecordings = ctx.identity.capabilities.has('recordings.viewAll')

    const customerName = customerId
      ? allCustomers.customers.find((c) => c.id === customerId)?.name ?? null
      : null
    const karute = mapSynqedKaruteRecord(raw, customerName)

    const built = buildKaruteDetailScreen({
      karute,
      allCustomers,
      outcome,
      viewerStaffId,
      canViewAllRecordings,
      contact: customer ? { phone: customer.phone, email: customer.email } : null,
      consentResult: consent ? { consent: consent.consent ?? null } : null,
      customer,
      locale,
    })

    const photos = photoRows.map((p) => ({
      id: p.id,
      signedUrl: p.signed_url,
      category: p.category,
      caption: p.caption,
    }))

    const dto = KaruteDetailScreenDTO.parse({ ...built, photos, viewerRole })
    // karute.view audit detail (Wave V, canon's transcriptShown mandate): the
    // hook's emit carries whether the raw transcript actually shipped in THIS
    // response — false covers both "none exists" and "ACL-withheld to null".
    // customer_id is the viewer's name join (packet 30 §4 karute-row idiom).
    // The emit itself stays logFacadeAudit's (see the karute.read row comment
    // in audit.ts); this route only enriches it.
    ctx.auditDetail = { transcript_shown: dto.transcript !== null, customer_id: customerId }
    return ok(ctx, dto)
  } catch (err) {
    if (err instanceof AppApiError) throw err
    throw new AppApiError('upstream_unavailable', 'session detail data unavailable')
  }
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
