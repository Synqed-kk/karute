// THE RECORDER'S YELLOW NOTICE, DECIDED (recording hole PR-6, FIX-PLAN §3
// "Detection"). One pure function, no React, no globals: the recorder feeds it
// what it already knows about the live take on its flush tick and renders
// whatever it answers. Two things can be wrong while a take records:
//   · 'device' — this phone cannot save the take (storage is off and the
//     revive has not won it back), so the audio is going straight to the
//     server from memory;
//   · 'server' — the server is not receiving it, so the audio is being kept
//     on the phone and sent later.
// `device` outranks `server`, and nothing latches: the answer is null the
// moment neither holds, so the notice clears on recovery.
//
// These are DETECTION THRESHOLDS, not lengths a salon chooses — constants, not
// settings (NO-HARDCODED-DURATIONS covers staff-chosen lengths only).

/** How long the revive gets before the phone is called unable to save: 15 s
 *  after its first try (it retries on the 5 s flush tick, backing off
 *  5/10/20/40 s — global-recorder's REVIVE_BACKOFF_MS). */
export const DEVICE_GRACE_MS = 15_000

/** Recorded time with not one segment on the server: one full pump backoff —
 *  segment-uploader's refusal backoff doubles 5 s → 60 s (SEGMENT_BACKOFF_MIN/MAX_MS). */
export const SERVER_SILENT_MS = 60_000

/** Segments written but not on the server: at one segment per ~5 s flush
 *  (TAKE_FLUSH_MS) this is ~90 s of audio — past one full 60 s backoff. */
export const SEGMENTS_BEHIND = 18

export type CaptureWarning = 'device' | 'server'

export function computeCaptureWarning(input: {
  /** The recorder's own recorded duration (paused time excluded) — the one
   *  the overrun guard reads. */
  recordedMs: number
  /** The take's storage is off (global-recorder's `p.disabled`). */
  disabled: boolean
  /** When the revive FIRST tried in this outage (global-recorder's
   *  `p.revive.since`); 0 = it has not tried. Not `p.revive.at`, which is when
   *  the NEXT try is due. */
  reviveAt: number
  /** Highest seq the server has (a contiguous prefix); -1 = none. */
  uploadedSeq: number
  /** Highest seq written (the row's, or memory's while storage is off). */
  lastSeq: number
  /** A terminal answer that stopped the segment pump for this take. */
  segmentError: string | null | undefined
  now: number
}): CaptureWarning | null {
  if (input.disabled && input.reviveAt > 0 && input.now - input.reviveAt >= DEVICE_GRACE_MS) {
    return 'device'
  }
  if (
    (input.recordedMs >= SERVER_SILENT_MS && input.uploadedSeq < 0) ||
    input.lastSeq - input.uploadedSeq >= SEGMENTS_BEHIND ||
    !!input.segmentError
  ) {
    return 'server'
  }
  return null
}
