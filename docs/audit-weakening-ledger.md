<!-- Audit-weakening ledger (contract §8 CP8). Every entry here is a DELIBERATE
     weakening of the audit taxonomy — a map/decision row moved off 'live', an
     AUDIT_ACTIONS member or AUDITED_CORES entry/symbol removed, or a new
     allowlist entry (a newly-legalized silent write) — that a human reviewed
     and approved. scripts/audit/check-audit-weakening.mjs (CP8) fails any PR
     that weakens the taxonomy vs origin/main WITHOUT an added line here naming
     the affected key; it never blocks a strengthening (skip/pendingWave→live,
     allowlist removal, new actions).

     Format: - YYYY-MM-DD · <key> · <why> · <who ruled>
     Keys are namespaced by source — copy them EXACTLY as the gate prints
     them (map:… / decision:… / action:… / cores:… / <ALLOWLIST>:…). Keep
     the key and the '·' after it on the entry's FIRST line (the gate's
     exact-key match reads line one); wrap the why/who freely after. -->

- 2026-07-29 · map:karute.ai.suggestedMessage · action changed
  'ai.suggested_message' → 'ai.suggested_message_view': the hook row fires on
  every 2xx of the draft GET — a cache-served read on all but the first open —
  so labeling it 生成 wrote "generated" rows where no LLM ran (field report:
  ~15 rows/evening from reopens, 変更 86→93 in hours). The 生成 action is NOT
  retired: it moved to the actual generation site (ai-outreach.ts private
  helpers, AUDITED_CORES-registered, emitted only when OpenAI returns a
  draft), so the taxonomy is strictly more truthful — every 生成 row FROM THE
  KARUTE-DETAIL CARD now means a real generation. (Known residual, out of
  this entry's scope: the separate recording-review suggestions feature —
  web /api/ai/suggestions + facade 'ai.suggestions' — still emits the same
  action string unconditionally incl. cache hits; its own honesty split is
  queued, blind-round find 2026-07-29.) · Liam (2026-07-29 ruling: A of A–D, "unless
  something changed it shouldn't regenerate — and the log should say what
  actually happened")
- 2026-07-29 · map:karute.ai.suggestedMessage · kind changed 'mutation' →
  'view': same change, same ruling — the per-open row is a read of a cached
  draft, so it belongs behind 閲覧を含む with the sibling AI-card rows
  (customer.ai_prediction_view / customer.brief_view) instead of flooding the
  default feed and inflating 変更. Paired with the strengthening above (real
  生成 emit + detail.customer_id on both rows) · Liam (2026-07-29 ruling)
- 2026-08-09 · SDK_WRITE_ALLOWLIST:src/app/api/app/v1/customers/[id]/photos/[photoId]/route.ts::customers.deletePhoto · new
  facade DELETE route (packet PR 9b device-wiring delta — customer.photo.delete
  is a LIVE FACADE_AUDIT_MAP mutation row, facade auto-emit). Same
  WithClient/Core-less shape as the existing customers.uploadPhoto allowlist
  entry above it: the route handler calls synqed.customers.deletePhoto
  directly and never calls audit() itself — only the facade's generic hook
  (logFacadeAudit, excluded from AUDITED_CORES) does. Not a new silent
  write in practice (the facade auto-emit covers it), but the raw SDK call
  site itself is legitimately new and CP3 requires its own registration ·
  Liam (device-wiring delta ruling, 2026-08-09)
- 2026-07-27 · facade-audit-totality.test.ts CP8-forerunner pin · the hardcoded
  live-row disposition snapshot (describe 'CP8 forerunner — hardcoded live-row
  disposition pin') is deleted by the proof-suite PR. It WORKED (hardcoded
  precisely so it could NOT move in lockstep with the map — built after a
  full-suite mutant proved the parameterized pins did) but covered only live
  facade rows; check-audit-weakening.mjs supersedes it with a vs-main diff
  that also tracks categories, decision rows, allowlists, registries, and the
  ledger itself · Liam (proof-suite PR kickoff)
- 2026-08-23 · SDK_WRITE_ALLOWLIST:src/actions/karute.ts::karuteRecords.update · F4
  reassign (PACKET-F4-REASSIGN-2026-09-02.md, gates cleared by Liam 8/23):
  reassignKaruteCustomerWithClient is an audit-FREE Core/WithClient shared
  core (D1-mirror doctrine — the web wrapper reassignKaruteCustomer emits
  its own auditWeb row, the facade route's generic success hook emits
  karute.customer_reassign off its LIVE FACADE_AUDIT_MAP row) — same shape
  as the existing grantCustomerConsentWithClient/setCustomerLifecycleWithClient
  entries above and the 2026-08-09 customer.photo.delete entry directly
  above this one. Not a new silent write in practice (both surfaces audit
  it independently); CP3 requires the raw karuteRecords.update call site's
  own registration since it sits outside AUDITED_CORES by design · Liam
  (F4 packet build-order clearance, 2026-08-23)
- 2026-08-25 · SDK_WRITE_ALLOWLIST:src/actions/recording-upload.ts::storage.recordings.remove · the
  web upload hotfix. The `recordings` bucket's RLS started rejecting
  browser-token inserts ("new row violates row-level security policy"), which
  killed every web take at its upload leg, so the web recording port moved to
  service-minted signed URLs like the thin arm — and the cleanup DELETE moved
  with it, off the browser's supabase-js client and onto this cookie-authed
  server action. Not a new silent write: the identical call was already
  allowlisted at src/lib/ports/recording-port.ts#prepareTranscription
  (2026-07-27, FIX ROUND 1 #15) and THAT entry is deleted in the same commit,
  along with the sibling storage.recordings.upload one — net −1 allowlist
  entry, and the browser no longer writes storage at all. The justification
  carries over verbatim because nothing about the delete changed: it fires
  right after transcription resolves (src/lib/ai-pipeline.ts cleanup(), before
  extraction/summarization/save even start), so it is not itself a business
  action — the eventual karute.save is what audits. The two MINT legs need no
  entry (createSignedUploadUrl/createSignedUrl are not CP3 storage write
  methods), same as the facade precedent
  src/app/api/app/v1/recordings/upload-url/route.ts · Liam (2026-08-25 web-upload hotfix)
- 2026-08-30 · SDK_WRITE_ALLOWLIST:src/lib/recording/discard.ts::recordingDiscards.create · server-side
  creation of the staff discard reason row (ensureDiscardReasonRow) — the
  ⚖-required written reason for every deliberate staff discard. Legal on three
  counts: it is probe-first idempotent (list before create, so a double-tap
  cannot double-create); the free-text reason is confined to the core discard
  row and never enters audit detail (schema .strict(), pinned by four
  independent tests); and the STAFF receipt that references the row is
  mintable only through the internal vouch path · Liam (⚖ 2026-08-17
  required-written-reason ruling + ⚖ 2026-08-20 kept-discards doctrine; build
  adjudicated in the P5-A 4-lens blind round + fix round,
  ADJUDICATION-P5A-ROUND1-2026-08-26.md, karute-recording-integrity lane)
- 2026-08-31 · SDK_WRITE_ALLOWLIST:src/actions/recording-discard-transcript.ts::recordings.upsertSegments · the
  WORDS of an already-audited action (A2-2). The staff discard that authorises
  this write emitted its own recording.discard receipt moments earlier
  (src/lib/recording/discard.ts, AUDITED_CORES — carrying discard_row_id,
  duration_sec and below_floor), and BOTH callers refuse to write at all unless
  that STAFF discard row already exists (a list probe on
  recording_session_id + source:'STAFF', pinned by discard-transcript-actions
  .test.ts). A second row here would double-count one act. The ⚖ 8/17 doc law
  also forbids the CONTENT reaching an audit detail, which is precisely what
  this call persists — the segments are read back through
  getDiscardTranscript's staff.manage gate, never through the audit log ·
  Liam (⚖ 2026-08-20 kept-discards doctrine + ⚖ 2026-08-25 ruling A, packet
  PACKET-P5-A2-TRANSCRIPT-2026-08-31.md, karute-recording-integrity lane)
- 2026-08-31 · SDK_WRITE_ALLOWLIST:src/actions/recording-discard-transcript.ts::storage.recordings.remove · best-effort
  cleanup of the staged audio object right after the discard transcription
  resolves — identical timing and reasoning to the two entries already
  allowlisted for the same call (src/actions/recording-upload.ts
  #removeRecordingObject and src/app/api/app/v1/ai/transcribe/route.ts#POST):
  read-then-delete, the worker's posture, not itself a business action. Fires
  on the consent-refusal path too, so a refusal leaves no litter behind ·
  Liam (⚖ 2026-08-20 kept-discards doctrine, packet
  PACKET-P5-A2-TRANSCRIPT-2026-08-31.md, karute-recording-integrity lane)
- 2026-08-31 · SDK_WRITE_ALLOWLIST:src/lib/recording/discard.ts::recordings.update · the
  BELOW-FLOOR half of the names fix. Nothing in this repo ever wrote
  recordings.duration_seconds, so the manager panel printed its generic
  「文字起こしはありません」 for a take that ran under the 10-second floor and was
  therefore never transcribed — two different facts wearing one sentence. This
  stamps ONE derived field, floored (Math.floor, so the panel's
  `< BELOW_FLOOR_SEC` predicate stays exact on an Int column), from the
  duration the receipt already reports: it adds no new fact and removes none.
  Not silent in substance — the SAME call stack emits the recording.discard
  receipt (writeDiscardReceipt, auditDurable, AWAITED) carrying duration_sec
  and below_floor for this exact take, one step out; a second row would
  double-count one act. The walker cannot see that emit for the same mechanical
  reason as the sibling recordingDiscards.create entry: discard.ts's emitter is
  auditDurable, not the audit()/auditWeb() pair AUDITED_CORES is seeded from ·
  Liam (⚖ 2026-08-20 kept-discards doctrine, packet
  PACKET-2026-08-31-NAMES-FIX.md, karute-field-issues lane)
