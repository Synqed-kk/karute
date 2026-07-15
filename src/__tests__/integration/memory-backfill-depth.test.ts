/**
 * Backfill depth (AI-quality lane, memory-durability audit 2026-07-15).
 *
 * backfillMemoryFromTranscripts silently read only the first 5 transcripts —
 * 再学習 and the bootstrap could never see a fact mentioned once in session
 * 6+ of a long history (the "cat from 50 sessions ago" requirement). It also
 * hardcoded existing=[], so a relearn re-added facts that survived the wipe
 * as staff-owned/pinned rows. Now: chunks of 5 processed oldest→newest with
 * existing threaded forward, capped at 10 chunks (newest kept, drop logged).
 */
import type { MemoryItem } from '@/lib/karute/memory-types'

type ExtractParams = { transcripts: string[]; existing: MemoryItem[] }
const mockExtract = jest.fn(async (_params: ExtractParams) => [] as unknown[])
const mockApplyDelta = jest.fn(async (_delta: unknown) => {})
const mockGetMemory = jest.fn(async (_id: string) => [] as MemoryItem[])

jest.mock('@/lib/subscription/feature-gate', () => ({
  featureAllowed: jest.fn(async () => true),
}))
jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => ({ business_type: 'massage' })),
}))
jest.mock('@/lib/karute/memory-extract', () => ({
  extractCustomerMemory: (p: ExtractParams) => mockExtract(p),
}))
jest.mock('@/lib/karute/customer-memory', () => ({
  applyMemoryDelta: (d: unknown) => mockApplyDelta(d),
  getCustomerMemory: (id: string) => mockGetMemory(id),
}))

import { backfillMemoryFromTranscripts } from '@/lib/karute/memory-ingest'

// Newest-first, like both bootstrap callers pass them: t1 is the newest session.
const transcripts = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1} 会話`)

const staffItem = {
  id: 'm-staff',
  category: 'personal',
  label: '猫を飼っている',
  detail: null,
  source: 'staff',
  confidence: null,
  pinned: true,
  suggestTalkingPoint: false,
  updatedAt: '2026-07-01',
} as unknown as MemoryItem

beforeEach(() => {
  jest.clearAllMocks()
  mockGetMemory.mockResolvedValue([staffItem])
})

describe('backfillMemoryFromTranscripts — depth + dedupe seeding', () => {
  it('reads past 5 transcripts: 12 sessions → 3 chunked extract calls', async () => {
    await backfillMemoryFromTranscripts({
      customerId: 'c-1',
      transcripts: transcripts(12),
      locale: 'ja',
    })
    expect(mockExtract).toHaveBeenCalledTimes(3)
  })

  it('processes chunks oldest→newest (facts evolve forward)', async () => {
    await backfillMemoryFromTranscripts({
      customerId: 'c-1',
      transcripts: transcripts(12),
      locale: 'ja',
    })
    const batches = mockExtract.mock.calls.map((c) => c[0].transcripts)
    // Newest-first input t1..t12 → chunks [t1-5],[t6-10],[t11-12] → chunk
    // order reversed (oldest chunk first) AND each chunk reversed internally,
    // so the model reads strictly oldest→newest: t12 is the very first
    // transcript it sees, t1 (the newest) the very last. The joined blob
    // carries no dates — reading order is the only chronology signal.
    expect(batches[0]).toEqual(['t12 会話', 't11 会話'])
    expect(batches[2][0]).toBe('t5 会話')
    expect(batches[2][batches[2].length - 1]).toBe('t1 会話')
  })

  it('maxChunks caps the walk to the NEWEST sessions (page/brief latency bound)', async () => {
    await backfillMemoryFromTranscripts({
      customerId: 'c-1',
      transcripts: transcripts(23),
      locale: 'ja',
      maxChunks: 2,
    })
    // 23 sessions, cap 2 chunks → only the newest 10 (t1..t10) are read,
    // still oldest→newest: [t10..t6] then [t5..t1].
    expect(mockExtract).toHaveBeenCalledTimes(2)
    const batches = mockExtract.mock.calls.map((c) => c[0].transcripts)
    expect(batches[0][0]).toBe('t10 会話')
    expect(batches[1][batches[1].length - 1]).toBe('t1 会話')
    const allSent = batches.flat()
    expect(allSent).not.toContain('t11 会話')
  })

  it('seeds existing from the store — staff/pinned rows are visible for dedupe', async () => {
    await backfillMemoryFromTranscripts({
      customerId: 'c-1',
      transcripts: transcripts(3),
      locale: 'ja',
    })
    expect(mockExtract.mock.calls[0][0].existing).toEqual([staffItem])
  })

  it('over the 50-transcript cap: keeps the newest, logs the drop', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    await backfillMemoryFromTranscripts({
      customerId: 'c-1',
      transcripts: transcripts(60),
      locale: 'ja',
    })
    expect(mockExtract).toHaveBeenCalledTimes(10)
    const allSent = mockExtract.mock.calls.flatMap((c) => c[0].transcripts)
    // Newest 50 kept (t1..t50); the oldest 10 (t51..t60) dropped, loudly.
    expect(allSent).toContain('t1 会話')
    expect(allSent).toContain('t50 会話')
    expect(allSent).not.toContain('t51 会話')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropping 10'))
    warn.mockRestore()
  })

  it('skips the store write when a chunk yields no ops (no wasted round-trips)', async () => {
    mockExtract.mockResolvedValue([])
    await backfillMemoryFromTranscripts({
      customerId: 'c-1',
      transcripts: transcripts(7),
      locale: 'ja',
    })
    expect(mockApplyDelta).not.toHaveBeenCalled()
  })
})

// The two render-path callers must (a) sort newest-first before calling —
// core's list order is not guaranteed, and backfill's over-cap keep +
// oldest→newest walk both assume newest-first input — (b) bound the walk with
// maxChunks: 2 (the full depth belongs to the explicit 再学習 action), and
// (c) trigger on REAL memory categories only (passport rows must not suppress
// the bootstrap). Source-pinned like ai-brief-memory-depth.test.ts: both call
// sites are module-private render paths.
describe('backfill render-path callers (source contract)', () => {
  const { readFileSync } = jest.requireActual('fs') as typeof import('fs')
  const page = readFileSync('src/app/[locale]/(app)/customers/[id]/page.tsx', 'utf8')
  const brief = readFileSync('src/lib/karute/ai-brief.ts', 'utf8')

  it('customer page: sorts newest-first, real-category trigger, maxChunks 2', () => {
    expect(page).toContain("(b.created_at ?? '').localeCompare(a.created_at ?? '')")
    expect(page).toContain('(MEMORY_CATEGORIES as string[]).includes(m.category)')
    expect(page).toContain('maxChunks: 2')
  })

  it('brief: zero-yield attempt marker + maxChunks 2', () => {
    expect(brief).toContain("getCachedAI('memory-backfill', attemptKey)")
    expect(brief).toContain('maxChunks: 2')
  })
})
