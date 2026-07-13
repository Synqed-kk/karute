/**
 * v2 AI相談 slice (PKT-101): today-signals engine + targeted context hint.
 *
 *   - getTodaySignals resolves store scope INTERNALLY and reads today's roster
 *     through it — a clamped staff's chips only ever see their store; [] on error.
 *   - the chat route's optional context_hint pins the karute slice to one
 *     customer or today's roster; absent → the generic recent slice, unchanged.
 *
 * Mocks sit at the data-fetch boundary (same idiom as ai-store-scope.test.ts) so
 * the ranking / hint-routing logic is what's actually exercised.
 */

jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(),
}))
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}))
jest.mock('@/lib/ai-rate-limit', () => ({
  enforceAiRateLimit: jest.fn(async () => null),
  reportAiUsage: jest.fn(),
}))
jest.mock('@/lib/karute/ai-context', () => ({
  getRecentKaruteForAI: jest.fn(async () => []),
  getCustomerKaruteForAI: jest.fn(async () => ({ customerName: null, rows: [] })),
  getTodayRosterKaruteForAI: jest.fn(async () => ({ rosterSize: 0, rows: [] })),
  getTodaysAppointments: jest.fn(async () => []),
  formatKaruteContext: jest.fn(() => 'ctx'),
}))
jest.mock('@/lib/prompts', () => ({
  getChatSystemPrompt: jest.fn(() => 'system'),
}))
jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => ({ business_type: 'beauty_chiropractic' })),
}))
jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerList: jest.fn(async () => []),
}))
jest.mock('@/lib/packs/store', () => ({
  listAllPackUsage: jest.fn(async () => new Map()),
}))
jest.mock('@/lib/openai', () => ({
  openai: {
    chat: {
      completions: {
        create: jest.fn(async () => ({
          choices: [{ message: { content: 'ok' } }],
          usage: null,
        })),
      },
    },
  },
}))
jest.mock('@/lib/synqed/client', () => {
  const customers = {
    list: jest.fn(async () => ({ customers: [] })),
    enrichment: jest.fn(async () => []),
  }
  const client = { customers }
  return { getSynqedClient: jest.fn(async () => client) }
})

import { POST } from '@/app/api/ai/chat/route'
import { getTodaySignals } from '@/lib/karute/ai-signals'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { createClient } from '@/lib/supabase/server'
import {
  getRecentKaruteForAI,
  getCustomerKaruteForAI,
  getTodayRosterKaruteForAI,
  getTodaysAppointments,
} from '@/lib/karute/ai-context'
import { getChatSystemPrompt } from '@/lib/prompts'
import { getSynqedClient } from '@/lib/synqed/client'
import { getCachedCustomerList } from '@/lib/customers/cached'
import { listAllPackUsage } from '@/lib/packs/store'

const scopeMock = resolveStoreScope as jest.Mock
const createClientMock = createClient as jest.Mock
const recentMock = getRecentKaruteForAI as jest.Mock
const customerKaruteMock = getCustomerKaruteForAI as jest.Mock
const rosterKaruteMock = getTodayRosterKaruteForAI as jest.Mock
const apptsMock = getTodaysAppointments as jest.Mock
const promptMock = getChatSystemPrompt as jest.Mock
const cachedMock = getCachedCustomerList as jest.Mock
const usageMock = listAllPackUsage as jest.Mock

const GINZA = 'store-ginza'

function signedIn() {
  createClientMock.mockResolvedValue({
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'u-1' } } })) },
  })
}
function clampedToGinza() {
  scopeMock.mockResolvedValue({ storeId: GINZA, viewAll: false, allowedStoreIds: [GINZA] })
}
function viewAll() {
  scopeMock.mockResolvedValue({ storeId: null, viewAll: true, allowedStoreIds: null })
}

function req(body: Record<string, unknown>) {
  return new Request('http://localhost/api/ai/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'x', locale: 'ja', ...body }),
  })
}

