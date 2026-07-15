/**
 * Memory safety tier (AI-quality lane, memory-durability audit 2026-07-15).
 *
 * Safety-relevant memory (「肘は避けて」, allergies, pregnancy, areas pending
 * tests) previously got the same generic treatment as a casual cat mention —
 * same capture priority, same update/remove looseness. Rule 5b makes them the
 * highest-priority capture, requires the what-and-why in detail, and locks
 * update/remove behind the customer's own explicit all-clear.
 *
 * The prompt is module-private; pinned via source text (same technique as
 * ai-brief-open-loops.test.ts).
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = readFileSync(
  join(process.cwd(), 'src/lib/karute/memory-extract.ts'),
  'utf8',
)

describe('memory-extract rule 5b — safety tier (JA + EN)', () => {
  it('safety facts are the highest-priority capture', () => {
    expect(SRC).toContain('安全第一')
    expect(SRC).toContain('最優先で記録する')
    expect(SRC).toContain('SAFETY FIRST')
    expect(SRC).toContain('HIGHEST-priority capture')
  })

  it('avoidance instructions carry the what-and-why in detail', () => {
    expect(SRC).toContain('「何を・なぜ避けるか」まで必ず含める')
    expect(SRC).toContain('本人の希望で肘への施術を回避')
    expect(SRC).toContain('what-and-why in detail')
  })

  // Field bug 2026-07-15 (2 customers): permanent hardware (手首のプレート) and
  // a doctor-recommended MRI never became memory items — the DURABLE-FACTS-ONLY
  // preamble ("today's details live on the karute") filtered them out before
  // rule 5b was ever consulted. The preamble now carves out 5b safety facts.
  it("safety facts are exempt from the today's-detail exclusion", () => {
    expect(SRC).toContain('ただし5bの安全事実')
    expect(SRC).toContain('今日の話題として語られた場合でも「今日の細部」ではなく')
    expect(SRC).toContain('体内金属')
    expect(SRC).toContain("NEVER excluded as \"today's detail\"")
    expect(SRC).toContain('implanted metal')
  })

  // Field bug 2026-07-15: the old 5b example itself taught pain+pending-exam →
  // 「施術回避」. The label must mirror the strength of what was spoken.
  it('avoid/forbid labels require a spoken instruction', () => {
    expect(SRC).toContain('label は発言の強さを鏡写しにする')
    expect(SRC).toContain('「回避」「禁止」とは書かず')
    expect(SRC).toContain('肘痛：MRI検査予定')
    expect(SRC).toContain('The label mirrors the strength of what was SPOKEN')
    expect(SRC).toContain('never write "avoid"/"forbidden"')
  })

  // Field bug 2026-07-15: relearn re-added a pinned survivor as
  // 「ゴルフ肘：施術回避」 next to pinned 「ゴルフ肘」 — the model never saw the
  // pinned flag and rule 4 had no same-fact-different-label clause.
  it('pinned items are visible to the model and locked; reworded duplicates banned', () => {
    expect(SRC).toContain('pinned: m.pinned')
    expect(SRC).toContain('pinned=true の項目はスタッフが固定した事実')
    expect(SRC).toContain('同じ部位・同じ事象なら同一の事実')
    expect(SRC).toContain('ANY pinned item are human-locked')
    expect(SRC).toContain('STILL a duplicate')
  })

  // Field bug 2026-07-15: a clearly spoken pressure preference yielded zero
  // preference items across 18 sessions — single clear statements now qualify.
  it('standing preferences are recordable from one clear statement', () => {
    expect(SRC).toContain('一度明確に言われたら記録する')
    expect(SRC).toContain('record once clearly stated')
  })

  it('a safety item without detail is banned (bare label loses the why)', () => {
    expect(SRC).toContain('detail の無い安全項目は出力しない')
    expect(SRC).toContain('Never emit a safety item with a null detail')
  })

  it('update/remove of a safety item needs the customer\'s explicit all-clear', () => {
    expect(SRC).toContain('明確な解消発言')
    expect(SRC).toContain('「肘はもう大丈夫です」')
    expect(SRC).toContain("customer's own explicit all-clear")
    expect(SRC).toContain('never because it went unmentioned')
  })

  // Re-audit 2026-07-15: the mandatory what-and-why read as "no why spoken →
  // don't emit", which inverts 5b into dropping exactly the safety facts it
  // exists to capture (customers often give instructions with no reason).
  // The why is mandatory WHEN SPOKEN; unspoken → 理由は未言及, item recorded.
  it('a why-less safety instruction is still recorded, reason marked unstated', () => {
    expect(SRC).toContain('「理由は未言及」と書いて、項目自体は必ず記録する')
    expect(SRC).toContain('安全項目を落とすことは理由の欠落より有害')
    expect(SRC).toContain('write the what plus "reason not stated" in detail and STILL record the item')
  })

  // Greptile on #513: principle 3 ("when unsure, emit nothing") overrides all
  // rules — a literal model could read a missing reason as "unsure" and drop
  // the safety item 5b just ordered it to keep. Principle 3 now scopes its
  // doubt (whose fact / was it said) and names the 5b carve-out explicitly.
  it('principle 3 doubt is scoped so a missing reason cannot drop a safety item', () => {
    expect(SRC).toContain('誰の事実か・本当に発言があったか迷ったら出力しない')
    expect(SRC).toContain('「迷い」ではない — 5b の通り「理由は未言及」で必ず記録する')
    expect(SRC).toContain('A safety instruction missing only its reason is NOT doubt: record it per 5b')
  })
})

// Re-audit 2026-07-15 (fleet S11/S20): the 0.70 confidence floor gated ONLY
// action='add' at both layers — a hesitant misread of an all-clear could
// soft-delete a safety item with no gate at all. Now every op is gated, in
// the extractor filter AND the store (belt and braces, matching the add gate).
describe('memory delta confidence floor — every op, both layers', () => {
  const EXTRACT = SRC
  const STORE = readFileSync(
    join(process.cwd(), 'src/lib/karute/customer-memory.ts'),
    'utf8',
  )

  it('extractor filter gates update/remove too', () => {
    expect(EXTRACT).toContain(
      'return ops.filter((op) => op.confidence != null && op.confidence >= 0.7)',
    )
    expect(EXTRACT).not.toContain("op.action !== 'add' ||")
  })

  it('store apply layer gates every op', () => {
    expect(STORE).toContain('if (op.confidence == null || op.confidence < 0.7)')
    expect(STORE).not.toContain(
      "op.action === 'add' && (op.confidence == null || op.confidence < 0.7)",
    )
  })

  // Field bug 2026-07-15: the store now backstops reworded duplicate adds
  // (same category + same label stem before 「：」) — prompt rule 4 teaches it,
  // this holds when the model doesn't listen.
  it('store apply layer skips duplicate adds by category + label stem', () => {
    expect(STORE).toContain("label.split(/[：:]/)[0].trim().toLowerCase()")
    expect(STORE).toContain('duplicate add skipped')
    expect(STORE).toContain("ops.some((o) => o.action === 'add')")
  })

  // Adversarial review on the guard itself: a stem collision with a PINNED or
  // staff row must NOT suppress the add — those rows are frozen to the AI
  // (update impossible), so suppression would strand a genuinely new fact
  // about the same body part with no path into memory. The guard's collision
  // set is scoped to rows the AI could have updated instead.
  it('the add-guard never suppresses against pinned/staff rows', () => {
    const guardBlock = STORE.slice(
      STORE.indexOf('ops.some((o) => o.action ==='),
      STORE.indexOf('for (const op of ops)'),
    )
    expect(guardBlock).toContain(".eq('source', 'ai_extraction')")
    expect(guardBlock).toContain(".eq('pinned', false)")
    expect(SRC).toContain('「新しい別の事実」')
    expect(SRC).toContain('is NOT a duplicate — always add it')
  })
})
