// Pure aligner — maps the voice-match engine's "this time range is the
// staff's voice" segments onto Deepgram's anonymous speaker indices.
// (Stage 1 of docs/diarization-stack.md; engine-agnostic: any provider that
// returns staff time segments works.)
//
// Overlap vote: for each Deepgram speaker, what fraction of their speaking
// time falls inside staff-identified segments? The whole-session vote makes
// single-segment engine errors wash out. Thresholds start at the council's
// values and get calibrated from shadow logs.

import type { DeepgramWord } from '@/lib/deepgram'

export interface StaffSegment {
  start: number
  end: number
}

export interface StaffSpeakerMatch {
  staffSpeakerIndex: number
  /** The winner's overlap ratio (0–1). */
  confidence: number
  /** True when staff segments blanket >80% of ALL speech — the pattern of a
   *  Deepgram merge error (staff+customer in one cluster). Confidence is
   *  halved; consumers should treat this as low-trust. */
  ambiguous: boolean
}

/** Winner must cover at least this fraction of their own speech. */
const MIN_WINNER_RATIO = 0.6
/** ...and beat the runner-up by at least this factor. */
const MIN_MARGIN = 2
/** Staff covering more than this fraction of ALL speech smells like a
 *  diarization merge — demote rather than confidently misattribute. */
const AMBIGUITY_COVERAGE = 0.8

export function mapStaffSpeaker(
  words: readonly DeepgramWord[],
  staffSegments: readonly StaffSegment[],
): StaffSpeakerMatch | null {
  if (words.length === 0 || staffSegments.length === 0) return null

  const perSpeaker = new Map<number, { total: number; staff: number }>()
  let allTotal = 0
  let allStaff = 0
  for (const w of words) {
    if (w.speaker === undefined) continue
    const dur = Math.max(0, w.end - w.start)
    const mid = (w.start + w.end) / 2
    const inStaff = staffSegments.some((s) => mid >= s.start && mid <= s.end)
    const cur = perSpeaker.get(w.speaker) ?? { total: 0, staff: 0 }
    cur.total += dur
    if (inStaff) cur.staff += dur
    perSpeaker.set(w.speaker, cur)
    allTotal += dur
    if (inStaff) allStaff += dur
  }
  if (perSpeaker.size === 0 || allTotal === 0) return null

  const ranked = [...perSpeaker.entries()]
    .map(([speaker, v]) => ({ speaker, ratio: v.total > 0 ? v.staff / v.total : 0 }))
    .sort((a, b) => b.ratio - a.ratio)

  const winner = ranked[0]
  const runnerUp = ranked[1]
  if (winner.ratio < MIN_WINNER_RATIO) return null
  if (runnerUp && runnerUp.ratio > 0 && winner.ratio < MIN_MARGIN * runnerUp.ratio) {
    return null
  }

  const ambiguous = allStaff / allTotal > AMBIGUITY_COVERAGE && perSpeaker.size > 1
  return {
    staffSpeakerIndex: winner.speaker,
    confidence: ambiguous ? winner.ratio / 2 : winner.ratio,
    ambiguous,
  }
}
