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

import { getCurrentSession, subscribeSessionState } from '@/lib/auth/mobile/session-store'
// Static imports are fine today (single bundle, no lazy routes yet) — the same
// precedent screen-prefetch.ts:24-27 carries for its own globalRecorder import,
// and the recorder is already in this entry chain because of it. So the live
// probe below is the REAL singleton, not an invented answer.
import { globalRecorder } from '@/lib/global-recorder'
import { drainOwedTakes } from '@/lib/recording/owed-drain'
import { sweepDiscardTranscripts } from '@/lib/recording/discard-transcript'

/** The uid this module has already drained for, or null when nobody is signed
 *  in. Two jobs in one field: it keeps the seed→signed-in notify PAIR from
 *  firing two runs for one staffer, and a sign-out resets it so the SAME
 *  staffer signing back in drains again (a shared iPad hands the phone on). */
let drainedUid: string | null = null

/** Fire-and-forget. Reads the session the way every other thin caller does —
 *  getCurrentSession answers the SEEDED session during 'recovering' too, which
 *  is the point: the owed audio must not wait for the boot gate to settle. */
function run(): void {
  const uid = getCurrentSession()?.user?.id ?? null
  if (!uid) return
  drainedUid = uid
  void (async () => {
    try {
      // The drain FIRST because it is the bytes: whole takes, the larger and
      // the more urgent upload, and the audio that exists nowhere but this
      // device. The words sweep second because it READS the finalized key —
      // which the drain may have just written — so this order saves the sweep
      // a wait on every take secured in this very run.
      await drainOwedTakes((id) => globalRecorder.isActiveTake(id))
      // …and then the discard words a reload left owing, which on the phone had
      // the same single door as the drain: the record page's mount.
      await sweepDiscardTranscripts()
    } catch (err) {
      console.warn('[launch-drain] run failed:', err)
    }
  })()
}

// A DIFFERENT staffer signs in on the shared iPad, or the same one signs back
// in after a sign-out: both drain. The store's owner gate is what scopes the
// worklist to whoever is signed in — this module never names a take itself.
subscribeSessionState(() => {
  const uid = getCurrentSession()?.user?.id ?? null
  if (!uid) {
    drainedUid = null
    return
  }
  if (uid !== drainedUid) run()
})

// The phone that came back from a pocket with signal. Cooldown protection is
// the take store's (SECURE_RETRY_COOLDOWN_MS), unchanged: a take that failed a
// minute ago is not eligible again yet, so a foreground burst costs one read.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') run()
})

// …and once at module load, for a session that was seeded before this module
// was even imported (bootMobileAuth's pre-render seed).
run()
