/**
 * Stage 0 diarization brain (src/lib/diarized.ts) — role-attribution rules
 * locked. Pure function, no mocks. The マッキー scenario (bystander speech
 * summarized into a customer's record, docs/prompt-defect-log.md entry 2)
 * is the failure mode these rules exist to kill.
 */
import { buildDiarizedTranscript, toSpeakerText } from '@/lib/diarized'

const para = (speaker: number, text: string, start: number, end: number) => ({
  speaker, text, start, end,
})

// Typical session: staff opens (speaker 0), customer answers (speaker 1),
// a neighboring conversation bleeds in (speaker 2).
const SESSION = [
  para(0, 'こんにちは、今日はどうされましたか', 0, 3),
  para(1, '腰が痛くて、デスクワークが多すぎて', 3, 8),
  para(0, 'なるほど、ではうつ伏せでお願いします', 8, 12),
  para(2, 'マッキーは筋肉痛の中施術するのが、まじで相性悪かったですね', 12, 18),
  para(1, '最近パグ飼い始めたんですよね', 18, 22),
]

describe('buildDiarizedTranscript — role attribution', () => {
  it('H1: first speaker = staff; most-adjacent other = customer; rest = bystander', () => {
    const d = buildDiarizedTranscript(SESSION, [], 0.9)!
    expect(d.turns.map((t) => t.role)).toEqual([
      'staff', 'customer', 'staff', 'unknown', 'customer',
    ])
    expect(d.speakerCount).toBe(3)
  })
  it('single speaker → null (flat transcript is strictly clearer)', () => {
    expect(buildDiarizedTranscript([para(0, 'メモ', 0, 2)], [], 0.9)).toBeNull()
  })
  it('empty / low overall confidence → null (graceful degradation)', () => {
    expect(buildDiarizedTranscript([], [], 0.9)).toBeNull()
    expect(buildDiarizedTranscript(SESSION, [], 0.4)).toBeNull()
  })
  it('low word-confidence segment → unknown, never a guessed role', () => {
    const words = [
      { word: 'x', start: 3.5, end: 4, confidence: 0.2 },
      { word: 'y', start: 4, end: 5, confidence: 0.3 },
    ]
    const d = buildDiarizedTranscript(SESSION, words, 0.9)!
    expect(d.turns[1].role).toBe('unknown') // the customer line dropped to 要確認
    expect(d.turns[4].role).toBe('customer') // untouched lines keep their role
  })
  it('missing word data defaults confidence to 1 (no silent mass-要確認)', () => {
    const d = buildDiarizedTranscript(SESSION, [], 0.9)!
    expect(d.turns.filter((t) => t.role === 'unknown')).toHaveLength(1)
  })
})

describe('toSpeakerText — the ONE rendering for prompts AND storage', () => {
  it('labels each turn 施術者/お客様/（周囲の会話・不明）', () => {
    const text = toSpeakerText(buildDiarizedTranscript(SESSION, [], 0.9)!)
    expect(text.split('\n')[0]).toBe('施術者: こんにちは、今日はどうされましたか')
    expect(text).toContain('お客様: 腰が痛くて、デスクワークが多すぎて')
    expect(text).toContain('（周囲の会話・不明）: マッキーは筋肉痛の中施術するのが、まじで相性悪かったですね')
  })
})

describe('repairAndCoalesce — fragment merging + orphan punctuation (AI-quality lane A1)', () => {
  // Real production failure (Liam's 7/14 代官山 session): diarization flips
  // mid-sentence, so the rendered transcript reads 「お客様: …です 施術者: 。
  // でも…」 — labels every few words, punctuation stranded on the wrong voice.
  it('merges consecutive same-role turns into one', () => {
    const d = buildDiarizedTranscript(
      [
        para(0, 'こんにちは', 0, 2),
        para(0, '今日はどうされましたか', 2, 5),
        para(1, '腰が痛くて', 5, 8),
      ],
      [],
      0.9,
    )!
    expect(d.turns.map((t) => t.text)).toEqual([
      'こんにちは 今日はどうされましたか',
      '腰が痛くて',
    ])
    expect(d.turns[0].start).toBe(0)
    expect(d.turns[0].end).toBe(5)
  })

  it('moves leading punctuation back to the previous turn', () => {
    const d = buildDiarizedTranscript(
      [
        para(0, '聞こえてますか', 0, 2),
        para(1, '。はい、大丈夫です', 2, 5),
      ],
      [],
      0.9,
    )!
    expect(toSpeakerText(d)).toBe(
      '施術者: 聞こえてますか。\nお客様: はい、大丈夫です',
    )
  })

  it('drops a punctuation-only fragment and merges the turns around it', () => {
    const d = buildDiarizedTranscript(
      [
        para(0, 'なるほど', 0, 2),
        para(1, '。', 2, 3),
        para(0, 'では始めますね', 3, 6),
        para(1, 'お願いします', 6, 8),
      ],
      [],
      0.9,
    )!
    expect(toSpeakerText(d)).toBe(
      '施術者: なるほど。 では始めますね\nお客様: お願いします',
    )
  })

  it('never merges across different roles', () => {
    const d = buildDiarizedTranscript(
      [
        para(0, 'こんにちは', 0, 2),
        para(1, 'どうも', 2, 4),
        para(0, '今日は', 4, 6),
      ],
      [],
      0.9,
    )!
    expect(d.turns).toHaveLength(3)
  })
})

describe('staffHint — voiceprint proof beats the first-speaker heuristic', () => {
  // Session where the CUSTOMER speaks first (the heuristic's failure case).
  const CUSTOMER_FIRST = [
    para(1, 'すみません、ちょっと早く着いちゃって', 0, 3),
    para(0, 'こんにちは、今日はどうされましたか', 3, 6),
    para(1, '腰が痛くて', 6, 9),
  ]
  it('confident hint overrides: enrolled voice becomes 施術者 even when not first', () => {
    const d = buildDiarizedTranscript(CUSTOMER_FIRST, [], 0.9, { speaker: 0, confidence: 0.95 })!
    expect(d.turns.map((t) => t.role)).toEqual(['customer', 'staff', 'customer'])
  })
  it('weak hint (<0.7) changes nothing — upgrade-only', () => {
    const d = buildDiarizedTranscript(CUSTOMER_FIRST, [], 0.9, { speaker: 0, confidence: 0.5 })!
    expect(d.turns[0].role).toBe('staff') // heuristic: first speaker
  })
  it('hint pointing at a speaker not in the recording → heuristic', () => {
    const d = buildDiarizedTranscript(CUSTOMER_FIRST, [], 0.9, { speaker: 7, confidence: 0.99 })!
    expect(d.turns[0].role).toBe('staff')
  })
})
