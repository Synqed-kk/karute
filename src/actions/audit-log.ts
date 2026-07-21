'use server'

// 監査ログ viewer read path (AUDIT-LOG-DESIGN.md §11, fix-plan P1-D).
// Owner-only by default; a manager reaches it only via the explicit audit.view
// grant — enforced HERE (the tab filter is exposure reduction, not security).
import { getSynqedClient } from '@/lib/synqed/client'
import { getMyCapabilities, ensureCapability } from '@/lib/auth/require-permission'
import { audit } from '@/lib/audit'
import { getBusinessId, getCurrentUserStaffId } from '@/lib/staff'

/** Mirror of core's audit row (SDK 1.13 ListAuditResponse.events[]). Local
 *  mirror instead of the SDK type so this file types against the pinned local
 *  SDK too — CI compiles against 1.13 either way. */
export interface AuditLogEvent {
  id: string
  at: string
  actor_id: string | null
  actor_type: string
  category: string
  action: string
  target_type: string | null
  target_id: string | null
  target_label: string | null
  detail: unknown
  break_glass: boolean
  severity: string
}

export interface AuditLogFilters {
  category?: string
  /** Cause-based person filter (design §10 — raw events only, never stats). */
  actorId?: string
  /** ISO datetimes (core validates z.string().datetime()). */
  from?: string
  to?: string
  /** Per-customer dispute view (the ?target= deep-link). */
  targetId?: string
  /** Default feed hides view events (they outnumber changes ~10:1). */
  includeViews?: boolean
  breakGlass?: boolean
  page?: number
  /** Set by the section on its FIRST fetch only — one privacy.audit_log_view
   *  row per open, not per filter click. Best-effort UI semantics: the caller
   *  is already audit.view-gated above, so this flag only shapes volume. */
  logOpen?: boolean
}

const PAGE_SIZE = 100

/** View-kind actions (customer.view, privacy.audit_log_view, …) stay out of
 *  the default feed by naming convention — core has no kind column/filter. */
function isViewAction(action: string): boolean {
  return action.endsWith('.view') || action.endsWith('_view')
}

type ListAuditLogResult =
  | {
      ok: true
      events: AuditLogEvent[]
      total: number
      page: number
      hasMore: boolean
      /** Exact 緊急アクセス count for the summary strip (same window,
       *  break_glass=true). Null when unknown: the count query degraded, or
       *  a person filter is active (I7 — the strip never renders per-staff
       *  counts, so no aux query is spent). */
      breakGlassTotal: number | null
      /** Display names for this page's customer/store targets — rows store ids
       *  only (PII rule), so names join at read time. Staff resolve client-side
       *  off the roster the section already holds. */
      targetLabels: Record<string, string>
    }
  | { ok: false; error: 'forbidden' | 'failed' }

/** Client-threaded core of listAuditLog (facade Bearer path, design-parity
 *  packet 17 §S3 — the 監査ログ tab going live). Carries the post-gate read
 *  AND the logOpen write so web and facade can never diverge; `actor` is the
 *  ONLY thing that differs between callers (cookie-resolved staff/business
 *  for web, Bearer-resolved for the facade) — null when this fetch isn't
 *  opening the log (filter clicks and paging never write the row). */
export async function listAuditLogWithClient(
  synqed: Awaited<ReturnType<typeof getSynqedClient>>,
  actor: { staffId: string | null; businessId: string | null; source: 'web' | 'facade' } | null,
  filters: AuditLogFilters,
): Promise<ListAuditLogResult> {
  try {
    const page = Math.max(1, Math.trunc(filters.page ?? 1))
    const baseQuery = {
      category: filters.category || undefined,
      actor_id: filters.actorId || undefined,
      target_type: filters.targetId ? ('customer' as const) : undefined,
      target_id: filters.targetId || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
    }
    const [res, breakGlassRes] = await Promise.all([
      synqed.audit.list({
        ...baseQuery,
        break_glass: filters.breakGlass ? true : undefined,
        page,
        page_size: PAGE_SIZE,
      }),
      // Strip count — page_size 1, only the total matters. Skipped when the
      // break-glass filter is already on (the main total IS the count) and
      // when a person filter is active (the strip hides — I7). Best-effort:
      // a failed count must never take the feed down with it.
      filters.breakGlass || filters.actorId
        ? null
        : synqed.audit
            .list({ ...baseQuery, break_glass: true, page: 1, page_size: 1 })
            .catch(() => null),
    ])

    // Opening the 監査ログ is itself a privileged read — one row per open
    // (the section sends logOpen on its first fetch only; filter clicks and
    // paging are the same open). Its _view suffix keeps it out of the
    // default feed like every other view event.
    if (filters.logOpen) {
      audit({
        category: 'privacy',
        action: 'privacy.audit_log_view',
        actorId: actor?.staffId ?? null,
        actorType: 'staff',
        businessId: actor?.businessId ?? null,
        ...(filters.targetId
          ? { targetType: 'customer' as const, targetId: filters.targetId }
          : {}),
        source: actor?.source ?? 'web',
      })
    }

    const events = (res.events as AuditLogEvent[]).filter(
      (e) => filters.includeViews || !isViewAction(e.action),
    )
    return {
      ok: true,
      events,
      total: res.total,
      page: res.page,
      // hasMore follows the UNFILTERED count — the next page may still hold
      // non-view rows even when this one filtered to empty.
      hasMore: res.page * res.page_size < res.total,
      breakGlassTotal: breakGlassRes
        ? breakGlassRes.total
        : filters.breakGlass
          ? res.total
          : null,
      targetLabels: await resolveTargetLabels(synqed, events),
    }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

/** Thin wrapper — resolves the cookie session into `actor` ONLY when opening
 *  the log (the cookie reads stay gated exactly as before: filters.logOpen
 *  decides whether they run at all), then delegates to the twin. */
export async function listAuditLog(filters: AuditLogFilters): Promise<ListAuditLogResult> {
  try {
    ensureCapability(await getMyCapabilities(), 'audit.view')
  } catch {
    return { ok: false, error: 'forbidden' }
  }
  const synqed = await getSynqedClient()
  const actor = filters.logOpen
    ? {
        staffId: await getCurrentUserStaffId().catch(() => null),
        businessId: await getBusinessId().catch(() => null),
        source: 'web' as const,
      }
    : null
  return listAuditLogWithClient(synqed, actor, filters)
}

/** Batch name lookup for this page's customer + store targets. Best-effort:
 *  a failed lookup degrades to ids in the UI, never fails the feed. Deleted
 *  customers resolve while soft-deleted (include_deleted); hard-purged rows
 *  simply don't — the row's id stands, which is the honest state. */
async function resolveTargetLabels(
  synqed: Awaited<ReturnType<typeof getSynqedClient>>,
  events: AuditLogEvent[],
): Promise<Record<string, string>> {
  const idsOf = (type: string) =>
    [...new Set(events.filter((e) => e.target_type === type && e.target_id).map((e) => e.target_id!))]
  const labels: Record<string, string> = {}
  const customerIds = idsOf('customer')
  if (customerIds.length > 0) {
    try {
      const { customers } = await synqed.customers.list({
        ids: customerIds,
        include_deleted: true,
      })
      for (const c of customers) labels[c.id] = c.name
    } catch {
      /* ids remain */
    }
  }
  if (idsOf('store').length > 0) {
    try {
      const { stores } = await synqed.stores.list()
      for (const s of stores) labels[s.id] = s.name
    } catch {
      /* ids remain */
    }
  }
  return labels
}
