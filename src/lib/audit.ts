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
  // AI相談 (contract §3.1, "replace FALSE skip" — council finding): the
  // comment this replaces claimed the row was "wired at the session mint,
  // not this screen GET" — no such writer exists anywhere. Honest state:
  // ai.consult_session, ONE row per session, is DECIDED but not built —
  // dated tracked-TODO (C2/F6), never a silent skip claiming coverage that
  // doesn't exist (the false AI相談-row lesson). Which of these two keys
  // actually mints the row (session open vs first send) is a Wave W design
  // question — both carry the marker so neither can re-acquire a false
  // "covered elsewhere" claim in the interim.
  'askAi.read': { kind: 'mutation', category: 'ai', action: 'ai.consult_session', pendingWave: 'Wave W — 2026-07-27' },
  'ai.chat': { kind: 'mutation', category: 'ai', action: 'ai.consult_session', pendingWave: 'Wave W — 2026-07-27' },
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

  // ── PR-M4 map totality (contract §3.1, remaining 47 keys) ──────────────

  // Wayfinding/metadata skips (§3.1 row 1: "lists and chrome never log",
  // canon §5) — screens.* chrome, plus every plain list/metadata GET.
  'screens.chrome': { kind: 'skip', category: 'staff', action: '' },
  'screens.profile': { kind: 'skip', category: 'staff', action: '' },
  'screens.settings': { kind: 'skip', category: 'settings', action: '' },
  'screens.welcome': { kind: 'skip', category: 'staff', action: '' },
  'screens.record': { kind: 'skip', category: 'recording', action: '' },
  'screens.appointments': { kind: 'skip', category: 'customer', action: '' },
  'screens.dataExport': { kind: 'skip', category: 'privacy', action: '' },
  'sessions.list': { kind: 'skip', category: 'recording', action: '' },
  'stores.list': { kind: 'skip', category: 'settings', action: '' },
  'invite.list': { kind: 'skip', category: 'staff', action: '' },
  'staffStores.get': { kind: 'skip', category: 'settings', action: '' },
  'permissions.get': { kind: 'skip', category: 'settings', action: '' },
  'entitlement.read': { kind: 'skip', category: 'billing', action: '' },
  'customer.pack.burnable': { kind: 'skip', category: 'customer', action: '' },
  'customer.consent.read': { kind: 'skip', category: 'customer', action: '' },
  'recordings.job.status': { kind: 'skip', category: 'recording', action: '' },

  // screens.dashboard (§3.1 D4, Liam-confirmed): the attention cards render a
  // one-line per-customer memo preview (attention.ts:142-144) and AI-generated
  // lines from summaries — same shape as the karute-list 80-char preview canon
  // deliberately exempts. Skip under that precedent; fields named here so a
  // future dispute has something concrete to revisit: memo preview text,
  // AI-generated attention line text.
  'screens.dashboard': { kind: 'skip', category: 'customer', action: '' },

  // View-class rows (§3.1): action decided, DELIBERATELY not emitting yet —
  // the viewer front-end + these writers are Wave V per contract §11. Kind/
  // category/action carry the FUTURE truth so Wave V doesn't have to
  // re-derive it; pendingWave keeps logFacadeAudit silent until then.
  'karute.read': { kind: 'view', category: 'karute', action: 'karute.view', targetType: 'karute', pendingWave: 'Wave V — 2026-07-27' },
  'karute.entryEdits.list': { kind: 'view', category: 'karute', action: 'karute.entry_edits_view', targetType: 'karute', pendingWave: 'Wave V — 2026-07-27' },
  'customer.ai.preSessionBrief': { kind: 'view', category: 'customer', action: 'customer.brief_view', targetType: 'customer', pendingWave: 'Wave V — 2026-07-27' },
  'customer.ai.bodyPrediction': { kind: 'view', category: 'customer', action: 'customer.ai_prediction_view', targetType: 'customer', pendingWave: 'Wave V — 2026-07-27' },
  // 監査ログ list (§3.1): the row is the TWIN'S OWN write — the facade GET
  // delegates to listAuditLogWithClient (src/actions/audit-log.ts), which
  // writes privacy.audit_log.view unconditionally per invocation for BOTH
  // surfaces (PR-M1, #630). A live rule here would double-log every facade
  // list — same reasoning as the karute.save choke-point skip. The facade
  // route's own header (app/v1/audit-log/route.ts) documents this contract.
  'audit.list': { kind: 'skip', category: 'privacy', action: '' },

  // export (§3.1 row 8): self-covered, NOT a row worth double-logging — this
  // route calls audit() directly with a custom `detail` payload (scope/
  // format/privacy/columns/store_id, AUDIT-LOG-DESIGN §7) that the generic
  // hook cannot reproduce (see src/app/api/app/v1/export/route.ts's own
  // header comment — verified at source, it already emits
  // privacy.customer_export on every successful export).
  'export': { kind: 'skip', category: 'privacy', action: '' },

  // ai.* baseline (§3.1: "log →" rows) + karute.ai.suggestedMessage — the
  // canon Wave-2 baseline never built; action decided, writer is Wave W
  // (contract §11). Same twins as the out-of-facade legacy /api/ai/* routes
  // (API_ROUTE_DECISIONS below) — both get the same action per key.
  'ai.extract': { kind: 'mutation', category: 'ai', action: 'ai.memory_extract', pendingWave: 'Wave W — 2026-07-27' },
  'ai.summarize': { kind: 'mutation', category: 'ai', action: 'ai.summary_generate', pendingWave: 'Wave W — 2026-07-27' },
  // Verify this route is still reachable post-server-pipeline before Wave W
  // wires the emit (§3.1: "if dead, delete instead of map").
  'ai.transcribe': { kind: 'mutation', category: 'recording', action: 'recording.transcribe', pendingWave: 'Wave W — 2026-07-27' },
  'ai.suggestions': { kind: 'mutation', category: 'ai', action: 'ai.suggested_message', pendingWave: 'Wave W — 2026-07-27' },
  // Weakest-held row (D2) — hidden from default feed is a Wave W viewer
  // concern, not a facade-map field; nothing to add here beyond the marker.
  'karute.ai.suggestedMessage': { kind: 'mutation', category: 'ai', action: 'ai.suggested_message', targetType: 'karute', pendingWave: 'Wave W — 2026-07-27' },

  // customer.memory.* (§3.1: "Worst attribution cluster") — live now: the
  // facade's own hook is the first thing that has ever emitted these:
  // W3.2's web-silent-hole list (customer-memory.ts ×11) is the SEPARATE
  // web-action gap, tracked for Wave W independently of this map.
  'customer.memory.add': { kind: 'mutation', category: 'customer', action: 'customer.memory_add', targetType: 'customer' },
  'customer.memory.update': { kind: 'mutation', category: 'customer', action: 'customer.memory_update', targetType: 'customer' },
  'customer.memory.delete': { kind: 'mutation', category: 'customer', action: 'customer.memory_delete', targetType: 'customer' },
  // Relearn logs rolled-back attempts (canon §12).
  'customer.memory.relearn': { kind: 'mutation', category: 'customer', action: 'customer.memory_relearn', targetType: 'customer' },

  // customer.pack.* mutations (§3.1 canon §0 hole 3; race class R2 §6).
  'customer.pack.create': { kind: 'mutation', category: 'customer', action: 'customer.pack_create', targetType: 'customer' },
  'customer.pack.redeem': { kind: 'mutation', category: 'customer', action: 'customer.pack_redeem', targetType: 'customer' },
  'customer.pack.undoRedemption': { kind: 'mutation', category: 'customer', action: 'customer.pack_undo', targetType: 'customer' },

  // consent/lifecycle/outcome mutation MIRRORS (§3.1 D1: today these are
  // row-stamped only — stamps stay as defense-in-depth). D1 mirror events are
  // EXPLICITLY Wave W per the build packet ("The 20 web writers + D1 mirrors
  // + ai.* baseline events = Wave W") — the mirror design decides its emit
  // point (shared core vs per-surface) there; a live facade rule now would
  // double-log the facade side the moment that lands. Action strings below
  // are placeholders per the repo's category.snake_verb convention — CP4's
  // generated taxonomy canonizes them in the proof-suite PR.
  'customer.consent.grant': { kind: 'mutation', category: 'customer', action: 'customer.consent_grant', targetType: 'customer', pendingWave: 'Wave W — 2026-07-27' },
  'customer.consent.revoke': { kind: 'mutation', category: 'customer', action: 'customer.consent_revoke', targetType: 'customer', pendingWave: 'Wave W — 2026-07-27' },
  'customer.lifecycle.set': { kind: 'mutation', category: 'customer', action: 'customer.lifecycle_set', targetType: 'customer', pendingWave: 'Wave W — 2026-07-27' },
  'karute.outcome.set': { kind: 'mutation', category: 'karute', action: 'karute.outcome_set', targetType: 'karute', pendingWave: 'Wave W — 2026-07-27' },

  // Photos are the customer (§3.1).
  'customer.passport.upsert': { kind: 'mutation', category: 'customer', action: 'customer.passport_update', targetType: 'customer' },
  'customer.photo.upload': { kind: 'mutation', category: 'customer', action: 'customer.photo_add', targetType: 'customer' },

  // karute.regenerate (§3.1: "mutation → karute.entries_regenerate /
  // karute.summary_regenerate", canon Wave 2, batch rules canon §4.2): the
  // table gives TWO possible actions for this ONE static endpoint key — which
  // one fires depends on the regenerate mode in the request body, and
  // FacadeAuditRule's action is a fixed string per key, so neither can be
  // picked correctly from this map alone. Marked pendingWave rather than
  // guess-and-possibly-mislabel a security-sensitive row; flagged for the
  // director — resolving this needs either two endpoint keys or a
  // request-body-driven action, both outside a map-totality PR's scope.
  'karute.regenerate': { kind: 'mutation', category: 'karute', action: 'karute.entries_regenerate', targetType: 'karute', pendingWave: 'Wave W — 2026-07-27' },

  // recordings.* (§3.1: "Inventory-verified; CP2 keeps the claim honest") —
  // all three skip, coveredBy the SAME choke point as karute.save/
  // karute.entry.update above: the pipeline's ONE eventual karute.save call
  // is what logs, not the enqueue/mint/upload-url steps that stage it.
  'recordings.job.enqueue': { kind: 'skip', category: 'recording', action: '' },
  'recordings.session.mint': { kind: 'skip', category: 'recording', action: '' },
  'recordings.uploadUrl': { kind: 'skip', category: 'recording', action: '' },

  // karute.save / karute.entry.update (§3.1 last row: "deliberate skip, now
  // with machine-readable coveredBy" — C2 formalizes what the comments above
  // already document). Total-map requirement pulls these two INTO the map
  // for the first time; same doctrine as the standing comments earlier in
  // this file (do not remove those comments — this is the map row they were
  // always describing).
  'karute.save': { kind: 'skip', category: 'karute', action: '' },
  'karute.entry.update': { kind: 'skip', category: 'karute', action: '' },
}

