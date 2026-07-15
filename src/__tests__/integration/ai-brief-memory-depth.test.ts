/**
 * Brief memory consumption v12 (AI-quality lane, memory-durability audit
 * 2026-07-15). Three verified defects killed the "cat from 50 sessions ago"
 * requirement at scale:
 *  1. Memory reached the model newest-updated-first under a SILENT 8k default
 *     cap — the oldest never-revisited items were exactly what truncation ate.
 *  2. pinned was fetched but never rendered or ranked — staff pinning had
 *     zero effect on the brief.
 *  3. The cautions/GROUNDING rules never named memory as a source — a
 *     safety instruction living only in memory (「肘は避けて」) had no license
 *     into cautions.
 * Plus: the bootstrap trigger fired on memory.length===0, but the table also
 * holds passport rows — a passport-only customer never bootstrapped.
 *
 * Rule text pinned via module source (module-private template); the
 * formatMemory ordering is pinned via source too (private function — its
 * observable contract is the rendered order in the source-level sort).
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = readFileSync(join(process.cwd(), 'src/lib/karute/ai-brief.ts'), 'utf8')

describe('ai-brief memory block v12', () => {
  it('memory ordered pinned → safety categories → talking-point → rest', () => {
    // When the cap bites, rapport dies before safety (Greptile P1 on #509).
    expect(SRC).toContain(
      "m.pinned ? 0 : m.category === 'body' || m.category === 'preference' ? 1 : m.suggestTalkingPoint ? 2 : 3",
    )
    expect(SRC).toContain('.sort((a, b) => rank(a) - rank(b))')
  })

  it('pin state busts the brief cache (key carries pinned, not just ids)', () => {
    expect(SRC).toContain('mem: memory.map((m) => `${m.id}${m.pinned ? \'!\' : \'\'}`)')
  })

  it('pinned items are visible to the model and declared never-droppable', () => {
    expect(SRC).toContain("${m.pinned ? '/PINNED' : ''}")
    expect(SRC).toContain('never drop those from consideration')
  })

  it('memory block gets the explicit history cap, not the silent 8k default', () => {
    expect(SRC).toContain(
      "wrapUntrustedContent('customer_memory', formatMemory(memory), MAX_HISTORY_CHARS)",
    )
  })

  it('cautions + GROUNDING license durable memory as a source', () => {
    expect(SRC).toContain(
      'stated ANYWHERE in the memo, the karute, or the durable memory',
    )
    expect(SRC).toContain(
      'backed by the memo, the karute, or the durable memory block',
    )
  })

  it('bootstrap triggers on real memory categories, not passport rows', () => {
    expect(SRC).toContain('const hasRealMemory = memory.some')
    expect(SRC).toContain('MEMORY_CATEGORIES')
    expect(SRC).not.toContain('if (memory.length === 0 && records.some')
  })

  it('cache version bumped to 14', () => {
    expect(SRC).toContain('v: 14,')
  })

  // Field bug 2026-07-15: 「強めの圧が好み」 (a preference) rendered inside the
  // 注意（施術前に必ず） safety box next to real cautions — line 357 blanket-
  // licensed preference items into cautions and the taxonomy's 「強さの注意」
  // matched a LIKED intensity. Cautions are now restrictions-only.
  it('preference items are barred from the caution box', () => {
    expect(SRC).toContain('RESTRICTIONS ONLY')
    expect(SRC).toContain('a preference is never a caution')
    expect(SRC).toContain('「強めが好き」等の好みは注意ではない')
    expect(SRC).toContain('a liked/preferred intensity is a preference, never a caution')
    expect(SRC).not.toContain("'body'/'preference' items inform concerns AND cautions")
  })

  // Re-audit 2026-07-15 (fleet S15): passport rows reached the model as
  // [passport] lines with raw EN field keys and hijacked the pinned-first
  // ranking; they also sat in the cache key. Filtered AFTER the bootstrap so
  // the backfill's full-store return can't reintroduce them.
  it('passport rows are filtered out of the prompt memory and the cache key', () => {
    expect(SRC).toContain(
      "memory = memory.filter((m) => (m.category as string) !== PASSPORT_CATEGORY)",
    )
    const filterIdx = SRC.indexOf('!== PASSPORT_CATEGORY')
    const bootstrapIdx = SRC.indexOf('backfillMemoryFromTranscripts({')
    const cacheIdx = SRC.indexOf('const cacheInput = {')
    expect(bootstrapIdx).toBeGreaterThan(-1)
    expect(filterIdx).toBeGreaterThan(bootstrapIdx)
    expect(cacheIdx).toBeGreaterThan(filterIdx)
  })

  // Re-audit 2026-07-15 (fleet S06): the safety clip keeps the string HEAD,
  // and the history block is oldest→newest — an over-long history silently
  // lost its TAIL: the newest session, the only entries-bearing one and the
  // only place a RE-ENTRY-closing answer can live. Truncation now drops the
  // OLDEST whole sessions instead.
  it('karute history over the cap drops the oldest sessions, never the newest', () => {
    expect(SRC).toContain('while (blocks.length > 1 && out.length > MAX_HISTORY_CHARS)')
    expect(SRC).toContain('blocks.shift()')
  })
})
