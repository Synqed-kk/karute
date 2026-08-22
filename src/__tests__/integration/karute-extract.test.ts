import type { Entry } from '@/types/ai'

// Mock the OpenAI boundary only — runKaruteExtraction is a direct function
// call (no route/auth/rate-limit boundaries to stub), following the repo's
// established per-dependency mock idiom (see api-extract.test.ts).
jest.mock('@/lib/openai', () => ({
  openai: {
    chat: { completions: { parse: jest.fn() } },
  },
}))

import { openai } from '@/lib/openai'
import { runKaruteExtraction, sanitizeExtractionEntries, MAX_ENTRIES_PER_CATEGORY } from '@/lib/ai/karute-extract'

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    category: 'lifestyle',
    title: 'Default title',
    source_quote: 'default quote',
    confidence_score: 0.8,
    ...overrides,
  }
}

/** Drives the seam through runKaruteExtraction (not the pure helper directly)
 *  so the test proves the wiring, not just the transform in isolation. */
async function extractWith(entries: Entry[], usage?: { prompt_tokens: number; completion_tokens: number }) {
  ;(openai.chat.completions.parse as jest.Mock).mockResolvedValue({
    choices: [{ message: { parsed: { entries } } }],
    usage: usage ?? { prompt_tokens: 100, completion_tokens: 50 },
  })

  return runKaruteExtraction({
    transcript: 'irrelevant transcript text',
    locale: 'en',
    customerName: null,
    sessionDate: null,
    businessType: null,
  })
}

describe('sanitizeExtractionEntries (via runKaruteExtraction seam)', () => {
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('1. leaves a normal result unchanged (distinct titles across categories), order preserved, usage passthrough intact', async () => {
    const entries = [
      entry({ category: 'symptom', title: 'Sensitive scalp' }),
      entry({ category: 'preference', title: 'Natural brown color' }),
      entry({ category: 'next_visit', title: 'Book in 6 weeks' }),
    ]

    const { result, usage } = await extractWith(entries, { prompt_tokens: 123, completion_tokens: 45 })

    expect(result.entries).toEqual(entries)
    expect(usage).toEqual({ tokensIn: 123, tokensOut: 45 })
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('2. collapses 39 identical (same category, same title) entries to 1', async () => {
    const entries = Array.from({ length: 39 }, () =>
      entry({ category: 'lifestyle', title: '散歩' })
    )

    const { result } = await extractWith(entries)

    expect(result.entries).toHaveLength(1)
  })

  it('3. dedupes whitespace/case title variants (same source_quote) in the same category, keeping the first', async () => {
    const first = entry({ category: 'lifestyle', title: '散歩 ', source_quote: 'same quote' })
    const entries = [first, entry({ category: 'lifestyle', title: '散歩', source_quote: 'same quote' })]

    const { result } = await extractWith(entries)

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toBe(first)
  })

  it('4. does NOT cross-dedupe the same title across different categories', async () => {
    const entries = [
      entry({ category: 'lifestyle', title: '散歩' }),
      entry({ category: 'preference', title: '散歩' }),
    ]

    const { result } = await extractWith(entries)

    expect(result.entries).toHaveLength(2)
  })

  it('4b. (⚖ versatility pin) same category + same title + DIFFERENT source_quote: BOTH survive', async () => {
    const entries = [
      entry({ category: 'lifestyle', title: '散歩', source_quote: 'quote one' }),
      entry({ category: 'lifestyle', title: '散歩', source_quote: 'quote two' }),
    ]

    const { result } = await extractWith(entries)

    expect(result.entries).toHaveLength(2)
  })

  it('5. caps a category at 30 (first 30 survive) while leaving another category untouched', async () => {
    const capped = Array.from({ length: 35 }, (_, i) =>
      entry({ category: 'lifestyle', title: `topic ${i}`, source_quote: `quote ${i}` })
    )
    const other = [entry({ category: 'preference', title: 'unrelated' })]
    const entries = [...capped, ...other]

    const { result } = await extractWith(entries)

    const lifestyleEntries = result.entries.filter((e) => e.category === 'lifestyle')
    expect(lifestyleEntries).toHaveLength(MAX_ENTRIES_PER_CATEGORY)
    expect(lifestyleEntries.map((e) => e.title)).toEqual(capped.slice(0, 30).map((e) => e.title))
    expect(result.entries).toContainEqual(other[0])
  })

  it('6. console.warn fires with before/after counts (no title text) when trimming happened, and does not fire on a clean result', async () => {
    const entries = Array.from({ length: 39 }, () =>
      entry({ category: 'lifestyle', title: '散歩' })
    )

    await extractWith(entries)

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const [message, payload] = warnSpy.mock.calls[0]
    expect(message).toBe('[karute-extract] safety net trimmed entries')
    expect(payload).toEqual({ before: 39, after: 1 })
    expect(JSON.stringify(payload)).not.toContain('散歩')

    warnSpy.mockClear()

    await extractWith([entry({ category: 'symptom', title: 'a' }), entry({ category: 'preference', title: 'b' })])

    expect(warnSpy).not.toHaveBeenCalled()
  })
})

describe('sanitizeExtractionEntries (pure)', () => {
  it('is a no-op on an empty array', () => {
    expect(sanitizeExtractionEntries([])).toEqual([])
  })
})
