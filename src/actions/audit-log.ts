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
  /** Write-time snapshot name (SDK 1.14, synqed-core PR #52) — durable even
   *  after the staff row is renamed/removed. Absent on old cached responses;
   *  optional here so those keep parsing. Component prefers this over the
   *  live roster lookup. */
  actor_label?: string | null
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

/** View-kind actions (customer.view, privacy.audit_log_view, …) — core's
 *  exclude_views param (T2, packet 18) now does this filtering server-side,
 *  so this file no longer calls it. Kept per packet instruction: still the
 *  naming-convention reference other callers may need. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept intentionally, see above
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
      /** Exact 変更/警告 strip counts (SDK 1.14 severity/exclude_views params —
       *  packet 18 T1). Both null together on ANY probe failure (never a
       *  partial sum) or when the probes are skipped (I7 actorId scope, or
       *  breakGlass — the strip's own feed IS the count then). Component
       *  falls back to its client-side approximate count + '+' when null. */
      warningsTotal: number | null
      changesTotal: number | null
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
    // Local SDK (1.11.1) has no `audit` property yet — `synqed.audit.list`
    // below already errors at tsc baseline (11, unchanged by CI's real
    // ^1.15.0). Extracting the accessor ONCE keeps that a single error site
    // instead of one per probe call (ponytail: `as any` scoped to this one
    // line, not sprinkled per call — upgrade path is deleting this cast once
    // the SDK bump lands).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same stale-SDK gap as above, scoped to one line
    const auditListProbe = (synqed as any).audit.list as (
      q: Record<string, unknown>,
    ) => Promise<{ total: number }>
    // T1 strip-count probes (page_size 1, total only) — skipped under the
    // SAME condition as the break-glass probe below (I7 actorId scope) plus
    // breakGlass on (that feed IS the count strip then).
    const skipStripProbes = Boolean(filters.breakGlass) || Boolean(filters.actorId)

    const [res, breakGlassRes, warnAllRes, critAllRes, nvAllRes, nvWarnRes, nvCritRes] =
      await Promise.all([
        synqed.audit.list({
          ...baseQuery,
          exclude_views: filters.includeViews ? undefined : true,
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
        skipStripProbes
          ? null
          : auditListProbe({ ...baseQuery, severity: 'warn', page: 1, page_size: 1 }).catch(
              () => null,
            ),
        skipStripProbes
          ? null
          : auditListProbe({ ...baseQuery, severity: 'critical', page: 1, page_size: 1 }).catch(
              () => null,
            ),
        skipStripProbes
          ? null
          : auditListProbe({ ...baseQuery, exclude_views: true, page: 1, page_size: 1 }).catch(
              () => null,
            ),
        skipStripProbes
          ? null
          : auditListProbe({
              ...baseQuery,
              exclude_views: true,
              severity: 'warn',
              page: 1,
              page_size: 1,
            }).catch(() => null),
        skipStripProbes
          ? null
          : auditListProbe({
              ...baseQuery,
              exclude_views: true,
              severity: 'critical',
              page: 1,
              page_size: 1,
            }).catch(() => null),
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

    // exclude_views:true above is now the ONLY view-kind filter on this path
    // (T2) — core does the exact same job the client used to do with
    // isViewAction, so the events don't get re-filtered here.
    // includeViews:true sends no exclude_views param, so this stays every row.
    const events = res.events as AuditLogEvent[]
    // Both totals null together on any probe failure or skip — never a
    // partial sum from a failed pair (T1).
    const probesOk = [warnAllRes, critAllRes, nvAllRes, nvWarnRes, nvCritRes].every(
      (r) => r !== null,
    )
    return {
      ok: true,
      events,
      total: res.total,
      page: res.page,
      // hasMore now follows the exact-filtered count — exclude_views:true
      // above means res.total already matches what's on screen.
      hasMore: res.page * res.page_size < res.total,
      breakGlassTotal: breakGlassRes
        ? breakGlassRes.total
        : filters.breakGlass
          ? res.total
          : null,
      warningsTotal: probesOk ? warnAllRes!.total + critAllRes!.total : null,
      changesTotal: probesOk ? nvAllRes!.total - nvWarnRes!.total - nvCritRes!.total : null,
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
  // Pre-extraction this call sat inside the read's own try — a failed client
  // construction must keep returning the 'failed' envelope, never throw
  // across the server-action boundary.
  let synqed: Awaited<ReturnType<typeof getSynqedClient>>
  try {
    synqed = await getSynqedClient()
  } catch {
    return { ok: false, error: 'failed' }
  }
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
