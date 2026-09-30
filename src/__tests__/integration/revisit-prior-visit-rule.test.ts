// R-O7 + V7 (PR-O commit 3, RULING-S67-PRO-STOP2): the ONE prior-visit rule.
// A karute row counts as a prior visit UNLESS it is the 仮カルテ placeholder
// (status DRAFT, no recording session) on the SAME JST day as the anchor —
// the recording session's START day, or today when there is no session.
// Guard-level cases + the write-refusal consumer (setKaruteOutcomeWithClient);
// the enqueue refusal, the record screen gate and the detail DTO are pinned in
// their own suites (app-api-recording-job, record-screen-cross-store-target,
// app-api-karute-detail-screen).
jest.mock('server-only', () => ({}))
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn(), newSynqedClient: jest.fn() }))

import { isReturningCustomerServerSide } from '@/lib/karute/revisit-guard'
import { countsAsPriorVisit } from '@/lib/customers/status-signals'
import { jstDayOf } from '@/lib/date/jst'
import { setKaruteOutcomeWithClient, REVISIT_NOT_ELIGIBLE } from '@/lib/karute/outcome'

type Row = { id: string; status: string; recording_session_id: string | null; session_date?: string | null; created_at: string }
const FIRST_TIMER = { is_existing_customer: false, visit_count: 0, has_ticket_pack: false }
const REGULAR = { is_existing_customer: false, visit_count: 4, has_ticket_pack: false }

// Liam's 9/29 shape: the draft 32 s before the session, the AI karute at 19:02 JST.
const OWN: Row = { id: 'own-ai', status: 'DRAFT', recording_session_id: 'sess-1', created_at: '2026-09-29T10:02:09Z' }
const SAME_DAY_PLACEHOLDER: Row = { id: 'draft-1', status: 'DRAFT', recording_session_id: null, session_date: '2026-09-29', created_at: '2026-09-29T07:44:07Z' }
const SESSION_START = '2026-09-29T07:44:39Z' // 16:44 JST

function client(opts: { customer: object; rows: Row[]; sessionStart?: string | null; sessionThrows?: boolean }) {
  const upsert = jest.fn(async () => ({}))
  const recordingsGet = jest.fn(async () => {
    if (opts.sessionThrows) throw new Error('core down')
    return { id: 'sess-1', created_at: opts.sessionStart ?? SESSION_START }
  })
  return {
    upsert,
    recordingsGet,
    c: {
      customers: { get: jest.fn(async () => opts.customer) },
      packs: { listPacks: jest.fn(async () => []) },
      karuteRecords: {
        list: jest.fn(async () => ({ karute_records: opts.rows })),
        get: jest.fn(async (id: string) => opts.rows.find((r) => r.id === id) ?? OWN),
      },
      recordings: { get: recordingsGet },
      karuteOutcomes: { get: jest.fn(async () => null), upsert },
    },
  }
}
const guard = (c: object, exclude: { karuteRecordId: string } | { recordingSessionId: string } = { karuteRecordId: 'own-ai' }) =>
  isReturningCustomerServerSide(c as never, 'cust-1', exclude)

