// AI再エンゲージメント facade read (§13, reengagement packet) — mirrors
// body-prediction/route.ts's shape: tenancy proof (readCustomerRaw before
// any LLM/cache work) + ensureCapability 'customers.view' + the WithClient
// entry. Returns { draft: ReengagementDraft|null } — a null payload is the
// CONTRACTUAL best-effort miss (gated, locked, or generation failure), NOT
// a 502 (web parity: the generator is null-on-exclusion/failure by design).
//
// This route is DISCONNECTED today (fence, reengagement packet §Queued
// riders): no client calls it yet — it ships as the twin the future bake
// rider wires thin's customer profile to. Its own generator (ai-
// reengagement.ts) needs more than body-prediction's does — status,
// visitPace.lastVisitAgoDays, hasUpcomingBooking, preferredStaffName — so
// this route re-derives those via the SAME pure resolveCustomerStatus /
// computeVisitPace the web page's profile-screen.ts calls (never a second,
// possibly-drifting status implementation), fed by a TRIMMED read wave
// (enrichment + lifecycle + staff roster + the same 8 karute records the
// generator's §1 call needs) rather than the full buildCustomerProfileScreen
// 12-read wave, whose photos/memory/passport/packs output this gate never
// uses. ponytail: hasTicketPack reads the raw customer flag only, skipping
// profile-screen.ts's packs-table active-pack refinement — narrow edge case
// (a customer whose ONLY returning-evidence is an active pack with zero
// karute/appointment history); revisit if that ever proves wrong live.

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { readCustomerRaw } from '@/lib/app-api/karute-facade'
import { getCustomerKaruteRecordsWithClient } from '@/actions/karute'
import { getReengagementDraftWithClient } from '@/lib/karute/ai-reengagement'
import { enrichCustomers, effectiveLastVisitIso, effectiveFirstVisitIso } from '@/lib/customers/list-enrich'
import { customerVisitCount, isReturningCustomer, resolveCustomerStatus } from '@/lib/customers/status-signals'
import { computeVisitPace } from '@/lib/visits/pace'
import { getCustomerLifecycleCheckedWithClient } from '@/lib/packs/store'
import { staffListByBusinessOrThrow, type StaffMember } from '@/lib/staff'

export const runtime = 'nodejs'

type Params = { id: string }

function readLocale(ctx: FacadeContext<Params>): 'ja' | 'en' {
  const raw = new URL(ctx.req.url).searchParams.get('locale')
  return raw === 'en' ? 'en' : 'ja'
}

export const GET = facadeHandler<Params>('customer.ai.reengagement', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'customer id is required')

  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)
  // Tenancy proof — must-502 side (cross-tenant/missing → 404, upstream → 502).
  const customer = await readCustomerRaw(synqed, id)

  // 8 sessions ≈ 2 months of rhythm (page + §1 parity) — the SAME fetch the
  // generator's own §1 call reuses, so there is no second karute read.
  const [records, enrichment, lifecycleRead, staffList] = await Promise.all([
    getCustomerKaruteRecordsWithClient(synqed, id, 8),
    enrichCustomers(businessId, [id]),
    getCustomerLifecycleCheckedWithClient(synqed, id),
    staffListByBusinessOrThrow(businessId).catch((): StaffMember[] => []),
  ])
  const enr = enrichment.get(id)
  const lifecycle = lifecycleRead.ok ? lifecycleRead.lifecycle : null
  const lastVisitIso = effectiveLastVisitIso(
    enr?.lastVisitIso ?? records[0]?.session_date ?? records[0]?.created_at ?? null,
    customer.last_visit_at,
  )
  const statusSignals = {
    joinDateIso: customer.created_at,
    lastVisitIso,
    isExistingCustomer: customer.is_existing_customer,
    visitCount: customer.visit_count,
    karuteCount: records.length,
    pastAppointmentCount: enr?.pastAppointmentCount,
    hasTicketPack: customer.has_ticket_pack ?? false,
  }
  const hasUpcomingBooking = !!enr?.nextAppointmentIso
  const status = resolveCustomerStatus({
    ...statusSignals,
    hasUpcomingBooking,
    lifecycleStatus: lifecycle?.status,
  })
  const visitPace = computeVisitPace({
    firstVisitIso: effectiveFirstVisitIso(enr?.firstVisitIso, customer.first_visit_at),
    lastVisitIso,
    datedVisitCount: enr?.datedVisitCount ?? 0,
    totalVisits: customerVisitCount(statusSignals),
    isReturning: isReturningCustomer(statusSignals),
    isTerminal: !lifecycleRead.ok || lifecycle?.status === 'graduated' || lifecycle?.status === 'lost',
  })
  const preferredStaffName = customer.assigned_staff_id
    ? (staffList.find((s) => s.id === customer.assigned_staff_id)?.full_name ?? null)
    : null

  const draft = await getReengagementDraftWithClient(
    synqed,
    businessId,
    ctx.identity.authUserId,
    ctx.meta.requestId,
    {
      customerId: id,
      customerName: customer.name,
      status,
      visitCount: customerVisitCount(statusSignals),
      lastVisitAgoDays: visitPace.lastVisitAgoDays,
      preferredStaffName,
      hasUpcomingBooking,
      locale: readLocale(ctx),
    },
  )
  return ok(ctx, { draft })
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
