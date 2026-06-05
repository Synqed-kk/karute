# Recording resilience — never lose a captured session

| | |
| --- | --- |
| **Status** | Plan — T0 shipped (PRs #170, #171); T1–T4 to build |
| **Audience** | Anthony + whoever owns the recording pipeline |
| **Owners** | Liam (product) · Anthony (engineering) |
| **Updated** | 2026-06-05 |

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
- **Overrun nudge + hard auto-stop-and-save** (#171): a toast at ~2h; a hard stop
  at ~2.5h (~54 MB, < the 60 MB cap) that routes through the normal save path, so a
  forgotten recording is preserved, not lost.
- **Interim only** — covers an OS-alive recording (phone on the counter). It does
  **not** save a pocketed/locked phone (T4) and the 2.5h ceiling exists only because
  capture is still one blob (T1 removes it).

### T1 — Local-first segmented capture (the real fix)
Record in rolling ~10-min segments; **persist each locally as captured**
(IndexedDB / OPFS) and upload as it completes. A crash/kill/dead-battery loses *at
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

## Open decisions for Anthony
- **T0 thresholds** (2h warn / 2.5h stop) are constants — make them booking-aware
  (warn at booked-duration + buffer)?
- **T1 local persistence:** IndexedDB vs OPFS; segment length (~10 min?).
- **T2 timing:** enrollment gates robust segmented diarization — sequence it with T1.
- **T3 boundary model:** diarization-only vs + LLM; how conservative the default cut.

## Related
- `AI_LEARNING_LOOP.md` (spike) — what the captured data feeds.
- `SPEAKER_RECOGNITION_AND_RECORDING_LAW.md` (spike) — diarization + voice
  enrollment design + APPI/consent posture.
- `CAPACITOR_MIGRATION_PLAN.md` (spike) — native background recording (T4).
- PRs **#170** (bitrate) and **#171** (auto-stop) — T0, shipped.
