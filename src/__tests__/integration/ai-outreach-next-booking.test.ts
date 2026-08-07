/**
 * Next-booking line (PLAN-post-session-flow-2026-08-07.md — Item 2, D6-D9).
 * appendNextBookingLine is private (single choke point, not exported) — these
 * tests drive it through both public entry points:
 *   - getSuggestedFollowUpWithClient (facade): the client is passed straight
 *     in, so the lookup/exclusion/store-naming/formatting logic is exercised
 *     deterministically without touching getSynqedClient() at all.
 *   - getSuggestedFollowUp (web): no client in scope — exercises the lazy
 *     getSynqedClient() acquisition branch (mocked to resolve the same fake
 *     client, so the two paths share one set of fixtures).
 * The AI cache is mocked to a permanent miss, so every test exercises a fresh
 * OpenAI-generated draft; the line is appended AFTER that call, mirroring the
 * real cache-then-append order (D6: append happens after the cache boundary,
 * so a cached draft picks up the same fresh line — the "cache key" describe
 * block below proves the cache boundary itself is untouched by this).
 */
import type { SynqedClient, Appointment } from '@synqed-kk/client'
import { readFileSync } from 'fs'
import { join } from 'path'

jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))
jest.mock('@/lib/audit-web', () => ({ auditWeb: jest.fn(async () => undefined) }))
jest.mock('@/lib/subscription/feature-gate', () => ({
  featureAllowed: jest.fn(async () => true),
  featureAllowedForBusiness: jest.fn(async () => true),
}))
jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => null),
  orgSettingsWithClient: jest.fn(async () => null),
}))
jest.mock('@/lib/openai', () => ({
  openai: { chat: { completions: { parse: jest.fn() } } },
}))
jest.mock('@/lib/ai-cache', () => ({
  getCachedAI: jest.fn(async () => null),
  setCachedAI: jest.fn(async () => undefined),
}))

const appointmentsList = jest.fn()
const storesGet = jest.fn()
const fakeClient = {
  appointments: { list: appointmentsList },
  stores: { get: storesGet },
} as unknown as Pick<SynqedClient, 'orgSettings' | 'appointments' | 'stores'>

// The web path acquires its own client via a dynamic import of this module —
// mocked to resolve the SAME fake client so both entry points share fixtures.
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn(async () => fakeClient) }))

import { getSuggestedFollowUp, getSuggestedFollowUpWithClient } from '@/lib/karute/ai-outreach'
import { KARUTE_PROMPT_VERSION } from '@/lib/karute/prompt-fragments'
import { openai } from '@/lib/openai'

const DRAFT_BODY = '本日はご来店ありがとうございました。'

function mockDraft() {
  ;(openai.chat.completions.parse as jest.Mock).mockResolvedValue({
    choices: [{ message: { parsed: { body: DRAFT_BODY } } }],
  })
}

