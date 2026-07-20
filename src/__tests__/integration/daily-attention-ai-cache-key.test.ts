/**
 * getDailyAttentionLines cache-key tenancy (fleet fresh-round finding): the
 * ai_cache table is GLOBAL (ai-cache.ts's cacheClient() builds a
 * businessId:'' SynqedClient), so businessId must be part of the cache
 * INPUT the key is hashed from — otherwise two businesses with the same
 * store id (or no store id), date, and coincidentally-identical attention
 * card set would collide on one cached line. Pins businessId landing in the
 * getCachedAI/setCachedAI input directly (mutation-proven gap: reverting the
 * businessId thread previously passed this file's older 23/23 baseline).
 */
process.env.OPENAI_API_KEY = 'test-key'

jest.mock('@/lib/openai', () => ({ openai: {} }))

const getCachedAI = jest.fn(async (_prefix: string, _input: unknown) => null)
const setCachedAI = jest.fn(async (_prefix: string, _input: unknown, _result: unknown, _ttl?: number) => {})
jest.mock('@/lib/ai-cache', () => ({
  getCachedAI: (prefix: string, input: unknown) => getCachedAI(prefix, input),
  setCachedAI: (prefix: string, input: unknown, result: unknown, ttl?: number) =>
    setCachedAI(prefix, input, result, ttl),
}))

import { getDailyAttentionLines, type AttentionInputItem } from '@/lib/dashboard/daily-attention-ai'

const item: AttentionInputItem = {
  appointmentId: 'appt-1',
  clientId: 'c1',
  name: '田中',
  startIso: '2026-07-20T02:00:00.000Z',
  firstTime: false,
  remaining: null,
  size: null,
  hadPack: false,
  daysSinceLastVisit: null,
  memo: null,
  badge: 'memo',
  lastSummary: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  getCachedAI.mockResolvedValue(null)
})

describe('getDailyAttentionLines cache-key tenancy', () => {
  it('businessId lands in the cache input getCachedAI is keyed on', async () => {
    await getDailyAttentionLines({
      items: [item],
      businessType: null,
      businessId: 'biz-A',
      storeId: 'store-1',
      dateYmd: '2026-07-20',
      locale: 'ja',
    })
    expect(getCachedAI).toHaveBeenCalledWith(
      'daily_attention',
      expect.objectContaining({ businessId: 'biz-A' }),
    )
  })

  it('two businesses with identical store/date/items get DIFFERENT cache inputs', async () => {
    await getDailyAttentionLines({
      items: [item],
      businessType: null,
      businessId: 'biz-A',
      storeId: 'store-1',
      dateYmd: '2026-07-20',
      locale: 'ja',
    })
    const inputA = getCachedAI.mock.calls[0][1]

    await getDailyAttentionLines({
      items: [item],
      businessType: null,
      businessId: 'biz-B',
      storeId: 'store-1',
      dateYmd: '2026-07-20',
      locale: 'ja',
    })
    const inputB = getCachedAI.mock.calls[1][1]

    expect(JSON.stringify(inputA)).not.toEqual(JSON.stringify(inputB))
  })

  it('a missing businessId (null) NEVER touches the global cache — fallback lines instead (Greptile #571 P1)', async () => {
    const lines = await getDailyAttentionLines({
      items: [item],
      businessType: null,
      businessId: null,
      storeId: 'store-1',
      dateYmd: '2026-07-20',
      locale: 'ja',
    })
    expect(getCachedAI).not.toHaveBeenCalled()
    expect(setCachedAI).not.toHaveBeenCalled()
    // Deterministic fallback line, one per item — the degraded-auth path
    // serves template copy, never a shared-bucket cached AI line.
    expect(lines.size).toBe(1)
    expect(lines.get('c1')).toBeTruthy()
  })
})
