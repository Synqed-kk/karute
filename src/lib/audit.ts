// Audit event emitter — the app side of the 監査ログ spine (design canon:
// ~/Documents/Claude/karute-ai-quality/AUDIT-LOG-DESIGN.md, mirrored in the
// Anthony ask's Addendum 2).
import { after } from 'next/server'
import type { AuditAction } from '@/lib/audit-policy'
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
  /** Namespaced key, e.g. 'karute.view', 'settings.permissions_change'. Typed
   *  against audit-policy's AUDIT_ACTIONS (type-only import — the emitter
   *  stays dependency-free); tsc totality is CP4's enforcement (contract §8). */
  action: AuditAction
  /** Auth user UUID; null for system/cron-originated events. */
  actorId: string | null
  actorType: 'staff' | 'system'
  businessId: string | null
  /** Store scope for this event, when the action has a natural store context
   *  (core's logSchema already accepts it — synqed-kk/client's
   *  AuditEventInput.store_id). Wave-M threading only; no back-filling
   *  lookups (contract §7 / PR-M5 piece ②). */
  storeId?: string
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
      store_id: e.storeId ?? null,
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

// Contract §7 / PR-M5 piece ①: core's AuditEventInput has no request_id
// column yet (ask A4, sent/undelivered) — until it lands, a short id rides in
// `detail.request_id` (detail is capped ~2KB server-side, so this always
// fits). Never overwrite a caller-supplied detail.request_id.
function detailWithRequestId(
  detail: AuditEvent['detail'],
  requestId: string | undefined,
): AuditEvent['detail'] | undefined {
  if (!requestId) return detail ?? undefined
  if (detail && Object.prototype.hasOwnProperty.call(detail, 'request_id')) return detail
  return { ...(detail ?? {}), request_id: requestId }
}

