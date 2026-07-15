// Stage 0 of the diarization stack (docs/diarization-stack.md): stop
// discarding the speaker labels we already pay Deepgram for. Pure module —
// no I/O, fully unit-tested.
//
// Role attribution (council spec):
//   - H1: the FIRST speaker is the staff member (~85% — staff opens every
//     session; verified against the real ぴあそん transcripts: 「こんにちは、
//     今日はどうされましたか」).
//   - The customer is the non-staff speaker with the most turn-taking
//     adjacency to staff (immediately before/after a staff turn).
//   - Every other speaker is a BYSTANDER (周囲の会話) — the マッキー failure
//     mode: neighboring-bed chatter must never enter this customer's karte.
//   - Bias to 'unknown' over guessing: misattribution is the trust-killing
//     failure, omission is recoverable (要確認 review, Stage 1 enrollment).

import type { DeepgramParagraph, DeepgramWord } from './deepgram'

export type SpeakerRole = 'staff' | 'customer' | 'unknown'

export interface DiarizedTurn {
  role: SpeakerRole
  speaker: number
  text: string
  start: number
  end: number
}

export interface DiarizedTranscript {
  turns: DiarizedTurn[]
  speakerCount: number
}

/** Per-segment confidence below this → role 'unknown' (要確認), never a guess. */
const SEGMENT_CONFIDENCE_FLOOR = 0.45
/** Overall transcription confidence below this → no attribution at all
 *  (caller falls back to the flat transcript — graceful degradation). */
const OVERALL_CONFIDENCE_FLOOR = 0.55

/** Voiceprint match from the speaker-id pass — overrides the first-speaker
 *  heuristic when confident. Upgrade-only: a weak hint changes nothing. */
export interface StaffHint {
  speaker: number
  confidence: number
}

const STAFF_HINT_MIN_CONFIDENCE = 0.7

export function buildDiarizedTranscript(
  paragraphs: readonly DeepgramParagraph[],
  words: readonly DeepgramWord[],
  overallConfidence: number,
  staffHint?: StaffHint | null,
): DiarizedTranscript | null {
  if (paragraphs.length === 0) return null
  if (overallConfidence > 0 && overallConfidence < OVERALL_CONFIDENCE_FLOOR) return null

  const speakers = [...new Set(paragraphs.map((p) => p.speaker))]
  // One voice = nothing to attribute; flat transcript is strictly clearer.
  if (speakers.length < 2) return null

  // Staff = the ENROLLED VOICE when the speaker-id pass matched confidently
  // (proof beats heuristic); otherwise H1 — first voice on the recording.
  const staff =
    staffHint &&
    staffHint.confidence >= STAFF_HINT_MIN_CONFIDENCE &&
    speakers.includes(staffHint.speaker)
      ? staffHint.speaker
      : paragraphs[0].speaker

  // Customer = the non-staff speaker most interleaved with staff turns.
  const adjacency = new Map<number, number>()
  for (let i = 0; i < paragraphs.length; i++) {
    const cur = paragraphs[i].speaker
    if (cur === staff) continue
    const prev = paragraphs[i - 1]?.speaker
    const next = paragraphs[i + 1]?.speaker
    if (prev === staff) adjacency.set(cur, (adjacency.get(cur) ?? 0) + 1)
    if (next === staff) adjacency.set(cur, (adjacency.get(cur) ?? 0) + 1)
  }
  let customer: number | null = null
  let best = -1
  for (const s of speakers) {
    if (s === staff) continue
    const score = adjacency.get(s) ?? 0
    if (score > best) {
      best = score
      customer = s
    }
  }

  const turns: DiarizedTurn[] = paragraphs.map((p) => {
    const conf = paragraphConfidence(p, words)
    const role: SpeakerRole =
      conf < SEGMENT_CONFIDENCE_FLOOR
        ? 'unknown'
        : p.speaker === staff
          ? 'staff'
          : p.speaker === customer
            ? 'customer'
            : 'unknown'
    return { role, speaker: p.speaker, text: p.text, start: p.start, end: p.end }
  })
  return { turns: repairAndCoalesce(turns), speakerCount: speakers.length }
}

/** Deepgram splits mid-sentence when diarization flips, stranding the closing
 *  punctuation at the head of the NEXT turn (「施術者: 。はい」) and shredding
 *  one utterance into many tiny labeled fragments. Both damage the readers:
 *  staff auditing the transcript and the LLM whose attribution rules trust the
 *  labels. Repair = give leading punctuation back to whoever spoke last, then
 *  merge consecutive same-role turns into one. */
const LEADING_PUNCT = /^[。、．，,.!！?？…]+/

function repairAndCoalesce(turns: readonly DiarizedTurn[]): DiarizedTurn[] {
  const out: DiarizedTurn[] = []
  for (const t of turns) {
    const prev = out[out.length - 1]
    let text = t.text
    if (prev) {
      const m = text.match(LEADING_PUNCT)
      if (m) {
        prev.text += m[0]
        text = text.slice(m[0].length).trimStart()
      }
    }
    if (!text) continue
    if (prev && prev.role === t.role && prev.speaker === t.speaker) {
      // Same voice continuing — one turn. Space matches how deepgram.ts joins
      // paragraph sentences. Speaker must match too: two DIFFERENT bystanders
      // both land role 'unknown', and merging them would fuse two people's
      // speech into one 周囲の会話 line.
      prev.text += ` ${text}`
      prev.end = t.end
    } else {
      out.push({ ...t, text })
    }
  }
  return out
}

/** Mean word confidence inside the paragraph's time range; 1 when unknown
 *  (missing words must not silently mark everything 要確認). */
function paragraphConfidence(
  p: DeepgramParagraph,
  words: readonly DeepgramWord[],
): number {
  let sum = 0
  let n = 0
  for (const w of words) {
    if (w.start >= p.start && w.end <= p.end) {
      sum += w.confidence
      n++
    }
  }
  return n === 0 ? 1 : sum / n
}

const ROLE_LABEL: Record<SpeakerRole, string> = {
  staff: '施術者',
  customer: 'お客様',
  unknown: '（周囲の会話・不明）',
}

/** Speaker-labeled text — ONE rendering used for both the prompts and the
 *  stored transcript, so what the AI read is exactly what staff can audit. */
export function toSpeakerText(d: DiarizedTranscript): string {
  return d.turns.map((t) => `${ROLE_LABEL[t.role]}: ${t.text}`).join('\n')
}
