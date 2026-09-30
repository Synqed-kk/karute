// S7 (PR-O commit 4; O2 + V5; RULING-S67-PRO-STOP2 R-O10): the ONE auto-link
// function. Each guardrail condition under its own test; the window is the
// booking's OWN duration on each side (no constant). The two callers (facade
// save, worker) are pinned in app-api-karute-save / process-recording-existing-karute.
import { linkUpdateOf, resolveAutoAppointmentLink } from '@/lib/karute/appointment-link'

const SESSION_START = '2026-09-29T07:44:39Z' // 16:44 JST
type Appt = {
  id: string; customer_id: string | null; store_id: string | null; starts_at: string; ends_at: string
  duration_minutes: number | null; status: string; cancelled_at: string | null
}
const booking = (over: Partial<Appt> = {}): Appt => ({
  id: 'appt-1', customer_id: 'cust-1', store_id: 'store-A',
  starts_at: '2026-09-29T07:30:00Z', ends_at: '2026-09-29T08:30:00Z', // 16:30–17:30 JST
  duration_minutes: 60, status: 'SCHEDULED', cancelled_at: null, ...over,
})
function client(appts: Appt[], linked: Array<{ appointment_id: string; recording_session_id: string | null }> = []) {
  const list = jest.fn(async () => ({ appointments: appts }))
  const recordingsGet = jest.fn(async () => ({ id: 'sess-1', created_at: SESSION_START }))
  const karuteList = jest.fn(async () => ({ karute_records: linked }))
  return {
    list, recordingsGet, karuteList,
    c: { appointments: { list }, recordings: { get: recordingsGet }, karuteRecords: { list: karuteList } } as never,
  }
}
const input = { customerId: 'cust-1', storeId: 'store-A', recordingSessionId: 'sess-1' }
const run = (c: never, over: Partial<typeof input & { sessionStartedAt: string | null }> = {}) =>
  resolveAutoAppointmentLink(c, { ...input, ...over })

