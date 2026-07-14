/**
 * Pre-session brief RE-ENTRY rule v11 (AI-quality lane, data-chain ruling
 * 2026-07-15): open loops from the latest session's 次回 line — pending
 * medical results (an MRI), homework, promises — each surface as their own
 * todayActions item, medical results first. Previously only "the single most
 * important one" was guaranteed, so a session with an MRI mention AND homework
 * could silently drop one. The brief is the staff's action surface (they read
 * it on the record screen, not the old karute) — this is where the
 * 「MRIは行かれましたか？」 moment lives.
 *
 * The prompt is a module-private template — these tests pin the rule text via
 * the module source (read as a file), the same technique as checking a pinned
 * clause without exporting internals.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = readFileSync(
  join(process.cwd(), 'src/lib/karute/ai-brief.ts'),
  'utf8',
)

describe('ai-brief RE-ENTRY — every open loop surfaces, medical first', () => {
  it('the rule covers pending medical results, not just homework/promises', () => {
    expect(SRC).toContain('pending medical result')
    expect(SRC).toContain('MRIの結果を確認')
  })

  it('EACH open loop gets its own action (not just the single most important)', () => {
    expect(SRC).toContain('EACH genuine open loop surfaces as its own todayActions item')
    expect(SRC).not.toContain('the single most important one MUST surface')
  })

  it('medical results outrank homework in the ordering', () => {
    expect(SRC).toContain('a pending medical result outranks homework')
  })

  it('schema description stays aligned with the system prompt (drift guard)', () => {
    // The file's own IMPORTANT comment: .describe() ships to the model and
    // silently overrides the rules if it drifts. Both must carry the rule.
    expect(SRC).toContain(
      'FIRST actions = the re-entry items when the latest 次回 line carries open loops',
    )
  })

  it('cache version bumped so stale briefs regenerate under the new rule', () => {
    expect(SRC).toContain('v: 11,')
    expect(SRC).not.toContain('v: 10,')
  })
})
