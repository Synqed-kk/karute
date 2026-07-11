/**
 * 未処理来店 detector (reconcile-core) — the forgot-to-record safety net's
 * rules, locked. Pure function, no mocks needed.
 */
import {
  findUnprocessedVisits,
  shiftDay,
  type FindUnprocessedInput,
} from '@/lib/packs/reconcile-core'

const TODAY = '2026-06-11'
const appt = (over: Partial<FindUnprocessedInput['appointments'][number]> = {}) => ({
  id: 'a1',
  customerId: 'c1',
  visitDayJst: '2026-06-09',
  isCancelled: false,
  isImport: false,
  hasKarute: false,
  ...over,
})
const base = (over: Partial<FindUnprocessedInput> = {}): FindUnprocessedInput => ({
  holders: new Map([['c1', { remaining: 3 }]]),
  lifecycles: new Map(),
  appointments: [appt()],
  redemptions: [],
  dismissals: new Set(),
  todayJst: TODAY,
  ...over,
})

describe('findUnprocessedVisits', () => {
  it('flags a pack holder visit with no karute and no redemption as 記録なし', () => {
    const { visits } = findUnprocessedVisits(base())
    expect(visits).toEqual([
      { customerId: 'c1', appointmentId: 'a1', visitDay: '2026-06-09', kind: 'unrecorded' },
    ])
  })
  it('karute exists but pack not ticked → 消化のみ未処理', () => {
    const { visits } = findUnprocessedVisits(base({ appointments: [appt({ hasKarute: true })] }))
    expect(visits[0].kind).toBe('unredeemed')
  })
  it('redemption linked by appointment id → processed', () => {
    const { visits } = findUnprocessedVisits(base({
      redemptions: [{ customerId: 'c1', appointmentId: 'a1', redeemedOn: '2026-06-09' }],
    }))
    expect(visits).toHaveLength(0)
  })
  it('redemption on the same JST day without a link → processed (manual check-off)', () => {
    const { visits } = findUnprocessedVisits(base({
      redemptions: [{ customerId: 'c1', appointmentId: null, redeemedOn: '2026-06-09' }],
    }))
    expect(visits).toHaveLength(0)
  })
  it('sheet-import appointments NEVER flag (1,393 historical visits ≠ unprocessed work)', () => {
    const { visits } = findUnprocessedVisits(base({ appointments: [appt({ isImport: true })] }))
    expect(visits).toHaveLength(0)
  })
  it('cancelled visits never flag', () => {
    const { visits } = findUnprocessedVisits(base({ appointments: [appt({ isCancelled: true })] }))
    expect(visits).toHaveLength(0)
  })
  it("TODAY's unrecorded visits get same-day grace (staff may be mid-flow)", () => {
    const { visits } = findUnprocessedVisits(base({ appointments: [appt({ visitDayJst: TODAY })] }))
    expect(visits).toHaveLength(0)
  })
  it("TODAY's recorded-but-unredeemed visit flags immediately (dashboard やること)", () => {
    const { visits } = findUnprocessedVisits(
      base({ appointments: [appt({ visitDayJst: TODAY, hasKarute: true })] }),
    )
    expect(visits).toHaveLength(1)
    expect(visits[0]).toMatchObject({ visitDay: TODAY, kind: 'unredeemed' })
  })
  it("TODAY's rows survive the cap (a 60-item backlog must not hide today's miss)", () => {
    const { visits, truncated } = findUnprocessedVisits(
      base({
        cap: 1,
        appointments: [
          appt({ id: 'p1', visitDayJst: '2026-06-08' }),
          appt({ id: 'p2', visitDayJst: '2026-06-09' }),
          appt({ id: 'td', visitDayJst: TODAY, hasKarute: true }),
        ],
      }),
    )
    expect(visits.map((v) => v.appointmentId)).toEqual(['p1', 'td'])
    expect(truncated).toBe(1)
  })
  it('outside the 7-day lookback → ignored (the strip is housekeeping, not archaeology)', () => {
    const { visits } = findUnprocessedVisits(base({ appointments: [appt({ visitDayJst: '2026-06-03' })] }))
    expect(visits).toHaveLength(0)
  })
  it('non-holders and exhausted packs never flag (nothing to consume)', () => {
    expect(findUnprocessedVisits(base({ holders: new Map() })).visits).toHaveLength(0)
    expect(
      findUnprocessedVisits(base({ holders: new Map([['c1', { remaining: 0 }]]) })).visits,
    ).toHaveLength(0)
  })
  it('卒業/離客 customers never flag', () => {
    const { visits } = findUnprocessedVisits(base({
      lifecycles: new Map([['c1', { status: 'graduated' as const }]]),
    }))
    expect(visits).toHaveLength(0)
  })
  it('来店なし dismissal silences exactly that visit day', () => {
    const { visits } = findUnprocessedVisits(base({
      dismissals: new Set(['c1|2026-06-09']),
    }))
    expect(visits).toHaveLength(0)
  })
  it('oldest first + cap with honest truncation count', () => {
    const appointments = Array.from({ length: 12 }, (_, i) =>
      appt({ id: `a${i}`, visitDayJst: shiftDay(TODAY, -1 - (i % 6)), customerId: 'c1' }),
    )
    const { visits, truncated } = findUnprocessedVisits(base({ appointments, cap: 5 }))
    expect(visits).toHaveLength(5)
    expect(truncated).toBe(7)
    expect(visits[0].visitDay <= visits[4].visitDay).toBe(true)
  })
})
