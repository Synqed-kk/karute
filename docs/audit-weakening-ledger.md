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

- 2026-09-01 · SDK_WRITE_ALLOWLIST:src/actions/recording-discard-transcript.ts::storage.recordings.remove#transcribeAndPersistDiscardWithClient · phone
  discard-transcript wiring (PHONEWIRE-2C): a SYMBOL RENAME, not a new
  write. The identical entry already stood at
  `…::storage.recordings.remove#transcribeAndPersistDiscard` since 2026-08-31;
  wiring the phone split that action into a `*WithClient` body plus its cookie
  wrapper (the same Core/WithClient shape as the customers.create entry above),
  and the janitor moved into the shared body — so the ledger key follows the
  symbol that now owns the call. The cookie wrapper keeping the old name owns
  no storage call at all. The call itself is unchanged in every respect: a
  best-effort `storage.recordings.remove` of the staged audio object on every
  exit past the tenant fence, read-then-delete, the worker's own posture. It is
  not a business action and its justification is unmoved — the audited action is
  the recording.discard receipt this transcription belongs to
  (src/lib/recording/discard.ts, AUDITED_CORES), and both doors refuse to write
  at all unless that STAFF discard row already exists. Nothing became legal that
  was not legal yesterday; one symbol name changed · Liam (⚖ 8/20 discard
  doctrine + ⚖ 8/12 one system two doors, packet
  PACKET-PHONEWIRE-2C-2026-09-01.md, karute-field-issues lane)

- 2026-09-01 · SDK_WRITE_ALLOWLIST:src/lib/recording/staged-audio.ts::storage.recordings.remove · a
  FILE MOVE of the entry directly above, not a new write (PHONEWIRE-2C fix
  round 3, Greptile #813). The staged-audio janitor was extracted out of
  src/actions/recording-discard-transcript.ts into its own module because it
  grew a SECOND caller: the phone stages its audio BEFORE it posts and every
  retry stages a fresh object (runDiscardTranscript → stageForJob;
  DiscardPending carries no path to reuse), so the facade route must sweep its
  own pre-body refusals or a repeating refusal strands one more object per
  record-page mount for seven days. The alternative — a second
  `storage.remove` spelling at the route — is exactly how a fence gets
  forgotten on one caller, so there is still ONE delete implementation and the
  old entry was pruned rather than left dead (CP3 named both halves and both
  were done). The call is byte-unchanged: same best-effort remove of the same
  staged object, same read-then-delete worker posture, still not a business
  action — the audited action remains the recording.discard receipt this
  transcription belongs to. It is STRICTLY NARROWER than what it replaced: the
  isOwnRecordingKey tenant fence now lives INSIDE the janitor rather than at
  the one call site, so no caller — present or future — can delete a key that
  is not its own business's. The module carries no 'use server' for the same
  reason lib/recording/discard.ts does not: it takes its tenant as an
  argument, and as a client-invokable action a caller could name any business
  · Liam (⚖ 8/20 discard doctrine + ⚖ 8/12 one system two doors, packet
  PACKET-PHONEWIRE-2C-2026-09-01.md, karute-field-issues lane)
- 2026-09-02 · SDK_WRITE_ALLOWLIST:src/actions/customers.ts::customers.update#scheduleCustomerDeletionWithClient · PHONEWIRE-2B:
  the 30-day deletion pair's bodies moved into WithClient twins
  so the web action and the new facade POST run ONE body — the same
  Core/WithClient split updateCustomerWithClient already uses in this entry,
  where the shared core stays audit-free. The `customers.update` call inside it
  is byte-unchanged (same soft-delete set, ⚖ NO hard delete, Liam 2026-07-19);
  only its enclosing symbol is new, which is why the gate sees an addition.
  STRICTLY NARROWER than what it replaces: the old symbol
  `scheduleCustomerDeletion` covered the whole cookie action, this one covers
  only the shared write body, and the old name was pruned rather than left
  dead. BOTH doors are covered — the web wrapper still calls emitDeletionAudit
  (AUDITED_CORES) unconditionally on its success path, and the facade door's
  new key customer.deletion.schedule is a LIVE FACADE_AUDIT_MAP mutation row
  emitting privacy.customer_delete_scheduled (a guarded no-op files nothing:
  the route sets ctx.auditSuppress) · Liam (⚖ 7/19 no-hard-delete + ⚖ 8/12 one
  system two doors, packet PACKET-PHONEWIRE-2B-2026-09-01.md,
  karute-field-issues lane)
- 2026-09-02 · SDK_WRITE_ALLOWLIST:src/actions/customers.ts::customers.update#cancelCustomerDeletionWithClient · The
  undo half of the same split, same reasoning line for line: byte-unchanged
  `customers.update` (deleted_at → null) inside a new, strictly narrower symbol;
  `cancelCustomerDeletion` pruned; the web wrapper keeps its emitDeletionAudit
  and the new customer.deletion.cancel key is a LIVE FACADE_AUDIT_MAP mutation
  row emitting privacy.customer_delete_canceled · Liam (same ruling and packet
  as the entry above)
- 2026-09-03 · map:recordings.uploadUrl · Capture pipeline PR2 fix round 7 (J6). The row
  stays a deliberate skip; only its coveredBy citation moves, from
  `src/actions/karute.ts#createOrUpdateKaruteRecord` to
  `src/lib/recording/mint-take-url.ts#auditTakeNamed`. STRICTLY MORE HONEST, not weaker:
  the old citation named the karute save at the far end of a flow this endpoint merely
  feeds — an act performed by a different door, on a different day, that would be equally
  true of half the recording routes. What this endpoint actually WRITES is the take's
  reservation on its recording row, and the emit that dominates every writing path of
  that write is auditTakeNamed (recording.take_named), the same symbol AUDITED_CORES
  already registers for this file. The endpoint's coverage therefore goes from "something
  downstream eventually files a row" to "this endpoint's own write files its own row" ·
  Liam (⚖ 8/17 ids-only doc law, packet PACKET-PR2-FIX-ROUND-7.md, karute-field-issues lane)
- 2026-09-03 · SDK_WRITE_ALLOWLIST:src/lib/recording/session-mint.ts::recordings.create · a
  FILE MOVE of the src/actions/recordings.ts entry above (fresh-eyes #7 fix
  round 11), not a new write. startRecordingSessionWithClient came out of
  src/actions/recordings.ts because that file carries 'use server': every
  top-level export of such a file is a client-invokable server action, so this
  function was reachable directly with a caller-supplied businessId — the
  exact escape mint-take-url.ts's own header warns against, since businessId
  decides the composed key's tenant prefix. The new home carries no
  'use server', same rule as mint-take-url.ts / discard.ts /
  session-cleanup.ts / staged-audio.ts. The recordings.create call itself is
  STRICTLY NARROWER than what it replaced, never wider: the SAME fresh-eyes
  round adds an objectExists(key) fence before it, so a row born reserved can
  no longer be created pointing at bytes this caller's row never wrote (a
  hard-deleted sibling row's finalized object staying on storage was the gap —
  session-cleanup deletes the row, never the object). The old entry
  (src/actions/recordings.ts::recordings.create) is pruned rather than left
  dead — that call site no longer exists · Liam (fresh-eyes round #7, packet
  PACKET-PR2-FIX-ROUND-11.md, karute-field-issues lane)
