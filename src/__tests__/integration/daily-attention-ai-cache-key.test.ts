/**
 * getDailyAttentionLines cache-key tenancy (fleet fresh-round finding): the
 * ai_cache table is GLOBAL (ai-cache.ts's cacheClient() builds a
 * businessId:'' SynqedClient), so businessId must be part of the cache
 * INPUT the key is hashed from — otherwise two businesses with the same
 * store id (or no store id), date, and coincidentally-identical attention
 * card set would collide on one cached line. Pins businessId landing in the
 * getCachedAI/setCachedAI input directly (mutation-proven gap: reverting the
 * businessId thread previously passed this file's older 23/23 baseline).
 *
 * Also pins (PR #571 post-merge ledger fast-follow): the degraded-auth
 * guard's "no AI call" half — a regression re-introducing the OpenAI call
 * for unknown tenants must fail here, not just "no cache write" — and the
 * real generate + cache-hit path (previously uncovered by any test).
 */
process.env.OPENAI_API_KEY = 'test-key'

jest.mock('@/lib/openai', () => ({
  openai: { chat: { completions: { parse: jest.fn() } } },
}))

const getCachedAI = jest.fn(async (_prefix: string, _input: unknown): Promise<unknown> => null)
const setCachedAI = jest.fn(async (_prefix: string, _input: unknown, _result: unknown, _ttl?: number) => {})
jest.mock('@/lib/ai-cache', () => ({
  getCachedAI: (prefix: string, input: unknown) => getCachedAI(prefix, input),
  setCachedAI: (prefix: string, input: unknown, result: unknown, ttl?: number) =>
    setCachedAI(prefix, input, result, ttl),
}))

import { getDailyAttentionLines, type AttentionInputItem } from '@/lib/dashboard/daily-attention-ai'
import { openai } from '@/lib/openai'

const parse = openai.chat.completions.parse as jest.Mock

// Deferred-call guard (fresh-round finding): a regression that schedules the
// AI call on a macrotask (setTimeout / after()-style fire-and-forget) would
// evade a same-tick not-called/count assertion — drain both macrotask phases
// before asserting. The setTimeout(0) leg is load-bearing: timers are FIFO,
// so it fires strictly after any attacker setTimeout(0) queued earlier
// (setImmediate alone can lose that race and let the stray call leak into
// the NEXT test instead of failing this one).
const flushDeferred = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setImmediate(resolve))
}

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

// NOTE: clearAllMocks() resets call history but NOT queued mockResolvedValueOnce
// values — each test must consume exactly the once-values it queues, or the
// leftover leaks into the next test.
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
    // Catches deferred (setTimeout/fire-and-forget) calls too, not just
    // same-tick ones.
    await flushDeferred()
    expect(getCachedAI).not.toHaveBeenCalled()
    expect(setCachedAI).not.toHaveBeenCalled()
    // The AI entrypoint itself must never fire for an unknown tenant — a
    // regression that re-introduces the OpenAI call here (independent of
    // whether it also happens to skip the cache) must fail this test.
    expect(parse).not.toHaveBeenCalled()
    // Deterministic fallback line, one per item — the degraded-auth path
    // serves template copy, never a shared-bucket cached AI line.
    expect(lines.size).toBe(1)
    expect(lines.get('c1')).toBeTruthy()
  })
})

describe('getDailyAttentionLines generate + cache-hit path', () => {
  it('cache miss: generates via OpenAI and writes the result to the cache under the businessId-keyed input', async () => {
    parse.mockResolvedValueOnce({
      choices: [{ message: { parsed: { lines: [{ customerId: 'c1', line: 'AI line' }] } } }],
    })

    const lines = await getDailyAttentionLines({
      items: [item],
      businessType: null,
      businessId: 'biz-A',
      storeId: 'store-1',
      dateYmd: '2026-07-20',
      locale: 'ja',
    })

    await flushDeferred()
    expect(parse).toHaveBeenCalledTimes(1)
    expect(lines.get('c1')).toBe('AI line')
    // EXACT cache-input shape, not objectContaining: dropping items/storeId
    // from the key (stale text served across different card sets) must fail
    // here, not just a missing businessId.
    expect(setCachedAI).toHaveBeenCalledWith(
      'daily_attention',
      {
        businessId: 'biz-A',
        storeId: 'store-1',
        dateYmd: '2026-07-20',
        items: [['c1', 'memo', null, null]],
      },
      { lines: [{ customerId: 'c1', line: 'AI line' }] },
      1,
    )
  })

  it('cache hit: returns the cached lines with NO second AI call', async () => {
    parse.mockResolvedValueOnce({
      choices: [{ message: { parsed: { lines: [{ customerId: 'c1', line: 'AI line' }] } } }],
    })
    const first = await getDailyAttentionLines({
      items: [item],
      businessType: null,
      businessId: 'biz-A',
      storeId: 'store-1',
      dateYmd: '2026-07-20',
      locale: 'ja',
    })
    expect(first.get('c1')).toBe('AI line')
    expect(parse).toHaveBeenCalledTimes(1)

    getCachedAI.mockResolvedValueOnce({ lines: [{ customerId: 'c1', line: 'Cached line' }] })
    const second = await getDailyAttentionLines({
      items: [item],
      businessType: null,
      businessId: 'biz-A',
      storeId: 'store-1',
      dateYmd: '2026-07-20',
      locale: 'ja',
    })

    expect(second.get('c1')).toBe('Cached line')
    // Drain deferred work: a background "cache refresh" scheduled on a
    // macrotask would evade a same-tick count assertion.
    await flushDeferred()
    // Still just the one call from the first (cache-miss) request above.
    expect(parse).toHaveBeenCalledTimes(1)
    // A hit must not WRITE the cache either (TTL-touch/refresh regressions);
    // the single recorded write is the first (miss) request's.
    expect(setCachedAI).toHaveBeenCalledTimes(1)
  })
})
