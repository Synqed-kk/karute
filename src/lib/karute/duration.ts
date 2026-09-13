// R8 fix round 1 (§6a / LENS §5e): one home for the 「N分NN秒」 display split,
// lifted verbatim out of two files that carried an identical copy —
// src/components/karute/redesign/detail/KaruteDetailView.tsx and
// src/components/settings/redesign/sections/DiscardReasonsSection.tsx.

/** Whole minutes + zero-padded seconds, the mock's 「4分12秒」 shape. Negative
 *  and fractional durations are floored to a real clock reading rather than
 *  rendered raw — core stores seconds, but a number we print is a claim. */
export function durationParts(sec: number): { m: string; s: string } {
  const whole = Math.max(0, Math.floor(sec))
  return { m: String(Math.floor(whole / 60)), s: String(whole % 60).padStart(2, '0') }
}
