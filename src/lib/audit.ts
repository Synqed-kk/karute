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
  'booking',
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

// ── Facade endpoint totality (contract §2.1 / PR-M4) ────────────────────
// The single set of legal facade endpoint keys. `facadeHandler`'s `endpoint`
// param (src/lib/app-api/handler.ts) AND FACADE_AUDIT_MAP's key type both
// bind to this union — an unmapped or typo'd key is then a `tsc` error,
// enforced by the compiler instead of a scan. Both call forms
// (`facadeHandler('key', fn)` and `facadeHandler<Params>('key', fn)`) bind
// to it identically; CP1's fixture test (src/lib/app-api/__typetests__/
// facade-endpoint-key.ts) pins that both forms stay covered. Census: 75 keys
// across 31 plain + 44 generic call sites, re-derived from source by the
// totality test (facade-audit.test.ts) — that test fails loud if this union
// drifts from src/app/api/**.
export type FacadeEndpointKey =
  | 'ai.chat'
  | 'ai.extract'
  | 'ai.suggestions'
  | 'ai.summarize'
  | 'ai.transcribe'
  | 'appointment.cancel'
  | 'appointment.create'
  | 'appointment.noShow'
  | 'appointment.restore'
  | 'askAi.read'
  | 'audit.list'
  | 'customer.ai.bodyPrediction'
  | 'customer.ai.preSessionBrief'
  | 'customer.consent.grant'
  | 'customer.consent.read'
  | 'customer.consent.revoke'
  | 'customer.lifecycle.set'
  | 'customer.memory.add'
  | 'customer.memory.delete'
  | 'customer.memory.relearn'
  | 'customer.memory.update'
  | 'customer.pack.alert.dismiss'
  | 'customer.pack.burnable'
  | 'customer.pack.contact.log'
  | 'customer.pack.create'
  | 'customer.pack.reconcile.dismiss'
  | 'customer.pack.redeem'
  | 'customer.pack.undoRedemption'
  | 'customer.passport.upsert'
  | 'customer.photo.upload'
  | 'customer.read'
  | 'customer.update'
  | 'customers.list'
  | 'entitlement.read'
  | 'export'
  | 'invite.create'
  | 'invite.list'
  | 'invite.revoke'
  | 'karute.ai.suggestedMessage'
  | 'karute.entry.update'
  | 'karute.entryEdits.list'
  | 'karute.outcome.set'
  | 'karute.read'
  | 'karute.regenerate'
  | 'karute.save'
  | 'orgSettings.update'
  | 'permissions.get'
  | 'permissions.update'
  | 'recordings.job.enqueue'
  | 'recordings.job.status'
  | 'recordings.session.mint'
  | 'recordings.uploadUrl'
  | 'screens.appointments'
  | 'screens.chrome'
  | 'screens.dashboard'
  | 'screens.dataExport'
  | 'screens.profile'
  | 'screens.record'
  | 'screens.settings'
  | 'screens.welcome'
  | 'sessions.list'
  | 'staff.create'
  | 'staff.delete'
  | 'staff.removePin'
  | 'staff.setPin'
  | 'staff.update'
  | 'staff.uploadAvatar'
  | 'staff.voice.enroll'
  | 'staff.voice.revoke'
  | 'staffStores.get'
  | 'staffStores.set'
  | 'stores.create'
  | 'stores.list'
  | 'stores.update'
  | 'sync.run'

export interface FacadeAuditRule {
  kind: 'view' | 'mutation' | 'skip'
  category: AuditCategory
  action: string
  targetType?: AuditEvent['targetType']
  /** Dated tracked-TODO (e.g. 'Wave V — 2026-07-27'): the row's classification
   *  is decided but its writer isn't built yet. logFacadeAudit no-ops for any
   *  rule carrying this — set kind/category/action to the FUTURE truth, never
   *  leave the row silently claiming coverage it doesn't have (contract C2). */
  pendingWave?: string
}

