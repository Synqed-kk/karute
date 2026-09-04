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

/** ⚖ THE TRIGGER IS AN AUTHORITATIVE SIGN-IN, NOT A UID (fix round 3, F6). The
 *  first spelling memoised the uid and ran on any notify that carried one —
 *  which includes the PRE-RENDER seed, whose Bearer may be expired. That run
 *  drained against a stale token, every mint 401'd into a 60 s cooldown, and
 *  the settle a second later carried the SAME uid, so nothing ran again: the
 *  cold launch this module exists for drained nothing at all.
 *
 *  `currentGeneration()` is the store's own authoritative-write counter — it
 *  advances on the boot result, an explicit login and the sign-out flip, and
 *  NOT on the seed or on a token rotation (session-store.ts). So "the expired
 *  seed just became a fresh token" is exactly a generation the runner has not
 *  drained for, and the seed→settle pair for one staffer is still one run.
 *
 *  Null while nobody is signed in, which is what makes the same staffer signing
 *  back in on a shared iPad drain again. */
let drainedGeneration: number | null = null

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

/** Fire-and-forget, single-flight. */
function run(): Promise<void> {
  if (inFlight) return inFlight
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
  const state = getSessionState()
  if (state.status !== 'signed-in') {
    // Signed out, or recovering into it. Forget the memo so the next
    // authoritative sign-in drains, and drop the pending re-look: there is
    // nobody to drain for, and the store's owner gate would answer nothing.
    if (state.status === 'signed-out') {
      drainedGeneration = null
      clearTimeout(retryTimer)
      retryTimer = undefined
    }
    return
  }
  const generation = currentGeneration()
  if (generation === drainedGeneration) return
  drainedGeneration = generation
  void run()
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
