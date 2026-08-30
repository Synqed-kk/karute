// Single source for the accidental-tap floor (recording-integrity spec §3.5).
// Both readers — discard.ts's `below_floor` receipt flag and RecordPageView's
// belowFloor-gated banner discard — must agree on the same number.
export const BELOW_FLOOR_SEC = 10
