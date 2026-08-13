// Audit taxonomy + coverage registries (proof-suite PR, contract §8, 2026-07-27).
// Hand-curated, machine-enforced by the CP2/CP3/CP4/CP7/CP8 proof suite
// (src/__tests__/integration/{audit-coveredby,sdk-write-sites,writer-emission,
// audit-actions-taxonomy}.test.ts + scripts/audit/check-audit-weakening.mjs).
// Kept separate from audit.ts so the emitter itself stays dependency-free
// (AuditEvent['action'] imports this file TYPE-ONLY).

// ── AUDIT_ACTIONS ──────────────────────────────────────────────────────────
// Exact union of: every non-empty FACADE_AUDIT_MAP action (live AND
// pendingWave), every structured decision-row
// action (API_ROUTE_DECISIONS), and every literal `action: '...'` string
// emitted via audit()/auditWeb() in src. CP4 (audit-actions-taxonomy.test.ts)
// enforces set-equality both directions — an orphan member (nobody maps/emits
// it) or a missing member (something emits a string not listed here) both
// fail loud. `// pending: Wave W` marks a member whose ONLY source today is a
// pendingWave map/decision row (the writer isn't built yet).
// Strictly alphabetical (CP4 enforces `[...AUDIT_ACTIONS].sort()` equality) —
// category is the string's own namespace prefix (customer.*, staff.*, ...),
// so a pure alphabetical sort keeps same-category members adjacent almost
// everywhere; the one exception is 'audit.unmapped_endpoint' (category:
// 'privacy', namespaced 'audit.' for historical reasons — it sorts next to
// 'auth.*', not next to the other privacy.* members) and 'ai.*'/
// 'recording.*'/'booking.*' interleaving with 'audit.'/'auth.' at the top.
export const AUDIT_ACTIONS = [
  'ai.consult_session',
  'ai.memory_extract',
  'ai.suggested_message',
  'ai.suggested_message_view',
  'ai.summary_generate',
  'audit.unmapped_endpoint', // category: privacy (see header note)
  'auth.pin_lockout',
  'booking.cancel',
  'booking.create',
  'booking.delete',
  'booking.no_show',
  'booking.restore',
  'booking.update',
  'customer.ai_prediction_view',
  'customer.brief_view',
  'customer.consent_grant',
  'customer.consent_revoke',
  'customer.create',
  'customer.edit',
  'customer.lifecycle_set',
  'customer.memory_add',
  'customer.memory_delete',
  'customer.memory_relearn',
  'customer.memory_update',
  'customer.pack_create',
  'customer.pack_redeem',
  'customer.pack_undo',
  'customer.passport_update',
  'customer.photo_add',
  'customer.photo_delete',
  'customer.photos_view',
  'customer.view',
  'karute.entries_regenerate', // pending: Wave W
  'karute.entry_edit',
  'karute.entry_edits_view',
  'karute.outcome_set',
  'karute.save',
  'karute.summary_edit',
  'karute.view',
  'privacy.audit_log.view',
  'privacy.customer_delete_canceled',
  'privacy.customer_delete_scheduled',
  'privacy.customer_export',
  'privacy.voice_enroll',
  'privacy.voice_revoke',
  'recording.transcribe',
  'settings.menu_create',
  'settings.permissions_change',
  'settings.staff_stores_change',
  'settings.store_create',
  'settings.store_update',
  'settings.sync_config_update',
  'settings.sync_run_now',
  'staff.add',
  'staff.avatar_update',
  'staff.invite_create',
  'staff.invite_mark_failed',
  'staff.invite_revoke',
  'staff.link_failed',
  'staff.pin_removed',
  'staff.pin_set',
  'staff.remove',
  'staff.update',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

// ── AUDITED_CORES ───────────────────────────────────────────────────────────
// The audited-core registry (CP3/CP3b coverage + CP7 emission proof). Seeded
// from the real current audited writers: every non-test src file with an
// `audit(`/`auditWeb(` call, EXCLUDING the three infrastructure emitters
// (src/lib/audit.ts, src/lib/audit-web.ts, src/lib/app-api/handler.ts — CP7
// excludes these explicitly) and one census false-positive
// (src/app/api/app/v1/org-settings/route.ts's header COMMENT mentions
// "auditWeb() call" in prose but the route makes no such call — verified at
// source; it is a deliberate FACADE_AUDIT_MAP skip with no writer at all).
//
// `symbols` is symbol-level COMPLETE (contract §8 round-2 amendment A — file
// membership alone grants nothing): every exported symbol in the file whose
// subtree (incl. nested closures like the emitSave idiom) contains a real
// audit()/auditWeb() call, verified by the same src-wide AST scan CP7 runs.
// One entry carries `unproven`: customers.ts#updateCustomer's single `return
// result` merges the success/no-op-failure paths through a plain identifier
// (not an object literal, not a call — `result` is a discriminated-union
// VARIABLE), which is un-provable by a lexical/AST walker without type
// information — the real auditWeb() call is correctly conditional
// (`if (result.success) { ...; auditWeb(...) }`), so this is a genuine
// mechanical-proof ceiling, not a code defect (facade-side coverage for
// customer.update is independently live via FACADE_AUDIT_MAP). CP7 registers
// it (registry-reality) but does not assert it passes the walker.
export const AUDITED_CORES: {
  file: string
  symbols: string[]
  unproven?: { symbol: string; reason: string }[]
  note?: string
}[] = [
  {
    file: 'src/lib/appointments/mutations.ts',
    symbols: [
      'createAppointmentCore',
      'cancelAppointmentCore',
      'restoreAppointmentCore',
      'markNoShowAppointmentCore',
      'deleteAppointmentCore',
      'updateAppointmentCore',
    ],
  },
  // FIX ROUND 1 #16: auditLockout is a private, non-exported helper, so the
  // registry-reality cross-check (which enumerates EXPORTED symbols only)
  // will never require this entry on its own — but findSymbol is
  // export-agnostic (processJob, below, is the existing precedent: also
  // private, also registered), and auditLockout's OWN body calls audit()
  // unconditionally, so it resolves and proves clean. Registered so the
  // real writer is provably covered, not left off as "not required."
  { file: 'src/lib/auth/pin-throttle.ts', symbols: ['auditLockout'] },
  { file: 'src/lib/jobs/process-recording.ts', symbols: ['processJob'] },
  // 自動消化 (packet 11) — the ONE auto-burn writer. The batch driver
  // autoBurnForBusiness is deliberately not listed: it performs no write of its
  // own and returns unemitted whenever there is nothing to burn.
  { file: 'src/lib/packs/auto-burn.ts', symbols: ['burnOneAutoRedemption'] },
  {
    file: 'src/actions/customers.ts',
    symbols: [
      'createCustomer',
      'createQuickCustomer',
      'updateCustomer',
      'emitDeletionAudit',
      // Wave W3 (D1 mirrors): the web twins of the facade consent rows.
      'grantCustomerConsent',
      'revokeCustomerConsent',
    ],
    unproven: [
      {
        symbol: 'updateCustomer',
        reason:
          'return result merges success/no-op-failure through a plain identifier (discriminated-union variable, not an object literal or call) — the conditional auditWeb() is correct but not lexically provable. See AUDITED_CORES header comment.',
      },
    ],
  },
  { file: 'src/actions/permissions.ts', symbols: ['setStaffPermissionsCore'] },
  { file: 'src/actions/staff-pin.ts', symbols: ['setStaffPinCore', 'removeStaffPinCore'] },
  { file: 'src/actions/voice.ts', symbols: ['enrollVoiceActionCore', 'revokeVoiceActionCore'] },
  { file: 'src/actions/stores.ts', symbols: ['createStoreCore', 'updateStoreCore', 'setStaffStoresCore'] },
  { file: 'src/actions/audit-log.ts', symbols: ['listAuditLogWithClient'] },
  // Menu catalog (PR-1a, create side). listMenus is a read — deliberately not
  // listed; the update/retire/reactivate writers land with PR-1b.
  { file: 'src/actions/menus.ts', symbols: ['createMenu'] },
  {
    file: 'src/actions/staff.ts',
    symbols: ['createStaffCore', 'updateStaffCore', 'deleteStaffCore', 'uploadStaffAvatarCore'],
  },
  { file: 'src/actions/invites.ts', symbols: ['createInviteCore', 'revokeInviteCore', 'acceptInvite'] },
  {
    file: 'src/actions/karute.ts',
    symbols: [
      'createOrUpdateKaruteRecord',
      'updateKaruteDetailEntryWithClient',
      'updateKaruteDetailSummaryWithClient',
    ],
  },
  {
    file: 'src/app/[locale]/(app)/customers/[id]/page.tsx',
    symbols: ['CustomerProfilePage'],
    note:
      'The page.tsx writer the original grep census missed (round-2 amendment A finding) — a single-record open (customer.view) fires a fire-and-forget auditWeb() at render.',
  },
  {
    file: 'src/app/[locale]/(app)/karute/[id]/page.tsx',
    symbols: ['KaruteDetailPage'],
    note:
      'Wave V: the web twin of the facade karute.view row — a single-record open fires a fire-and-forget auditWeb() after the existence check, carrying transcript_shown.',
  },
  { file: 'src/app/api/app/v1/export/route.ts', symbols: ['GET'] },
  { file: 'src/app/api/sync/quickreserve/config/route.ts', symbols: ['POST'] },
  { file: 'src/app/api/sync/quickreserve/route.ts', symbols: ['POST'] },
  { file: 'src/app/api/export/route.ts', symbols: ['GET'] },
  { file: 'src/app/api/ai/extract/route.ts', symbols: ['POST'] },
  { file: 'src/app/api/ai/summarize/route.ts', symbols: ['POST'] },
  { file: 'src/app/api/ai/suggestions/route.ts', symbols: ['POST'] },
  { file: 'src/app/api/ai/transcribe/route.ts', symbols: ['POST'] },
  // Wave W2 (Option A, Liam 7/28): ai.consult_session per exchange — the web
  // twin of the promoted facade ai.chat row.
  { file: 'src/app/api/ai/chat/route.ts', symbols: ['POST'] },
  // 2026-07-29 honesty split (Liam ruling): getSuggestedFollowUp emits the
  // per-VIEW row unconditionally on every non-error return (web twin of the
  // facade hook's view row); the 生成 row lives in the two PRIVATE helpers
  // (auditLockout pattern — each body emits unconditionally on its one
  // return path, computeSuggestedFollowUp conditions the CALL to the real
  // generation branch only). getSuggestedFollowUpWithClient stays
  // unregistered (and emit-free) — the facade hook + the facade helper are
  // that path's emitters.
  {
    file: 'src/lib/karute/ai-outreach.ts',
    symbols: [
      'getSuggestedFollowUp',
      'auditSuggestedMessageGeneratedWeb',
      'auditSuggestedMessageGeneratedFacade',
    ],
  },
  // Wave W3 (D1 mirrors): the web twins of the facade lifecycle/outcome rows.
  // The WithClient cores they wrap stay audit-free (Core/WithClient split);
  // updateKaruteOutcome is the AFTER-THE-FACT path only — a save-embedded
  // outcome write is covered by that path's karute.save row on both surfaces
  // (see the FACADE_AUDIT_MAP mirror-block comment in audit.ts).
  { file: 'src/actions/packs.ts', symbols: ['setLifecycleAction'] },
  { file: 'src/actions/karute-outcome.ts', symbols: ['updateKaruteOutcome'] },
]

// ── SDK_WRITE_ALLOWLIST ──────────────────────────────────────────────────────
// Every current SDK write call site (derived write-method set × src scan) —
// PLUS the CP3c surfaces (`.auth.admin.<method>(`, `.storage.from(bucket).
// <upload|remove|update|move|copy>(`, same 'call' shape convention:
// 'auth.admin.createUser', 'storage.<bucket>.remove') — that is NOT lexically
// inside one of the file's AUDITED_CORES `symbols` spans (round-2 amendment
// A: symbol-level, not file-level — a write call sitting in a DIFFERENT,
// unregistered function of an otherwise-audited file still needs its own
// entry here). Honest, dated justifications only — a silent write SAYS
// silent + names the wave that fixes it, or explains why it is not
// user-attributable / already covered by a mechanism CP3 can't see directly
// (the false AI相談-row lesson).
export const SDK_WRITE_ALLOWLIST: {
  file: string
  call: string
  /** The enclosing symbol(s) this entry covers, derived mechanically from
   *  the current scan (fix round 1 #7) — a site legal by (file, call) alone
   *  used to grant FILE-WIDE amnesty, contradicting the file's own
   *  symbol-level doctrine; a NEW site under an already-allowlisted (file,
   *  call) but a DIFFERENT symbol is a real gap CP3 must still catch. */
  symbols: string[]
  justification: string
  dated: string
  pendingWave?: string
}[] = [
  {
    file: 'src/actions/bootstrap.ts',
    call: 'staff.create',
    symbols: ['bootstrapBusinessForNewUser'],
    justification:
      "Signup bootstrap — creates the OWNER's own synqed staff record as part of account provisioning, not an admin managing staff. FIX ROUND 1 #13 correction: the actor is NOT unknown — the function verifies the auth uid via service.auth.admin.getUserById BEFORE this write and resolves businessId in the same call. Self-provisioning on the user's OWN new account; silent today; no wave committed (candidate mirror: a future staff.bootstrap action per the coverage inventory). No facade/web action endpoint covers this path at all.",
    dated: '2026-07-27',
  },
  {
    file: 'src/actions/customers.ts',
    call: 'customers.update',
    symbols: ['updateCustomerWithClient', 'scheduleCustomerDeletion', 'cancelCustomerDeletion'],
    justification:
      "customer.update is a LIVE FACADE_AUDIT_MAP row (facade auto-emit) — this call site sits inside updateCustomerWithClient/scheduleCustomerDeletion/cancelCustomerDeletion, none of which are AUDITED_CORES symbols. Web-path coverage: updateCustomerWithClient's caller (updateCustomer) conditionally auditWebs customer.edit (see AUDITED_CORES unproven note); scheduleCustomerDeletion/cancelCustomerDeletion each call emitDeletionAudit (AUDITED_CORES) unconditionally on the success path — verified at source, not lexically provable by symbol-span containment.",
    dated: '2026-07-27',
  },
  {
    file: 'src/actions/customers.ts',
    call: 'customers.uploadPhoto',
    symbols: ['uploadCustomerPhotoWithClient'],
    justification:
      "customer.photo.upload is a LIVE FACADE_AUDIT_MAP row (facade auto-emit). uploadCustomerPhotoWithClient itself never audits (deliberate — matches the WithClient/Core split convention where the shared core stays audit-free and only the facade's generic hook or a registered wrapper emits); the web action uploadCustomerPhoto has no auditWeb call today — parity gap, not built here.",
    dated: '2026-07-27',
  },
  {
    file: 'src/actions/customers.ts',
    call: 'customers.deletePhoto',
    symbols: ['deleteCustomerPhoto'],
    justification:
      // PR 9b device-wiring delta (2026-08-09) correction: customer.photo.delete
      // now IS a FacadeEndpointKey (see the entry below) — the ORIGINAL claim
      // here ("no FacadeEndpointKey covers photo deletion") no longer holds.
      // What is still true and unchanged: THIS call site is the WEB action's
      // own direct SDK call (deleteCustomerPhoto, src/actions/customers.ts),
      // which has no auditWeb() call — same parity-gap class as
      // customer.photo.upload's twin sentence below (the web upload action
      // has no auditWeb call either). Not pendingWave — no wave has claimed
      // web-side photo-action auditing.
      'customer.photo.delete is a LIVE FACADE_AUDIT_MAP row as of PR 9b (facade auto-emit) covering the DEVICE/facade path. The web action deleteCustomerPhoto (this call site) has no auditWeb call — parity gap, not built here.',
    dated: '2026-07-27',
  },
  {
    file: 'src/app/api/app/v1/customers/[id]/photos/[photoId]/route.ts',
    call: 'customers.deletePhoto',
    symbols: ['DELETE'],
    justification:
      "customer.photo.delete is a LIVE FACADE_AUDIT_MAP row (facade auto-emit) — same WithClient/Core-less shape as customer.photo.upload's entry above: the route handler itself never calls audit() directly, only the facade's generic hook (logFacadeAudit, excluded from AUDITED_CORES) does.",
    dated: '2026-08-09',
  },
  {
    file: 'src/actions/customers.ts',
    call: 'customers.grantConsent',
    symbols: ['grantCustomerConsentWithClient'],
    justification:
      'customer.consent_grant is a LIVE FACADE_AUDIT_MAP row as of Wave W3 (facade auto-emit); the web wrapper grantCustomerConsent emits its own auditWeb (AUDITED_CORES). grantCustomerConsentWithClient itself stays audit-free, matching the Core/WithClient split convention.',
    dated: '2026-07-28',
  },
  {
    file: 'src/actions/customers.ts',
    call: 'customers.revokeConsent',
    symbols: ['revokeCustomerConsentWithClient'],
    justification:
      'customer.consent_revoke is a LIVE FACADE_AUDIT_MAP row as of Wave W3 (facade auto-emit); the web wrapper revokeCustomerConsent emits its own auditWeb (AUDITED_CORES). revokeCustomerConsentWithClient itself stays audit-free, matching the Core/WithClient split convention.',
    dated: '2026-07-28',
  },
  {
    file: 'src/actions/karute.ts',
    call: 'karuteRecords.delete',
    symbols: ['deleteKaruteRecord'],
    justification:
      'deleteKaruteRecord — no FacadeEndpointKey covers karute deletion and no audit() call exists on this path today. Genuinely untracked, not pendingWave (no wave has claimed it). Flagged here rather than silently passing.',
    dated: '2026-07-27',
  },
  {
    file: 'src/actions/karute.ts',
    call: 'karuteRecords.create',
    symbols: ['createOrUpdateKaruteRecord', 'createManualKaruteRecord'],
    justification:
      'createOrUpdateKaruteRecord (AUDITED_CORES — this specific call site is its own fresh-record branch, dominated by its emitSave call-through, already proven by CP2/CP7) and createManualKaruteRecord (the "+ 新規カルテ" manual-entry dialog — a separate creation path with no audit() call today, genuinely untracked, not pendingWave).',
    dated: '2026-07-27',
  },
  {
    file: 'src/actions/org-settings.ts',
    call: 'orgSettings.upsert',
    symbols: ['writeOrgSettingsBlobWithClient'],
    justification:
      'Deliberately unaudited by design — see FACADE_AUDIT_MAP[\'orgSettings.update\'] skip row: "writeOrgSettingsBlob has no auditWeb() call on the web side" (verified at source). Not pendingWave-tracked; this is the accepted parity rule, not a gap.',
    dated: '2026-07-27',
  },
  {
    file: 'src/actions/recording-jobs.ts',
    call: 'recordingJobs.enqueue',
    symbols: ['enqueueRecordingJob'],
    justification:
      "coveredBy the eventual karute.save emit at pipeline completion (src/lib/jobs/process-recording.ts#processJob, AUDITED_CORES) — see FACADE_AUDIT_MAP['recordings.job.enqueue'] skip row (FIX ROUND 1 #17: this citation now correctly points at processJob, the job pipeline's true and only choke point — not createOrUpdateKaruteRecord, which karute.ts's own header comment says process-recording.ts never calls). The enqueue step itself stages no auditable outcome.",
    dated: '2026-07-27',
  },
  {
    file: 'src/actions/recordings.ts',
    call: 'recordings.create',
    symbols: ['startRecordingSessionWithClient'],
    justification:
      "mints the recording_sessions id only — nothing auditable happens until the eventual save. Feeds EITHER downstream pipeline (verified, FIX ROUND 1 #17): the interactive save (createOrUpdateKaruteRecord) or the job pipeline (processJob) — see FACADE_AUDIT_MAP['recordings.session.mint'] skip row comment for the same ambiguity on its facade twin.",
    dated: '2026-07-27',
  },
  {
    file: 'src/actions/regenerate-karute.ts',
    call: 'karuteRecords.deleteEntry',
    symbols: ['rollback', 'regenerateKaruteEntriesWithClient'],
    justification:
      "karute.regenerate — pendingWave (writer not wired to emit yet). FIX ROUND 1 #14 correction: the prior claim of TWO actions depending on a request-body mode was fabricated — the facade route (src/app/api/app/v1/karute/[id]/regenerate/route.ts) parses NO body at all (only `id` from params, `locale` from a query string), and only karute.entries_regenerate exists anywhere in this file. See FACADE_AUDIT_MAP['karute.regenerate'].",
    dated: '2026-07-27',
    pendingWave: 'Wave W — 2026-07-27',
  },
  {
    file: 'src/actions/regenerate-karute.ts',
    call: 'karuteRecords.addEntry',
    symbols: ['regenerateKaruteEntriesWithClient'],
    justification:
      "karute.regenerate — same pendingWave gap as karuteRecords.deleteEntry above in this file, same FIX ROUND 1 #14 correction (no request-body mode exists; only karute.entries_regenerate). See FACADE_AUDIT_MAP['karute.regenerate'].",
    dated: '2026-07-27',
    pendingWave: 'Wave W — 2026-07-27',
  },
  {
    file: 'src/actions/regenerate-karute.ts',
    call: 'karuteRecords.update',
    symbols: ['updateKaruteSummaryWithClient'],
    justification:
      "karute.regenerate — same pendingWave gap as the other regenerate-karute.ts write sites, same FIX ROUND 1 #14 correction (no request-body mode exists; only karute.entries_regenerate). See FACADE_AUDIT_MAP['karute.regenerate'].",
    dated: '2026-07-27',
    pendingWave: 'Wave W — 2026-07-27',
  },
  {
    file: 'src/actions/staff-pin.ts',
    call: 'staff.verifyPin',
    symbols: ['verifyStaffPin'],
    justification:
      'verifyStaffPin — a PIN verification attempt (correct or wrong), not a mutation of the target. FIX ROUND 1 #15 correction: auth.pin_lockout only fires once failures reach the lockout THRESHOLD (>= 5 within the rolling window, src/lib/auth/pin-throttle.ts recordPinFailure) — a single wrong PIN attempt below that threshold audits nothing at all, correctly (nothing was mutated). A successful verify is a profile-switch read-path, not a write the taxonomy tracks. Derives as a write only because the SDK endpoint is POST-shaped (known accepted noise).',
    dated: '2026-07-27',
  },
  {
    file: 'src/actions/stores.ts',
    call: 'stores.create',
    symbols: ['listStoresWithClient'],
    justification:
      "listStoresWithClient's lazy 本店-create (ensurePrimary). FIX ROUND 1 #12 correction: the prior claim that no facade/web surface triggers this was FALSE — ensurePrimary:true is passed from BOTH the stores.list facade GET and the listStores web action (layout + settings render), so this fires on every zero-store tenant's first read, not just at signup. The acting staff IS resolvable (the read's own identity) and the write is genuinely SILENT today (no audit call anywhere in listStoresWithClient). The coverage inventory's silent-hole list already claims this as settings.store_create, source:system — pendingWave reflects that.",
    dated: '2026-07-27',
    pendingWave: 'Wave W — 2026-07-27',
  },
  {
    file: 'src/app/api/app/v1/recordings/job/route.ts',
    call: 'recordingJobs.enqueue',
    symbols: ['POST'],
    justification:
      "Facade twin of src/actions/recording-jobs.ts — same coveredBy reasoning: the job pipeline's true choke point is process-recording.ts#processJob (see FACADE_AUDIT_MAP['recordings.job.enqueue'] skip row, corrected per FIX ROUND 1 #17).",
    dated: '2026-07-27',
  },
  {
    file: 'src/app/api/app/v1/sync/run/route.ts',
    call: 'sync.runNow',
    symbols: ['POST'],
    justification:
      "sync.run is a LIVE FACADE_AUDIT_MAP row (kind: 'mutation') — handler.ts's generic post-response hook (logFacadeAudit) auto-emits settings.sync_run_now on every 2xx from this route. No direct audit() call belongs in this file.",
    dated: '2026-07-27',
  },
  {
    file: 'src/app/api/app/v1/ai/transcribe/route.ts',
    call: 'storage.recordings.remove',
    symbols: ['POST'],
    justification:
      'Best-effort cleanup of the staged audio object after transcription (finally block, mirrors ai-pipeline.ts\'s own cleanup() timing — right after the transcribe call resolves, before extraction/summarization/save even start) — not itself a business action; the eventual karute.save is what audits.',
    dated: '2026-07-27',
  },
  {
    file: 'src/app/api/cleanup/route.ts',
    call: 'storage.recordings.remove',
    symbols: ['GET'],
    justification:
      "CRON_SECRET-gated system janitor (see API_ROUTE_DECISIONS['cleanup']: \"no user-attributable action\") — deletes orphaned recording objects on a schedule, not in response to any staff action.",
    dated: '2026-07-27',
  },
  {
    file: 'src/lib/ai-cache.ts',
    call: 'aiCache.upsert',
    symbols: ['setCachedAI'],
    justification:
      'Global AI-response cache write — internal performance cache (hash-of-input key, TTL expiry), not a user-attributable business mutation. No facade/web action surface exists for it.',
    dated: '2026-07-27',
  },
  {
    file: 'src/lib/ai-cache.ts',
    call: 'aiCache.cleanup',
    symbols: ['cleanupExpiredAiCache'],
    justification: 'Cron maintenance sweep of expired cache rows — system-internal, not user-attributable.',
    dated: '2026-07-27',
  },
  {
    file: 'src/lib/ai-rate-limit.ts',
    call: 'aiRateLimit.consume',
    symbols: ['enforceAiRateLimitWithClient', 'enforceAiRateLimit'],
    justification:
      'Per-request AI spend/rate accounting — system-internal counter increment, not a user-attributable business mutation.',
    dated: '2026-07-27',
  },
  {
    file: 'src/lib/ai-rate-limit.ts',
    call: 'aiRateLimit.recordUsage',
    symbols: ['reportAiUsageWithClient'],
    justification: 'Fire-and-forget token-usage report for the daily $-cap — system-internal accounting.',
    dated: '2026-07-27',
  },
  {
    file: 'src/lib/jobs/process-recording.ts',
    call: 'karuteRecords.update',
    symbols: ['upsertKaruteRecord'],
    justification:
      'upsertKaruteRecord (the reprocess-existing-record branch) — a private helper CALLED BY processJob (AUDITED_CORES) but not lexically inside its span; processJob emits karute.save unconditionally after this helper returns, covering the outcome.',
    dated: '2026-07-27',
  },
  {
    file: 'src/lib/jobs/process-recording.ts',
    call: 'karuteRecords.create',
    symbols: ['upsertKaruteRecord'],
    justification:
      'upsertKaruteRecord (the fresh-record branch) — same reasoning as karuteRecords.update above in this file: called by processJob (AUDITED_CORES), covered by its unconditional karute.save emit on return.',
    dated: '2026-07-27',
  },
  {
    file: 'src/lib/jobs/process-recording.ts',
    call: 'recordingJobs.claim',
    symbols: ['processRecordingJobs'],
    justification:
      'processRecordingJobs\' claim-and-process loop — job-queue plumbing (atomically claims the next job for THIS worker tick), not a business mutation on customer/karute data. Derives as a write only because the SDK endpoint is POST-shaped (known accepted noise).',
    dated: '2026-07-27',
  },
  {
    file: 'src/lib/jobs/process-recording.ts',
    call: 'recordingJobs.complete',
    symbols: ['processRecordingJobs'],
    justification: 'Job-queue status transition (QUEUED/RUNNING→DONE) — infrastructure bookkeeping, not a business mutation; the actual outcome is already audited via processJob\'s karute.save.',
    dated: '2026-07-27',
  },
  {
    file: 'src/lib/jobs/process-recording.ts',
    call: 'recordingJobs.fail',
    symbols: ['processRecordingJobs'],
    justification: 'Job-queue status transition on failure (attempts→FAILED) — infrastructure bookkeeping, not a business mutation; nothing was committed to audit.',
    dated: '2026-07-27',
  },
  {
    file: 'src/lib/karute/outcome.ts',
    call: 'karuteOutcomes.upsert',
    symbols: ['setKaruteOutcomeWithClient'],
    justification:
      "karute.outcome_set is a LIVE FACADE_AUDIT_MAP row as of Wave W3, fired ONLY by the dedicated after-the-fact route (facade auto-emit); the web after-the-fact wrapper updateKaruteOutcome (src/actions/karute-outcome.ts) emits its own auditWeb (AUDITED_CORES). This symbol stays audit-free: a save-EMBEDDED outcome write (web saveKaruteRecord/saveKaruteRecordInline, the facade karute save route, processJob) is part of the save, covered by that path's karute.save row on BOTH surfaces — deliberately row-less, not a gap. NARROWED 2026-08-10: setKaruteOutcome no longer performs the upsert itself — it delegates to setKaruteOutcomeWithClient so the revisit-eligibility chokepoint cannot be enforced on one surface and missed on the other — so it no longer needs an SDK-write exemption. One write site, one entry.",
    dated: '2026-08-10',
  },
  {
    file: 'src/lib/packs/store.ts',
    call: 'packs.createPack',
    symbols: ['createPackWithClient'],
    justification:
      "customer.pack_create is a LIVE FACADE_AUDIT_MAP row (facade auto-emit via handler.ts). The web action path (src/actions/packs.ts) has no auditWeb() call today — documented parity gap, not built here.",
    dated: '2026-07-27',
  },
  {
    file: 'src/lib/packs/store.ts',
    call: 'packs.addRedemption',
    symbols: ['addRedemptionWithClient'],
    justification:
      "customer.pack_redeem is a LIVE FACADE_AUDIT_MAP row (facade auto-emit). Web-path parity gap same as packs.createPack above. FIX ROUND 1 #15 correction: executeGuardedBurn (src/lib/appointments/mutations.ts) is a PRIVATE helper, not itself an AUDITED_CORES entry — its two callers, cancelAppointmentCore and markNoShowAppointmentCore (both AUDITED_CORES), are the real registered callers; when the burn runs from either, it is additionally captured in that caller's own booking.cancel/booking.no_show audit row detail (burn_pack/burn_error).",
    dated: '2026-07-27',
  },
  {
    file: 'src/lib/packs/store.ts',
    call: 'packs.removeRedemption',
    symbols: ['removeRedemptionWithClient'],
    justification:
      'customer.pack_undo is a LIVE FACADE_AUDIT_MAP row (facade auto-emit). Web-path parity gap same as packs.createPack above.',
    dated: '2026-07-27',
  },
  {
    file: 'src/lib/packs/store.ts',
    call: 'packs.addAlertDismissal',
    symbols: ['addPackAlertDismissalWithClient'],
    justification:
      "customer.pack.alert.dismiss is a FACADE_AUDIT_MAP 'skip' row — deliberately unaudited on both facade and web paths (verified: src/actions/packs.ts has no audit() calls for any pack action).",
    dated: '2026-07-27',
  },
  {
    file: 'src/lib/packs/store.ts',
    call: 'packs.addContact',
    symbols: ['addCustomerContactWithClient'],
    justification:
      "customer.pack.contact.log is a FACADE_AUDIT_MAP 'skip' row — deliberately unaudited on both paths, same as packs.addAlertDismissal above.",
    dated: '2026-07-27',
  },
  {
    file: 'src/lib/packs/store.ts',
    call: 'packs.addVisitDismissal',
    symbols: ['addVisitReconcileDismissalWithClient'],
    justification:
      "customer.pack.reconcile.dismiss is a FACADE_AUDIT_MAP 'skip' row — deliberately unaudited on both paths, same as packs.addAlertDismissal above.",
    dated: '2026-07-27',
  },
  {
    file: 'src/lib/packs/store.ts',
    call: 'packs.setLifecycle',
    symbols: ['setCustomerLifecycleWithClient'],
    justification:
      "customer.lifecycle_set is a LIVE FACADE_AUDIT_MAP row as of Wave W3 (facade auto-emit via the lifecycle route); the web wrapper setLifecycleAction emits its own auditWeb (AUDITED_CORES). setCustomerLifecycleWithClient itself stays audit-free (Core/WithClient split).",
    dated: '2026-07-28',
  },
  {
    file: 'src/lib/packs/store.ts',
    call: 'packs.updatePackStatus',
    symbols: ['updatePackStatus'],
    justification:
      'No FacadeEndpointKey or web action taxonomy entry covers pack status changes at all today — genuinely untracked, not pendingWave (no wave has claimed it). Flagged here rather than silently passing.',
    dated: '2026-07-27',
  },
  {
    file: 'src/lib/ports/recording-port.ts',
    call: 'storage.recordings.upload',
    symbols: ['prepareTranscription', 'stageForJob'],
    justification:
      "The web recording port's audio staging upload (both the interactive prepareTranscription leg and the job-pipeline stageForJob leg) — nothing auditable happens until the eventual save (createOrUpdateKaruteRecord) or job completion (processJob).",
    dated: '2026-07-27',
  },
  {
    file: 'src/lib/ports/recording-port.ts',
    call: 'storage.recordings.remove',
    symbols: ['prepareTranscription'],
    justification:
      "Best-effort cleanup of the staged audio object. FIX ROUND 1 #15 correction: this fires right AFTER TRANSCRIPTION resolves (verified at source, src/lib/ai-pipeline.ts:101-115 — cleanup() is called immediately after the transcribe fetch, BEFORE extraction/summarization/save even start), not \"after a successful save\" and never on retry — not itself a business action either way; the eventual karute.save is what audits.",
    dated: '2026-07-27',
  },
  {
    file: 'src/lib/synqed/staff-map.ts',
    call: 'staff.update',
    symbols: ['lookupSynqedStaffIdForBusiness'],
    justification:
      'Internal self-heal side effect (patches a synqed staff record\'s user_id when an email-only match resolves it) — not a user-initiated staff-management action; no facade/web action surface triggers this directly.',
    dated: '2026-07-27',
  },
  {
    file: 'src/lib/synqed/staff-map.ts',
    call: 'staff.create',
    symbols: ['resolveSynqedStaffIdForBusiness'],
    justification:
      'Internal create-on-miss side effect of resolving a profiles.id to a synqed staff.id for an FK the booking flow needs — not a user-initiated "add staff" action; no facade/web action surface triggers this directly.',
    dated: '2026-07-27',
  },
]

// ── RAW_SUPABASE_WRITE_ALLOWLIST ─────────────────────────────────────────────
// Same shape as SDK_WRITE_ALLOWLIST, `call` = 'table.method' form, for raw
// app-DB (Supabase) writes (`.from(table).insert/update/upsert/delete(`) not
// inside an AUDITED_CORES file (CP3b).
export const RAW_SUPABASE_WRITE_ALLOWLIST: {
  file: string
  call: string
  symbols: string[]
  justification: string
  dated: string
  pendingWave?: string
}[] = [
  {
    file: 'src/actions/bootstrap.ts',
    call: 'profiles.update',
    symbols: ['bootstrapBusinessForNewUser'],
    justification:
      "Signup bootstrap — stamps the auto-created profiles row with the salon name (and the OWNER role, once, gated on a role-less row). FIX ROUND 1 #13 correction: same as this file's staff.create SDK entry above — the actor IS verified (service.auth.admin.getUserById) before this write, not unknown.",
    dated: '2026-07-27',
  },
  {
    file: 'src/actions/bootstrap.ts',
    call: 'profiles.insert',
    symbols: ['bootstrapBusinessForNewUser'],
    justification:
      'Signup bootstrap fallback (only when the Supabase auto-create trigger is absent) — same reasoning and same FIX ROUND 1 #13 correction as profiles.update above in this file.',
    dated: '2026-07-27',
  },
  {
    file: 'src/lib/karute/customer-memory.ts',
    call: 'customer_memory_items.insert',
    symbols: ['applyMemoryDelta', 'addStaffMemoryItem', 'upsertPassportField'],
    justification:
      "customer.memory_add is a LIVE FACADE_AUDIT_MAP row — the facade's own hook is the first thing that has ever emitted it (see that row's comment: \"W3.2's web-silent-hole list (customer-memory.ts ×11) is the SEPARATE web-action gap, tracked for Wave W\"). Web-path writes here (applyMemoryDelta's add branch, addStaffMemoryItem, upsertPassportField's insert branch) are silent today; pendingWave.",
    dated: '2026-07-27',
    pendingWave: 'Wave W — 2026-07-27',
  },
  {
    file: 'src/lib/karute/customer-memory.ts',
    call: 'customer_memory_items.update',
    symbols: [
      'applyMemoryDelta',
      'updateMemoryItem',
      'softDeleteAiExtractionItems',
      'restoreMemoryItems',
      'setMemoryItemPinned',
      'softDeleteMemoryItem',
      'upsertPassportField',
    ],
    justification:
      'customer.memory_update/customer.memory_delete are LIVE FACADE_AUDIT_MAP rows with the same web-silent-hole gap as customer_memory_items.insert above in this file — pendingWave, tracked together per the map row\'s comment.',
    dated: '2026-07-27',
    pendingWave: 'Wave W — 2026-07-27',
  },
]
