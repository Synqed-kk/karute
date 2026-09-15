import { listOwnStoppedUnsecuredTakeIds } from '@/lib/karute/take-store'
import { getRecordingPipelinePort } from '@/lib/ports/recording-port'
import { secureTake } from '@/lib/recording/secure-take'

/** ONE drain at a time, ACROSS EVERY CALLER (capture pipeline PR3 fix round 10,
 *  P3; LIFTED here in slice five packet A). The loop below is sequential — a
 *  take is a whole recording, tens of megabytes, and three PUTs at once on
 *  salon wifi starve each other until they all time out. But "one in flight"
 *  used to be per MOUNT: a staffer bouncing between 記録 and the record page
 *  (or React remounting under StrictMode) ran a second whole drain beside the
 *  first, which is the exact starvation the loop exists to prevent. Module-level
 *  because the two runs share no object — the same reason secure-take's own
 *  in-flight set is.
 *
 *  ⚖ AND IT IS ONE LOCK FOR BOTH DOORS NOW. The record page's mount effect and
 *  the phone's launch runner (thin/data/launch-drain.ts) call the SAME function,
 *  so a fast navigation onto the record page while the launch drain is still
 *  working cannot put two whole takes on the wire.
 *
 *  ponytail: a boolean that DEFERS the second run, not a queue that interleaves
 *  it — the running drain is already working the same worklist, so the loser
 *  simply asks again on the next tick. (It used to DROP the run outright, which
 *  under React's double mount left the surviving mount holding no schedule at
 *  all — fix round 11.) Upgrade path if that wait ever matters: chain the runs
 *  instead of re-reading the worklist. */
let running = false

/** What the caller has to decide its next move with. `busy` = another runner
 *  holds the lock and nothing else happened here, so ask again later. Otherwise
 *  `stillOwed` answers "is a take still owed its bytes?" — counting the ones
 *  the cooldown is HIDING, which is what the includeCoolingDown flag is for. */
export type DrainOutcome = { busy: true } | { busy: false; stillOwed: boolean }

/**
 * Secure every take this device still owes the server, one at a time.
 *
 * @param isActive the recorder singleton's own live-take probe, passed by a
 *   caller that shares its runtime. ⚖ `recorded` and nothing else: a take still
 *   recording (or paused) must never be finalized — its remaining audio could
 *   not land afterwards. This is that rule read from the recorder itself, the
 *   belt behind the worklist's own stopped-only filter.
 */
export async function drainOwedTakes(
  isActive?: (takeId: string) => boolean,
): Promise<DrainOutcome> {
  // The other runner is already on this same worklist: ask again after it,
  // never beside it.
  if (running) return { busy: true }
  running = true
  try {
    const port = getRecordingPipelinePort()
    // ONE AT A TIME, and this loop is the ONLY drain path (fix round 7). A
    // take is a whole recording — tens of megabytes — and a staffer with
    // three owed takes on salon wifi would otherwise start three PUTs at
    // once, each starving the others (and the app's own calls) until they
    // all time out. The recorder's own stopped take used to get a second,
    // un-awaited call of its own here: it is already on this worklist
    // (onstop stamps the duration the list reads), and starting it outside
    // the loop put two whole takes on the wire at once — the exact
    // starvation this is sequential to prevent.
    // isActive goes to the WORKLIST too (fix round 13): inside the phone's
    // single WebView the store may name a take whose stop stamp never
    // landed, and the singleton is the only thing that can tell that from a
    // take a page is still capturing (a paused one flushes nothing and looks
    // stale within seconds). On the web it changes nothing — the list stays
    // stopped-only there.
    for (const id of await listOwnStoppedUnsecuredTakeIds(false, isActive))
      await secureTake(port, id, undefined, isActive)
  } finally {
    running = false
  }
  // Keep ticking only while a take still OWES its bytes — counting the ones
  // the cooldown is HIDING, which is what the flag asks for. The eligible
  // list is empty both when everything is safely on the server and when
  // everything failed a minute ago; stopping on that would end the retry at
  // the moment it became necessary. Empty here means finalized or terminal,
  // and neither of those is waiting for us.
  return {
    busy: false,
    stillOwed: (await listOwnStoppedUnsecuredTakeIds(true, isActive)).length > 0,
  }
}
