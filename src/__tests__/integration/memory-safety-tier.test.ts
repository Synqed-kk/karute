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

  it('update/remove of a safety item needs the customer\'s explicit all-clear', () => {
    expect(SRC).toContain('明確な解消発言')
    expect(SRC).toContain('「肘はもう大丈夫です」')
    expect(SRC).toContain("customer's own explicit all-clear")
    expect(SRC).toContain('never because it went unmentioned')
  })
})
