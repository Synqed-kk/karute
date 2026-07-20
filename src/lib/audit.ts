// Audit event emitter — the app side of the 監査ログ spine (design canon:
// ~/Documents/Claude/karute-ai-quality/AUDIT-LOG-DESIGN.md, mirrored in the
// Anthony ask's Addendum 2).
import { after } from 'next/server'
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
  targetType?: 'customer' | 'karute' | 'staff' | 'recording' | 'business' | 'store'
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

/** Emit one audit event. Two sinks, by design (§4):
 *   1. ONE structured console line — sync + cheap, survives in Vercel log
 *      drains, keeps its level semantics. Stays even now that the durable
 *      sink exists (belt + braces; drains are the outage-time record).
 *   2. The DURABLE row — core's append-only audit_log via synqed.audit.log.
 *      Starts immediately and never blocks or slows the caller ("the log
 *      proves presence, never absence"), but inside a request scope the
 *      write is handed to Next's after() so the serverless runtime stays
 *      alive until the row lands — a response finishing first can no longer
 *      freeze the write mid-flight. Outside a request scope (jest, module
 *      init) it degrades to plain fire-and-forget. Skipped when the event
 *      has no businessId (core writes are tenant-scoped; the console line
 *      still records it — e.g. pre-auth PIN lockouts). */
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

  if (e.businessId) {
    // Start NOW (zero added latency), then extend the function's lifetime
    // until the write settles. forwardToCore never rejects, so the fallback
    // void can't become an unhandled rejection.
    const durable = forwardToCore(e, e.businessId)
    try {
      after(durable)
    } catch {
      // No request scope to attach to — best-effort, as before.
      void durable
    }
  }
}

// App severities are richer than core's column enum — map, don't drop:
// info stays info; notice (privileged/consequential) → warn; warning
// (security: lockouts, deletions) → critical.
const CORE_SEVERITY: Record<AuditSeverity, 'info' | 'warn' | 'critical'> = {
  info: 'info',
  notice: 'warn',
  warning: 'critical',
}

/** The durable sink. Builds a business-scoped core client directly (the audit
 *  emitter can run outside a request's auth scope — cron, throttle callbacks —
 *  so it must not depend on getSynqedClient's session lookup). Never throws. */
async function forwardToCore(e: AuditEvent, businessId: string): Promise<void> {
  try {
    const baseUrl = process.env.SYNQED_CORE_URL
    const apiKey = process.env.SYNQED_CORE_API_KEY
    if (!baseUrl || !apiKey) return
    const { SynqedClient } = await import('@synqed-kk/client')
    const synqed = new SynqedClient({ baseUrl, apiKey, businessId })
    await synqed.audit.log({
      actor_id: e.actorId,
      actor_type: e.actorType,
      category: e.category,
      action: e.action,
      target_type: e.targetType ?? null,
      target_id: e.targetId ?? null,
      detail: e.detail ?? undefined,
      break_glass: e.breakGlass ?? false,
      severity: CORE_SEVERITY[e.severity ?? 'info'],
    })
  } catch (err) {
    // Never let auditing break (or slow) the calling path — the console line
    // above already recorded the event for the drain.
    console.warn(JSON.stringify({ evt: 'audit_sink_error', action: e.action, err: String(err) }))
  }
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
  // Same ruling for the chat send itself — per-message turns don't re-log.
  'ai.chat': { kind: 'skip', category: 'ai', action: '' },
  // Booking status writes (P-B 2/2): the audit trail lives in CORE — every
  // mutation stamps acting_staff_id / status_set_by / status_set_at on the
  // appointment row itself, and the web actions emit no app-side audit either.
  // A facade row here would double-log the binary relative to web. (Category
  // is decorative on 'skip' rows — nothing emits; there is no booking
  // category and skip rows are no reason to grow the core-coupled enum.)
  'appointment.create': { kind: 'skip', category: 'customer', action: '' },
  'appointment.cancel': { kind: 'skip', category: 'customer', action: '' },
  'appointment.noShow': { kind: 'skip', category: 'customer', action: '' },
  'appointment.restore': { kind: 'skip', category: 'customer', action: '' },
  // dashboard pack mutations (design-parity Gap B-1 PR 2): the trail lives
  // in the rows themselves (dismissed_by / contacted_by stamps on the
  // packs tables), and the web actions emit no app-side audit for these
  // either (verified against src/actions/packs.ts — no audit() calls).
  'customer.pack.reconcile.dismiss': { kind: 'skip', category: 'customer', action: '' },
  'customer.pack.alert.dismiss': { kind: 'skip', category: 'customer', action: '' },
  'customer.pack.contact.log': { kind: 'skip', category: 'customer', action: '' },
  // org-settings write (design-parity packet 12 §S1): writeOrgSettingsBlob has
  // no auditWeb() call on the web side (verified at source — no audit-log
  // import in src/actions/org-settings.ts) — a facade row here would log
  // something web itself never logs. Same parity rule as the appointment.*
  // rows above.
  'orgSettings.update': { kind: 'skip', category: 'settings', action: '' },
}