- 2026-09-06 · SDK_WRITE_ALLOWLIST:src/lib/recording/enqueue-from-session.ts::recordingJobs.enqueue · build 23
  slice ③ adds a THIRD door onto the one job the worker already owns:
  saving a recording whose audio reached the server without the device (the
  nightly assembler sealed a stranded take, or the phone finalized at stop and
  then died). The write is `recordingJobs.enqueue` in the shared body both new
  doors run, and it is silent for EXACTLY the reason the two existing enqueue
  sites are — see the src/actions/recording-jobs.ts and
  src/app/api/app/v1/recordings/job/route.ts entries above, and
  FACADE_AUDIT_MAP['recordings.job.enqueueFromSession']'s skip row: the enqueue
  stages no auditable outcome, and the act becomes auditable at the job
  pipeline's own choke point (src/lib/jobs/process-recording.ts#processJob,
  AUDITED_CORES), which emits karute.save when the record actually lands. A live
  row here would double-log every save the worker performs. Not a widening of
  what goes unaudited — the same one act, reachable from one more place · Fable
  (DESIGN-ASSEMBLER-2026-09-06 D8, PACKET-ASSEMBLER-C C3)
- 2026-09-08 · SDK_WRITE_ALLOWLIST:src/lib/ai-rate-limit.ts::aiRateLimit.recordUsage#reportTranscriptionUsageWithClient · the
  transcription SPEND WALL adds a second reporter onto the SAME ledger the
  token routes already report to: transcription is billed per MINUTE, so its
  cents are computed from the audio's own length and returned through
  `recordUsage('transcribe', null, null, cents)`. It is silent for exactly the
  reason the existing reportAiUsageWithClient entry above it is — a
  system-internal accounting increment, not a user-attributable business
  mutation — and it is the OPPOSITE of a widening in practice: the act it
  reports (a Deepgram call) has never been audited at all until this round,
  and the same wrapper now files a `recording.transcribe` receipt for every
  provider answer plus a `recording.transcribe_refused` row (severity warning)
  for every refusal, from src/lib/ai/transcribe.ts (AUDITED_CORES). The money
  moves in one place and the log says so · Fable
  (LENS-RULING-SPEND-2026-09-08 §3.7 / PACKET-SPEND-METER-2026-09-08 C1)
- 2026-09-08 · SDK_WRITE_ALLOWLIST:src/lib/ai-rate-limit.ts::aiRateLimit.recordUsage#releaseTranscriptionReserveWithClient · fix
  round 5 of the transcription SPEND WALL adds the reserve's RELEASE — the same
  system-internal accounting write as the two symbols already on this entry,
  in the other direction. When the provider call itself throws, no money was
  spent, and the caller retries: the worker re-runs the job, each attempt
  reserves again, and a reserve left standing would put max_attempts × the
  estimate on the ledger for a recording nobody ever transcribed — so one
  Deepgram outage would refuse honest work for the rest of the rolling day.
  The release is `recordUsage('transcribe', null, null, -reserveCents)`, a
  negative row on the same route, because core stores the integer as given and
  `consume` SUMs the column over the rolling 24 h (synqed-core
  src/services/ai-rate-limit.service.ts) — no refund call was invented and no
  core change was needed. It is silent for exactly the reason the entry above
  it is, and it is the OPPOSITE of a widening in what goes unlogged: the act
  it corrects is a provider FAILURE, which every door already surfaces on its
  own error path (the worker's fail(), the two routes' error arms), and the
  only new place it can be reached from is the catch inside
  src/lib/ai/transcribe.ts#runMeteredTranscription (AUDITED_CORES). A
  SUCCESSFUL call is still never refunded — the no-refund ruling is unchanged ·
  Fable (BLIND-LENS-SPEND-f7ca094.md MEDIUM 2 / PACKET-SPEND-FIX5-2026-09-08 C1)
