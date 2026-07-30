/**
 * `cacheOnly` — the WEB opt-in that takes the 要注目 model call OUT of the
 * dashboard render path (2026-07-30 speed pass: OpenAI runs inside the server
 * render, so the first dashboard view of the day per store blocks on it).
 *
 * Three things must hold, and the third is the phone-safety one:
 *
 *  1. cacheOnly + cache MISS → deterministic lines returned NOW, model call
 *     handed to after() (runs once the response is already sent) and the cache
 *     is filled by it, so the next load is warm.
 *  2. cacheOnly + cache HIT → completely unchanged: cached lines, no after(),
 *     no model call.
 *  3. DEFAULT (no cacheOnly — the FACADE screen route) + MISS → still
 *     generates INLINE. The native shell asks once and paints what it gets;
 *     it has no second render to pick up a late fill, so it must never be
 *     silently switched onto the deferred path.
 */
process.env.OPENAI_API_KEY = 'test-key'

jest.mock('@/lib/openai', () => ({
  openai: { chat: { completions: { parse: jest.fn(), create: jest.fn() } } },
}))

const getCachedAI = jest.fn(async (_p: string, _i: unknown): Promise<unknown> => null)
const setCachedAI = jest.fn(async (_p: string, _i: unknown, _r: unknown, _t?: number) => {})
jest.mock('@/lib/ai-cache', () => ({
  getCachedAI: (p: string, i: unknown) => getCachedAI(p, i),
  setCachedAI: (p: string, i: unknown, r: unknown, t?: number) => setCachedAI(p, i, r, t),
}))

// after() is captured rather than executed, so a test can assert BOTH that the
// work was deferred and that the deferred work actually fills the cache.
const scheduled: Array<() => unknown> = []
const afterSpy = jest.fn((cb: () => unknown) => {
  scheduled.push(cb)
})
jest.mock('next/server', () => ({
  ...jest.requireActual('next/server'),
  after: (cb: () => unknown) => afterSpy(cb),
}))

import { getDailyAttentionLines, type AttentionInputItem } from '@/lib/dashboard/daily-attention-ai'
import { fallbackLine } from '@/lib/dashboard/attention'
import { openai } from '@/lib/openai'

const parse = openai.chat.completions.parse as jest.Mock

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

const base = {
  items: [item],
  businessType: 'salon',
  businessId: 'biz-1',
  storeId: 'store-1',
  dateYmd: '2026-07-30',
  locale: 'ja',
}

const AI_LINE = { lines: [{ customerId: 'c1', line: '今日は肩まわりを確認' }] }

beforeEach(() => {
  jest.clearAllMocks()
  scheduled.length = 0
  getCachedAI.mockResolvedValue(null)
})

describe('getDailyAttentionLines — cacheOnly (web render path)', () => {
  it('MISS: returns deterministic lines immediately and defers the model call', async () => {
    parse.mockResolvedValue({ choices: [{ message: { parsed: AI_LINE } }] })

    const lines = await getDailyAttentionLines({ ...base, cacheOnly: true })

    // The render got the fallback, not a model round trip.
    expect(lines.get('c1')).toBe(fallbackLine(item))
    expect(parse).not.toHaveBeenCalled()
    expect(setCachedAI).not.toHaveBeenCalled()
    // ...but the fill WAS scheduled for after the response.
    expect(afterSpy).toHaveBeenCalledTimes(1)

    // And the deferred work is real: running it generates + warms the cache.
    await scheduled[0]!()
    expect(parse).toHaveBeenCalledTimes(1)
    expect(setCachedAI).toHaveBeenCalledTimes(1)
  })

  it('MISS burst: a cold cache schedules ONE fill, not one per request', async () => {
    // The morning case: several staff open the dashboard within seconds of
    // each other while ai_cache is still empty for the day.
    parse.mockResolvedValue({ choices: [{ message: { parsed: AI_LINE } }] })

    await getDailyAttentionLines({ ...base, cacheOnly: true })
    await getDailyAttentionLines({ ...base, cacheOnly: true })
    await getDailyAttentionLines({ ...base, cacheOnly: true })

    expect(afterSpy).toHaveBeenCalledTimes(1)

    // ...and once that fill settles, a later miss may schedule again.
    await scheduled[0]!()
    await getDailyAttentionLines({ ...base, cacheOnly: true })
    expect(afterSpy).toHaveBeenCalledTimes(2)

    // Settle the second one too: the in-flight registry is module state, so a
    // fill left pending here would suppress the NEXT test's scheduling.
    await scheduled[1]!()
  })

  it('a failed deferred fill is reported, never swallowed silently', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    parse.mockRejectedValue(new Error('openai down'))

    await getDailyAttentionLines({ ...base, cacheOnly: true })
    await expect(scheduled[0]!()).resolves.not.toThrow()

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('ai_cache stays cold'),
      expect.any(Error),
    )
    warn.mockRestore()
  })

  it('HIT: unchanged — cached lines, nothing deferred, no model call', async () => {
    getCachedAI.mockResolvedValue(AI_LINE)

    const lines = await getDailyAttentionLines({ ...base, cacheOnly: true })

    expect(lines.get('c1')).toBe('今日は肩まわりを確認')
    expect(afterSpy).not.toHaveBeenCalled()
    expect(parse).not.toHaveBeenCalled()
  })
})

describe('getDailyAttentionLines — default path (facade screen route)', () => {
  it('MISS: still generates INLINE — the shell has no second render', async () => {
    parse.mockResolvedValue({ choices: [{ message: { parsed: AI_LINE } }] })

    const lines = await getDailyAttentionLines(base)

    expect(lines.get('c1')).toBe('今日は肩まわりを確認')
    expect(parse).toHaveBeenCalledTimes(1)
    expect(setCachedAI).toHaveBeenCalledTimes(1)
    expect(afterSpy).not.toHaveBeenCalled()
  })
})