describe('R-O7 — the prior-visit rule in the shared guard', () => {
  it('V7-1: a same-day 仮カルテ placeholder never makes a first-timer returning', async () => {
    const { c, recordingsGet } = client({ customer: FIRST_TIMER, rows: [OWN, SAME_DAY_PLACEHOLDER] })
    expect(await guard(c)).toBe('not_returning')
    expect(recordingsGet).toHaveBeenCalledWith('sess-1')
  })

  it('V7-2: a same-day placeholder never hides 既存のお客様 for a real regular (visit count, or an earlier karute)', async () => {
    expect(await guard(client({ customer: REGULAR, rows: [OWN, SAME_DAY_PLACEHOLDER] }).c)).toBe('returning')
    const earlier: Row = { id: 'k-old', status: 'APPROVED', recording_session_id: 'sess-0', created_at: '2026-08-01T03:00:00Z' }
    expect(await guard(client({ customer: FIRST_TIMER, rows: [OWN, SAME_DAY_PLACEHOLDER, earlier] }).c)).toBe('returning')
  })

  it('a same-day COMPLETED karute still counts (a true second visit in one day)', async () => {
    const completed: Row = { ...SAME_DAY_PLACEHOLDER, id: 'k-done', status: 'APPROVED' }
    expect(await guard(client({ customer: FIRST_TIMER, rows: [OWN, completed] }).c)).toBe('returning')
    const recordedDraft: Row = { ...SAME_DAY_PLACEHOLDER, id: 'k-rec', recording_session_id: 'sess-earlier' }
    expect(await guard(client({ customer: FIRST_TIMER, rows: [OWN, recordedDraft] }).c)).toBe('returning')
  })

  it('an EARLIER-day DRAFT placeholder still counts (a regular whose karutes never left DRAFT)', async () => {
    const olderDraft: Row = { ...SAME_DAY_PLACEHOLDER, id: 'draft-old', session_date: '2026-09-28', created_at: '2026-09-28T05:00:00Z' }
    expect(await guard(client({ customer: FIRST_TIMER, rows: [OWN, olderDraft] }).c)).toBe('returning')
  })

  it('the midnight edge: draft 23:50, session 23:51, evaluated 00:10 next day → first-timer (the session\'s day, not the clock)', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-29T15:10:00Z'), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
    try {
      const draft: Row = { id: 'draft-late', status: 'DRAFT', recording_session_id: null, session_date: '2026-09-29', created_at: '2026-09-29T14:50:00Z' }
      const own: Row = { ...OWN, created_at: '2026-09-29T15:10:00Z' }
      const at = { customer: FIRST_TIMER, rows: [own, draft], sessionStart: '2026-09-29T14:51:00Z' }
      expect(await guard(client(at).c)).toBe('not_returning')
      expect(await guard(client(at).c, { recordingSessionId: 'sess-1' })).toBe('not_returning')
    } finally {
      jest.useRealTimers()
    }
  })

  it('an anchor that cannot be read counts every row — the pre-R-O7 answer, never a silent narrowing', async () => {
    const { c } = client({ customer: FIRST_TIMER, rows: [OWN, SAME_DAY_PLACEHOLDER], sessionThrows: true })
    expect(await guard(c)).toBe('returning')
  })

  it('no placeholder in the list → no anchor read at all (the common path costs nothing)', async () => {
    const { c, recordingsGet } = client({ customer: FIRST_TIMER, rows: [OWN] })
    expect(await guard(c)).toBe('not_returning')
    expect(recordingsGet).not.toHaveBeenCalled()
  })
})

describe('R-O7 consumer — the write refusal inherits the rule (setKaruteOutcomeWithClient → the guard)', () => {
  const revisit = { karuteRecordId: 'own-ai', customerId: 'cust-1', status: 'revisit' as const, decidedBy: 'staff-1', onUnverifiable: 'write' as const }
  it('first-timer + same-day placeholder → the 既存のお客様 label is refused, nothing written', async () => {
    const { c, upsert } = client({ customer: FIRST_TIMER, rows: [OWN, SAME_DAY_PLACEHOLDER] })
    expect(await setKaruteOutcomeWithClient(c as never, revisit)).toEqual({ error: REVISIT_NOT_ELIGIBLE })
    expect(upsert).not.toHaveBeenCalled()
  })
  it('first-timer + an EARLIER-day placeholder → returning, the label is written', async () => {
    const olderDraft: Row = { ...SAME_DAY_PLACEHOLDER, id: 'draft-old', session_date: '2026-09-28', created_at: '2026-09-28T05:00:00Z' }
    const { c, upsert } = client({ customer: FIRST_TIMER, rows: [OWN, olderDraft] })
    expect(await setKaruteOutcomeWithClient(c as never, revisit)).toEqual({})
    expect(upsert).toHaveBeenCalledTimes(1)
  })
})