- 2026-09-14 · SDK_WRITE_ALLOWLIST:src/lib/recording/share-columns.ts::recordings.update · the
  recorder's own share toggle (⚖ Liam 2026-09-13 sharing law) — the D13 typed
  write wrapper (updateRecordingShare) sends shared_at/shared_by_staff_id through
  SDK 1.34's untyped UpdateRecordingInput cast, the same "SDK predates the columns"
  shape as every other recordings.update call on this list. Silent by design, same
  reasoning as discard.ts#stampRecordingDuration above: the write sits ONE call
  below the emit, not lexically inside it — setRecordingSharedWithClient
  (src/lib/recording/share.ts, AUDITED_CORES via its own emitShareAudit helper)
  awaits this call and then, on its one WRITING branch, emits recording.share /
  recording.unshare, which dominates its own return; the idempotent no-op branch
  (D6 step 5: already in the requested state) never reaches this call at all, so
  no write is ever silent in substance — only in the walker's lexical reach. Time-
  boxed like every other SDK-1.34 predates-the-columns entry: DELETE this file at
  client 1.35, once the SDK's own types carry shared_at/shared_by_staff_id and the
  cast is no longer needed · Fable (DESIGN-SHARE-2026-09-14.md D6/D13,
  PKT-SHARE-B-2026-09-14.md C1/C2 — Liam signed off the design 9/14 01:0x)
- 2026-09-19 · SDK_WRITE_ALLOWLIST:src/lib/staff/new-card.ts::staff.create · the shared
  new-card mint (⚖ Liam 2026-09-16, store at creation). ONE home for "a new staff card is
  born in a store", reached by BOTH doors that make one — the 追加 button
  (actions/staff.ts#createStaffCore) and a FRESH invite (actions/invites.ts#createInviteCore,
  which now mints the card up front so accept only attaches the login). Its success path
  emits nothing ON PURPOSE: each door writes its own staff.add at the point it knows what it
  made, which is what keeps CP7's dominating-emit walker able to read them — a shared emit
  inside the mint would be invisible to both. Both doors are registered AUDITED_CORES
  symbols, so no write here is silent in substance; the allowlist covers the walker's
  lexical reach only · Fable (ADJUDICATION-STORE-AT-CREATION-3bec439c2-2026-09-19.md; ⚖ Liam 2026-09-16 store-at-creation)
- 2026-09-19 · SDK_WRITE_ALLOWLIST:src/lib/staff/new-card.ts::staff.delete · the same mint's
  placement ROLLBACK, in its private `rollback` helper. It only ever removes the card
  createAndPlaceStaffCard created moments earlier in the same request, so the delete has no
  lifecycle of its own to audit — the door's staff.add never fires for a rolled-back card.
  ⚖ G8 (2026-09-19): the FAILURE path is no longer silent — when the delete itself throws,
  `rollback` writes a WARNING staff.add row (targetId = the stranded card,
  detail.reason = 'rollback_failed') and logs that id, then answers
  STAFF_CARD_LEFT_BEHIND. That row records a card that really is on the roster, not the
  delete · Fable (ADJUDICATION-STORE-AT-CREATION-3bec439c2-2026-09-19.md; ⚖ Liam 2026-09-16 store-at-creation)
