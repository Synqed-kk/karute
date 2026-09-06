# Recording & processing resilience — never lose a session, at any scale

| | |
| --- | --- |
| **Status** | Building — capture T0 shipped (#170, #171); T1's capture path is now shipped end to end (segments as they complete, the launch drain, the nightly assembler) with one decision still open (bitrate, below); T2–T4 to build |
| **Audience** | Anthony + whoever owns the recording pipeline |
| **Owners** | Liam (product) · Anthony (engineering) |
| **Updated** | 2026-09-07 |

## Why this matters (the principle)

The recording is the **top-of-funnel input to the whole product**: booking →
auto-filed karute on the right customer → customer memory that persists across
visits → **coaching that makes staff better**. If capture is lossy or unreliable,
*everything downstream is starved at the source* — the memory, the coaching, the
learning loop ([`AI_LEARNING_LOOP.md`]). So this isn't a recorder feature war with
Plaud; it's protecting the one input the moat compounds from.

**The non-negotiable:** a captured customer session must be **impossible to lose.**
Today it isn't.

## The failure modes (today)

The recorder holds one blob in memory and only uploads/transcribes at the **end**,
so a single problem = total loss of the session:

1. **Forgot to stop** (the realistic one): staff records, the customer leaves, they
   go on a break and forget. It runs 3–4 hr → exceeds the storage limit → the whole
   session is rejected and lost.
2. **Crash / dead battery / network drop** mid-session → the in-memory blob is gone.
3. **iOS backgrounding:** a pocketed/locked phone — iOS suspends the Safari tab, so
   the recording can stop or be killed *before* size even matters.

Raising the storage limit does **not** fix any of these — the fix is architectural:
**capture must be incremental and durable.**

## The plan (build order)

### T0 — Runaway safety nets — ✅ shipped (#170, #171)
- **48 kbps recording** (#170): ~0.36 MB/min, so a 90-min session is ~32 MB —
  under the bucket cap, with negligible STT impact (Opus is clean for speech well
  above ~16 kbps; Deepgram accuracy tracks sample rate, not bitrate).
- **Overrun nudge + hard auto-stop-and-save** (#171, retuned in 9072ba0): a toast
  at ~1h40; a hard stop at ~2h (~43 MB, < the real 50 MB cap) that routes through
  the normal save path, so a forgotten recording is preserved, not lost.
- **Interim only** — covers an OS-alive recording (phone on the counter). It does
  **not** save a pocketed/locked phone (T4) and the 2h ceiling exists only because
  capture is still one blob (T1 removes it).

### T1 — Local-first segmented capture (the real fix) — shipped, one decision open
**Where it actually stands (2026-09-07, capture-pipeline lane):**
- **Local persistence is live.** Takes are held in IndexedDB as ~5 s segments
  and survive a crash, a kill, and a dead battery (`lib/karute/take-store.ts`).
- **The segments go up as they complete** (#836, `lib/recording/segment-uploader
  .ts`) — every ~5 s, while the recording is still running. What the device had
  is no longer only on the device.
- **The whole take is secured at STOP**, to its own server-composed key, and the
  core row points at it (`lib/recording/secure-take.ts`). Transcription and the
  server job both read *that* object — there is no second staging upload.
- **Every session row minted since slice ③ is born in a store** (older rows
  carry none, and the take doors read that as open). The recording carries the store it
  was made in, and both doors refuse rather than persist a store-less *new* row
  whatever the client sent: the facade mint stamps the request's own `store-id`
  lens when one rode it (proven to be this caller's first) and otherwise the
  business's primary store — the same store the shell seeds its own lens to on
  first boot, so the two answers agree by construction. A store lookup that
  cannot answer is a fail-closed 403 on the facade, or a null mint (no row) on
  the web action; capture is unaffected either way, because the client reads any
  non-2xx / null id as "no session id" and the drain re-mints later.
- **A take the device never sent is drained at the next launch** (#835), so a
  phone that comes back finishes its own recording rather than waiting for
  anyone to notice — and it can *always* finish it, whenever it turns up,
  because the nightly job below never occupies the key it will need.
- **And a device that never comes back no longer keeps the audio** — a nightly
  job (03:07 JST, `/api/assemble`, `lib/recording/assembler.ts`) rebuilds the
  take from the segments it left behind, once they have gone 48 hours
  untouched. It concatenates the contiguous run from the first segment, ADDS
  the result **beside** the take — at `rsc/<the take's own key>`, never on it —
  and files one `recording.capture_resumed` audit row that says plainly how many
  segments there were, where the first hole is, and how long the rebuilt audio
  is estimated to run. Two days, not two hours, because the device's own drain
  is faster than we are and there is nothing to gain by spending a rebuild on a
  take that is about to arrive whole.
- **⚖ The rescue is a SIDE key, and that is what closes the returning phone**
  (Liam's ruling, 2026-09-06). It used to write under the take's own key, which
  meant a phone turning up later — out of a drawer, or simply *un-paused* — met
  an object it could not replace, and its own finalize ended at a terminal
  `size_mismatch` with the fuller audio stuck on the device. Writing one prefix
  over leaves the phone's key free: it uploads its whole take and finalizes at
  the size it declared, and nothing is stuck. Both objects then exist, and every
  reader **prefers the phone's** — one precedence in one place
  (`lib/recording/take-audio.ts`), used by the play button and the discard door
  today and by the inbox's save door next. The 48-hour line now decides only
  *when* a rescue happens, never what it can break. The cost is one extra
  partial object per rescued take, which — like all audio here — is never
  deleted.
- **⚖ What the side key does NOT close — the words.** A karute somebody saved
  from a rescue was transcribed from the rebuilt prefix, and it keeps those
  words for good: no door in the app re-transcribes an existing record
  (`regenerate-karute.ts` reads the record's own transcript, never the audio).
  So when the phone returns, its fuller take becomes *playable* — the play
  button signs it automatically — without becoming *written*. The staffer sees a
  normal saved karute, not 要対応. The honest close is a 「音声から文字起こしを
  やり直す」 door, and that is a separate decision, not this lane. It is still
  strictly better than what it replaced: nothing is stuck, no second karute
  appears, and the full recording is on the server either way.
- **The rescued take's LENGTH will be written when a staffer saves it** — not
  by the nightly job. Core fences `PUT /v1/recordings/:id` behind a human actor
  (core D10, `docs/backlog/LIAM_FULL_DUMP_BACKLOG.md:94`), and a 03:07 cron has
  none, so the job settles the audio and records what it rebuilt. The next PR's
  save door — **not built yet** — will write `duration_seconds` from the same
  estimate with the staffer's own credentials. **Until then, and for any
  rescued take nobody saves:** the row keeps a null duration, so 録音履歴 shows
  no length for it. Nothing is lost by that — the audio is on the server and
  the audit row carries the estimate — and closing it for good would take a
  system actor in core.
- **⚖ Retention is LIVE: audio is never deleted.** Every code path that could
  destroy a recording is gone — the worker's post-transcription delete, the
  facade transcribe route's `finally`, the web port's cleanup leg, the discard
  janitor, the `removeRecordingObject` server action, and the hour-old bucket
  sweep (which now only *reports*). `deleteTake` refuses a take the server has
  not received, and session cleanup refuses a row that still points at audio.
  The assembler is held to the same rule: it reads segments and adds an object,
  and removes nothing at all. Enforced in CI by
  `scripts/audit/check-audio-never-deleted.mjs`; the one exemption is
  voice-enrolment revocation, fenced to its own key prefix.

**What T1 still does NOT cover — so it is not "done":**
- **Bitrate stays 48 kbps** (T0's number). Whether to raise it is still an OPEN
  decision, and it is the bucket cap that has to answer first — a 2-hour take
  at 48 kbps is already ~43 MB against a 50 MB object cap.
- **A pocketed or locked phone still suspends capture** — that is T4 (native
  background audio), not this lane.
- **録音履歴 does not yet say any of this.** A staffer on a device that no
  longer holds the take still reads 失敗 until the row learns to say "the
  server holds part of this one" and offer 保存する; that is the inbox half,
  built separately — and it is the same half that writes a rescued take's
  length.

The design, in full: record in rolling segments; **persist each locally as
captured** (IndexedDB / OPFS) and upload as it completes. A crash/kill/dead-battery loses *at
most the last segment*, never the session, and no single blob is ever too big or
too large for memory. On stop, transcribe segments and **stitch** into one
transcript. This is Plaud's model in software (see below). Removes the length
ceiling entirely.

> **Hard problem to design for:** Deepgram diarization labels are per-request, so
> "Speaker 0" in segment 1 ≠ "Speaker 0" in segment 2 — naive stitching scrambles
> who's who. The fix is T2.

### T2 — Voice enrollment (enables segmented diarization)
The spike already scaffolds it ([`SPEAKER_RECOGNITION_AND_RECORDING_LAW.md`];
`VoiceEnrollmentDialog` exists in Settings → Staff). Enroll staff once → "staff vs
customer" is consistent **across segments and across sessions** (Plaud does exactly
this — "name a speaker once, recognized forever"). Not optional once we segment.

### T3 — Session-boundary trim (quality + compliance)
A runaway recording's tail (after the customer leaves) is irrelevant *and* a
**legal risk** — it captures non-consented third parties / private staff talk
(APPI). So:
- **Auto-detect the end:** the customer's **last sustained utterance** (via
  diarization) + a light LLM confirmation. Good enough to *propose*, never to
  decide — it fails on crosstalk, a quiet customer, or a customer who steps out and
  returns (Plaud documents these same failures).
- **Staff confirms / drags the marker** — one tap in the common case. Handles both
  the runaway (trim) and the legit-long session (extend). **Non-destructive** — the
  boundary is a marker on what the karute surfaces; never a hard delete on a guess.
- **Trim before you bill:** stop transcribing once the customer's voice has been
  absent for N minutes — a forgotten recording must not cost hours of Deepgram for a
  1-hour session.

### T4 — True background reliability
For recording *through* a lunch break on a pocketed phone, the web can't do it
reliably (iOS suspends tabs). The answer is **native background audio via Capacitor**
([`CAPACITOR_MIGRATION_PLAN.md`]) — which is also how Plaud's device does it. Live
streaming transcription (Deepgram websocket) is the alternative end-state (no upload
at all).

> **✅ Tested (real use):** the iOS `UIBackgroundModes: audio` background-audio
> path has been confirmed keeping capture alive with the app backgrounded / phone
> locked. The Capacitor shell holds the mic session; recording no longer dies on
> tab suspension.

## What we learned from Plaud (and where the moat actually is)

Plaud's architecture (researched): the **device is a capture-store-transfer
peripheral with NO AI on it** — mics + DSP/beamforming + flash memory + Bluetooth.
All transcription/diarization/LLM runs in the **cloud** (Claude/GPT), triggered by
the app, **not real-time**. Three things worth copying:

1. **Local-first capture** — record to local storage first, sync later (T1).
2. **Voice enrollment that learns** — name once, recognized forever (T2).
3. **Industry glossaries / keyterm priming** — feed Deepgram a 整体/beauty + product
   + staff-name glossary (keyterm prompting) for accuracy, no provider change.

**The moat is NOT a recorder feature** (Plaud has screened models, good mics, etc.).
It's the **integrated system + coaching**: Karute auto-files the recording on the
right customer, links the appointment, updates memory, and **feeds coaching** — a
compounding flywheel Plaud structurally can't follow without becoming a booking +
CRM + coaching company. Capture-resilience protects the *input* to that.

## Hardware mic — keep the pipeline input-source-agnostic

Liam is exploring a wearable clip mic (Plaud-style: **capture + store + transfer;
the AI stays in our cloud**). So the capture → upload → transcribe path should treat
the audio source as pluggable — **phone mic today, Bluetooth/wearable mic later** —
without a rewrite. The device feeds the same pipeline; nothing about T1–T3 changes.

## Processing durability + scale (the other half)

Capture is only half of "never lose a session." The **processing** (transcribe →
extract → summarize → save) has its own durability + concurrency gaps — and they
bite the moment more than one bed is recording.

### Two concurrency problems
- **A — one device, back-to-back.** Staff finishes customer A, the transcription is
  still running, customer B walks in. They must start recording B **immediately**,
  without losing A.
- **B — many devices, one account.** 3 beds in Daikanyama + 5 in Ginza all record +
  transcribe on the same 14:00 slot — scaling to hundreds/thousands.

### Current state (prototype — supports neither at scale)
- `globalPipeline` is a **single-slot, in-memory singleton**. Starting B's pipeline
  while A runs **supersedes A and discards it** (the `runId` bails the old run) — so
  back-to-back recording **silently loses the first karute**. It also **dies on a
  page reload** mid-transcription.
- The client singletons are **per-browser-tab**, so 8 phones don't collide on the
  client — but they all hit the same backend, where three ceilings live:
  - **Per-account rate caps** — `synqed.aiRateLimit.consume` enforces an hourly
    request cap + daily $-cap **shared across every staff member in the account**.
    Must be sized per-plan for real concurrency, or simultaneous staff get `429`.
  - **Upstream API concurrency** — Deepgram's per-key concurrent limit + OpenAI org
    RPM/TPM. Fine at 8; needs higher tiers at thousands.
  - **Serverless timeouts** — transcribe is capped at 300s; a 90-min Deepgram job
    fits, but it's a ceiling.
  - **Cost accounting** — the $-cap under-counted gpt-4o until **#174**; Deepgram's
    per-minute spend (the dominant cost) still isn't in the cap (synqed-core TODO).

### The fix — move processing into a server-side job queue
The client should stop processing on-device:

```
Device:  record → upload audio to storage → POST a "process recording" job → DONE
         → free to record the next customer immediately.

Backend: a durable queue holds jobs. Workers pull them → Deepgram → OpenAI → write
         karute → notify. Workers scale horizontally — N workers = N concurrent jobs.
         Every recording is its own job; A, B, C never touch each other.

Device:  polls / subscribes → "3 karutes ready to review."
```

Why this is bulletproof:
- **A (back-to-back):** trivial — each recording is an independent job; the device
  never waits.
- **B (many devices):** trivial — 8 or 8,000 recordings are just that many jobs;
  scale = worker count + API tiers + DB pooling.
- **No loss, survives reload:** audio is durable in storage and the job is durable
  in the queue **before** any processing runs — a crash/reload loses nothing.
- This is the "durable v2" the pipeline code already flags. Primarily **synqed-core
  / backend** work; the client simplifies to upload-and-enqueue + a review inbox.

### What must scale (synqed-core / infra)
- **Job queue + workers** (Postgres-queue / SQS / Inngest / Trigger.dev — pick one).
- **Per-account rate caps sized per plan** — don't throttle a legitimately busy store.
- **API tiers** — Deepgram + OpenAI concurrency/throughput for the target scale.
- **DB** — connection pooling + write throughput for concurrent karute saves.
- **Cost accounting** — fold Deepgram per-minute spend into the cap (#174 fixed the
  token side).

## Open decisions for Anthony
- **Processing pipeline:** client-side concurrent vs the server-side job queue
  above. Recommend the queue — it's the only one that scales to many beds + survives
  reload. Which queue tech?
- **T0 thresholds** (1h40 warn / 2h stop) are constants — make them booking-aware
  (warn at booked-duration + buffer)?
- **T1 local persistence:** IndexedDB vs OPFS; segment length (~10 min?).
- **T2 timing:** enrollment gates robust segmented diarization — sequence it with T1.
- **T3 boundary model:** diarization-only vs + LLM; how conservative the default cut.

## Related
- `AI_LEARNING_LOOP.md` (spike) — what the captured data feeds.
- `SPEAKER_RECOGNITION_AND_RECORDING_LAW.md` (spike) — diarization + voice
  enrollment design + APPI/consent posture.
- `CAPACITOR_MIGRATION_PLAN.md` (spike) — native background recording (T4).
- PRs **#170** (bitrate) and **#171** (auto-stop) — capture T0, shipped.
- PR **#174** — model-aware spend-cap cost estimate (the cost-accounting gap above).
- `src/lib/global-pipeline.ts` — the single-slot client pipeline to replace.