// Drop counter — every swallowed forwardToCore failure increments this (PR-M5
// piece ⑤ / contract §5's "failure is never silent"). The console line above
// (audit_sink_error) is the primary alert net; this is a cheap in-process
// count a health-check/test can read. ponytail: a `let` + getter, no metrics
// library — durable alerting (>1% rule) is its own Wave-M build item.
let coreForwardDropCount = 0
export function getCoreForwardDropCount(): number {
  return coreForwardDropCount
}
/** Test seam — reset between cases. */
export function _resetCoreForwardDropCount(): void {
  coreForwardDropCount = 0
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
      detail: detailWithRequestId(e.detail, e.requestId),
      store_id: e.storeId ?? null,
      break_glass: e.breakGlass ?? false,
      severity: CORE_SEVERITY[e.severity ?? 'info'],
    })
  } catch (err) {
    // Never let auditing break (or slow) the calling path — the console line
    // above already recorded the event for the drain.
    coreForwardDropCount += 1
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
// totality test (facade-audit-totality.test.ts) — that test fails loud if
// this union drifts from src/app/api/**.
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
  action: AuditAction | ''
  targetType?: AuditEvent['targetType']
  /** Dated tracked-TODO (e.g. 'Wave V — 2026-07-27'): the row's classification
   *  is decided but its writer isn't built yet. logFacadeAudit no-ops for any
   *  rule carrying this — set kind/category/action to the FUTURE truth, never
   *  leave the row silently claiming coverage it doesn't have (contract C2). */
  pendingWave?: string
  /** Structured choke-point citation, format 'src/path/file.ts#symbolName' —
   *  the file+symbol whose OWN body carries the real emit for a 'skip' row
   *  that's covered elsewhere (e.g. karute.save → createOrUpdateKaruteRecord),
   *  or (rarely) a self-citation for a row whose emit already lives at this
   *  exact route. CP2 (audit-coveredby.test.ts) walks every row carrying this
   *  field and proves the citation is real (contract §8 CP2). Prose comments
   *  stay alongside — this is a machine-checkable index, not a replacement. */
  coveredBy?: string
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
  // AI相談 mint (⚖ Liam ruled Option A, 2026-07-28): the row mints PER
  // EXCHANGE at the send (ai.chat) — the generic hook fires on every 2xx now
  // that the marker is off, and the route enriches it with
  // {first_turn, history_len} via ctx.auditDetail. Canon for the "ONE row
  // per session" phrasing: the first_turn row IS the session row. A
  // screen-open mint at askAi.read was rejected (weak evidence of intent,
  // and CP7's shape law fails the natural braced form of a first-send-only
  // conditional emit, pushing writers to unconditional per-exchange emits —
  // its walker is lexical dominance, not full control-flow analysis).
  // askAi.read stays a dated tracked-TODO VERBATIM — its
  // retirement is a ledgered (Anthony-gated) edit, queued, someday; until
  // then the marker keeps it from re-acquiring a false "covered elsewhere"
  // claim (the false AI相談-row lesson, C2/F6).
  'askAi.read': { kind: 'mutation', category: 'ai', action: 'ai.consult_session', pendingWave: 'Wave W — 2026-07-27' },
  'ai.chat': { kind: 'mutation', category: 'ai', action: 'ai.consult_session' },
  // Booking mutations (Liam ruling 2026-07-26: everything gets logged,
  // including bookings): the ONE booking.create/cancel/no_show/restore emit
  // lives in the shared cores (createAppointmentCore / cancelAppointmentCore /
  // markNoShowAppointmentCore / restoreAppointmentCore, src/lib/appointments/
  // mutations.ts) — the ONE function both the web action and this facade
  // route call. A row here would double-log every facade write. (Category is
  // decorative on 'skip' rows — nothing emits.)
  'appointment.create': { kind: 'skip', category: 'customer', action: '', coveredBy: 'src/lib/appointments/mutations.ts#createAppointmentCore' },
  'appointment.cancel': { kind: 'skip', category: 'customer', action: '', coveredBy: 'src/lib/appointments/mutations.ts#cancelAppointmentCore' },
  'appointment.noShow': { kind: 'skip', category: 'customer', action: '', coveredBy: 'src/lib/appointments/mutations.ts#markNoShowAppointmentCore' },
  'appointment.restore': { kind: 'skip', category: 'customer', action: '', coveredBy: 'src/lib/appointments/mutations.ts#restoreAppointmentCore' },
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
  'stores.create': { kind: 'skip', category: 'settings', action: '', coveredBy: 'src/actions/stores.ts#createStoreCore' },
  'stores.update': { kind: 'skip', category: 'settings', action: '', coveredBy: 'src/actions/stores.ts#updateStoreCore' },
  // staff CRUD + avatar + permissions + staff-stores (design-parity packet
  // 12 §S4a): createStaffCore/updateStaffCore/deleteStaffCore/
  // uploadStaffAvatarCore/setStaffPermissionsCore/setStaffStoresCore (the
  // ONE core both the web action and the matching facade route call) already
  // emit their own row (staff.add/update/remove/avatar_update,
  // settings.permissions_change, settings.staff_stores_change). Same
  // reasoning as stores.create/update above — a rule here would double-log
  // every facade write.
  'staff.create': { kind: 'skip', category: 'staff', action: '', coveredBy: 'src/actions/staff.ts#createStaffCore' },
  'staff.update': { kind: 'skip', category: 'staff', action: '', coveredBy: 'src/actions/staff.ts#updateStaffCore' },
  'staff.delete': { kind: 'skip', category: 'staff', action: '', coveredBy: 'src/actions/staff.ts#deleteStaffCore' },
  'staff.uploadAvatar': { kind: 'skip', category: 'staff', action: '', coveredBy: 'src/actions/staff.ts#uploadStaffAvatarCore' },
  'permissions.update': { kind: 'skip', category: 'settings', action: '', coveredBy: 'src/actions/permissions.ts#setStaffPermissionsCore' },
  'staffStores.set': { kind: 'skip', category: 'settings', action: '', coveredBy: 'src/actions/stores.ts#setStaffStoresCore' },
  // PIN + voice + invites (design-parity packet 12 §S4b): setStaffPinCore/
  // removeStaffPinCore/enrollVoiceActionCore/revokeVoiceActionCore/
  // createInviteCore/revokeInviteCore (the ONE core both the web action and
  // the matching facade route call) already emit their own row
  // (staff.pin_set/pin_removed, privacy.voice_enroll/voice_revoke,
  // staff.invite_create/invite_revoke). Same reasoning as staff.create/
  // update/delete above — a rule here would double-log every facade write.
  'staff.setPin': { kind: 'skip', category: 'staff', action: '', coveredBy: 'src/actions/staff-pin.ts#setStaffPinCore' },
  'staff.removePin': { kind: 'skip', category: 'staff', action: '', coveredBy: 'src/actions/staff-pin.ts#removeStaffPinCore' },
  'staff.voice.enroll': { kind: 'skip', category: 'privacy', action: '', coveredBy: 'src/actions/voice.ts#enrollVoiceActionCore' },
  'staff.voice.revoke': { kind: 'skip', category: 'privacy', action: '', coveredBy: 'src/actions/voice.ts#revokeVoiceActionCore' },
  'invite.create': { kind: 'skip', category: 'staff', action: '', coveredBy: 'src/actions/invites.ts#createInviteCore' },
  'invite.revoke': { kind: 'skip', category: 'staff', action: '', coveredBy: 'src/actions/invites.ts#revokeInviteCore' },
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

  // View-class rows (§3.1) — LIVE as of Wave V: single-record opens on the
  // four view surfaces, emitted by the generic success hook like every other
  // live row. karute.read specifically: the design-canon table mandates a
  // transcriptShown flag on this row (stored snake_case, `transcript_shown`,
  // per the detail-key convention — same as client_request_id) — the route
  // hands it to THE HOOK'S OWN emit via ctx.auditDetail (handler.ts), not a
  // separate direct audit() call. The pre-gate plan ("direct call at the
  // route, export-row pattern") would have demoted this row to
  // skip+coveredBy, which CP8 prices as an owner-approved ledger weakening;
  // the auditDetail seam delivers the same flag while the row stays a live
  // view and the emit stays the hook's unconditional-on-2xx write. Web twin:
  // the karute detail page fires its own karute.view with the same detail
  // (auditWeb — src/app/[locale]/(app)/karute/[id]/page.tsx, registered in
  // AUDITED_CORES).
  'karute.read': { kind: 'view', category: 'karute', action: 'karute.view', targetType: 'karute' },
  'karute.entryEdits.list': { kind: 'view', category: 'karute', action: 'karute.entry_edits_view', targetType: 'karute' },
  'customer.ai.preSessionBrief': { kind: 'view', category: 'customer', action: 'customer.brief_view', targetType: 'customer' },
  'customer.ai.bodyPrediction': { kind: 'view', category: 'customer', action: 'customer.ai_prediction_view', targetType: 'customer' },
  // 監査ログ list (§3.1): the row is the TWIN'S OWN write — the facade GET
  // delegates to listAuditLogWithClient (src/actions/audit-log.ts), which is
  // meant to write privacy.audit_log.view unconditionally per invocation for
  // BOTH surfaces — that unconditional write lands with PR #630 (at the
  // gate, 2026-07-27) — MERGE-ORDERED BEFORE THIS PR; verify at merge time.
  // A live rule here would double-log every facade list once #630 lands —
  // same reasoning as the karute.save choke-point skip. The facade route's
  // own header (app/v1/audit-log/route.ts) documents this contract.
  'audit.list': { kind: 'skip', category: 'privacy', action: '', coveredBy: 'src/actions/audit-log.ts#listAuditLogWithClient' },

  // export (§3.1 row 8): self-covered, NOT a row worth double-logging — this
  // route calls audit() directly with a custom `detail` payload (scope/
  // format/privacy/columns/store_id, AUDIT-LOG-DESIGN §7) that the generic
  // hook cannot reproduce (see src/app/api/app/v1/export/route.ts's own
  // header comment — verified at source, it already emits
  // privacy.customer_export on every successful export).
  'export': { kind: 'skip', category: 'privacy', action: '', coveredBy: 'src/app/api/app/v1/export/route.ts#GET' },

  // ai.* baseline (§3.1: "log →" rows) + karute.ai.suggestedMessage — writers
  // live as of Wave W1 (2026-07-28). Same twins as the out-of-facade legacy
  // /api/ai/* routes (API_ROUTE_DECISIONS below) — both get the same action
  // per key.
  'ai.extract': { kind: 'mutation', category: 'ai', action: 'ai.memory_extract' },
  'ai.summarize': { kind: 'mutation', category: 'ai', action: 'ai.summary_generate' },
  // FIX ROUND 1 (2026-07-28) correction: the prior comment cited the WEB
  // route's evidence for THIS facade row — wrong twin. This key is reached by
  // LOCAL-mode shell builds: thin/main.tsx:30 setRecordingPipelinePort(
  // viteRecordingPort) wires thin/ports/recording.vite.ts:16's
  // aiBase: '/api/app/v1/ai' (this facade route), baked into device builds via
  // scripts/shell/release.mjs (KARUTE_SHELL_MODE=local) — field-confirmed
  // 2026-07-28 (device renders the local bundle). The WEB pipeline instead
  // reaches the LEGACY twin (src/lib/ai-pipeline.ts:104, recording-port.ts:68's
  // aiBase '/api/ai') — that evidence now lives on the decision row below
  // (API_ROUTE_DECISIONS['ai/transcribe']) instead of here.
  'ai.transcribe': { kind: 'mutation', category: 'recording', action: 'recording.transcribe' },
  'ai.suggestions': { kind: 'mutation', category: 'ai', action: 'ai.suggested_message' },
  // Weakest-held row (D2) — hidden from default feed is a Wave W viewer
  // concern, not a facade-map field; writer live as of Wave W1 (2026-07-28).
  // Facade-side client: thin/screens/KaruteDetailScreen.tsx:81 (SuggestedMessageSlot's
  // useAiSlot call against this exact route).
  'karute.ai.suggestedMessage': { kind: 'mutation', category: 'ai', action: 'ai.suggested_message', targetType: 'karute' },

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
  // undoRedemption's route param is the REDEMPTION id (packs/redemptions/[id]/
  // undo/route.ts), NOT the customer id — logFacadeAudit stamps params.id
  // verbatim as targetId, so a targetType:'customer' row here would wrongly
  // stamp a redemption UUID as the customer target (breaks the per-customer
  // dispute view — four-lens blind-round finding, 2026-07-27). No cheap fix
  // exists: PacksClient (node_modules/@synqed-kk/client) has no
  // getRedemption(id)-by-id lookup, and removeRedemption's own response is
  // just `{ ok: boolean }` — the customer id isn't derivable from anything
  // that exists today without a NEW core method, not merely an extra round-
  // trip with what's already there. targetType omitted deliberately: the row
  // still emits customer.pack_undo with no target — honest > wrong. Wave-W
  // refinement: add a core getRedemption(id) lookup (or have removeRedemption
  // return customer_id) so this row can carry a correct target.
  'customer.pack.undoRedemption': { kind: 'mutation', category: 'customer', action: 'customer.pack_undo' },

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
  // (FIX ROUND 1 #14 — fact-check correction: the route (src/app/api/app/v1/
  // karute/[id]/regenerate/route.ts) reads NO body at all — only `id` from
  // params and `locale` from a query string — so there is no "mode" for a
  // second action to depend on; regenerateKaruteWithClient (src/actions/
  // regenerate-karute.ts) never mentions a summary-regenerate action either.
  // Only karute.entries_regenerate exists. pendingWave stays: the writer
  // (the three SDK calls inside regenerateKaruteEntriesWithClient/rollback/
  // updateKaruteSummaryWithClient) isn't wired to emit this action yet — see
  // SDK_WRITE_ALLOWLIST's regenerate-karute.ts entries.
  'karute.regenerate': { kind: 'mutation', category: 'karute', action: 'karute.entries_regenerate', targetType: 'karute', pendingWave: 'Wave W — 2026-07-27' },

  // recordings.* (§3.1: "Inventory-verified; CP2 keeps the claim honest").
  // recordings.job.enqueue: the job-pipeline's OWN choke point is
  // process-recording.ts#processJob (karute.ts's own header on
  // createOrUpdateKaruteRecord says "process-recording.ts does NOT call this
  // function" — verified, FIX ROUND 1 #17) — the enqueue step routes
  // EXCLUSIVELY into that worker, never into the interactive save.
  'recordings.job.enqueue': { kind: 'skip', category: 'recording', action: '', coveredBy: 'src/lib/jobs/process-recording.ts#processJob' },
  // recordings.session.mint / recordings.uploadUrl: BOTH stage audio/ids for
  // EITHER downstream pipeline (verified at source: thin's
  // viteRecordingPort.prepareTranscription AND .stageForJob both call the
  // SAME upload-url facade endpoint before diverging — one leg reaches
  // createOrUpdateKaruteRecord via the interactive transcribe→save flow, the
  // other reaches processJob via enqueueJob). coveredBy keeps citing the
  // interactive choke point (the default/primary flow when no job is
  // enqueued); the job-pipeline alternative is real too and not reducible to
  // one symbol — flagged here rather than silently picking one truth.
  'recordings.session.mint': { kind: 'skip', category: 'recording', action: '', coveredBy: 'src/actions/karute.ts#createOrUpdateKaruteRecord' },
  'recordings.uploadUrl': { kind: 'skip', category: 'recording', action: '', coveredBy: 'src/actions/karute.ts#createOrUpdateKaruteRecord' },

  // karute.save / karute.entry.update (§3.1 last row: "deliberate skip, now
  // with machine-readable coveredBy" — C2 formalizes what the comments above
  // already document). Total-map requirement pulls these two INTO the map
  // for the first time; same doctrine as the standing comments earlier in
  // this file (do not remove those comments — this is the map row they were
  // always describing).
  'karute.save': { kind: 'skip', category: 'karute', action: '', coveredBy: 'src/actions/karute.ts#createOrUpdateKaruteRecord' },
  'karute.entry.update': { kind: 'skip', category: 'karute', action: '', coveredBy: 'src/actions/karute.ts#updateKaruteDetailEntryWithClient' },
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
   *  reason nothing emits. Free text — CP2 (audit-coveredby.test.ts, in this
   *  PR) machine-resolves the structured `coveredBy` field below, never this
   *  prose. */
  justification: string
  /** ISO date this decision was made/last reviewed. */
  dated: string
  /** Same dated tracked-TODO device as FacadeAuditRule.pendingWave — the
   *  action is decided, the writer isn't built yet. */
  pendingWave?: string
  /** Structured taxonomy source for a pendingWave row whose action is decided
   *  but not yet emitted anywhere — CP4 (audit-actions-taxonomy.test.ts)
   *  reads this instead of parsing the free-text justification. */
  action?: AuditAction
  /** Same structured choke-point citation as FacadeAuditRule.coveredBy —
   *  'src/path/file.ts#symbolName'. CP2 walks every row carrying this. */
  coveredBy?: string
}