- 2026-09-23 · cores:src/actions/invites.ts#createInviteCore · NOT a dropped writer — the
  symbol MOVED. Every runtime export of a 'use server' file is registered as a
  browser-callable server action with no authentication of its own, so the four
  client-threaded invite cores left src/actions/invites.ts for the server-only module
  src/lib/invites/invites.core.ts (no directive, `import 'server-only'` on line one).
  createInviteCore is re-registered there, byte-identical body and the same
  staff.invite_create / staff.add emits, as
  AUDITED_CORES['src/lib/invites/invites.core.ts']. Rename tolerance was removed from the
  gate on purpose (fix round 1 #8), so the move costs this line · Fable
  (PKT-SEC-CORES-B1-INVITES-2026-09-23.md; ⚖ Liam 2026-09-16 security tight, whole ecosystem)
- 2026-09-23 · cores:src/actions/invites.ts#revokeInviteCore · the twin of the line above,
  same move, same PR: revokeInviteCore is now
  AUDITED_CORES['src/lib/invites/invites.core.ts'] with a byte-identical body and the same
  staff.invite_revoke emit. Nothing about the write or its audit row changed — only which
  module it lives in, and that module is no longer HTTP-reachable · Fable
  (PKT-SEC-CORES-B1-INVITES-2026-09-23.md; ⚖ Liam 2026-09-16 security tight, whole ecosystem)
- 2026-09-23 · map:invite.create · coveredBy repointed
  'src/actions/invites.ts#createInviteCore' → 'src/lib/invites/invites.core.ts#createInviteCore'.
  The same choke point, at its new address: the facade POST /api/app/v1/invites route still
  calls that one core, which still emits staff.invite_create itself, which is why the row
  stays a 'skip' (a rule here would double-log every facade write). The citation moved
  because the file did · Fable (PKT-SEC-CORES-B1-INVITES-2026-09-23.md)
- 2026-09-23 · map:invite.revoke · coveredBy repointed
  'src/actions/invites.ts#revokeInviteCore' → 'src/lib/invites/invites.core.ts#revokeInviteCore'.
  Same move, same choke point: the facade DELETE /api/app/v1/invites/[id] route calls that one
  core and it emits staff.invite_revoke itself · Fable (PKT-SEC-CORES-B1-INVITES-2026-09-23.md)
- 2026-09-23 · cores:src/actions/stores.ts#createStoreCore · NOT a dropped writer — the
  symbol MOVED. Every runtime export of a 'use server' file is registered as a
  browser-callable server action with no authentication of its own, so the six
  client-threaded store cores left src/actions/stores.ts for the server-only module
  src/lib/stores/stores.core.ts (no directive, `import 'server-only'` on line one).
  createStoreCore is re-registered there, byte-identical body and the same
  settings.store_create emit, as AUDITED_CORES['src/lib/stores/stores.core.ts']. Rename
  tolerance was removed from the gate on purpose (fix round 1 #8), so the move costs this
  line · Fable (PKT-SEC-CORES-B2-STORES-2026-09-23.md; ⚖ Liam 2026-09-16 security tight,
  whole ecosystem)
- 2026-09-23 · cores:src/actions/stores.ts#updateStoreCore · the twin of the line above,
  same move, same PR: updateStoreCore is now
  AUDITED_CORES['src/lib/stores/stores.core.ts'] with a byte-identical body and the same
  settings.store_update emit. Nothing about the write or its audit row changed — only which
  module it lives in, and that module is no longer HTTP-reachable · Fable
  (PKT-SEC-CORES-B2-STORES-2026-09-23.md; ⚖ Liam 2026-09-16 security tight, whole ecosystem)
- 2026-09-23 · cores:src/actions/stores.ts#setStoreHoursCore · same move, same PR: the 営業時間
  save core is now AUDITED_CORES['src/lib/stores/stores.core.ts'] with a byte-identical body
  and the same settings.store_hours_update / settings.store_hours_reset emits. Only its
  module changed, and that module is no longer HTTP-reachable · Fable
  (PKT-SEC-CORES-B2-STORES-2026-09-23.md; ⚖ Liam 2026-09-16 security tight, whole ecosystem)
- 2026-09-23 · cores:src/actions/stores.ts#setStaffStoresCore · same move, same PR:
  setStaffStoresCore is now AUDITED_CORES['src/lib/stores/stores.core.ts'] with a
  byte-identical body and the same settings.staff_stores_change emit. Its at-creation
  sibling (setStaffStoresAtCreationCore) stays in src/actions/stores.ts and keeps the old
  entry, so that file's AUDITED_CORES row was split, not dropped · Fable
  (PKT-SEC-CORES-B2-STORES-2026-09-23.md; ⚖ Liam 2026-09-16 security tight, whole ecosystem)
- 2026-09-23 · map:stores.create · coveredBy repointed
  'src/actions/stores.ts#createStoreCore' → 'src/lib/stores/stores.core.ts#createStoreCore'.
  The same choke point, at its new address: the facade POST /api/app/v1/stores route still
  calls that one core, which still emits settings.store_create itself, which is why the row
  stays a 'skip' (a rule here would double-log every facade write). The citation moved
  because the file did · Fable (PKT-SEC-CORES-B2-STORES-2026-09-23.md)
- 2026-09-23 · map:stores.update · coveredBy repointed
  'src/actions/stores.ts#updateStoreCore' → 'src/lib/stores/stores.core.ts#updateStoreCore'.
  Same move, same choke point: the facade PUT /api/app/v1/stores/[id] route calls that one
  core and it emits settings.store_update itself. The second writer named in the comment
  above this row (setStoreHoursCore, PATCH /stores/[id]/hours) moved in the same PR and its
  citation followed · Fable (PKT-SEC-CORES-B2-STORES-2026-09-23.md)
- 2026-09-23 · map:staffStores.set · coveredBy repointed
  'src/actions/stores.ts#setStaffStoresCore' → 'src/lib/stores/stores.core.ts#setStaffStoresCore'.
  Same move, same choke point: the facade PUT /api/app/v1/staff/[id]/stores route calls that
  one core and it emits settings.staff_stores_change itself · Fable
  (PKT-SEC-CORES-B2-STORES-2026-09-23.md)
- 2026-09-23 · SDK_WRITE_ALLOWLIST:src/lib/stores/stores.core.ts::stores.create · NOT a new
  legalized silent write — the SAME allowlist entry, at its new address. listStoresWithClient's
  lazy 本店-create (ensurePrimary) has been allowlisted since 2026-07-27 under the key
  SDK_WRITE_ALLOWLIST:src/actions/stores.ts::stores.create with pendingWave 'Wave W —
  2026-07-27'; the twin moved to the server-only module in this PR, so the entry's `file`
  followed it. Justification, dated and pendingWave are unchanged, and the gate reads a moved
  entry as an addition because the key is file-scoped · Fable
  (PKT-SEC-CORES-B2-STORES-2026-09-23.md; ⚖ Liam 2026-09-16 security tight, whole ecosystem)
- 2026-09-23 · SDK_WRITE_ALLOWLIST:src/lib/recording/discard-transcript.core.ts::recordings.upsertSegments · NOT
  a new legalized silent write — the SAME allowlist entry, at its new address.
  writeTranscript's one-segment upsert has been allowlisted since 2026-08-31 under
  the key SDK_WRITE_ALLOWLIST:src/actions/recording-discard-transcript.ts::recordings.upsertSegments
  (the A2-2 ruling: the staff discard that authorises the write already emitted its
  own recording.discard receipt, and ⚖ 8/17 doc law keeps the CONTENT out of audit
  details). Every runtime export of a 'use server' file is registered as a
  browser-callable server action with no authentication of its own, so the two
  client-threaded discard-transcript bodies — and the private writeTranscript they
  both call — left src/actions/recording-discard-transcript.ts for the server-only
  module src/lib/recording/discard-transcript.core.ts (no directive, `import
  'server-only'` on line one). Body byte-identical, justification and `dated`
  unchanged, no pendingWave on this entry before or after; the gate reads a moved
  entry as an addition because the key is file-scoped · Fable
  (PKT-SEC-CORES-C-DISCARD-2026-09-23.md; ⚖ Liam 2026-09-16 security tight, whole ecosystem)
- 2026-09-23 · SDK_WRITE_ALLOWLIST:src/lib/customers/customers.core.ts::customers.create · NOT a
  new legalized silent write — the SAME allowlist entry, at its new address. The two create
  bodies' customers.create call has been allowlisted since 2026-09-01 under the key
  SDK_WRITE_ALLOWLIST:src/actions/customers.ts::customers.create (PHONEWIRE-1: the shared
  WithClient cores stay audit-free; customer.create is a LIVE FACADE_AUDIT_MAP row on the phone
  door and the web wrappers createCustomer/createQuickCustomer — both AUDITED_CORES — emit it on
  their success path). Every runtime export of a 'use server' file is registered as a
  browser-callable server action with no authentication of its own, so the eight
  client-threaded customer bodies left src/actions/customers.ts for the server-only module
  src/lib/customers/customers.core.ts (no directive, `import 'server-only'` on line one). Bodies
  byte-identical, symbols, justification and `dated` unchanged, no pendingWave on this entry
  before or after; the gate reads a moved entry as an addition because the key is file-scoped ·
  Fable (PKT-SEC-CORES-D1-CUSTOMERS-2026-09-23.md; ⚖ Liam 2026-09-16 security tight, whole
  ecosystem)
- 2026-09-23 · SDK_WRITE_ALLOWLIST:src/lib/customers/customers.core.ts::customers.update · same
  move, same PR: the customers.update call site shared by updateCustomerWithClient and the
  30-day deletion pair (schedule/cancel) has been allowlisted since 2026-09-02 under the key
  SDK_WRITE_ALLOWLIST:src/actions/customers.ts::customers.update. All three symbols moved
  together, byte-identical; the web wrappers that own the emits — updateCustomer's customer.edit
  and scheduleCustomerDeletion/cancelCustomerDeletion's emitDeletionAudit — STAYED in the action
  file, so AUDITED_CORES did not change and neither did the justification or `dated`. Only the
  module changed, and that module is no longer HTTP-reachable · Fable
  (PKT-SEC-CORES-D1-CUSTOMERS-2026-09-23.md; ⚖ Liam 2026-09-16 security tight, whole ecosystem)
- 2026-09-23 · SDK_WRITE_ALLOWLIST:src/lib/customers/customers.core.ts::customers.uploadPhoto · same
  move, same PR: uploadCustomerPhotoWithClient's photo write (with its one network-level
  retry) has been allowlisted since 2026-07-27 under the key
  SDK_WRITE_ALLOWLIST:src/actions/customers.ts::customers.uploadPhoto. Body byte-identical,
  justification and `dated` unchanged — including the parity-gap sentence about the web action
  uploadCustomerPhoto, which stayed in src/actions/customers.ts and still has no auditWeb call.
  The sibling customers.deletePhoto entry keeps the OLD file: deleteCustomerPhoto is a web
  action and did not move · Fable (PKT-SEC-CORES-D1-CUSTOMERS-2026-09-23.md; ⚖ Liam 2026-09-16
  security tight, whole ecosystem)
- 2026-09-23 · SDK_WRITE_ALLOWLIST:src/lib/customers/customers.core.ts::customers.grantConsent · same
  move, same PR: grantCustomerConsentWithClient's consent write has been allowlisted since
  2026-07-28 under the key SDK_WRITE_ALLOWLIST:src/actions/customers.ts::customers.grantConsent.
  Body byte-identical, policy_version still SERVER-pinned in the core, justification and `dated`
  unchanged: customer.consent_grant is still a LIVE FACADE_AUDIT_MAP row and the web wrapper
  grantCustomerConsent — which stayed, and stays AUDITED_CORES — still emits its own auditWeb ·
  Fable (PKT-SEC-CORES-D1-CUSTOMERS-2026-09-23.md; ⚖ Liam 2026-09-16 security tight, whole
  ecosystem)
- 2026-09-23 · SDK_WRITE_ALLOWLIST:src/lib/customers/customers.core.ts::customers.revokeConsent · the
  twin of the line above, same move, same PR: revokeCustomerConsentWithClient's write has
  been allowlisted since 2026-07-28 under the key
  SDK_WRITE_ALLOWLIST:src/actions/customers.ts::customers.revokeConsent. Body byte-identical,
  justification and `dated` unchanged; customer.consent_revoke stays a LIVE FACADE_AUDIT_MAP row
  and the web wrapper revokeCustomerConsent (AUDITED_CORES) still emits its own auditWeb · Fable
  (PKT-SEC-CORES-D1-CUSTOMERS-2026-09-23.md; ⚖ Liam 2026-09-16 security tight, whole ecosystem)
- 2026-09-19 · SDK_WRITE_ALLOWLIST:src/lib/stores/stores.core.ts::staffStores.set · the 1→2-store
  backfill (⚖ Liam 2026-09-16: nobody blanks mid-shift). It DOES audit — one
  settings.staff_stores_change notice per staff member it places, detail.backfill =
  '1_to_2_stores', plus (⚖ G4) one WARNING row naming the ids still unplaced after the
  retry pass — but the emits sit INSIDE the per-staff loop, and the function returns
  without emitting on the paths where it wrote nothing at all (not the 1→2 transition; no
  roster; every card already assigned). CP7's dominating-emit walker cannot express "emits
  once per write", so the registry would fail a function whose every WRITE is in fact
  audited. Allowlisted rather than registered, for that mechanical reason only · Fable (ADJUDICATION-STORE-AT-CREATION-3bec439c2-2026-09-19.md; ⚖ Liam 2026-09-16 store-at-creation)
- 2026-09-23 · cores:src/actions/karute.ts#createOrUpdateKaruteRecord · NOT a dropped emitter — the
  SAME AUDITED_CORES symbol, registered at its new address
  cores:src/lib/karute/karute.core.ts#createOrUpdateKaruteRecord. Every runtime export of a
  'use server' file is registered as a browser-callable server action with no authentication of its
  own, so the eight karute cores left src/actions/karute.ts for the server-only module
  src/lib/karute/karute.core.ts (no directive, `import 'server-only'` on line one). The body moved
  BYTE-IDENTICAL, emitSave and all: karute.save is still the ONE choke-point emit covering web
  saveKaruteRecord, web saveKaruteRecordInline and the facade POST, and FACADE_AUDIT_MAP['karute.save']
  is still the skip row citing it (its coveredBy is repointed on its own line below). The entry is
  file-scoped, so the gate reads a moved symbol as a removal · Fable
  (PKT-SEC-CORES-D2-KARUTE-2026-09-23.md; ⚖ Liam 2026-09-16 security tight, whole ecosystem)
- 2026-09-23 · cores:src/actions/karute.ts#updateKaruteDetailEntryWithClient · same move, same PR: the
  per-entry CAS core and its karute.entry_edit emit are now
  cores:src/lib/karute/karute.core.ts#updateKaruteDetailEntryWithClient. Body byte-identical, the
  store lock still runs FIRST, the emit still sits inside the shared body so the web wrapper
  updateKaruteDetailEntry and the facade PATCH get exactly one row between them. The web wrapper
  stayed in the action file and was never an AUDITED_CORES symbol · Fable
  (PKT-SEC-CORES-D2-KARUTE-2026-09-23.md; ⚖ Liam 2026-09-16 security tight, whole ecosystem)
- 2026-09-23 · cores:src/actions/karute.ts#updateKaruteDetailSummaryWithClient · same move, same PR:
  the edited_summary overlay core and its karute.summary_edit emit are now
  cores:src/lib/karute/karute.core.ts#updateKaruteDetailSummaryWithClient. Body byte-identical —
  store lock first, content bounds, the no-change guard that refuses to mint a row for an identical
  save, then the emit — so the web wrapper updateKaruteDetailSummary and the facade PATCH still
  share ONE row. Only the module changed, and that module is no longer HTTP-reachable · Fable
  (PKT-SEC-CORES-D2-KARUTE-2026-09-23.md; ⚖ Liam 2026-09-16 security tight, whole ecosystem)
- 2026-09-23 · map:karute.save · NOT a repointed truth claim — the citation follows its own emitter.
  The skip row still says "karute.save logs at the shared choke point createOrUpdateKaruteRecord,
  never here", and that choke point is now src/lib/karute/karute.core.ts#createOrUpdateKaruteRecord
  instead of src/actions/karute.ts#createOrUpdateKaruteRecord. Same function, byte-identical body,
  same single emit; CP2 re-proves the new citation resolves and emits on every non-error path ·
  Fable (PKT-SEC-CORES-D2-KARUTE-2026-09-23.md; ⚖ Liam 2026-09-16 security tight, whole ecosystem)
- 2026-09-23 · map:karute.entry.update · same move, same PR: the skip row's coveredBy follows
  updateKaruteDetailEntryWithClient to src/lib/karute/karute.core.ts. The doctrine is unchanged —
  no live row here, because a row would double-log every facade entry edit against the core's own
  karute.entry_edit emit · Fable (PKT-SEC-CORES-D2-KARUTE-2026-09-23.md; ⚖ Liam 2026-09-16 security
  tight, whole ecosystem)
- 2026-09-23 · map:karute.summary.update · same move, same PR: the skip row's coveredBy follows
  updateKaruteDetailSummaryWithClient to src/lib/karute/karute.core.ts. Unchanged doctrine — the ONE
  karute.summary_edit emit lives in that shared body and covers the web action AND this facade
  route · Fable (PKT-SEC-CORES-D2-KARUTE-2026-09-23.md; ⚖ Liam 2026-09-16 security tight, whole
  ecosystem)
- 2026-09-23 · map:recordings.session.mint · same move, same PR: this skip row has cited
  createOrUpdateKaruteRecord since the facade map was written ("the mint stages nothing auditable;
  the eventual save is what audits the recording"), and that function's new home is
  src/lib/karute/karute.core.ts. Nothing about the mint changed, the cited emitter is byte-identical,
  and the ambiguity the row's own comment records (interactive save vs processJob) is exactly as it
  was · Fable (PKT-SEC-CORES-D2-KARUTE-2026-09-23.md; ⚖ Liam 2026-09-16 security tight, whole
  ecosystem)
- 2026-09-23 · SDK_WRITE_ALLOWLIST:src/lib/karute/karute.core.ts::karuteRecords.update · NOT a new
  legalized silent write — the SAME allowlist entry, at its new address. reassignKaruteCustomerWithClient's
  single `{ customer_id }` update has been allowlisted since 2026-08-23 under the key
  SDK_WRITE_ALLOWLIST:src/actions/karute.ts::karuteRecords.update (F4: the WithClient core is
  audit-free by design; karute.customer_reassign is a LIVE FACADE_AUDIT_MAP row on the phone door
  and the web wrapper reassignKaruteCustomer — AUDITED_CORES, unproven-marked — emits its own
  auditWeb). Body byte-identical, symbols, justification and `dated` unchanged, no pendingWave on
  this entry before or after; the gate reads a moved entry as an addition because the key is
  file-scoped · Fable (PKT-SEC-CORES-D2-KARUTE-2026-09-23.md; ⚖ Liam 2026-09-16 security tight,
  whole ecosystem)
- 2026-09-23 · SDK_WRITE_ALLOWLIST:src/lib/karute/karute.core.ts::karuteRecords.create · same move,
  same PR: the karuteRecords.create call site shared by createOrUpdateKaruteRecord's fresh-record
  branch and createManualKaruteRecordWithClient has been allowlisted since 2026-09-01 under the key
  SDK_WRITE_ALLOWLIST:src/actions/karute.ts::karuteRecords.create. Both symbols moved together,
  byte-identical; the emits that cover them did not move relative to the writes — emitSave still
  dominates the create inside createOrUpdateKaruteRecord, and the manual-create body still stays
  audit-free with its web wrapper createManualKaruteRecord (AUDITED_CORES, in the action file) and
  the facade's FACADE_AUDIT_MAP['karute.manualCreate'] row owning the emits. Justification and
  `dated` unchanged · Fable (PKT-SEC-CORES-D2-KARUTE-2026-09-23.md; ⚖ Liam 2026-09-16 security
  tight, whole ecosystem)
- 2026-09-23 · cores:src/actions/staff.ts · NOT a dropped writer — the symbols MOVED. Every
  runtime export of a 'use server' file is registered as a browser-callable server action with
  no authentication of its own, so the four client-threaded staff cores (createStaffCore,
  updateStaffCore, deleteStaffCore, uploadStaffAvatarCore) left src/actions/staff.ts for the
  server-only module src/lib/staff/staff.core.ts (no directive, `import 'server-only'` on line
  one). All four are re-registered there as AUDITED_CORES['src/lib/staff/staff.core.ts'],
  byte-identical body, same staff.add/staff.update/staff.remove/staff.avatar_update emits. The
  whole entry left the old file (nothing registered stays behind — the web wrappers were never
  registered), and the entry key is file-scoped so the move costs this line · Fable
  (PKT-SEC-CORES-D5-STAFF-2026-09-23.md; ⚖ Liam 2026-09-16 security tight, whole ecosystem)
- 2026-09-23 · map:staff.create · coveredBy repointed
  'src/actions/staff.ts#createStaffCore' → 'src/lib/staff/staff.core.ts#createStaffCore'.
  The same choke point, at its new address: the facade POST /api/app/v1/staff route still calls
  that one core, which still emits staff.add itself, which is why the row stays a 'skip' (a rule
  here would double-log every facade write). The citation moved because the file did · Fable
  (PKT-SEC-CORES-D5-STAFF-2026-09-23.md; ⚖ Liam 2026-09-16 security tight, whole ecosystem)
- 2026-09-23 · map:staff.update · coveredBy repointed
  'src/actions/staff.ts#updateStaffCore' → 'src/lib/staff/staff.core.ts#updateStaffCore'.
  Same move, same choke point: the facade PATCH /api/app/v1/staff/[id] route calls that one core
  and it emits staff.update itself · Fable (PKT-SEC-CORES-D5-STAFF-2026-09-23.md; ⚖ Liam
  2026-09-16 security tight, whole ecosystem)
- 2026-09-23 · map:staff.delete · coveredBy repointed
  'src/actions/staff.ts#deleteStaffCore' → 'src/lib/staff/staff.core.ts#deleteStaffCore'.
  Same move, same choke point: the facade DELETE /api/app/v1/staff/[id] route calls that one core
  and it emits staff.remove itself · Fable (PKT-SEC-CORES-D5-STAFF-2026-09-23.md; ⚖ Liam
  2026-09-16 security tight, whole ecosystem)
- 2026-09-23 · map:staff.uploadAvatar · coveredBy repointed
  'src/actions/staff.ts#uploadStaffAvatarCore' → 'src/lib/staff/staff.core.ts#uploadStaffAvatarCore'.
  Same move, same choke point: the facade POST /api/app/v1/staff/[id]/avatar route calls that one
  core and it emits staff.avatar_update itself · Fable (PKT-SEC-CORES-D5-STAFF-2026-09-23.md;
  ⚖ Liam 2026-09-16 security tight, whole ecosystem)
- 2026-09-24 · action:recording.session_cleanup · AUDIT_ACTIONS member removed. Its one emitter,
  src/lib/recording/session-cleanup.ts#deleteRecordingSessionWithClient, is deleted with the
  module, so CP4 would fail the member as an orphan. Retired on the lead's ruling 2026-09-23:
  nothing deleted, soft only; the write it covered no longer exists. The ja/en label stays, so
  past rows still render · Fable (PKT-S28-PR4-RETIRE-HARD-DELETE.md; ⚖ Liam 2026-09-16 nothing
  deleted, soft only)
- 2026-09-24 · cores:src/lib/recording/session-cleanup.ts · AUDITED_CORES entry removed. The
  module and its recordings.delete write are deleted outright (the entry's own INTERIM note said
  it goes with the module). Retired on the lead's ruling 2026-09-23: nothing deleted, soft only;
  the write it covered no longer exists · Fable (PKT-S28-PR4-RETIRE-HARD-DELETE.md; ⚖ Liam
  2026-09-16 nothing deleted, soft only)
- 2026-09-24 · map:recordings.session.delete · cited skip row deleted with its route (the facade
  DELETE /api/app/v1/recordings/session/[id] file is removed). Retired on the lead's ruling
  2026-09-23: nothing deleted, soft only; the write it covered no longer exists · Fable
  (PKT-S28-PR4-RETIRE-HARD-DELETE.md; ⚖ Liam 2026-09-16 nothing deleted, soft only)
- 2026-09-24 · SDK_WRITE_ALLOWLIST:src/lib/recording/transcript-memo.ts::storage.recordings.upload · PR-5
  (charge once) keeps the provider's answer for one audio object in one language at
  trc/<audio key>.<locale>.json, so the same audio is never paid for twice. The write
  (writeTranscriptMemo) is a side-effect of an ALREADY-AUDITED paid call: its one caller,
  runMeteredTranscription, reaches it only after the provider answered, and every door files
  its own recording.transcribe receipt for that same call (web auditWeb, facade hook row,
  job/from_session/discard via the meter's auditTranscriptionReceipt) — the write precedes it by
  one call-frame and never throws. ⚖ 8/17 doc law keeps the transcript content out of audit
  details, which is what the object holds. Create-only (upsert:false) except the one repair case
  (Greptile round): an object the read PROVED corrupt is replaced by the paid answer, unless a
  re-read immediately before the write finds another caller's repair, which is left standing
  (Greptile rounds 2–3); a readable memo is never replaced, nothing is ever deleted · Opus 5.5
  builder on Fable's S29 fix-round ruling
  (PKT-S29-PR5-CHARGE-ONCE.md; recorder fix plan v3 §6 row 3)
- 2026-09-24 · SDK_WRITE_ALLOWLIST:src/business/lib/practice-door/door.ts::orgSettings.upsert · the Business card-colour writer (A2): one key, palette-or-null, settings.manage, read-before-write; server log line per write, core audit row = R5 later · Fable 5.1 (lead, R-A2-4/R-A2-11) under the 7/27 parity rule · Liam's 9/24 fence yes · Liam is told before the merge word · core audit row = R5
- 2026-09-25 · SDK_WRITE_ALLOWLIST:src/business/lib/practice-door/door-booking-colors.ts::orgSettings.upsert · the Business booking-colours writer (予約の色分け, per store): one key (the whole per-store map), closed palette, settings.manage + a store the operator may see, read-before-write; server log line per write, core audit row = R5 later · Opus 5.5 builder on PKT-S38-COLORS-PR2 R8 + the lead's R-S39-1 under the 7/27 parity rule · ⚖ Liam 9/25 「make it work」 · Liam's per-change word before the merge
- 2026-09-25 · SDK_WRITE_ALLOWLIST:src/business/lib/practice-door/door-booking-colors.ts::orgSettings.upsert · shape change, same grant and symbol: 予約の色分け writes ONE key PER STORE (`booking_colors:<storeId>`, sent alone; core merges top-level keys, so the same-instant cross-store race is gone); the legacy `booking_colors` map is read-only (never written, never removed); closed palette, settings.manage + a store the operator may see, read-before-write · Opus 5.5 builder on PKT-S41-COLORS-PR2C R-S41-1 · ⚖ Liam 9/25 「Yeah okay, go with A」 · Liam's per-change word before the merge
