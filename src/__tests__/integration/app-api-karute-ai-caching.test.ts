// PR-3 read-path caching (design §4): the effectiveSummary flip point + per-surface
// content-keyed cacheInputs. Each generator is driven with @/lib/ai-cache mocked to
// a canned HIT so it short-circuits BEFORE any OpenAI call; the test captures the
// cacheInput handed to getCachedAI and asserts JSON identity — the cache hashes
// JSON.stringify(input) (ai-cache.ts:13), so JSON equality IS the key identity.
// Order is significant by design (the key mirrors the prompt) — no order-insensitivity
// is claimed or tested.
import type { KaruteRecord } from '@synqed-kk/client'
import type { AiKaruteContextRow } from '@/lib/karute/ai-context'

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), unstable_cache: (fn: unknown) => fn }))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))
// The generators import @/lib/openai, which constructs an OpenAI client eagerly at
// import; stub it (the short-circuited paths never call it).
jest.mock('@/lib/openai', () => ({ openai: {} }))

// Canned cache HIT that satisfies every surface's early-return check (brief reads
// its AiBrief fields, prediction needs headline, outreach needs body, insights any).
const CANNED = {
  headline: 'h', confidence: 70, delta: null, recommended: 'w', recommendedSub: null, rationaleSummary: 'r',
  body: 'draft', insights: [{ type: 'GENERAL', title: 't', body: 'b', customerName: 'x', priority: 0.5 }],
  memoAnalysis: [], hooks: [], concerns: [], lastProduct: null, recommendedFocus: null,
  opener: null, lastWords: null, cautions: [], todayActions: [],
}
const cacheInputs: Array<{ prefix: string; input: unknown }> = []
const getCachedAIMock = jest.fn(async (prefix: string, input: unknown): Promise<unknown> => {
  cacheInputs.push({ prefix, input })
  return CANNED
})
const setCachedAIMock = jest.fn(async () => {})
jest.mock('@/lib/ai-cache', () => ({
  getCachedAI: (prefix: string, input: unknown) => getCachedAIMock(prefix, input),
  setCachedAI: () => setCachedAIMock(),
}))

jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => ({ business_type: 'seitai' })),
  orgSettingsWithClient: jest.fn(async () => ({ business_type: 'seitai' })),
}))
jest.mock('@/lib/karute/customer-memory', () => ({ getCustomerMemory: jest.fn(async () => []) }))
jest.mock('@/lib/karute/memory-ingest', () => ({ backfillMemoryFromTranscripts: jest.fn(async () => []) }))
jest.mock('@/lib/subscription/feature-gate', () => ({
  featureAllowed: jest.fn(async () => true),
  featureAllowedForBusiness: jest.fn(async () => true),
}))

// insights route deps
const recentRows = { current: [] as AiKaruteContextRow[] }
const getRecentKaruteForAIMock = jest.fn(async () => recentRows.current)
jest.mock('@/lib/karute/ai-context', () => ({ getRecentKaruteForAI: () => getRecentKaruteForAIMock() }))
jest.mock('@/lib/auth/store-scope', () => ({ resolveStoreScope: jest.fn(async () => ({ allowedStoreIds: null, storeId: null })) }))
jest.mock('@/lib/welcome/business-types', () => ({ getBusinessProfile: () => ({ label: 'Seitai' }) }))
jest.mock('@/lib/ai-rate-limit', () => ({ enforceAiRateLimit: jest.fn(async () => null), reportAiUsage: jest.fn() }))

import { effectiveSummary } from '@/lib/karute/effective-summary'
import { getAiPreSessionBrief } from '@/lib/karute/ai-brief'
import { getBodyPrediction } from '@/lib/karute/ai-body-prediction'
import { getSuggestedFollowUp } from '@/lib/karute/ai-outreach'
import { POST as insightsPOST } from '@/app/api/ai/insights/route'

type Entry = { category: string; content: string }
// Minimal record — generators read id, created_at, ai_summary, entries, transcript.
function rec(over: { id?: string; created_at?: string; ai_summary?: string | null; entries?: Entry[] } = {}): KaruteRecord {
  return {
    id: over.id ?? 'k1',
    created_at: over.created_at ?? '2026-06-01T00:00:00Z',
    ai_summary: over.ai_summary ?? 'S1',
    transcript: null,
    entries: over.entries ?? [{ category: 'SYMPTOM', content: 'lower back' }],
  } as unknown as KaruteRecord
}
const D1 = '2026-06-01T00:00:00Z'
const D2 = '2026-06-02T00:00:00Z'

function lastInput(prefix: string): string {
  const found = [...cacheInputs].reverse().find((c) => c.prefix === prefix)
  if (!found) throw new Error(`no cache lookup captured for ${prefix}`)
  return JSON.stringify(found.input)
}