async function enrichmentMock() {
  const client = await (getSynqedClient as jest.Mock)()
  return client.customers.enrichment as jest.Mock
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('chat route — context hint', () => {
  it('absent hint: generic slice, no context_label (unchanged)', async () => {
    signedIn()
    viewAll()
    const res = await POST(req({}))
    expect(res.status).toBe(200)
    expect(recentMock).toHaveBeenCalledWith(5, undefined)
    expect(customerKaruteMock).not.toHaveBeenCalled()
    expect(rosterKaruteMock).not.toHaveBeenCalled()
    expect(promptMock.mock.calls[0][0].contextLabel).toBeUndefined()
    const json = await res.json()
    expect(json).not.toHaveProperty('context_label')
  })

  it('customer_id hint: fetches THAT customer, clamped; labels the slice', async () => {
    signedIn()
    clampedToGinza()
    customerKaruteMock.mockResolvedValue({
      customerName: '田中',
      rows: [{ id: 'k1', customerName: '田中', createdAt: '2026-07-13', summary: null, entries: [] }],
    })
    const res = await POST(req({ context_hint: { customer_id: 'c-1' } }))
    expect(res.status).toBe(200)
    expect(customerKaruteMock).toHaveBeenCalledWith('c-1', 10, GINZA)
    expect(recentMock).not.toHaveBeenCalled()
    expect(promptMock.mock.calls[0][0].contextLabel).toBe('田中様のカルテ1件')
    const json = await res.json()
    expect(json.context_label).toBe('田中様のカルテ1件')
  })

  it("scope:'today' hint: fetches the roster slice, clamped; count = roster size", async () => {
    signedIn()
    clampedToGinza()
    // rosterSize (3 booked) drives the 「N名」 count, NOT the 2 rows that happen to
    // have a record — record-less/unknown customers must still be counted.
    rosterKaruteMock.mockResolvedValue({
      rosterSize: 3,
      rows: [
        { id: 'k1', customerName: '田中', createdAt: '2026-07-13', summary: null, entries: [] },
        { id: 'k2', customerName: '佐藤', createdAt: '2026-07-13', summary: null, entries: [] },
      ],
    })
    const res = await POST(req({ context_hint: { scope: 'today' } }))
    expect(res.status).toBe(200)
    expect(rosterKaruteMock).toHaveBeenCalledWith(GINZA)
    expect(recentMock).not.toHaveBeenCalled()
    const json = await res.json()
    expect(json.context_label).toBe('本日ご来店のお客様3名のカルテ')
  })

  it('malformed hint falls back to the generic slice', async () => {
    signedIn()
    viewAll()
    const res = await POST(req({ context_hint: { bogus: true } }))
    expect(res.status).toBe(200)
    expect(recentMock).toHaveBeenCalledWith(5, undefined)
    expect(customerKaruteMock).not.toHaveBeenCalled()
  })
})

describe('getTodaySignals — store scope + ranking', () => {
  const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString()

  function rosterOf(customerId: string) {
    apptsMock.mockResolvedValue([
      { id: 'a1', customer_id: customerId, starts_at: soon, status: 'SCHEDULED' },
    ])
  }

  it('clamped staff: reads today via their store scope', async () => {
    clampedToGinza()
    rosterOf('c-1')
    cachedMock.mockResolvedValue([{ id: 'c-1', name: '田中' }])
    await getTodaySignals()
    expect(apptsMock).toHaveBeenCalledWith(GINZA)
  })

  it('viewAll staff: reads today unfiltered', async () => {
    viewAll()
    rosterOf('c-1')
    cachedMock.mockResolvedValue([{ id: 'c-1', name: '田中' }])
    await getTodaySignals()
    expect(apptsMock).toHaveBeenCalledWith(undefined)
  })

  it('empty roster → no signals', async () => {
    clampedToGinza()
    apptsMock.mockResolvedValue([])
    expect(await getTodaySignals()).toEqual([])
  })

  it('read error → [] (page falls back)', async () => {
    clampedToGinza()
    apptsMock.mockRejectedValue(new Error('boom'))
    expect(await getTodaySignals()).toEqual([])
  })

  it('produces up to 4 ranked signals (next_visit → ticket_low → long_absence → today_roster)', async () => {
    clampedToGinza()
    rosterOf('c-1')
    cachedMock.mockResolvedValue([{ id: 'c-1', name: '田中' }])
    usageMock.mockResolvedValue(
      new Map([['c-1', { remaining: 1, size: 5, unconsumed: 0, hasActivePack: true, firstPackId: null }]]),
    )
    ;(await enrichmentMock()).mockResolvedValue([
      { customer_id: 'c-1', last_visit: '2020-01-01T00:00:00Z' },
    ])
    const signals = await getTodaySignals()
    expect(signals.map((s) => s.kind)).toEqual([
      'next_visit',
      'ticket_low',
      'long_absence',
      'today_roster',
    ])
    expect(signals.length).toBeLessThanOrEqual(4)
    // grounded chip carries its targeted hint
    expect(signals[0].contextHint).toEqual({ customer_id: 'c-1' })
    expect(signals[3].titleJa).toBe('本日の1名のお客様の要点まとめ')
  })

  it('locale=en: emits English tags/titles/prompts (no mixed language)', async () => {
    clampedToGinza()
    rosterOf('c-1')
    cachedMock.mockResolvedValue([{ id: 'c-1', name: 'Tanaka' }])
    const signals = await getTodaySignals('en')
    const next = signals.find((s) => s.kind === 'next_visit')!
    expect(next.tagJa).toBe('Next visit')
    expect(next.titleJa).toContain('Next: Tanaka')
    expect(next.prompt).toContain("Tanaka's karute")
    const roster = signals.find((s) => s.kind === 'today_roster')!
    expect(roster.tagJa).toBe('Today')
    expect(roster.titleJa).toBe("Key points for today's 1 customer")
    // no stray Japanese anywhere in the EN output
    const allText = signals.flatMap((s) => [s.tagJa, s.titleJa, s.prompt]).join(' ')
    expect(allText).not.toMatch(/[぀-ヿ㐀-鿿]/)
  })
})