describe('S7 — resolveAutoAppointmentLink, the guardrail', () => {
  it('the one booking of the session\'s day, same customer + store, SCHEDULED, unlinked, in its window → auto_linked', async () => {
    const { c, list } = client([booking()])
    expect(await run(c)).toEqual({ link: 'auto_linked', appointmentId: 'appt-1' })
    expect(list).toHaveBeenCalledWith({
      customer_id: 'cust-1', store_id: 'store-A',
      from: '2026-09-28T15:00:00.000Z', to: '2026-09-29T14:59:59.999Z', page_size: 50,
    })
  })
  it('condition 1 — another customer\'s booking → none', async () => {
    expect((await run(client([booking({ customer_id: 'cust-2' })]).c)).link).toBe('none')
  })
  it('condition 2 — a booking in another store → none', async () => {
    expect((await run(client([booking({ store_id: 'store-B' })]).c)).link).toBe('none')
  })
  it('condition 3 — a booking on another JST day → none', async () => {
    expect((await run(client([booking({ starts_at: '2026-09-29T15:30:00Z', ends_at: '2026-09-29T16:30:00Z' })]).c)).link).toBe('none')
  })
  it('condition 3 at midnight — a booking just past midnight is another day even inside its window → none', async () => {
    // session 23:51 JST 9/29; a 60-min booking 00:10–01:10 JST 9/30 (window 23:10–02:10) — inside the window, not the session's day.
    const late = booking({ starts_at: '2026-09-29T15:10:00Z', ends_at: '2026-09-29T16:10:00Z' })
    expect((await run(client([late]).c, { sessionStartedAt: '2026-09-29T14:51:00Z' })).link).toBe('none')
  })
  it('condition 4 — status: IN_PROGRESS links; COMPLETED / NO_SHOW / CANCELLED never', async () => {
    expect((await run(client([booking({ status: 'IN_PROGRESS' })]).c)).link).toBe('auto_linked')
    for (const status of ['COMPLETED', 'NO_SHOW', 'CANCELLED']) {
      expect((await run(client([booking({ status })]).c)).link).toBe('none')
    }
  })
  it('condition 5 — a cancelled booking (cancelled_at set) → none', async () => {
    expect((await run(client([booking({ cancelled_at: '2026-09-29T01:00:00Z' })]).c)).link).toBe('none')
  })
  it('condition 6 — another karute already points at it → none; this session\'s own karute does not count', async () => {
    expect((await run(client([booking()], [{ appointment_id: 'appt-1', recording_session_id: 'sess-other' }]).c)).link).toBe('none')
    expect((await run(client([booking()], [{ appointment_id: 'appt-1', recording_session_id: 'sess-1' }]).c)).link).toBe('auto_linked')
  })
  it('condition 7 — TWO bookings that day → ambiguous, no link', async () => {
    const second = booking({ id: 'appt-2', starts_at: '2026-09-29T10:00:00Z', ends_at: '2026-09-29T11:00:00Z' })
    expect(await run(client([booking(), second]).c)).toEqual({ link: 'ambiguous', appointmentId: null })
  })
  // S67 fix round 2, B-1 (the attack's A5a/A5b): condition 7 counts every
  // booking of the day that is not cancelled, BEFORE the status check.
  it('B-1 A5a: the real visit 09:00–10:00 already COMPLETED + the next 10:00–11:00 SCHEDULED, session 09:05 → ambiguous, no link', async () => {
    const real = booking({ id: 'appt-real', starts_at: '2026-09-29T00:00:00Z', ends_at: '2026-09-29T01:00:00Z', status: 'COMPLETED' })
    const next = booking({ id: 'appt-next', starts_at: '2026-09-29T01:00:00Z', ends_at: '2026-09-29T02:00:00Z' })
    expect(await run(client([real, next]).c, { sessionStartedAt: '2026-09-29T00:05:00Z' })).toEqual({ link: 'ambiguous', appointmentId: null })
  })
  it('B-1: a NO_SHOW or IN_PROGRESS booking beside a SCHEDULED one is two bookings → ambiguous', async () => {
    for (const status of ['NO_SHOW', 'IN_PROGRESS']) {
      const other = booking({ id: 'appt-x', starts_at: '2026-09-29T01:00:00Z', ends_at: '2026-09-29T02:00:00Z', status })
      expect((await run(client([booking(), other]).c)).link).toBe('ambiguous')
    }
  })
  it('B-1: a CANCELLED booking (status or cancelled_at) beside a SCHEDULED one does not count → the SCHEDULED one links', async () => {
    const other = (over: Partial<Appt>) => booking({ id: 'appt-x', starts_at: '2026-09-29T01:00:00Z', ends_at: '2026-09-29T02:00:00Z', ...over })
    expect(await run(client([booking(), other({ status: 'CANCELLED' })]).c)).toEqual({ link: 'auto_linked', appointmentId: 'appt-1' })
    expect(await run(client([booking(), other({ cancelled_at: '2026-09-28T23:00:00Z' })]).c)).toEqual({ link: 'auto_linked', appointmentId: 'appt-1' })
  })
  it('B-1: one COMPLETED booking only, in its window → none (counted, then refused by status)', async () => {
    expect(await run(client([booking({ status: 'COMPLETED' })]).c)).toEqual({ link: 'none', appointmentId: null })
  })
  it('the window is the booking\'s OWN duration on each side (no constant)', async () => {
    // 60-min booking 17:40–18:40 JST → window 16:40–19:40: 16:44 inside.
    expect((await run(client([booking({ starts_at: '2026-09-29T08:40:00Z', ends_at: '2026-09-29T09:40:00Z' })]).c)).link).toBe('auto_linked')
    // 60-min booking 18:00–19:00 → window 17:00–20:00: 16:44 outside.
    expect((await run(client([booking({ starts_at: '2026-09-29T09:00:00Z', ends_at: '2026-09-29T10:00:00Z' })]).c)).link).toBe('none')
    // 30-min booking 17:20–17:50 → window 16:50–18:20: 16:44 outside (a 60-min rule would have linked it).
    expect((await run(client([booking({ starts_at: '2026-09-29T08:20:00Z', ends_at: '2026-09-29T08:50:00Z', duration_minutes: 30 })]).c)).link).toBe('none')
    // after the booking: 60-min 15:00–16:00 → window 14:00–17:00: 16:44 inside.
    expect((await run(client([booking({ starts_at: '2026-09-29T06:00:00Z', ends_at: '2026-09-29T07:00:00Z' })]).c)).link).toBe('auto_linked')
  })
  it('a booking with no length links nothing', async () => {
    expect((await run(client([booking({ ends_at: '2026-09-29T07:30:00Z', duration_minutes: null })]).c)).link).toBe('none')
  })
  // S-3 (S68 fix round 3): a failed read is NOT evaluated — its own word,
  // never 'none' ("no booking qualifies"); the function still never throws.
  const readFailed = (warn: jest.SpyInstance) =>
    warn.mock.calls.filter((c) => String(c[0]).includes('"reason":"read_failed"'))
  it('S-3: appointments.list throws → skipped:read_failed, logged once with its cause, no link', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const { c, list } = client([booking()])
    list.mockRejectedValueOnce(new Error('core down'))
    expect(await run(c)).toEqual({ link: 'skipped:read_failed', appointmentId: null })
    expect(readFailed(warn)).toHaveLength(1)
    expect(JSON.parse(String(readFailed(warn)[0][0]))).toEqual({
      evt: 'auto_link_skipped', reason: 'read_failed', recordingSessionId: 'sess-1', cause: 'core down',
    })
    warn.mockRestore()
  })
  it('S-3: the karute list (condition 6) throws → skipped:read_failed', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const { c, karuteList } = client([booking()])
    karuteList.mockRejectedValueOnce(new Error('core down'))
    expect(await run(c)).toEqual({ link: 'skipped:read_failed', appointmentId: null })
    expect(readFailed(warn)).toHaveLength(1)
    warn.mockRestore()
  })
  // A11 (S69 fix round 4, commit 29): only the SESSION's own start failing to
  // parse is read_failed; a booking's bad date COUNTS toward the day and is
  // never linked (its window cannot be judged) — 'ambiguous'.
  it('A11: a lone NON-cancelled booking with a malformed starts_at → ambiguous (counted, never linked, never read_failed)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await run(client([booking({ starts_at: 'not-a-date' })]).c)).toEqual({ link: 'ambiguous', appointmentId: null })
    expect(readFailed(warn)).toHaveLength(0)
    warn.mockRestore()
  })
  it('A11 L1: a CANCELLED booking with a bad date is ignored → the good one links', async () => {
    const bad = booking({ id: 'appt-x', starts_at: 'not-a-date', status: 'CANCELLED', cancelled_at: '2026-09-28T00:00:00Z' })
    expect(await run(client([bad, booking()]).c)).toEqual({ link: 'auto_linked', appointmentId: 'appt-1' })
  })
  it('A11 L2: a NON-cancelled bad-date booking + one good booking → ambiguous (the bad one counts, never excluded)', async () => {
    expect(await run(client([booking({ id: 'appt-x', starts_at: 'not-a-date' }), booking()]).c)).toEqual({ link: 'ambiguous', appointmentId: null })
  })
  it('A11 L3: the session start will not parse → skipped:read_failed, logged once, the day never read', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const { c, list } = client([booking()])
    expect(await run(c, { sessionStartedAt: 'not-a-date' })).toEqual({ link: 'skipped:read_failed', appointmentId: null })
    expect(list).not.toHaveBeenCalled()
    expect(readFailed(warn)).toHaveLength(1)
    warn.mockRestore()
  })
  it('S-3: the session row read throws → skipped:read_failed', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const { c, recordingsGet, list } = client([booking()])
    recordingsGet.mockRejectedValueOnce(new Error('core down'))
    expect(await run(c)).toEqual({ link: 'skipped:read_failed', appointmentId: null })
    expect(list).not.toHaveBeenCalled()
    warn.mockRestore()
  })
  // SF-6 (S67 fix round 2, commit 16): no start = NOT evaluated, its own word
  // (was 'none', the same word as "no booking qualifies").
  it('a caller that already holds the start (the worker) → no session read; no start → skipped:no_session_start', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const { c, recordingsGet, list } = client([booking()])
    expect((await run(c, { sessionStartedAt: SESSION_START })).link).toBe('auto_linked')
    expect(await run(c, { sessionStartedAt: null })).toEqual({ link: 'skipped:no_session_start', appointmentId: null })
    expect(recordingsGet).not.toHaveBeenCalled()
    expect(list).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('"auto_link_skipped"'))).toHaveLength(1)
    warn.mockRestore()
  })
})