// ── Facade endpoint → audit classification ──────────────────────────────
// TOTAL map (contract §2.1/§3.1): every FacadeEndpointKey has an explicit
// row — the Record<FacadeEndpointKey,...> type makes a missing key a tsc
// error, not a silent gap. 'skip' documents a DELIBERATE exemption (lists
// never log; per-fetch screen reads that aren't a person-record open don't
// either; some skips point at a choke point elsewhere via a coveredBy
// comment — C2's justification idiom). `pendingWave` marks a row whose
// action is decided but whose writer isn't built yet (dated tracked-TODO,
// C2/F6): logFacadeAudit treats it as no-emit until the wave lands — never
// a silent claim of coverage that doesn't exist (the false AI相談-row
// lesson, contract §11/D5).
export const FACADE_AUDIT_MAP: Record<FacadeEndpointKey, FacadeAuditRule> = {
  // Opening ONE customer's full profile = a view event.
  'customer.read': { kind: 'view', category: 'customer', action: 'customer.view', targetType: 'customer' },
  'customer.update': { kind: 'mutation', category: 'customer', action: 'customer.edit', targetType: 'customer' },
  // karute.save is NOT a row here (deliberately, packet 30 §3): it logs at
  // the shared choke point createOrUpdateKaruteRecord (src/actions/karute.ts)
  // instead — that ONE emit covers the web save actions AND this facade
  // route. A row here would double-log every facade save. Deny-default doc
  // rule readers: do not add 'karute.save' to this map.
  // List render ≠ a view (Liam ruling 2026-07-17) — names on a list don't log.
  'customers.list': { kind: 'skip', category: 'customer', action: '' },
  // AI相談 logs once per SESSION (wired at the session mint, not this screen GET).
  'askAi.read': { kind: 'skip', category: 'ai', action: '' },
  // Same ruling for the chat send itself — per-message turns don't re-log.
  'ai.chat': { kind: 'skip', category: 'ai', action: '' },
  // Booking mutations (Liam ruling 2026-07-26: everything gets logged,
  // including bookings): the ONE booking.create/cancel/no_show/restore emit
  // lives in the shared cores (createAppointmentCore / cancelAppointmentCore /
  // markNoShowAppointmentCore / restoreAppointmentCore, src/lib/appointments/
  // mutations.ts) — the ONE function both the web action and this facade
  // route call. A row here would double-log every facade write. (Category is
  // decorative on 'skip' rows — nothing emits.)
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
  // stores CRUD (design-parity packet 12 §B-3 S2): the OPPOSITE reason from
  // orgSettings.update above — createStoreCore/updateStoreCore (the ONE core
  // both the web action and this facade route call) already emit
  // settings.store_create / settings.store_update themselves. A rule here
  // would double-log every facade create/update; list reads stay unmapped
  // (list-render-is-not-a-view, same ruling as customers.list).
  'stores.create': { kind: 'skip', category: 'settings', action: '' },
  'stores.update': { kind: 'skip', category: 'settings', action: '' },
  // staff CRUD + avatar + permissions + staff-stores (design-parity packet
  // 12 §S4a): createStaffCore/updateStaffCore/deleteStaffCore/
  // uploadStaffAvatarCore/setStaffPermissionsCore/setStaffStoresCore (the
  // ONE core both the web action and the matching facade route call) already
  // emit their own row (staff.add/update/remove/avatar_update,
  // settings.permissions_change, settings.staff_stores_change). Same
  // reasoning as stores.create/update above — a rule here would double-log
  // every facade write.
  'staff.create': { kind: 'skip', category: 'staff', action: '' },
  'staff.update': { kind: 'skip', category: 'staff', action: '' },
  'staff.delete': { kind: 'skip', category: 'staff', action: '' },
  'staff.uploadAvatar': { kind: 'skip', category: 'staff', action: '' },
  'permissions.update': { kind: 'skip', category: 'settings', action: '' },
  'staffStores.set': { kind: 'skip', category: 'settings', action: '' },
  // PIN + voice + invites (design-parity packet 12 §S4b): setStaffPinCore/
  // removeStaffPinCore/enrollVoiceActionCore/revokeVoiceActionCore/
  // createInviteCore/revokeInviteCore (the ONE core both the web action and
  // the matching facade route call) already emit their own row
  // (staff.pin_set/pin_removed, privacy.voice_enroll/voice_revoke,
  // staff.invite_create/invite_revoke). Same reasoning as staff.create/
  // update/delete above — a rule here would double-log every facade write.
  'staff.setPin': { kind: 'skip', category: 'staff', action: '' },
  'staff.removePin': { kind: 'skip', category: 'staff', action: '' },
  'staff.voice.enroll': { kind: 'skip', category: 'privacy', action: '' },
  'staff.voice.revoke': { kind: 'skip', category: 'privacy', action: '' },
  'invite.create': { kind: 'skip', category: 'staff', action: '' },
  'invite.revoke': { kind: 'skip', category: 'staff', action: '' },
  // 今すぐ同期 manual crawl trigger (Liam ruling 7/24, packet 32): an owner
  // action worth a trail row, same family as settings.sync_config_update
  // above — this endpoint only TRIGGERS core's crawl (no credentials touched
  // here), so a row here does not double-log anything core itself emits.
  'sync.run': { kind: 'mutation', category: 'settings', action: 'settings.sync_run_now', targetType: 'business' },
  // karute.entry_edit is NOT a row here (deliberately, edit-layer W2 PR-B
  // fleet round — same doctrine as karute.save above): it logs at the shared
  // choke point updateKaruteDetailEntryWithClient (src/actions/karute.ts)
  // instead — that ONE emit covers the web action AND this facade route
  // ('karute.entry.update'). A row here would double-log every facade edit.
  // Deny-default doc rule readers: do not add 'karute.entry.update' to this map.
}
