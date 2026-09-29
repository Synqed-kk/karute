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
