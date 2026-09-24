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
  'ai.reengagement_draft',
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
  'booking.store_write_refused',
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
  'customer.reengagement_view',
  'customer.view',
  'karute.customer_reassign',
  'karute.delete',
  'karute.entries_regenerate',
  'karute.entry_edit',
  'karute.entry_edits_view',
  'karute.manual_create',
  'karute.outcome_set',
  'karute.save',
  'karute.store_write_refused',
  'karute.summary_edit',
  'karute.view',
  'privacy.audit_log.view',
  'privacy.customer_delete_canceled',
  'privacy.customer_delete_scheduled',
  'privacy.customer_export',
  'privacy.voice_enroll',
  'privacy.voice_revoke',
  'recording.capture_finalized',
  'recording.capture_resumed',
  'recording.capture_unlinked',
  'recording.capture_warned',
  'recording.discard',
  'recording.karute_missing',
  'recording.no_sessions_today',
  'recording.play',
  'recording.share',
  'recording.store_write_refused',
  'recording.take_named',
  'recording.take_refused_has_record',
  'recording.transcribe',
  'recording.transcribe_failed',
  'recording.transcribe_refused',
  'recording.transcribe_storm',
  'recording.unshare',
  'settings.menu_create',
  'settings.menu_reactivate',
  'settings.menu_retire',
  'settings.menu_update',
  'settings.permissions_change',
  'settings.recording_autostart_toggle',
  'settings.staff_stores_change',
  'settings.store_create',
  'settings.store_hours_reset',
  'settings.store_hours_update',
  'settings.store_update',
  'settings.store_write_refused',
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
// Two entries carry `unproven` — customers.ts#updateCustomer and
// packs.ts#redeemSessionAction — for the SAME mechanical reason. Taking the
// first: its single `return
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
  // recording.transcribe_failed (監査ログ round 2 PR C, subject 6) —
  // emitTranscribeFailedIfExhausted is a PRIVATE helper called from
  // processRecordingJobs' catch (not lexically inside processJob or
  // processRecordingJobs itself, so the registry-reality scan — exported
  // symbols only — would never ask for this entry on its own; registered
  // anyway per the same "provably covered, not left off as not required"
  // discipline as auditLockout/processJob just above). Kept in ONE entry with
  // processJob (not a second { file: ... } row for this same file) because
  // check-audit-weakening.mjs's findAuditedCoresWeakenings keys removed-
  // symbol detection by FILE (headCoresByFile = Map<file, Set<symbols>>) — a
  // second entry for an already-registered file collapses in that Map and
  // reads as processJob's own symbol having been silently removed.
  // `unproven`: the ONE audit() call inside emitTranscribeFailedIfExhausted
  // is conditional on three things at once (the exhausted round, AND not a
  // discard refusal, AND not a spend-limit refusal) — most failures return
  // without ever reaching it (an earlier-attempt failure, or the two
  // excluded refusal reasons), same mechanical-proof ceiling as
  // watchOneBusiness below. processJob itself stays proven (unconditional).
  {
    file: 'src/lib/jobs/process-recording.ts',
    symbols: ['processJob', 'emitTranscribeFailedIfExhausted'],
    unproven: [
      {
        symbol: 'emitTranscribeFailedIfExhausted',
        reason:
          'Emits only when job.attempts >= job.max_attempts (this is the round that exhausts the job) AND the failure message is neither DISCARDED_BY_STAFF/the discard-ledger-unreadable message (the discard\'s own recording.discard row is the record — council amendment 4 F3) nor AI_SPEND_LIMIT (recording.transcribe_refused already filed that row — src/lib/ai/transcribe.ts#auditTranscriptionRefused). Every other call returns with no emit at all.',
      },
    ],
  },
  // The audit-watch cron (監査ログ round 2 PR C) — the two audit() calls sit
  // directly inside watchOneBusiness's own two candidate loops, so the
  // registry-reality scan finds them and requires this entry. `unproven`
  // because most returns are NOT dominated by an emit at all: the common run
  // has zero candidates (or every candidate already has a row), which
  // returns without ever calling audit() — the same shape as
  // auto-burn.ts#autoBurnForBusiness / assembler.ts#runAssembler
  // (deliberately unemitted when there is nothing to do), except the emit
  // lives inside THIS symbol rather than a downstream one, so it cannot be
  // left off the registry the way those batch drivers are.
  {
    file: 'src/lib/audit-watch/run.ts',
    symbols: ['watchOneBusiness'],
    unproven: [
      {
        symbol: 'watchOneBusiness',
        reason:
          'Both audit() calls are conditional on a NEW candidate existing (found via the per-target dedupe read) — the common case (no candidates, or every candidate already recorded) returns with no emit at all, and a truncated/errored run also returns unemitted. Real writes still happen on every path that finds something new: not a missing writer, a mechanical-proof ceiling on a batch driver whose emit is inline rather than in a downstream function.',
      },
    ],
  },
  // The transcription SPEND WALL (2026-09-08). Both emitters are PRIVATE
  // helpers inside runMeteredTranscription's file, the same shape
  // auditLockout above has: each emits unconditionally on its own single path,
  // so the walker proves them, while the wrapper itself decides WHICH doors
  // file a receipt (the two interactive routes emit their own row and would
  // otherwise double-log one call). Registered so the real writers are
  // provably covered, not left off as "not required" — registry-reality
  // enumerates exported symbols only and would never ask for this entry.
  {
    file: 'src/lib/ai/transcribe.ts',
    symbols: ['auditTranscriptionReceipt', 'auditTranscriptionRefused'],
  },
  // The take-finalize choke point (capture pipeline PR2) — its recordings
  // .update write sits inside the same symbol as its emit (via emitFinalized,
  // the emitSave call-through idiom), so no SDK_WRITE_ALLOWLIST row is needed.
  // It no longer creates rows at all: fix round 4 moved the minting to
  // mint-take-url.ts, where the take is bound before any byte exists.
  { file: 'src/lib/recording/finalize-take.ts', symbols: ['finalizeTakeWithClient'] },
  // The capture-warning choke point (recording hole PR-7) — makes NO SDK write
  // at all (one recordings.get for the owner check), so it needs no
  // SDK_WRITE_ALLOWLIST row; its one emit is the recording.capture_warned row.
  { file: 'src/lib/recording/capture-warning.ts', symbols: ['recordCaptureWarningWithClient'] },
  // The nightly assembler (build 23 slice ③) — the take a dead device never
  // came back for, rebuilt from its segments. Its ONE write sits inside this
  // symbol alongside the emit — the bucket PUT (storage.recordings.upload) —
  // so it needs no SDK_WRITE_ALLOWLIST row, the same shape
  // finalizeTakeWithClient above has. It makes NO SDK write at all: the client
  // it is handed is narrowed to `list`, because core fences a recording write
  // behind a human actor and a cron has none (the duration is written by the
  // save door instead). The walk driver runAssembler is deliberately NOT
  // listed: it performs no write of its own and returns a summary whenever
  // there is nothing old enough to rescue. Every path here that writes nothing
  // (a concurrent run already wrote the rescue; a leaf would not come down)
  // returns an { error } before the emit — a rescue that files a row for audio
  // it did not actually settle would be the one lie this job must never tell.
  // ⚖ Liam 2026-09-06 "b": no device ever writes `rsc/`, so "the device sealed
  // its own key first" is no longer one of those paths — a folder whose phone
  // came back is skipped by the walk, long before this symbol is called.
  { file: 'src/lib/recording/assembler.ts', symbols: ['assembleStrandedTake'] },
  // The play-button mint (build 23 slice ①) — its ONE success return is
  // dominated by the recording.play emit; every refusal is an { error } literal
  // that returns before it. It performs no SDK/storage WRITE at all
  // (createSignedUrl is a read), so it needs no SDK_WRITE_ALLOWLIST row.
  { file: 'src/lib/recording/playback-url.ts', symbols: ['mintPlaybackUrlWithClient'] },
  // The recorder's own share toggle (⚖ Liam 2026-09-13 sharing law; 2026-09-14
  // design D6/D7). `emitShareAudit` is a PRIVATE helper (the auditLockout/
  // emitDeletionAudit shape: a real function parameter named `action`, typed
  // as the exact literal union — CP4's one sanctioned way to author a
  // runtime-chosen action string) called from setRecordingSharedWithClient's
  // one writing branch; it emits unconditionally on its own single path, so
  // the walker proves it clean, same as auditLockout. `setRecordingSharedWithClient`
  // itself is NOT registered here: its own body calls `emitShareAudit(...)`,
  // not `audit(`/`auditWeb(`/`auditDurable(` directly, so the registry-
  // reality scan never requires an entry for it — and its idempotent no-op
  // return (D6 step 5: already in the requested state, no write, no audit)
  // would otherwise need an `unproven` marking it does not need this way.
  { file: 'src/lib/recording/share.ts', symbols: ['emitShareAudit'] },
  // The take-URL mint (capture pipeline PR2 fix round 2, widened in fix round
  // 4, re-split in fix round 6). auditTakeNamed is a private helper emitting
  // unconditionally on its one path; mintTakeUploadUrl conditions the CALL (a
  // server-named take reserves nothing and files no row — with
  // RECORDING_SWITCHES.bindUnboundUploads OFF (ships OFF); ON, that arm files a
  // row through startRecordingSessionWithClient (session-mint.ts), which
  // carries no audit() and is NOT covered by auditTakeNamed — the row is
  // covered the same way recordings.session.mint's is
  // (karute.core.ts#createOrUpdateKaruteRecord at save; inbox 復元可能/失敗 until
  // then), see audit.ts's map entry) and carries no audit() of its own, so
  // CP7's registry-reality cross-check (exported symbols only) can never
  // require this entry — recording-upload-actions.test.ts pins it directly
  // instead.
  // commitReservation joins it because IT is the write: fix round 6 split the
  // old reserveTakeForRecorder into a read-only planReservation (the fences +
  // exists check, never a write) and commitReservation (recordings.update,
  // run only after a successful sign — fix round 7 deleted the .create half
  // with the mint's row-creating branch), and every one of
  // commitReservation's success paths that actually writes leaves through
  // auditTakeNamed — the retry path writes and audits nothing, by design (I3).
  { file: 'src/lib/recording/mint-take-url.ts', symbols: ['auditTakeNamed', 'commitReservation'] },
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
  {
    file: 'src/actions/stores.ts',
    // ⚖ Liam 2026-09-16 added two more audited writers here: the
    // store-at-CREATION entry (a manager placing a new hire within their own
    // stores) and the 1→2-store backfill (nobody blanks mid-shift). Both emit
    // settings.staff_stores_change, the same row setStaffStoresCore writes,
    // distinguished by detail.at_creation / detail.backfill.
    symbols: [
      'setStaffStoresAtCreationCore',
    ],
  },
  // The four store write cores left the action file for a server-only module
  // (PKT-SEC-CORES-B2, 2026-09-23) — the SAME writers, registered at their new
  // home. Ledgered: cores:src/actions/stores.ts#createStoreCore /
  // #updateStoreCore / #setStoreHoursCore / #setStaffStoresCore in
  // docs/audit-weakening-ledger.md.
  {
    file: 'src/lib/stores/stores.core.ts',
    symbols: [
      'createStoreCore',
      'updateStoreCore',
      'setStoreHoursCore',
      'setStaffStoresCore',
    ],
  },
  { file: 'src/actions/audit-log.ts', symbols: ['listAuditLogWithClient'] },
  // Menu catalog (PR-1a create side, PR-1b update side). listMenus is a read
  // — deliberately not listed.
  {
    file: 'src/actions/menus.ts',
    symbols: ['createMenu', 'updateMenu', 'retireMenu', 'reactivateMenu'],
  },
  // The four staff emitters followed their bodies out of the action file and
  // into the server-only module (PKT-SEC-CORES-D5, 2026-09-23) — the SAME
  // emitters, registered at their new home. Ledgered: cores:src/actions/staff.ts
  // in docs/audit-weakening-ledger.md. The web wrappers stayed.
  {
    file: 'src/lib/staff/staff.core.ts',
    symbols: ['createStaffCore', 'updateStaffCore', 'deleteStaffCore', 'uploadStaffAvatarCore'],
  },
  { file: 'src/actions/invites.ts', symbols: ['acceptInvite'] },
  // The two invite write cores left the action file for a server-only module
  // (PKT-SEC-CORES-B1, 2026-09-23) — the SAME writers, registered at their new
  // home. Ledgered: cores:src/actions/invites.ts#createInviteCore /
  // #revokeInviteCore in docs/audit-weakening-ledger.md.
  { file: 'src/lib/invites/invites.core.ts', symbols: ['createInviteCore', 'revokeInviteCore'] },
  // The three karute spine emitters followed their bodies out of the action
  // file and into the server-only module (PKT-SEC-CORES-D2, 2026-09-23) — the
  // SAME emitters, registered at their new home. Ledgered:
  // cores:src/actions/karute.ts#createOrUpdateKaruteRecord /
  // #updateKaruteDetailEntryWithClient / #updateKaruteDetailSummaryWithClient
  // in docs/audit-weakening-ledger.md. The web wrappers below stayed.
  {
    file: 'src/lib/karute/karute.core.ts',
    symbols: [
      'createOrUpdateKaruteRecord',
      'updateKaruteDetailEntryWithClient',
      'updateKaruteDetailSummaryWithClient',
    ],
  },
  {
    file: 'src/actions/karute.ts',
    symbols: [
      // F4 (2026-08-23): the web wrapper's own auditWeb() call — the
      // audit-free WithClient core (reassignKaruteCustomerWithClient) is
      // deliberately NOT listed here (Core/WithClient split, see its own
      // SDK_WRITE_ALLOWLIST entry below).
      'reassignKaruteCustomer',
      // PR B2 §1: the only writer of karute.delete — no facade route exists
      // for a karute delete (verified at source), so this is a web-only door.
      'deleteKaruteRecord',
      // PR B2 §2: the WEB manual-create wrapper's own emit — the facade twin
      // auto-emits via FACADE_AUDIT_MAP['karute.manualCreate'] and stays
      // registered separately (it calls logFacadeAudit, not audit() directly,
      // so it never trips this scan). The shared body
      // createManualKaruteRecordWithClient stays audit-free (deliberately,
      // PHONEWIRE-2A) — do not add it here.
      'createManualKaruteRecord',
    ],
    unproven: [
      {
        symbol: 'reassignKaruteCustomer',
        reason:
          "the requiresConfirm (preview) branch is `return result` — a plain identifier (discriminated-union variable), not an object literal or call — un-provable by the lexical/AST walker without type information, the SAME mechanical-proof ceiling as customers.ts#updateCustomer above. The preview phase deliberately emits NOTHING (success-only audit pin ⚖ HELD — only the confirmed:true write is audited); the success branch DOES lexically dominate its own return via the auditWeb() call that precedes it in the same block.",
      },
      {
        symbol: 'createManualKaruteRecord',
        reason:
          "the shared body's error branch is `if ('error' in result) return result` — `result` is a plain identifier (the createManualKaruteRecordWithClient discriminated-union return), not an object literal or call — the SAME mechanical-proof ceiling as reassignKaruteCustomer above. Emits nothing (error path, nothing to audit); the success path DOES lexically dominate its own implicit tail return via the top-level audit() call between the try/catch and the redirect (PR B2 §2).",
      },
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
  // AI再エンゲージメント (§13, F9): success-only audit doctrine governs the
  // 生成 row only (ai.reengagement_draft) — FIX ROUND 1 R3 corrected the
  // FACADE_AUDIT_MAP row from a stale 'skip' to the real `kind: 'view'`
  // customer.reengagement_view (same shape as its bodyPrediction/
  // preSessionBrief siblings), emitted by the generic facade hook, not by
  // this file. getReengagementDraft/getReengagementDraftWithClient
  // themselves still carry no direct audit()/auditWeb() call (no web-side
  // view row either, matching the two siblings) and are deliberately NOT
  // listed here — only the two private auditLockout-pattern helpers below,
  // each emitting unconditionally on its one return path, generation-branch
  // only (computeReengagementDraft conditions the CALL). FIX ROUND 1 R4:
  // both symbols are module-private, so CP7's registry-reality cross-check
  // (exported-symbols only) can never require this entry on its own —
  // ai-reengagement.test.ts pins the entry directly (red-run: delete it,
  // the pin goes red).
  {
    file: 'src/lib/karute/ai-reengagement.ts',
    symbols: ['auditReengagementDraftGeneratedWeb', 'auditReengagementDraftGeneratedFacade'],
  },
  // Wave W3 (D1 mirrors): the web twins of the facade lifecycle/outcome rows.
  // The WithClient cores they wrap stay audit-free (Core/WithClient split);
  // updateKaruteOutcome is the AFTER-THE-FACT path only — a save-embedded
  // outcome write is covered by that path's karute.save row on both surfaces
  // (see the FACADE_AUDIT_MAP mirror-block comment in audit.ts).
  // redeemSessionAction emits ONLY on the PR-B1 recovery path (D7): the burn's
  // own facade twin already auto-emits customer.pack_redeem, so this row exists
  // to carry the resolved_via:'recovery' marker the redemption `source` column
  // cannot (no 'recovery' value, and the set core accepts is not visible from
  // this repo). A normal web burn still emits nothing — the documented parity
  // gap recorded against packs.addRedemption below is unchanged.
  {
    file: 'src/actions/packs.ts',
    symbols: ['setLifecycleAction', 'redeemSessionAction'],
    unproven: [
      {
        symbol: 'redeemSessionAction',
        reason:
          'PR-B1 D7: the auditWeb() emit is CONDITIONAL BY DESIGN — it fires only for a recovery-path burn (input.recovery), to carry the resolved_via marker the redemption `source` column cannot. A normal web burn still emits nothing, which is the pre-existing documented parity gap (see SDK_WRITE_ALLOWLIST packs.addRedemption). The single `return result` merges both, through a plain identifier, so the walker cannot prove domination — the same mechanical ceiling as customers.ts#updateCustomer, not a missing writer.',
      },
    ],
  },
  { file: 'src/actions/karute-outcome.ts', symbols: ['updateKaruteOutcome'] },
  // Lane 2026-08-30 (regen audit row): the two web wrappers now emit their own
  // success-only karute.entries_regenerate row (facade auto-emits its own via
  // logFacadeAudit — see FACADE_AUDIT_MAP['karute.regenerate']). Unlike
  // customers.ts#updateCustomer/packs.ts#redeemSessionAction, the early-error
  // return here is a FRESH `{ error: result.error }` object literal (not the
  // shared `result` identifier), so the walker's shape-exempt check reads it
  // and the auditWeb() call provably dominates the remaining success return —
  // no `unproven` needed.
  {
    file: 'src/actions/regenerate-karute.ts',
    symbols: ['regenerateKarute', 'regenerateKaruteEntries'],
  },
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
      "Signup bootstrap — creates the OWNER's own synqed staff record as part of account provisioning, not an admin managing staff. FIX ROUND 1 #13 correction: the actor is NOT unknown — the function verifies the auth uid via service.auth.admin.getUserById BEFORE this write and resolves businessId in the same call. Self-provisioning on the user's OWN new account; silent today; no wave committed (candidate mirror: a future staff.bootstrap action per the coverage inventory). No facade/web action endpoint covers this path at all. Since 2026-09-19 the module is server-only (not a server action): reachable from the email-confirmation callback route only; the actor is the user of that route's verified code exchange.",
    dated: '2026-07-27',
  },
  // The five entries below follow the eight client-threaded customer cores out
  // of the action file and into the server-only module (PKT-SEC-CORES-D1,
  // 2026-09-23) — the SAME writes, registered at their new home. Ledgered:
  // SDK_WRITE_ALLOWLIST:src/lib/customers/customers.core.ts::customers.create /
  // .update / .uploadPhoto / .grantConsent / .revokeConsent in
  // docs/audit-weakening-ledger.md. customers.deletePhoto keeps the old file —
  // deleteCustomerPhoto is a web action and stayed behind.
  {
    file: 'src/lib/customers/customers.core.ts',
    call: 'customers.create',
    symbols: ['createCustomerWithClient', 'createQuickCustomerWithClient'],
    justification:
      "PHONEWIRE-1: the create bodies moved into WithClient twins so the web action and the new facade POSTs run ONE body — the same Core/WithClient split as updateCustomerWithClient below, where the shared core stays audit-free. Both doors ARE covered: customer.create / customer.quickCreate are LIVE FACADE_AUDIT_MAP mutation rows (facade auto-emit, target id from ctx.auditTargetId), and the web wrappers createCustomer/createQuickCustomer — both AUDITED_CORES symbols — emit customer.create unconditionally on their success path.",
    dated: '2026-09-01',
  },
  {
    file: 'src/lib/customers/customers.core.ts',
    call: 'customers.update',
    symbols: [
      'updateCustomerWithClient',
      'scheduleCustomerDeletionWithClient',
      'cancelCustomerDeletionWithClient',
    ],
    justification:
      "customer.update is a LIVE FACADE_AUDIT_MAP row (facade auto-emit) — this call site sits inside updateCustomerWithClient/scheduleCustomerDeletionWithClient/cancelCustomerDeletionWithClient, none of which are AUDITED_CORES symbols. Web-path coverage: updateCustomerWithClient's caller (updateCustomer) conditionally auditWebs customer.edit (see AUDITED_CORES unproven note). PHONEWIRE-2B: the deletion pair's bodies moved into WithClient twins so the web actions and the new facade POSTs run ONE body — the same Core/WithClient split as updateCustomerWithClient above, where the shared core stays audit-free. BOTH doors are covered: customer.deletion.schedule / .cancel are LIVE FACADE_AUDIT_MAP mutation rows emitting privacy.customer_delete_scheduled / _canceled (a guarded no-op files nothing — the routes set ctx.auditSuppress), and the web wrappers scheduleCustomerDeletion/cancelCustomerDeletion each call emitDeletionAudit (AUDITED_CORES) unconditionally on their success path — verified at source, not lexically provable by symbol-span containment.",
    dated: '2026-09-02',
  },
  {
    file: 'src/lib/customers/customers.core.ts',
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
    file: 'src/lib/recording/discard.ts',
    call: 'recordingDiscards.create',
    symbols: ['ensureDiscardReasonRow'],
    justification:
      "P5-A (⚖ 8/17) — the written discard reason. NOT a silent write: its caller discardRecordingWithReasonRow hands the created row's id straight to discardRecordingWithClient, whose writeDiscardReceipt emits the recording.discard row (auditDurable, AWAITED — a dropped receipt is a failure, never a success) carrying discard_row_id. So every row this call creates is audited within the same call stack, one step out; the walker cannot see it because ensureDiscardReasonRow is a private helper with no audit() of its own, and the emitter is auditDurable rather than the audit()/auditWeb() pair AUDITED_CORES is seeded from. The reason TEXT deliberately never enters the audit row (doc law: reason is content, id only).",
    dated: '2026-08-25',
  },
  {
    file: 'src/lib/recording/discard.ts',
    call: 'recordings.update',
    symbols: ['stampRecordingDuration'],
    justification:
      "Names-fix (2026-08-31, ordering corrected in fix round 1) — the below-floor half. Stamps ONE derived field, recordings.duration_seconds, onto the session the caller is discarding, from the duration the receipt already reports: it adds no new fact and takes none away. Not silent in substance, and now not merely in the same call stack but strictly AFTER the emit: writeDiscardReceipt calls the stamp PAST its own failure guard, so the stamp fires only once the awaited durable recording.discard row carrying duration_sec and below_floor for this exact take has actually landed. A receipt-failed discard stamps nothing and retries whole, so there is no state in which a stamped duration exists without the audit row for the request that wrote it, and a second row here would double-count one act. The walker cannot see that emit because discard.ts's emitter is auditDurable rather than the audit()/auditWeb() pair AUDITED_CORES is seeded from — the same reason the sibling recordingDiscards.create entry above needs a line. It adds one serialized best-effort round-trip to a path already awaiting core four times (accepted cost), and can never fail the discard: every failure is one warn line and the result is returned unchanged.",
    dated: '2026-08-31',
  },
  {
    file: 'src/lib/recording/share-columns.ts',
    call: 'recordings.update',
    symbols: ['updateRecordingShare'],
    justification:
      "The D13 typed write wrapper (⚖ Liam 2026-09-13 sharing law; 2026-09-14 design D6/D13) — SDK 1.34's UpdateRecordingInput predates the shared_at/shared_by_staff_id columns, so this is the one place the untyped cast happens. The write itself sits one level below the emit: setRecordingSharedWithClient (src/lib/recording/share.ts, AUDITED_CORES via its own emitShareAudit helper) awaits this call and then, on its ONE writing branch, calls emitShareAudit — recording.share/recording.unshare — which dominates its own return. A second row here would double-count one act; this file stays audit-free by design, the exact same shape as discard.ts#stampRecordingDuration above (a write in a sibling helper, dominated by an emit one call-frame away, not lexically inside it).",
    dated: '2026-09-14',
  },
  {
    file: 'src/lib/customers/customers.core.ts',
    call: 'customers.grantConsent',
    symbols: ['grantCustomerConsentWithClient'],
    justification:
      'customer.consent_grant is a LIVE FACADE_AUDIT_MAP row as of Wave W3 (facade auto-emit); the web wrapper grantCustomerConsent emits its own auditWeb (AUDITED_CORES). grantCustomerConsentWithClient itself stays audit-free, matching the Core/WithClient split convention.',
    dated: '2026-07-28',
  },
  {
    file: 'src/lib/customers/customers.core.ts',
    call: 'customers.revokeConsent',
    symbols: ['revokeCustomerConsentWithClient'],
    justification:
      'customer.consent_revoke is a LIVE FACADE_AUDIT_MAP row as of Wave W3 (facade auto-emit); the web wrapper revokeCustomerConsent emits its own auditWeb (AUDITED_CORES). revokeCustomerConsentWithClient itself stays audit-free, matching the Core/WithClient split convention.',
    dated: '2026-07-28',
  },
  // The two entries below follow the client-threaded karute cores out of the
  // action file and into the server-only module (PKT-SEC-CORES-D2,
  // 2026-09-23) — the SAME writes, registered at their new home. Ledgered:
  // SDK_WRITE_ALLOWLIST:src/lib/karute/karute.core.ts::karuteRecords.update /
  // ::karuteRecords.create in docs/audit-weakening-ledger.md.
  {
    file: 'src/lib/karute/karute.core.ts',
    call: 'karuteRecords.update',
    symbols: ['reassignKaruteCustomerWithClient'],
    justification:
      "karute.customer_reassign is a LIVE FACADE_AUDIT_MAP row (facade auto-emit via ctx.auditDetail/auditTargetId) — this call site sits inside reassignKaruteCustomerWithClient, the audit-free Core/WithClient shared core (F4, 2026-08-23). The web wrapper reassignKaruteCustomer emits its own auditWeb (AUDITED_CORES, unproven-marked for the same return-shape reason as customers.ts#updateCustomer). reassignKaruteCustomerWithClient itself stays audit-free by design, matching the grantCustomerConsentWithClient/setCustomerLifecycleWithClient Core/WithClient convention elsewhere in this list.",
    dated: '2026-08-23',
  },
  {
    file: 'src/lib/karute/karute.core.ts',
    call: 'karuteRecords.create',
    symbols: ['createOrUpdateKaruteRecord', 'createManualKaruteRecordWithClient'],
    justification:
      'createOrUpdateKaruteRecord (AUDITED_CORES — this specific call site is its own fresh-record branch, dominated by its emitSave call-through, already proven by CP2/CP7) and createManualKaruteRecordWithClient (PHONEWIRE-2A: the "+ 新規カルテ" manual-entry create body, moved into a WithClient twin so the web action and the new facade POST run ONE body — the same Core/WithClient split as createCustomerWithClient. The shared body stays audit-free; the FACADE door is covered — karute.manualCreate is a LIVE FACADE_AUDIT_MAP mutation row emitting karute.manual_create with the target from ctx.auditTargetId. PR B2 §2 (2026-09-11) closed the last gap: the WEB wrapper createManualKaruteRecord now emits its own karute.manual_create row (AUDITED_CORES) — the write call here still sits one level below that emit, in the shared WithClient body, so this allowlist entry stays).',
    dated: '2026-09-01',
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
      "coveredBy the eventual karute.save emit at pipeline completion (src/lib/jobs/process-recording.ts#processJob, AUDITED_CORES) — see FACADE_AUDIT_MAP['recordings.job.enqueue'] skip row (FIX ROUND 1 #17: this citation now correctly points at processJob, the job pipeline's true and only choke point — not createOrUpdateKaruteRecord, which karute.core.ts's own header comment says process-recording.ts never calls). The enqueue step itself stages no auditable outcome.",
    dated: '2026-07-27',
  },
  {
    file: 'src/lib/recording/enqueue-from-session.ts',
    call: 'recordingJobs.enqueue',
    symbols: ['enqueueFromSessionWithClient'],
    justification:
      "Build 23 slice ③ — the shared body BOTH new doors run (the web action enqueueRecordingJobFromSession and POST /api/app/v1/recordings/job/from-session). Identical reasoning to the src/actions/recording-jobs.ts entry above and to FACADE_AUDIT_MAP['recordings.job.enqueueFromSession']'s skip row: this call routes EXCLUSIVELY into the job worker (src/lib/jobs/process-recording.ts#processJob, AUDITED_CORES), which is where the recording actually becomes a karute and emits karute.save. The enqueue step stages no auditable outcome of its own, and a row here would double-log every save the worker performs. Nothing else in this symbol writes: every other SDK call is a read (recordings.get, the shared discard-ledger read, and the revisit guard's customer/pack/record lookups).",
    dated: '2026-09-06',
  },
  // writeTranscript left the action file with the two shared bodies it serves,
  // for a server-only module (PKT-SEC-CORES-C, 2026-09-23) — the SAME write,
  // registered at its new home. Ledgered: SDK_WRITE_ALLOWLIST:
  // src/lib/recording/discard-transcript.core.ts::recordings.upsertSegments in
  // docs/audit-weakening-ledger.md.
  {
    file: 'src/lib/recording/discard-transcript.core.ts',
    call: 'recordings.upsertSegments',
    symbols: ['writeTranscript'],
    justification:
      "A2-2 (packet P5-A2): the WORDS of an ALREADY-AUDITED action. The staff discard that authorises this write emitted its own recording.discard receipt moments earlier (src/lib/recording/discard.ts, AUDITED_CORES — carrying discard_row_id, duration_sec and below_floor), and both callers refuse to write at all unless that STAFF discard row already exists. A second row here would double-count one act. ⚖ 8/17 doc law also forbids the CONTENT reaching an audit detail, which is exactly what this call persists — the segments are read back through getDiscardTranscript's staff.manage gate, never through the audit log. EXTENDED 2026-09-01 (PHONEWIRE-2C): the call now has a THIRD caller, the phone. persistDiscardTranscriptWithClient / transcribeAndPersistDiscardWithClient are the shared bodies the cookie wrappers and the facade route (src/app/api/app/v1/recordings/discards/transcript/route.ts POST, FACADE_AUDIT_MAP['recordings.discards.transcript.write'] — a 'skip' citing this same ruling) both run. Nothing about the justification moves: the facade door writes only after the SAME hasStaffDiscard fence proves the audited recording.discard receipt already landed, so a phone discard is still one act with one row.",
    dated: '2026-08-31',
  },
  // src/lib/recording/staged-audio.ts#sweepStagedDiscardAudio and
  // src/actions/recording-upload.ts#removeRecordingObject both held a
  // 'storage.recordings.remove' entry until 2026-09-04. Capture pipeline PR4
  // deleted the janitor (file and all) and the server action outright — the
  // pipeline reads the take's finalized object and nothing removes recording
  // audio — so the writes are gone and the entries with them: an allowlist row
  // for a write that no longer exists is what the dead-entry rule refuses.
  {
    file: 'src/lib/recording/session-mint.ts',
    call: 'recordings.create',
    symbols: ['startRecordingSessionWithClient'],
    justification:
      "mints the recording_sessions id only — nothing auditable happens until the eventual save. Feeds EITHER downstream pipeline (verified, FIX ROUND 1 #17): the interactive save (createOrUpdateKaruteRecord) or the job pipeline (processJob) — see FACADE_AUDIT_MAP['recordings.session.mint'] skip row comment for the same ambiguity on its facade twin. STILL TRUE after capture-pipeline PR2 fix round 10, which made the create carry the take's audio_storage_path + UPLOADING when the recorder names its take (BORN RESERVED): that is the SAME reservation the mint used to write one call later as an UPDATE, moved earlier to delete the race window — not a new act. It stays unaudited here, deliberately and per the round's ruling: no audit row is added at session start (this file has never had one — FACADE_AUDIT_MAP['recordings.session.mint'] is a skip), so the STATED consequence is that a born-reserved take files no recording.take_named row BY DESIGN, because the mint it used to come from now finds its own key already on the row and writes nothing. The binding is no longer a separate act to receipt — it is part of the row this entry already covers — and the eventual save is still what audits the recording. MOVED (fix round 11, ledgered): a FILE MOVE of the entry above's neighbor, not a new write — startRecordingSessionWithClient came out of src/actions/recordings.ts (a 'use server' file, so every top-level export was a client-invokable action taking a caller-supplied businessId, the exact escape mint-take-url.ts's own header warns against) into this non-'use server' module, same reasoning as the staged-audio.ts precedent below. The call is byte-unchanged except for the fresh-eyes #7 P2 fix riding the same commit: an objectExists(key) fence now runs before this create whenever the row is born reserved, refusing `exists` rather than ever creating a row that points at bytes this caller's row never wrote — STRICTLY NARROWER than what it replaced, never wider.",
    dated: '2026-09-03',
  },
  {
    file: 'src/actions/regenerate-karute.ts',
    call: 'karuteRecords.deleteEntry',
    symbols: ['rollback', 'regenerateKaruteEntriesWithClient'],
    justification:
      "karute.regenerate — writer IS wired as of lane 2026-08-30: the facade route auto-emits via logFacadeAudit (FACADE_AUDIT_MAP row, no pendingWave now), and the web wrappers (regenerateKarute/regenerateKaruteEntries) emit their own success-only auditWeb() row (AUDITED_CORES). This SDK call site itself stays allowlisted — the emit lives at the wrapper level, not inline with the rollback delete. FIX ROUND 1 #14 correction (still true): the prior claim of TWO actions depending on a request-body mode was fabricated — the facade route (src/app/api/app/v1/karute/[id]/regenerate/route.ts) parses NO body at all (only `id` from params, `locale` from a query string), and only karute.entries_regenerate exists anywhere in this file. See FACADE_AUDIT_MAP['karute.regenerate'].",
    dated: '2026-08-30',
    pendingWave: 'Wave W — 2026-07-27',
  },
  {
    file: 'src/actions/regenerate-karute.ts',
    call: 'karuteRecords.addEntry',
    symbols: ['regenerateKaruteEntriesWithClient'],
    justification:
      "karute.regenerate — same now-wired state as karuteRecords.deleteEntry above in this file (facade auto-emit live, web wrappers emit their own row — see AUDITED_CORES), same FIX ROUND 1 #14 correction (no request-body mode exists; only karute.entries_regenerate). See FACADE_AUDIT_MAP['karute.regenerate'].",
    dated: '2026-08-30',
    pendingWave: 'Wave W — 2026-07-27',
  },
  {
    file: 'src/actions/regenerate-karute.ts',
    call: 'karuteRecords.update',
    symbols: ['updateKaruteSummaryWithClient'],
    justification:
      "karute.regenerate — same now-wired state as the other regenerate-karute.ts write sites (facade auto-emit live, web wrappers emit their own row — see AUDITED_CORES); updateKaruteSummaryWithClient itself stays audit-free by design (one emit per logical regenerate, not per SDK call — the wrapper's single row covers the whole entries+summary operation), same FIX ROUND 1 #14 correction (no request-body mode exists; only karute.entries_regenerate). See FACADE_AUDIT_MAP['karute.regenerate'].",
    dated: '2026-08-30',
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
    file: 'src/lib/staff/new-card.ts',
    call: 'staff.create',
    symbols: ['createAndPlaceStaffCard'],
    justification: "The shared new-card mint (⚖ Liam 2026-09-16): one home for 'a new staff card is born in a store', reached by BOTH doors that make one — the 追加 button (lib/staff/staff.core.ts#createStaffCore) and a FRESH invite (lib/invites/invites.core.ts#createInviteCore, which now mints the card up front so accept only attaches the login). createAndPlaceStaffCard itself emits NOTHING on its success path, on purpose: each door emits its own staff.add row at the point it knows what it made, which is what keeps CP7's dominating-emit walker able to read them (a shared emit here would be invisible to both). Both citations are registered AUDITED_CORES symbols. 'staff.delete' is the placement ROLLBACK, in its own `rollback` helper — it only ever removes the card this same function created moments earlier, so it has no separate lifecycle to audit; the door's staff.add never fires for a rolled-back card. ⚖ G8 (2026-09-19): that helper DOES emit on one path — when the rollback's own delete throws, it writes a WARNING staff.add row (targetId = the stranded card, detail.reason = 'rollback_failed') before returning STAFF_CARD_LEFT_BEHIND, because that is the one case where the roster really did grow and no door's staff.add ever fires for it. It is a private function, so CP7's exported-symbol registry-reality scan does not reach it, and it is listed here rather than in AUDITED_CORES because its SUCCESS path correctly emits nothing.",
    dated: '2026-09-16',
  },
  {
    file: 'src/lib/staff/new-card.ts',
    call: 'staff.delete',
    // ⚖ FOLD ROUND 3 (fresh-eyes F8, 2026-09-17): the delete moved out of
    // createAndPlaceStaffCard into the private `rollback` helper, which is
    // where a FAILED rollback is now turned into its own answer
    // (STAFF_CARD_LEFT_BEHIND) instead of a console line. Same single call
    // site, same reasoning, one level down.
    symbols: ['rollback'],
    justification: "The shared new-card mint's ROLLBACK (⚖ Liam 2026-09-16; moved into its own helper by the F8 fold, 2026-09-17). The delete itself is never audited: it only ever removes the card createAndPlaceStaffCard created moments earlier in the same request, so it has no separate lifecycle — the door's staff.add never fires for a rolled-back card. ⚖ G8 (2026-09-19): the FAILURE path now does emit — when the delete throws, `rollback` writes a WARNING staff.add row (targetId = the stranded card, detail.reason = 'rollback_failed') and logs that id, then returns STAFF_CARD_LEFT_BEHIND. That row records a card that really is on the roster, not the delete. The mint's success path still carries NO audit call on purpose — each door emits its own staff.add at the point it knows what it made, which is what keeps CP7's dominating-emit walker able to read them (a shared emit here would be invisible to both). Both doors (lib/staff/staff.core.ts#createStaffCore and lib/invites/invites.core.ts#createInviteCore) are registered AUDITED_CORES symbols; `rollback` is private, so CP7's exported-symbol registry-reality scan does not reach it.",
    dated: '2026-09-16',
  },
  {
    file: 'src/lib/stores/stores.core.ts',
    call: 'staffStores.set',
    symbols: ['backfillStaffToExistingStore'],
    justification:
      "The 1→2-store backfill (⚖ Liam 2026-09-16: nobody blanks mid-shift). It DOES audit — one settings.staff_stores_change row per staff member it places, detail.backfill = '1_to_2_stores' — but the emit sits INSIDE the per-staff loop, and the function returns without emitting on the paths where it wrote nothing at all (not the 1→2 transition; no roster; every card already assigned). CP7's dominating-emit walker cannot express 'emits once per write', so the registry would fail on a function whose every WRITE is in fact audited. Allowlisted rather than registered, for that mechanical reason only.",
    dated: '2026-09-16',
  },
  {
    file: 'src/lib/stores/stores.core.ts',
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
  // src/app/api/app/v1/ai/transcribe/route.ts#POST held a
  // 'storage.recordings.remove' entry until 2026-09-04 (PR4): the `finally`
  // that deleted the transcribed object is gone, so the entry is too.
  // src/app/api/cleanup/route.ts#GET held a 'storage.recordings.remove' entry
  // until 2026-09-03. The sweep no longer deletes anything (⚖ audio is never
  // deleted — it reports orphan candidates and a human decides), so the call is
  // gone and the entry with it: an allowlist row for a write that no longer
  // exists is exactly what the dead-entry rule refuses.
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
    symbols: [
      'reportAiUsageWithClient',
      'reportTranscriptionUsageWithClient',
      'releaseTranscriptionReserveWithClient',
    ],
    justification:
      'Fire-and-forget token-usage report for the daily $-cap — system-internal accounting. EXTENDED 2026-09-08 (the transcription spend wall): reportTranscriptionUsageWithClient reports the SAME ledger in cents-from-minutes for Deepgram, and is equally system-internal — the user-visible receipt for that spend is the recording.transcribe audit row the wrapper files (src/lib/ai/transcribe.ts, AUDITED_CORES). EXTENDED AGAIN 2026-09-08 (fix round 5): releaseTranscriptionReserveWithClient is the SAME accounting write in the other direction — a negative row that takes back a reserve the provider then threw on, so it was never spent. It writes only from inside the wrapper’s catch around the provider call (AUDITED_CORES), reports no new act, and files no row of its own: the act it corrects is the provider failure, which is already the caller’s own error path (the worker’s fail(), the routes’ error arms).',
    dated: '2026-09-08',
  },
  {
    file: 'src/lib/jobs/process-recording.ts',
    call: 'karuteRecords.update',
    symbols: ['upsertKaruteRecord'],
    justification:
      'upsertKaruteRecord (the reprocess-existing-record branch) — a private helper CALLED BY processJob (AUDITED_CORES) but not lexically inside its span; processJob emits karute.save directly after this helper returns on the normal completion path, covering the write. NARROWED 2026-09-19 (packet B fix round 2): unreachable from the existing-karute skip path — that path returns before ever calling upsertKaruteRecord, so no create/update happens there.',
    dated: '2026-07-27',
  },
  {
    file: 'src/lib/jobs/process-recording.ts',
    call: 'karuteRecords.create',
    symbols: ['upsertKaruteRecord'],
    justification:
      'upsertKaruteRecord (the fresh-record branch) — same reasoning as karuteRecords.update above in this file: called by processJob (AUDITED_CORES) on the normal completion path only, covered by its karute.save emit directly on return. NARROWED 2026-09-19 (packet B fix round 2): unreachable from the existing-karute skip path, same as above.',
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
    justification: 'Job-queue status transition on failure (attempts→FAILED) — infrastructure bookkeeping, not a business mutation; the fail() call itself commits nothing to audit. UPDATED 2026-09-11 (監査ログ round 2 PR C, subject 6): the catch beside this call now conditionally emits recording.transcribe_failed via a separate helper (emitTranscribeFailedIfExhausted, AUDITED_CORES) ONLY on the round that exhausts the job — that emit is its own registered writer, not this SDK status-transition write.',
    dated: '2026-09-11',
  },
  {
    file: 'src/lib/karute/outcome.ts',
    call: 'karuteOutcomes.upsert',
    symbols: ['setKaruteOutcomeWithClient'],
    justification:
      "karute.outcome_set is a LIVE FACADE_AUDIT_MAP row as of Wave W3, fired ONLY by the dedicated after-the-fact route (facade auto-emit); the web after-the-fact wrapper updateKaruteOutcome (src/actions/karute-outcome.ts) emits its own auditWeb (AUDITED_CORES). This symbol stays audit-free: a save-EMBEDDED outcome write (web saveKaruteRecord/saveKaruteRecordInline, the facade karute save route, processJob's normal completion path) is part of the save, covered by that path's karute.save row on BOTH surfaces — deliberately row-less, not a gap. NARROWED 2026-09-19 (packet B fix round 3): processJob's existing-karute skip path writes this SAME upsert without a save of its own (no create/update runs on that path) — an after-the-fact outcome write like the dedicated route above, so processJob itself (AUDITED_CORES) now emits its own karute.outcome_set row directly after a successful write on that path; this symbol (the SDK upsert call) stays audit-free either way, the emit sits one level up at the call site. NARROWED 2026-08-10: setKaruteOutcome no longer performs the upsert itself — it delegates to setKaruteOutcomeWithClient so the revisit-eligibility chokepoint cannot be enforced on one surface and missed on the other — so it no longer needs an SDK-write exemption. One write site, one entry.",
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
      "Signup bootstrap — stamps the auto-created profiles row with the salon name (and the OWNER role, once, gated on a role-less row). FIX ROUND 1 #13 correction: same as this file's staff.create SDK entry above — the actor IS verified (service.auth.admin.getUserById) before this write, not unknown. Since 2026-09-19 the module is server-only (not a server action): reachable from the email-confirmation callback route only; the actor is the user of that route's verified code exchange.",
    dated: '2026-07-27',
  },
  {
    file: 'src/actions/bootstrap.ts',
    call: 'profiles.insert',
    symbols: ['bootstrapBusinessForNewUser'],
    justification:
      'Signup bootstrap fallback (only when the Supabase auto-create trigger is absent) — same reasoning and same FIX ROUND 1 #13 correction as profiles.update above in this file. Since 2026-09-19 the module is server-only (not a server action): reachable from the email-confirmation callback route only; the actor is the user of that route\'s verified code exchange.',
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
