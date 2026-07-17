// Audit event emitter — the app side of the 監査ログ spine (design canon:
// ~/Documents/Claude/karute-ai-quality/AUDIT-LOG-DESIGN.md, mirrored in the
// Anthony ask's Addendum 2).
//
// The durable audit_log table lives in synqed-core (Anthony item). Until that
// endpoint exists, every event emits as ONE structured console line — the same
// seam pattern as pin-throttle's lockout line and the facade error line — so
// capture points land now, events are observable in Vercel logs immediately,
// and the sink swaps to the core client in exactly one function later.
//
// PII rule for this interim sink: ids only. No customer names, no note/summary
// text, ever — display labels join in the DB layer later; log-drain lines must
// stay label-free.
//
// View-event rule (Liam 2026-07-17): a view logs only when ONE person's record
// is opened. List/search renders NEVER log — mapped 'skip' below, deliberately.

export const AUDIT_CATEGORIES = [
  'auth',
  'customer',
  'karute',
  'recording',
  'ai',
  'privacy',
  'settings',
  'staff',
  'billing',
] as const
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number]

export type AuditSeverity = 'info' | 'notice' | 'warning'

export interface AuditEvent {
  category: AuditCategory
  /** Namespaced key, e.g. 'karute.view', 'settings.permissions_change'. */
  action: string
  /** Auth user UUID; null for system/cron-originated events. */
  actorId: string | null
  actorType: 'staff' | 'system'
  businessId: string | null
  targetType?: 'customer' | 'karute' | 'staff' | 'recording' | 'business'
  targetId?: string
  /** Default 'info'. 'notice' = privileged/consequential, 'warning' = security. */
  severity?: AuditSeverity
  /** Privileged cross-access (dev tools, owner opening another staff's data).
   *  Always logged; gets its own filter chip in the viewer. */
  breakGlass?: boolean
  /** SMALL — ids/flags/counts only, never record content. */
  detail?: Record<string, string | number | boolean | null>
  requestId?: string
  source: 'facade' | 'web' | 'system'
}

/** Emit one audit event. Interim sink = one JSON console line (sync + cheap,
 *  so safe inline even on read paths). When this becomes a network call to the
 *  core audit endpoint: view-path callers move behind next/server's after()
 *  (a lost view row must never block or slow care delivery — design §4), and
 *  mutation writers move into the mutation's own core-side transaction. */
export function audit(e: AuditEvent): void {
  // Severity maps to console level so log drains keep their level semantics
  // (a 'warning' event — lockouts, deletions-scheduled — lands on the warn
  // channel exactly like the bespoke lines it replaces).
  const emit = (e.severity ?? 'info') === 'warning' ? console.warn : console.log
  emit(
    JSON.stringify({
      evt: 'audit',
      at: new Date().toISOString(),
      category: e.category,
      action: e.action,
      actor_id: e.actorId,
      actor_type: e.actorType,
      business_id: e.businessId,
      target_type: e.targetType ?? null,
      target_id: e.targetId ?? null,
      severity: e.severity ?? 'info',
      break_glass: e.breakGlass ?? false,
      detail: e.detail ?? null,
      request_id: e.requestId ?? null,
      source: e.source,
    }),
  )
}

// ── Facade endpoint → audit classification ──────────────────────────────
// Deny-default: an endpoint with no row here emits nothing — add the row when
// adding the route. 'skip' documents a DELIBERATE exemption (lists never log;
// per-fetch screen reads that aren't a person-record open don't either).
// Routes in the parked phase-2 stack inherit this hook on merge — their rows
// get added in the same PR that reconciles the stack (fix-plan P3).
export interface FacadeAuditRule {
  kind: 'view' | 'mutation' | 'skip'
  category: AuditCategory
  action: string
  targetType?: AuditEvent['targetType']
}

export const FACADE_AUDIT_MAP: Record<string, FacadeAuditRule> = {
  // Opening ONE customer's full profile = a view event.
  'customer.read': { kind: 'view', category: 'customer', action: 'customer.view', targetType: 'customer' },
  'customer.update': { kind: 'mutation', category: 'customer', action: 'customer.edit', targetType: 'customer' },
  // List render ≠ a view (Liam ruling 2026-07-17) — names on a list don't log.
  'customers.list': { kind: 'skip', category: 'customer', action: '' },
  // AI相談 logs once per SESSION (wired at the session mint, not this screen GET).
  'askAi.read': { kind: 'skip', category: 'ai', action: '' },
}