function appt(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-next',
    business_id: 'biz-1',
    customer_id: 'cust-1',
    staff_id: 'staff-1',
    store_id: 'store-own',
    starts_at: '2026-08-21T05:00:00.000Z', // 14:00 JST, Friday
    ends_at: '2026-08-21T06:00:00.000Z',
    duration_minutes: 60,
    title: null,
    notes: null,
    menu_id: null,
    booked_price_amount: null,
    booked_price_currency: null,
    status: 'SCHEDULED',
    source: 'MANUAL',
    external_refs: {},
    cancelled_at: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

function listResult(appointments: Appointment[]) {
  return { appointments, total: appointments.length, page: 1, page_size: 5 }
}

type Params = {
  karuteId: string
  customerId: string | null
  customerName: string
  summary: string | null
  locale: string
  appointmentId: string | null
  storeId: string | null
}

const BASE_PARAMS: Params = {
  karuteId: 'kar-1',
  customerId: 'cust-1',
  customerName: 'お客様',
  summary: '本日は肩こりのケアを行いました。',
  locale: 'ja',
  appointmentId: 'appt-own',
  storeId: 'store-own',
}

describe('next-booking line — via getSuggestedFollowUpWithClient (facade, client passed directly)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDraft()
  })

  const call = (params: Params = BASE_PARAMS, client = fakeClient) =>
    getSuggestedFollowUpWithClient(client, 'biz-1', 'staff-1', 'req-1', params)

  it('no upcoming booking → body unchanged', async () => {
    appointmentsList.mockResolvedValue(listResult([]))
    const draft = await call()
    expect(draft?.body).toBe(DRAFT_BODY)
  })

  it('booking exists → correct ja line with date/weekday/time (JST)', async () => {
    appointmentsList.mockResolvedValue(listResult([appt()]))
    const draft = await call()
    expect(draft?.body).toBe(
      `${DRAFT_BODY}\n\n次回は8月21日(金)14:00のご予約をお受けしております。お待ちしております。`,
    )
  })

  it('own appointment excluded from candidates — takes the next-earliest remaining', async () => {
    appointmentsList.mockResolvedValue(
      listResult([
        appt({ id: 'appt-own', starts_at: '2026-08-10T05:00:00.000Z' }), // this karute's own visit
        appt({ id: 'appt-next', starts_at: '2026-08-21T05:00:00.000Z' }),
      ]),
    )
    const draft = await call()
    expect(draft?.body).toContain('8月21日(金)14:00')
    expect(draft?.body).not.toContain('8月10日')
  })

  it('same-JST-day booking → 本日この後 variant, not 次回は', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-21T02:00:00.000Z')) // 11:00 JST
    try {
      appointmentsList.mockResolvedValue(
        listResult([appt({ starts_at: '2026-08-21T05:00:00.000Z' })]), // 14:00 JST, same day
      )
      const draft = await call()
      expect(draft?.body).toBe(
        `${DRAFT_BODY}\n\n本日この後14:00のご予約をお受けしております。お待ちしております。`,
      )
    } finally {
      jest.useRealTimers()
    }
  })

  it('multi-store: booking at a DIFFERENT store than today\'s session names the store', async () => {
    appointmentsList.mockResolvedValue(listResult([appt({ store_id: 'store-ginza' })]))
    storesGet.mockResolvedValue({ id: 'store-ginza', name: '銀座店' })
    const draft = await call()
    expect(draft?.body).toBe(
      `${DRAFT_BODY}\n\n次回は銀座店にて8月21日(金)14:00のご予約をお受けしております。お待ちしております。`,
    )
    // FC1: ONE business-wide call — never store-scoped.
    expect(appointmentsList).toHaveBeenCalledTimes(1)
    expect(appointmentsList.mock.calls[0][0]).not.toHaveProperty('store_id')
  })

  it('FC1: an earlier cross-store booking wins over a later own-store booking — the old own-store-first lookup would return the later own-store one instead', async () => {
    appointmentsList.mockResolvedValue(
      listResult([
        // Later, but at the session's own store — the old two-step lookup
        // would find this FIRST (store-scoped query) and stop there.
        appt({ id: 'appt-late-own', store_id: 'store-own', starts_at: '2026-08-25T05:00:00.000Z' }),
        // Earlier, at a different store — the actually-correct "next" booking.
        appt({ id: 'appt-early-other', store_id: 'store-ginza', starts_at: '2026-08-21T05:00:00.000Z' }),
      ]),
    )
    storesGet.mockResolvedValue({ id: 'store-ginza', name: '銀座店' })
    const draft = await call()
    expect(draft?.body).toBe(
      `${DRAFT_BODY}\n\n次回は銀座店にて8月21日(金)14:00のご予約をお受けしております。お待ちしております。`,
    )
    expect(draft?.body).not.toContain('8月25日')
    expect(appointmentsList).toHaveBeenCalledTimes(1)
  })

  it('FC7: unsorted API response — earliest booking is still chosen regardless of array order', async () => {
    appointmentsList.mockResolvedValue(
      listResult([
        appt({ id: 'appt-later', starts_at: '2026-08-25T05:00:00.000Z', store_id: 'store-own' }),
        appt({ id: 'appt-earlier', starts_at: '2026-08-21T05:00:00.000Z', store_id: 'store-own' }),
      ]),
    )
    const draft = await call()
    expect(draft?.body).toContain('8月21日(金)14:00')
    expect(draft?.body).not.toContain('8月25日')
  })

  it('FC2: cross-store booking whose store name lookup rejects → body unchanged, never location-blind', async () => {
    appointmentsList.mockResolvedValue(listResult([appt({ store_id: 'store-ginza' })]))
    storesGet.mockRejectedValue(new Error('store lookup failed'))
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const draft = await call()
      expect(draft?.body).toBe(DRAFT_BODY)
      expect(consoleErrorSpy).toHaveBeenCalled()
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('FC2: cross-store booking whose store lookup resolves with no name → body unchanged', async () => {
    appointmentsList.mockResolvedValue(listResult([appt({ store_id: 'store-ginza' })]))
    storesGet.mockResolvedValue({ id: 'store-ginza', name: '' })
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const draft = await call()
      expect(draft?.body).toBe(DRAFT_BODY)
      expect(consoleErrorSpy).toHaveBeenCalled()
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('same store as today: no store name in the line', async () => {
    appointmentsList.mockResolvedValue(listResult([appt({ store_id: 'store-own' })]))
    const draft = await call()
    expect(draft?.body).not.toContain('にて')
  })

  it('en locale: 12-hour time, natural EN line', async () => {
    appointmentsList.mockResolvedValue(listResult([appt()]))
    const draft = await call({ ...BASE_PARAMS, locale: 'en' })
    expect(draft?.body).toBe(
      `${DRAFT_BODY}\n\nWe have your next appointment on Fri, Aug 21 at 2:00 PM. We look forward to seeing you then.`,
    )
  })

  it('customerId null → body unchanged, no lookup attempted', async () => {
    const draft = await call({ ...BASE_PARAMS, customerId: null })
    expect(draft?.body).toBe(DRAFT_BODY)
    expect(appointmentsList).not.toHaveBeenCalled()
  })

  it('appointments.list rejects → body unchanged, never throws', async () => {
    appointmentsList.mockRejectedValue(new Error('core down'))
    await expect(call()).resolves.toEqual(expect.objectContaining({ body: DRAFT_BODY }))
  })

  it('null draft (no summary) → stays null, no crash, no lookup attempted', async () => {
    const draft = await call({ ...BASE_PARAMS, summary: '  ' })
    expect(draft).toBeNull()
    expect(appointmentsList).not.toHaveBeenCalled()
  })
})

describe('next-booking line — via getSuggestedFollowUp (web, acquires its own client)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDraft()
  })

  it('booking exists → line appended using the lazily-acquired client', async () => {
    appointmentsList.mockResolvedValue(listResult([appt()]))
    const draft = await getSuggestedFollowUp(BASE_PARAMS)
    expect(draft?.body).toBe(
      `${DRAFT_BODY}\n\n次回は8月21日(金)14:00のご予約をお受けしております。お待ちしております。`,
    )
  })

  it('no upcoming booking → body unchanged (web path)', async () => {
    appointmentsList.mockResolvedValue(listResult([]))
    const draft = await getSuggestedFollowUp(BASE_PARAMS)
    expect(draft?.body).toBe(DRAFT_BODY)
  })
})