// ── Out-of-facade route decisions (contract §2.3/§2.5, PR-M4) ───────────
// The fifth door: every route.ts under src/app/api/** OUTSIDE the facade
// subtree (src/app/api/app/v1/**) also needs an explicit decision — a
// bulk-mutation route (今すぐ同期) and unauthed legacy AI routes were both
// invisible to every v1 mechanism precisely because nothing walked this
// tree. Keyed by the route's path relative to src/app/api (no leading
// slash, no trailing /route.ts, e.g. 'sync/quickreserve/config') — CP1's
// totality test (facade-audit-totality.test.ts) derives the same key and
// fails loud for any route.ts file with neither a facade-map row nor an
// entry here.
export interface ApiRouteDecision {
  /** 'log' mirrors the table's own verb for the ai.* actions (§3.1) — a
   *  content-generation/consult event, distinct from a CRUD 'mutation'. */
  kind: 'mutation' | 'view' | 'skip' | 'log'
  /** Cites the covering file#symbol for a skip/already-emits row, or the
   *  reason nothing emits. Free text — CP2 (a follow-up PR, not this one)
   *  is what machine-resolves these. */
  justification: string
  /** ISO date this decision was made/last reviewed. */
  dated: string
  /** Same dated tracked-TODO device as FacadeAuditRule.pendingWave — the
   *  action is decided, the writer isn't built yet. */
  pendingWave?: string
}

