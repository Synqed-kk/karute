// ⚖ THE PHONE DRAINS AT LAUNCH (capture pipeline slice five, D3). Side-effect
// module, wired at boot from thin/main.tsx — the same idiom screen-prefetch.ts
// uses, for the same reason: its module-scope subscribeSessionState arms itself
// with no explicit init call.
//
// THE HOLE IT CLOSES. Until now the ONLY drain in the app was the record page's
// mount effect (src/lib/recording/owed-drain.ts, called from RecordPageView).
// On the phone that is a page a staffer may not open for a day: a take whose
// stop-time upload lost the network — the salon's wifi dropping, the app
// backgrounded by a call, the phone dying mid-PUT — then sits on the device
// with its audio nowhere else, silently, until somebody happens to walk back
// onto 録音. The shell reopens far more often than that page does, and inside
// the single WebView the recorder singleton is the whole world, so a launch is
// a moment when "is anything still owed?" can be asked honestly.
//
// The WEB deliberately keeps only its mount drain: a browser can hold this app
// open in five tabs, and a drain per tab load is five runners on one worklist.
//
// Nothing rendered waits on any of this. It is fire-and-forget behind the
// splash, and every refusal it can meet is already recorded on the take.
//
// ⚖ THE INVARIANT THIS MODULE KEEPS (fix round 6). Every authoritative
// signed-in state — a generation while the store's status is 'signed-in' —
// gets at least one run that STARTED under it. Foreground and retry-tick runs
// may happen in any state; only a run that started signed-in SERVES a
// signed-in state. Everything below is that sentence: one key, compared in
// three places (a run's start, that run's end, and the subscriber).

import {
  currentGeneration,
  getSessionState,
  subscribeSessionState,
} from '@/lib/auth/mobile/session-store'
// Static imports are fine today (single bundle, no lazy routes yet) — the same
// precedent screen-prefetch.ts:24-27 carries for its own globalRecorder import,
// and the recorder is already in this entry chain because of it. So the live
// probe below is the REAL singleton, not an invented answer.
import { globalRecorder } from '@/lib/global-recorder'
import { drainOwedTakes } from '@/lib/recording/owed-drain'
import { sweepDiscardTranscripts } from '@/lib/recording/discard-transcript'

/** How long this module waits before looking again when a take is still owed.
 *  A COPY of RecordPageView's own REDRAIN_MS/REDRAIN_JITTER_MS (see the note at
 *  RecordPageView.tsx:110-119, which explains why the page keeps a copy rather
 *  than importing the store's SECURE_RETRY_COOLDOWN_MS): this is the RUNNER's
 *  policy — how often it looks — and the store's is the TAKE's — how soon it may
 *  be tried again. They are equal only by today's arithmetic, and a shorter tick
 *  here could only re-read a worklist the cooldown is still hiding. The jitter
 *  keeps a salon's phones, all opened at the same 10:00, off one door. */
const REDRAIN_MS = 60_000
const REDRAIN_JITTER_MS = 5_000

/** ⚖ THE ONE THING A RUN IS FOR (fix round 6): the signed-in generation it
 *  started under, or null when it started in any other state.
 *
 *  `currentGeneration()` is the store's own authoritative-write counter — it
 *  advances on the boot result, an explicit login and the sign-out flip, and
 *  NOT on the pre-render seed or on a token rotation (session-store.ts). The
 *  STATUS is the other half, and it has to be, because `applyTokenRotation`
 *  flips recovering → signed-in IN PLACE without moving the counter: a
 *  generation alone cannot tell "still recovering" from "signed in now".
 *
 *  Rounds 3, 4 and 5 each patched one symptom of comparing something narrower
 *  than this — a uid, then a bare generation, then a generation plus a
 *  start-time status check — and each left the next shape of the same bug
 *  alive: a run drained for a staffer it never looked at, or a settle whose own
 *  turn was spent by a run that started before it. They are one bug. The key
 *  below is the whole of the fix, and the three places it is compared are the
 *  three moments that can differ. */
const servedKey = (): number | null =>
  getSessionState().status === 'signed-in' ? currentGeneration() : null

/** The last signed-in generation a run actually STARTED under. Written by
 *  `run()`, never by the subscriber: "this state has been served" is a claim
 *  only a pass that began under it can make. Null while nobody is signed in,
 *  which is what makes the same staffer signing back in on a shared iPad drain
 *  again. */
let drainedKey: number | null = null

/** The run in flight, so a second trigger joins it instead of starting a rival
 *  (fix round 3, F6). `drainOwedTakes` self-guards its own loop, but the SWEEP
 *  half never did and `run()` had no guard at all — so a foreground event
 *  landing on a launch drain answered `busy` and fell straight through to
 *  `sweepDiscardTranscripts`, putting a second whole take on the wire beside
 *  the first. That is the starvation the sequential loop exists to prevent. */
let inFlight: Promise<void> | null = null

/** The one pending re-look, ever. Cleared on sign-out, and replaced rather
 *  than stacked — the same "ONE pending wake-up" shape the record page's
 *  scheduler keeps. */
let retryTimer: ReturnType<typeof setTimeout> | undefined

function schedule(): void {
  clearTimeout(retryTimer)
  retryTimer = setTimeout(() => void run(), REDRAIN_MS + Math.random() * REDRAIN_JITTER_MS)
}