// FC4: a generated draft body containing a concrete date/time token skips
// the 365-day cache write (the guard can't tell "grounded in the summary"
// from "invented" apart, so it protects the CACHE, not the draft itself —
// the draft is still returned either way, see the assertions below).
describe('FC4 — cache-lock guard on date/time-token bodies', () => {
  const { setCachedAI } = jest.requireMock('@/lib/ai-cache') as { setCachedAI: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()
    appointmentsList.mockResolvedValue(listResult([]))
  })

  it('JA date token (8月21日) in the generated body → setCachedAI NOT called, draft still returned', async () => {
    ;(openai.chat.completions.parse as jest.Mock).mockResolvedValue({
      choices: [{ message: { parsed: { body: '本日はありがとうございました。8月21日にまたお待ちしております。' } } }],
    })
    const draft = await getSuggestedFollowUpWithClient(fakeClient, 'biz-1', 'staff-1', 'req-1', BASE_PARAMS)
    expect(draft?.body).toContain('8月21日')
    expect(setCachedAI).not.toHaveBeenCalled()
  })

  it('clock-time token (14:00) in the generated body → setCachedAI NOT called', async () => {
    ;(openai.chat.completions.parse as jest.Mock).mockResolvedValue({
      choices: [{ message: { parsed: { body: '14:00にお待ちしております。' } } }],
    })
    await getSuggestedFollowUpWithClient(fakeClient, 'biz-1', 'staff-1', 'req-1', BASE_PARAMS)
    expect(setCachedAI).not.toHaveBeenCalled()
  })

  it('clean body (no date/time tokens) → setCachedAI called normally', async () => {
    mockDraft()
    await getSuggestedFollowUpWithClient(fakeClient, 'biz-1', 'staff-1', 'req-1', BASE_PARAMS)
    expect(setCachedAI).toHaveBeenCalledTimes(1)
  })

  // Delta-verify catch (2026-08-07): ordinal-suffixed EN dates and slash dates
  // slipped the original regex — the `1`→`s` char pair in "21st" defeats a
  // bare \b, and 8/21 had no alternative at all.
  it('EN ordinal date (August 21st) in the generated body → setCachedAI NOT called', async () => {
    ;(openai.chat.completions.parse as jest.Mock).mockResolvedValue({
      choices: [{ message: { parsed: { body: 'Thank you for today. See you again on August 21st!' } } }],
    })
    await getSuggestedFollowUpWithClient(fakeClient, 'biz-1', 'staff-1', 'req-1', BASE_PARAMS)
    expect(setCachedAI).not.toHaveBeenCalled()
  })

  it('slash date (8/21) in the generated body → setCachedAI NOT called', async () => {
    ;(openai.chat.completions.parse as jest.Mock).mockResolvedValue({
      choices: [{ message: { parsed: { body: '本日はありがとうございました。また8/21にお待ちしております。' } } }],
    })
    await getSuggestedFollowUpWithClient(fakeClient, 'biz-1', 'staff-1', 'req-1', BASE_PARAMS)
    expect(setCachedAI).not.toHaveBeenCalled()
  })

  // Dash ranges are DELIBERATELY not matched (see DATE_TIME_TOKEN_RE's doc):
  // 週2-3回 is a common legitimate self-care phrase — a false positive here
  // would skip caching on every such draft.
  it('dash range (週2-3回) is NOT a date token → setCachedAI still called', async () => {
    ;(openai.chat.completions.parse as jest.Mock).mockResolvedValue({
      choices: [{ message: { parsed: { body: '週2-3回のセルフケアを続けてみてください。' } } }],
    })
    await getSuggestedFollowUpWithClient(fakeClient, 'biz-1', 'staff-1', 'req-1', BASE_PARAMS)
    expect(setCachedAI).toHaveBeenCalledTimes(1)
  })

  // Fresh-eyes catch (2026-08-07): a bare slash also matches fractions in
  // care instructions (1/2カップ) — the counter lookahead excludes those;
  // full-width digits/slash are covered like the JA alternatives.
  it('fraction with counter (1/2カップ) is NOT a date token → setCachedAI still called', async () => {
    ;(openai.chat.completions.parse as jest.Mock).mockResolvedValue({
      choices: [{ message: { parsed: { body: 'お湯で1/2カップほど薄めてお使いください。' } } }],
    })
    await getSuggestedFollowUpWithClient(fakeClient, 'biz-1', 'staff-1', 'req-1', BASE_PARAMS)
    expect(setCachedAI).toHaveBeenCalledTimes(1)
  })

  it('slash date with particle (8/21に) IS a date token → setCachedAI NOT called', async () => {
    ;(openai.chat.completions.parse as jest.Mock).mockResolvedValue({
      choices: [{ message: { parsed: { body: 'また8/21にお会いできるのを楽しみにしております。' } } }],
    })
    await getSuggestedFollowUpWithClient(fakeClient, 'biz-1', 'staff-1', 'req-1', BASE_PARAMS)
    expect(setCachedAI).not.toHaveBeenCalled()
  })

  it('full-width slash date (８／２１) IS a date token → setCachedAI NOT called', async () => {
    ;(openai.chat.completions.parse as jest.Mock).mockResolvedValue({
      choices: [{ message: { parsed: { body: '次は８／２１ごろにどうぞ。' } } }],
    })
    await getSuggestedFollowUpWithClient(fakeClient, 'biz-1', 'staff-1', 'req-1', BASE_PARAMS)
    expect(setCachedAI).not.toHaveBeenCalled()
  })
})