export const API_ROUTE_DECISIONS: Record<string, ApiRouteDecision | Record<string, ApiRouteDecision>> = {
  // Legacy /api/ai/* — 5 of 7 stay live (advice/insights were deleted, #629,
  // D5). §3.1: decision rows on BOTH twins (this route + its facade twin
  // above) using the SAME ai.* action; all pendingWave — the writers land
  // Wave W, same as the facade twins. Auth: `chat` already has the explicit
  // getUser() 401 guard; extract/summarize/suggestions/transcribe get the
  // same guard in PR-M3 (a sibling Wave-M PR, not built here).
  'ai/chat': {
    kind: 'log',
    justification:
      'ai.consult_session (§3.1 askAi.read+ai.chat row) — writer not built (false session-mint claim, the AI相談 lesson); auth guard already present (getUser 401).',
    dated: '2026-07-27',
    pendingWave: 'Wave W — 2026-07-27',
  },
  'ai/extract': {
    kind: 'log',
    justification: 'ai.memory_extract (§3.1) — auth guard lands in PR-M3.',
    dated: '2026-07-27',
    pendingWave: 'Wave W — 2026-07-27',
  },
  'ai/summarize': {
    kind: 'log',
    justification: 'ai.summary_generate (§3.1) — auth guard lands in PR-M3.',
    dated: '2026-07-27',
    pendingWave: 'Wave W — 2026-07-27',
  },
  'ai/suggestions': {
    kind: 'log',
    justification: 'ai.suggested_message (§3.1) — auth guard lands in PR-M3.',
    dated: '2026-07-27',
    pendingWave: 'Wave W — 2026-07-27',
  },
  'ai/transcribe': {
    kind: 'log',
    justification:
      'recording.transcribe (§3.1) — auth guard lands in PR-M3; verify still reachable post-server-pipeline before Wave W wires the emit (§3.1: "if dead, delete instead of map").',
    dated: '2026-07-27',
    pendingWave: 'Wave W — 2026-07-27',
  },

  // 今すぐ同期 (§3.1): mutation, maps to the same sync.run classification as
  // the facade twin. ⚠ As of this tip the cited emit is PR-M2's work (a
  // sibling Wave-M PR, not built here) — this decision row describes the
  // state ONCE PR-M2 lands, not necessarily today; flagged in the PR-M4
  // build report.
  'sync/quickreserve': {
    kind: 'mutation',
    justification:
      'settings.sync_run_now — coveredBy this route\'s own auditWeb call (src/app/api/sync/quickreserve/route.ts), added by PR-M2 alongside the sync.view capability gate.',
    dated: '2026-07-27',
  },
  // Split by method: the config GET is a metadata read (sync.view-gated
  // since PR-M2, credentials never leave core — synqed.sync.getConfig omits
  // the password); the config POST already emits today (verified at
  // source: settings.sync_config_update via auditWeb, pre-existing).
  'sync/quickreserve/config': {
    GET: {
      kind: 'skip',
      justification: 'sync-settings metadata read; sync.view-gated since PR-M2; credentials never leave core.',
      dated: '2026-07-27',
    },
    POST: {
      kind: 'mutation',
      justification:
        "coveredBy this route's own settings.sync_config_update auditWeb emit (pre-existing, verified at source).",
      dated: '2026-07-27',
    },
  },
  'sync/quickreserve-deep': {
    kind: 'skip',
    justification: 'retired stub, always 501, no action performed.',
    dated: '2026-07-27',
  },

  // privacy.customer_export — verified at source: this route already calls
  // auditWeb() with the query scope persisted, after the export body builds
  // successfully (same shape as the facade twin's direct audit() call).
  export: {
    kind: 'mutation',
    justification: "coveredBy this route's own privacy.customer_export auditWeb emit (verified at source, pre-existing).",
    dated: '2026-07-27',
  },

  cleanup: {
    kind: 'skip',
    justification: 'CRON_SECRET-gated system janitor: orphaned-recording + expired-cache deletion; no user-attributable action.',
    dated: '2026-07-27',
  },
  'jobs/process': {
    kind: 'skip',
    justification: 'CRON_SECRET/worker-key-gated pipeline tick; recording pipeline audits at its own choke points.',
    dated: '2026-07-27',
  },
}
