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
  Not silent in substance, and (fix round 1, ADJUDICATION-NAMES-FIX-ROUND1.md
  ruling FIX-3) not merely in the same call stack but strictly AFTER the emit:
  writeDiscardReceipt calls the stamp PAST its own failure guard, so it fires
  only once the awaited durable recording.discard row carrying duration_sec and
  below_floor for this exact take has actually landed. There is therefore no state
  in which a stamped duration exists without the audit row for the request that
  wrote it; a receipt-failed discard stamps nothing and retries whole. A second
  row here would double-count one act. The walker cannot see that emit for the
  same mechanical reason as the sibling recordingDiscards.create entry:
  discard.ts's emitter is auditDurable, not the audit()/auditWeb() pair
  AUDITED_CORES is seeded from. The ordering costs one serialized best-effort
  round-trip on a path that already awaits core four times — accepted — and the
  stamp still can never fail the discard: every failure is one warn line and the
  result is returned unchanged · Liam (⚖ 2026-08-20 kept-discards doctrine,
  packet PACKET-2026-08-31-NAMES-FIX.md, karute-field-issues lane)
- 2026-09-01 · SDK_WRITE_ALLOWLIST:src/actions/customers.ts::customers.create · phone
  customer-create wiring (PHONEWIRE-1): on phones 新規顧客 creation was dead —
  the actions port's createCustomer/createQuickCustomer were notWired stubs
  because the customers facade tree had [id]/* subroutes but no create door.
  Wiring it meant extracting the two create bodies into WithClient twins so the
  web action and the new facade POSTs run ONE body — the same Core/WithClient
  split as the customers.update entry above, where the shared core stays
  audit-free and the callers emit. The write is FULLY AUDITED on both doors,
  and this entry only registers the shared body's SDK call site as a known
  writer: customer.create and customer.quickCreate are LIVE FACADE_AUDIT_MAP
  mutation rows (facade auto-emit via logFacadeAudit, target id handed over as
  ctx.auditTargetId since a collection POST carries no path param), and the web
  wrappers createCustomer/createQuickCustomer — both AUDITED_CORES symbols,
  both walker-proven — emit customer.create unconditionally on their success
  path. Not a new silent write in any sense: the SAME customer.create action
  the web form already wrote, now reachable from the phone too. The raw SDK
  call site is legitimately new (it moved out of the two audited wrappers into
  the twins) and CP3 requires its own registration · Liam (⚖ 8/12 one system
  two doors, packet PACKET-PHONEWIRE-1-2026-09-01.md, adjudication
  ADJUDICATION-PHONEWIRE-1-2026-09-01, karute-field-issues lane)
- 2026-09-01 · SDK_WRITE_ALLOWLIST:src/actions/karute.ts::karuteRecords.create#createManualKaruteRecordWithClient · phone
  manual-karute wiring (PHONEWIRE-2A): on phones ＋新規カルテ was dead —
  the actions port's createManualKaruteRecord was a soft stub because the karute
  facade tree had save/window/reveal but no MANUAL create door. Wiring it meant
  extracting the create body into a WithClient twin so the web action and the
  new facade POST run ONE body — the same Core/WithClient split as the
  customers.create entry directly above. This entry is a RENAME of an allowlist
  symbol that has stood since 2026-07-27, not a new call site: the raw
  karuteRecords.create moved verbatim out of createManualKaruteRecord into
  createManualKaruteRecordWithClient (raw body diff = one line, store_id:
  storeId -> input.storeId), and CP3 requires the new symbol its own
  registration. HONEST DIFFERENCE FROM THE PHONEWIRE-1 ENTRY ABOVE, stated
  rather than borrowed: this write is NOT audited on both doors. The FACADE door
  now is — karute.manualCreate is a LIVE FACADE_AUDIT_MAP mutation row emitting
  karute.manual_create, target id handed over as ctx.auditTargetId since the
  collection POST carries no path param, and a row is safe here (unlike
  karute.save) because manual create does not pass the
  createOrUpdateKaruteRecord choke point, so there is exactly one writer. The
  WEB wrapper createManualKaruteRecord still emits nothing, exactly as it has
  since the original 2026-07-27 allowlist entry recorded it "genuinely
  untracked". So this build NARROWS a pre-existing gap and widens nothing: the
  same manual create the web dialog already performed unaudited, now also
  reachable from the phone and audited there · Liam (⚖ 8/12 one system two
  doors, packet PACKET-PHONEWIRE-2A-2026-09-01.md, karute-field-issues lane)
