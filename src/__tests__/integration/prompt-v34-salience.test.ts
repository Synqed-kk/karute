/**
 * Prompt v3.4 (AI-quality lane, PLAN-2026-07-15 B2+B3) — four rules added to
 * the shared JA core after the 2026-07-14 field test scored the output
 * 60-65/100 ("すごく惜しい"):
 *   1. 主題の厚み — the most-discussed topic gets proportional depth and
 *      leads (right after safety); a passing remark never outweighs it.
 *   2. 出所の明示 — third-party facts (doctor, previous clinic) name their
 *      source in the title; never re-attributed to staff/customer judgment.
 *   3. 次回の確認事項 — facts that progress before the next visit (an MRI,
 *      homework self-care) always pair with a next_visit follow-up question.
 *   4. 文脈の意味 — lifestyle/preference lines keep the conversational
 *      meaning, not just the literal words.
 * All four live in the SHARED core: every business type receives them. The
 * v3.2 bodywork canon is untouched (prompt-debodywork.test.ts stays the
 * fidelity guard).
 */
import { getExtractionSystemPrompt, getSummarySystemPrompt } from '@/lib/prompts'
import { KARUTE_PROMPT_VERSION } from '@/lib/karute/prompt-fragments'

// One bodywork type + one non-bodywork type — the rules are shared-core, so
// both families must carry them.
const TYPES = ['massage', 'hair_salon'] as const

const EXTRACTION_CLAUSES = [
  '主題の厚み',
  '最も長く・繰り返し扱われた話題',
  '安全に関わる情報の直後に主題',
  '出所の明示',
  '医師にMRI検査を勧められた',
  '次回の確認事項',
  '次回確認：MRIは行かれたか',
  '文脈の意味',
  '夜の方が頭が冴えて仕事が捗る',
]

const SUMMARY_CLAUSES = [
  '主題の厚み',
  '本日の会話を最も長く占めた訴え',
  '出所の明示',
  '医師にMRI検査を勧められた',
  '次回の確認事項',
  'MRIの結果を確認',
  '文脈の意味',
]

describe('prompt v3.4 — salience, source attribution, follow-up pairing', () => {
  it('extraction prompt carries all four v3.4 rules (both families)', () => {
    for (const t of TYPES) {
      const p = getExtractionSystemPrompt('ja', t)
      for (const clause of EXTRACTION_CLAUSES) {
        expect(`${t}: ${p}`).toContain(clause)
      }
    }
  })

  it('summary prompt carries all four v3.4 rules (both families)', () => {
    for (const t of TYPES) {
      const p = getSummarySystemPrompt('ja', t)
      for (const clause of SUMMARY_CLAUSES) {
        expect(`${t}: ${p}`).toContain(clause)
      }
    }
  })

  it('follow-up questions stay grounded: the rule pins them to spoken facts', () => {
    const p = getExtractionSystemPrompt('ja', 'massage')
    expect(p).toContain('問いは実際に会話に出た事実にのみ基づく')
  })

  it('meaning-not-literal never licenses invention', () => {
    for (const t of TYPES) {
      expect(getExtractionSystemPrompt('ja', t)).toContain('推測で意味を作らない')
      expect(getSummarySystemPrompt('ja', t)).toContain('推測で意味を作らない')
    }
  })

  it('version bumped so cached AI outputs regenerate under v3.4', () => {
    expect(KARUTE_PROMPT_VERSION).toBe('v3.4-2026-07-15')
  })
})
