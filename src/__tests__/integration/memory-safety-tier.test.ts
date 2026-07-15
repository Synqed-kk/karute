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
    expect(SRC).toContain('医師にMRI検査を勧められており圧をかけない')
    expect(SRC).toContain('what-and-why in detail')
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
})