/** Fire-and-forget, single-flight.
 *
 *  ⚖ JOINING A RUN IS NOT HAVING ONE (fix round 6, and the whole of the
 *  invariant at the top of this file). A drain is scoped to whoever is signed
 *  in when it starts — `listOwnStoppedUnsecuredTakeIds` is owner-gated — so a
 *  pass that began under one state can never answer for another. The
 *  single-flight guard below is still right (one whole take on the wire at a
 *  time), but the trigger it turns away has NOT been served: it was handed
 *  somebody else's promise.
 *
 *  So the key is read at the start, memoised only when it names a signed-in
 *  state, and read again at the end. Different ⇒ a signed-in state exists that
 *  no run has started under, and it gets one immediately — no timer, no
 *  foreground event. That covers, in one comparison, all three shapes the
 *  earlier rounds patched one at a time: the shared iPad where the generation
 *  moved mid-run, a foreground pass that began while the boot was still
 *  recovering, and the token rotation that settles recovering → signed-in
 *  DURING such a pass without moving the generation at all. */
function run(): Promise<void> {
  if (inFlight) return inFlight
  // Read once, at the one moment that matters: work starting. A run that began
  // outside signed-in claims nothing, so the settle that follows it still finds
  // its own turn waiting.
  const startKey = servedKey()
  if (startKey !== null) drainedKey = startKey
  const work = (async () => {
    try {
      // The drain FIRST because it is the bytes: whole takes, the larger and
      // the more urgent upload, and the audio that exists nowhere but this
      // device. The words sweep second because it READS the finalized key —
      // which the drain may have just written — so this order saves the sweep
      // a wait on every take secured in this very run.
      const outcome = await drainOwedTakes((id) => globalRecorder.isActiveTake(id))
      // ⚖ A BUSY DRAIN IS NOT A TURN TO SWEEP (fix round 3, F6). `busy` means
      // the record page's own drain holds the lock and is working this very
      // worklist; the sweep's staging is a whole-take upload of its own, so
      // running it here would be the second recording on the wire that the one
      // lock was lifted to module scope to prevent. The sweep runs only after a
      // drain THIS run actually performed.
      if (outcome.busy) {
        schedule()
        return
      }
      // …and then the discard words a reload left owing, which on the phone had
      // the same single door as the drain: the record page's mount.
      await sweepDiscardTranscripts()
      // A take still owes its bytes — an offline launch, a mint that 401'd, a
      // PUT that met its deadline. The record page has a tick for this and the
      // launch runner had none, so a boot that drained nothing never asked
      // again and the audio waited for a foreground cycle or a walk onto 録音.
      if (outcome.stillOwed) schedule()
    } catch (err) {
      console.warn('[launch-drain] run failed:', err)
    } finally {
      inFlight = null
      // ⚖ START vs NOW, one comparison. A different key means the generation
      // moved while this pass worked, OR this pass started outside signed-in
      // and the store is signed in now — either way a signed-in state exists
      // that no run has started under, and somebody was handed this promise
      // instead of a run of their own. Serve it. The new run writes the memo
      // itself, so a third transition landing inside THAT one is caught the
      // same way. Deliberately in the `finally` and not the `try`: a pass that
      // threw must not swallow the next staffer's turn — that was the one
      // shape with no heal at all before round 4.
      const now = servedKey()
      if (now !== null && now !== startKey) void run()
    }
  })()
  inFlight = work
  return work
}

// A DIFFERENT staffer signs in on the shared iPad, or the same one signs back
// in after a sign-out: both open a new generation, and both drain. The store's
// owner gate is what scopes the worklist to whoever is signed in — this module
// never names a take itself.
//
// 'recovering' deliberately never runs: nothing can upload without a valid
// Bearer anyway, and the settle arrives either inside the boot gate's timeout
// or on the resume coordinator — as a new generation, which is this line.
subscribeSessionState(() => {
  const key = servedKey()
  if (key === null) {
    // Signed out, or recovering. Only a sign-out forgets the memo — so the next
    // authoritative sign-in drains — and drops the pending re-look: there is
    // nobody to drain for, and the store's owner gate would answer nothing.
    if (getSessionState().status === 'signed-out') {
      drainedKey = null
      clearTimeout(retryTimer)
      retryTimer = undefined
    }
    return
  }
  // A signed-in state no run has started under. `run()` writes the memo, so a
  // trigger that merely JOINS a pass in flight leaves this key unserved — and
  // that pass's own tail comes back for it.
  if (key !== drainedKey) void run()
})

// The phone that came back from a pocket with signal. Cooldown protection is
// the take store's (SECURE_RETRY_COOLDOWN_MS), unchanged: a take that failed a
// minute ago is not eligible again yet, so a foreground burst costs one read.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void run()
})

// ⚖ AND NOTHING RUNS AT MODULE LOAD (fix round 3, F6). There used to be a bare
// `run()` here "for a session that was seeded before this module was imported".
// The entry cannot produce that: import declarations are hoisted, so this body
// evaluates during thin/main.tsx's import phase, while `bootMobileAuth()` —
// the only caller of seedKnownSession — runs from main() far below it. Nothing
// evaluated ahead of this module writes the store, so the call could only ever
// return at its first line. Worse, it ran BEFORE main.tsx's
// setRecordingPipelinePort, so had the ordering ever changed it would have
// drained through the WEB port from inside capacitor://localhost. The
// subscriber above is what actually starts the first run, and it is past that
// assignment by construction; thin/main.tsx's side-effect import is pinned by
// recording-delete-doors-removed.test.ts.