describe('outreach cache key — outreach-only suffix (D9), passport cache untouched', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDraft()
  })

  it('outreach cacheInput.v carries the outreach-2 suffix, never the bare KARUTE_PROMPT_VERSION', async () => {
    const { getCachedAI } = jest.requireMock('@/lib/ai-cache')
    appointmentsList.mockResolvedValue(listResult([]))
    await getSuggestedFollowUpWithClient(fakeClient, 'biz-1', 'staff-1', 'req-1', BASE_PARAMS)
    const [, cacheInput] = (getCachedAI as jest.Mock).mock.calls[0]
    expect(cacheInput.v).toBe(`${KARUTE_PROMPT_VERSION}:outreach-2`)
    expect(cacheInput.v).not.toBe(KARUTE_PROMPT_VERSION)
  })

  // ai-passport.ts's single-slot これまで-box cache key is a SEPARATE consumer
  // of KARUTE_PROMPT_VERSION (2026-07-15 incident: bumping the shared constant
  // blanks it business-wide). The outreach-only suffix above lives entirely in
  // ai-outreach.ts's cacheInput — this asserts ai-passport.ts's key shape is
  // byte-for-byte untouched by that change.
  it('ai-passport.ts cache key is untouched — bare KARUTE_PROMPT_VERSION, no outreach suffix', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/karute/ai-passport.ts'), 'utf8')
    expect(src).toContain('{ v: KARUTE_PROMPT_VERSION, c: customerId, bt: businessType }')
    expect(src).not.toContain('outreach-2')
  })
})