export const API_ROUTE_DECISIONS: Record<string, ApiRouteDecision | Record<string, ApiRouteDecision>> = {
  // Legacy /api/ai/* — 5 of 7 stay live (advice/insights were deleted, #629,
  // D5). §3.1: decision rows on BOTH twins (this route + its facade twin
  // above) using the SAME ai.* action. Four of five went LIVE in Wave W1
  // (2026-07-28, direct auditWeb writers at each route); only ai/chat stays
  // pendingWave — its mint design is Wave W2 (Liam ruled Option A, 7/28).
  // Auth: `chat` already has the explicit getUser() 401 guard;
  // extract/summarize/suggestions/transcribe have carried the same guard
  // since PR-M3 (#632, merged 2026-07-27).
  'ai/chat': {
    kind: 'log',
    justification:
      'ai.consult_session (§3.1, Option A — Liam 7/28) — writer live (Wave W2): auditWeb() emits per exchange before the success response, first_turn/history_len in detail; auth guard present (getUser 401).',
    dated: '2026-07-28',
    action: 'ai.consult_session',
    coveredBy: 'src/app/api/ai/chat/route.ts#POST',
  },
  'ai/extract': {
    kind: 'log',
    justification: 'ai.memory_extract (§3.1) — writer live (Wave W1): auditWeb() emits before the success response.',
    dated: '2026-07-28',
    action: 'ai.memory_extract',
    coveredBy: 'src/app/api/ai/extract/route.ts#POST',
  },
  'ai/summarize': {
    kind: 'log',
    justification: 'ai.summary_generate (§3.1) — writer live (Wave W1): auditWeb() emits before the success response.',
    dated: '2026-07-28',
    action: 'ai.summary_generate',
    coveredBy: 'src/app/api/ai/summarize/route.ts#POST',
  },
  'ai/suggestions': {
    kind: 'log',
    justification: 'ai.suggested_message (§3.1) — writer live (Wave W1): auditWeb() emits before every non-error response.',
    dated: '2026-07-28',
    action: 'ai.suggested_message',
    coveredBy: 'src/app/api/ai/suggestions/route.ts#POST',
  },
  // FIX ROUND 1 (2026-07-28) correction: this justification now carries the
  // WEB pipeline's own evidence (moved off the facade row's comment above,
  // which was citing the wrong twin) — src/lib/ai-pipeline.ts:104 fetches
  // this legacy route via recording-port.ts:68's aiBase '/api/ai'.
  'ai/transcribe': {
    kind: 'log',
    justification:
      "recording.transcribe (§3.1) — verified alive 2026-07-28: src/lib/ai-pipeline.ts:104 fetches this route via recording-port.ts:68 aiBase '/api/ai', plus 7/27 3-day prod-log traffic; writer live (Wave W1): auditWeb() emits before every non-error response.",
    dated: '2026-07-28',
    action: 'recording.transcribe',
    coveredBy: 'src/app/api/ai/transcribe/route.ts#POST',
  },

  // 今すぐ同期 (§3.1): mutation, maps to the same sync.run classification as
  // the facade twin. The cited emit + capability gate lands with PR #631
  // (at the gate, 2026-07-27) — MERGE-ORDERED BEFORE THIS PR; verify at
  // merge time.
  'sync/quickreserve': {
    kind: 'mutation',
    justification:
      "settings.sync_run_now — coveredBy this route's own auditWeb call (src/app/api/sync/quickreserve/route.ts) — lands with PR #631 (at the gate, 2026-07-27) — MERGE-ORDERED BEFORE THIS PR; verify at merge time.",
    dated: '2026-07-27',
    coveredBy: 'src/app/api/sync/quickreserve/route.ts#POST',
  },
  // Split by method: the config GET is a metadata read (credentials never
  // leave core regardless — synqed.sync.getConfig omits the password — but
  // the sync.view capability gate itself lands with PR #631, at the gate,
  // 2026-07-27 — MERGE-ORDERED BEFORE THIS PR; verify at merge time); the
  // config POST already emits today (verified at source:
  // settings.sync_config_update via auditWeb, pre-existing).
  'sync/quickreserve/config': {
    GET: {
      kind: 'skip',
      justification:
        'sync-settings metadata read; credentials never leave core (synqed.sync.getConfig omits the password) — the sync.view gate lands with PR #631 (at the gate, 2026-07-27) — MERGE-ORDERED BEFORE THIS PR; verify at merge time.',
      dated: '2026-07-27',
    },
    POST: {
      kind: 'mutation',
      justification:
        "coveredBy this route's own settings.sync_config_update auditWeb emit (pre-existing, verified at source).",
      dated: '2026-07-27',
      coveredBy: 'src/app/api/sync/quickreserve/config/route.ts#POST',
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
    coveredBy: 'src/app/api/export/route.ts#GET',
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