// A2 (S69 fix round 4, commit 24): the ONE spelling of a converge's link key.
describe('A2 — linkUpdateOf, the link key of a converge update', () => {
  const ex = { customer_id: 'cust-1' }
  it('A2: same customer, no booking, no auto-link → the key is omitted', () => {
    expect(linkUpdateOf(ex, { customer_id: 'cust-1', appointment_id: null }, null)).toEqual({})
  })
  it('A2: a named booking → the key with the given id', () => {
    expect(linkUpdateOf(ex, { customer_id: 'cust-1', appointment_id: 'appt-g' }, { appointmentId: 'appt-auto' })).toEqual({ appointment_id: 'appt-g' })
  })
  it('A2: an auto-link hit → the key with the auto-linked id', () => {
    expect(linkUpdateOf(ex, { customer_id: 'cust-1' }, { appointmentId: 'appt-auto' })).toEqual({ appointment_id: 'appt-auto' })
  })
  it('A2: a re-point with no booking and no auto-link hit → appointment_id: null', () => {
    expect(linkUpdateOf(ex, { customer_id: 'cust-2' }, { appointmentId: null })).toEqual({ appointment_id: null })
  })
})

// A5 (S69 fix round 4, commit 26): page 1 is judged as the whole day only when
// it is not full — more bookings than one page is 'ambiguous', never a link.
describe('A5 — more bookings than one page is ambiguous', () => {
  const pageOf = (appts: Appt[], total?: number) => {
    const { c, list } = client(appts)
    list.mockResolvedValueOnce((total === undefined ? { appointments: appts } : { appointments: appts, total }) as never)
    return c
  }
  it('A5: total 51 with one qualifying row on the page → ambiguous, no link', async () => {
    expect(await run(pageOf([booking()], 51))).toEqual({ link: 'ambiguous', appointmentId: null })
  })
  it('A5: no total and a full page (50 rows, one qualifying) → ambiguous, no link', async () => {
    const others = Array.from({ length: 49 }, (_, i) => booking({ id: `other-${i}`, customer_id: 'cust-other' }))
    expect(await run(pageOf([booking(), ...others]))).toEqual({ link: 'ambiguous', appointmentId: null })
  })
  it('A5: total equal to the rows on the page → judged as today (the one booking links)', async () => {
    expect(await run(pageOf([booking()], 1))).toEqual({ link: 'auto_linked', appointmentId: 'appt-1' })
  })
})