async function captureBrief(records: KaruteRecord[], p: { customerName?: string; visitCount?: number } = {}) {
  cacheInputs.length = 0
  await getAiPreSessionBrief({
    customerId: 'c1', customerName: p.customerName ?? '田中', visitCount: p.visitCount ?? 3,
    records, reservationMemo: 'memo', locale: 'ja', now: new Date(D2),
  })
  return lastInput('presession_brief')
}
async function capturePrediction(records: KaruteRecord[]) {
  cacheInputs.length = 0
  await getBodyPrediction({ customerId: 'c1', records, locale: 'ja' })
  return lastInput('body_prediction')
}
async function captureOutreach(customerName: string, summary = 'S1') {
  cacheInputs.length = 0
  await getSuggestedFollowUp({ karuteId: 'k1', customerName, summary, locale: 'ja' })
  return lastInput('karute_followup')
}
function iRow(over: Partial<AiKaruteContextRow> = {}): AiKaruteContextRow {
  return { id: 'k1', customerName: '田中', createdAt: '2026-06-01', summary: 'S1', entries: [{ category: 'symptom', content: 'back' }], ...over }
}
async function captureInsights(rows: AiKaruteContextRow[]) {
  cacheInputs.length = 0
  recentRows.current = rows
  await insightsPOST(new Request('https://s/x', { method: 'POST', body: JSON.stringify({ locale: 'ja' }) }))
  return lastInput('insights')
}

beforeEach(() => {
  jest.clearAllMocks()
  cacheInputs.length = 0
  process.env.OPENAI_API_KEY = 'test-openai-key'
})

describe('effectiveSummary (Wave-2 flip point)', () => {
  it('returns ai_summary today', () => {
    expect(effectiveSummary({ ai_summary: '・肩こり改善傾向' })).toBe('・肩こり改善傾向')
  })
  it('null-safe: null/missing summary and null/undefined record → null', () => {
    expect(effectiveSummary({ ai_summary: null })).toBeNull()
    expect(effectiveSummary({})).toBeNull()
    expect(effectiveSummary(null)).toBeNull()
    expect(effectiveSummary(undefined)).toBeNull()
  })
})

describe('brief cacheInput — content-keyed', () => {
  it('identical records → identical cacheInput (no volatile fields)', async () => {
    const a = await captureBrief([rec()])
    const b = await captureBrief([rec()])
    expect(b).toBe(a)
  })
  it('changed entry content → different cacheInput', async () => {
    const a = await captureBrief([rec()])
    const b = await captureBrief([rec({ entries: [{ category: 'SYMPTOM', content: 'CHANGED' }] })])
    expect(b).not.toBe(a)
  })
  it('changed summary → different cacheInput', async () => {
    const a = await captureBrief([rec()])
    const b = await captureBrief([rec({ ai_summary: 'S2' })])
    expect(b).not.toBe(a)
  })
  it('customerName + visitCount participate in the key', async () => {
    const a = await captureBrief([rec()])
    const b = await captureBrief([rec()], { customerName: '佐藤' })
    const c = await captureBrief([rec()], { visitCount: 9 })
    expect(b).not.toBe(a)
    expect(c).not.toBe(a)
  })
})

describe('body-prediction cacheInput — summary-keyed, entries deliberately excluded', () => {
  const pair = (over?: { ai_summary?: string | null; entries?: Entry[] }) => [
    rec({ id: 'k2', created_at: D2, ...over }),
    rec({ id: 'k1', created_at: D1 }),
  ]
  it('changed summary → different cacheInput', async () => {
    const a = await capturePrediction(pair())
    const b = await capturePrediction(pair({ ai_summary: 'S2' }))
    expect(b).not.toBe(a)
  })
  it('entry-only change → IDENTICAL cacheInput (prompt never reads entries)', async () => {
    const a = await capturePrediction(pair({ entries: [{ category: 'SYMPTOM', content: 'x' }] }))
    const b = await capturePrediction(pair({ entries: [{ category: 'SYMPTOM', content: 'TOTALLY DIFFERENT' }] }))
    expect(b).toBe(a)
  })
})

describe('outreach cacheInput — summary + customerName keyed', () => {
  it('changed customerName → different cacheInput', async () => {
    const a = await captureOutreach('田中')
    const b = await captureOutreach('佐藤')
    expect(b).not.toBe(a)
  })
  it('changed summary → different cacheInput', async () => {
    const a = await captureOutreach('田中', 'S1')
    const b = await captureOutreach('田中', 'S2')
    expect(b).not.toBe(a)
  })
})

describe('insights cacheInput — content + business-type keyed', () => {
  it('changed summary → different cacheInput', async () => {
    const a = await captureInsights([iRow()])
    const b = await captureInsights([iRow({ summary: 'S2' })])
    expect(b).not.toBe(a)
  })
  it('changed entry → different cacheInput', async () => {
    const a = await captureInsights([iRow()])
    const b = await captureInsights([iRow({ entries: [{ category: 'symptom', content: 'CHANGED' }] })])
    expect(b).not.toBe(a)
  })
  it('business type participates in the key', async () => {
    await captureInsights([iRow()])
    expect(lastInput('insights')).toContain('seitai')
  })
})
