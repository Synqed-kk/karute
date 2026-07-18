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

export async function listAuditLog(filters: AuditLogFilters): Promise<
  | {
      ok: true
      events: AuditLogEvent[]
      total: number
      page: number
      hasMore: boolean
    }
  | { ok: false; error: 'forbidden' | 'failed' }
> {
  try {
    ensureCapability(await getMyCapabilities(), 'audit.view')
  } catch {
    return { ok: false, error: 'forbidden' }
  }
  try {
    const synqed = await getSynqedClient()
    const page = Math.max(1, Math.trunc(filters.page ?? 1))
    const res = await synqed.audit.list({
      category: filters.category || undefined,
      target_type: filters.targetId ? 'customer' : undefined,
      target_id: filters.targetId || undefined,
      break_glass: filters.breakGlass ? true : undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      page,
      page_size: PAGE_SIZE,
    })

    // Opening the 監査ログ is itself a privileged read — one row per open
    // (the section sends logOpen on its first fetch only; filter clicks and
    // paging are the same open). Its _view suffix keeps it out of the
    // default feed like every other view event.
    if (filters.logOpen) {
      audit({
        category: 'privacy',
        action: 'privacy.audit_log_view',
        actorId: await getCurrentUserStaffId().catch(() => null),
        actorType: 'staff',
        businessId: await getBusinessId().catch(() => null),
        ...(filters.targetId
          ? { targetType: 'customer' as const, targetId: filters.targetId }
          : {}),
        source: 'web',
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
    }
  } catch {
    return { ok: false, error: 'failed' }
  }
}