// S67 fix round 2, commit 14 (SF-4; the attack's F-5 / M5): the prior-visit
// read pages on past the own record and same-day placeholders — they can
// never push a regular's real past karute off a 3-row page (a regression vs
// base, which counted them). The mock honours page/page_size like core.
describe('SF-4 — the revisit guard never pages a regular off the list', () => {
  const ph = (id: string): Row => ({ ...SAME_DAY_PLACEHOLDER, id })
  const PAST: Row = { id: 'k-past', status: 'COMPLETED', recording_session_id: 'sess-0', created_at: '2026-08-01T03:00:00Z' }
  const paged = (rows: Row[]) => {
    const made = client({ customer: FIRST_TIMER, rows })
    const list = jest.fn(async (q: { page?: number; page_size: number }) => {
      const page = q.page ?? 1
      return { karute_records: rows.slice((page - 1) * q.page_size, page * q.page_size) }
    })
    made.c.karuteRecords.list = list as never
    return { ...made, list }
  }

  it('SF-4 F-5: own record + 2 same-day placeholders on page 1, the real past karute on page 2 → returning (stale signals)', async () => {
    const { c, list } = paged([OWN, ph('d1'), ph('d2'), PAST])
    expect(await guard(c)).toBe('returning')
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ customer_id: 'cust-1', page: 2, page_size: 3 }))
  })
  it('SF-4 F-5 at the write refusal: the same regular\'s 既存のお客様 label is written', async () => {
    const { c, upsert } = paged([OWN, ph('d1'), ph('d2'), PAST])
    expect(await setKaruteOutcomeWithClient(c as never, {
      karuteRecordId: 'own-ai', customerId: 'cust-1', status: 'revisit', isFirstVisit: false, decidedBy: 'staff-1',
    })).toEqual({})
    expect(upsert).toHaveBeenCalledTimes(1)
  })
  it('SF-4 M5: the enqueue exclusion with THREE same-day placeholders + a past karute → returning', async () => {
    const { c } = paged([ph('d3'), ph('d2'), ph('d1'), PAST])
    expect(await guard(c, { recordingSessionId: 'sess-1' })).toBe('returning')
  })
  it('SF-4: a first-timer whose list ends after the placeholders stays not_returning (the short page ends the read)', async () => {
    const { c, list } = paged([OWN, ph('d1'), ph('d2')])
    expect(await guard(c)).toBe('not_returning')
    expect(list).toHaveBeenCalledTimes(2)
  })
  it('SF-4: a list still full of placeholders at the page bound is NOT KNOWN (unknown, never a 0)', async () => {
    const { c, list } = paged([OWN, ...Array.from({ length: 40 }, (_, i) => ph(`d${i}`))])
    expect(await guard(c)).toBe('unknown')
    // 10 pages per read, the guard's one retry of a failed read → 20.
    expect(list).toHaveBeenCalledTimes(20)
  })
})


// A11 (S69 fix round 4, commit 29): date reads are null-safe and one shape.
describe('A11 — the prior-visit rule reads dates through the one null-safe helper', () => {
  it("A11 D: jstDayOf — a canonical day as is, '2026-9-29' normalised to '2026-09-29', a timestamp in JST, garbage and null → null", () => {
    expect(jstDayOf('2026-09-29')).toBe('2026-09-29')
    expect(jstDayOf('2026-9-29')).toBe('2026-09-29')
    expect(jstDayOf('2026-09-28T15:30:00Z')).toBe('2026-09-29')
    expect(jstDayOf('not-a-real-date-at-all')).toBeNull()
    expect(jstDayOf(null)).toBeNull()
  })
  it("A11 N: a same-day placeholder dated '2026-9-29' is today's (normalised) → not a prior visit", () => {
    expect(countsAsPriorVisit({ status: 'DRAFT', recording_session_id: null, session_date: '2026-9-29', created_at: null }, '2026-09-29')).toBe(false)
  })
  it('A11 N: a placeholder with no session_date and created_at null → counts (a regular is never hidden)', () => {
    expect(countsAsPriorVisit({ status: 'DRAFT', recording_session_id: null, session_date: null, created_at: null }, '2026-09-29')).toBe(true)
  })
  it('A11 clog: a placeholder with a malformed long session_date counts → returning, never unknown (the enqueue no longer refuses on every retry)', async () => {
    const bad: Row = { id: 'draft-bad', status: 'DRAFT', recording_session_id: null, session_date: 'not-a-real-date-at-all', created_at: '2026-09-29T07:44:07Z' }
    expect(await guard(client({ customer: FIRST_TIMER, rows: [OWN, bad] }).c)).toBe('returning')
  })
})
