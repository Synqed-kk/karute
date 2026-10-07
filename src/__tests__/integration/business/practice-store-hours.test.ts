// ⚖ §v11 V11-1…V11-3 · ⚖ S81 R4–R9 — store-hours.ts: a practice store's 営業時間 · 定休日 · 臨時休業 · 臨時営業日 through
// Karute's ONE resolver (resolveDayHours, src/lib/operating-hours.ts), now CALLED, never re-implemented.
import { jstDayKey } from '@/business/lib/clock'
import {
  closedDaysRange,
  closedWeekdaysOf,
  resolveStoreHours,
  sampleHours,
  usualPairOf,
  weekdayOfKey,
  weekFromPair,
  type HoursReads,
} from '@/business/lib/practice-door/store-hours'
import { POLICIES, STORE } from './practice-door-recorded'

const NOW = new Date('2026-09-14T04:24:00Z') // the recorded today, a Monday (JST)
const MON = jstDayKey(NOW), TUE = MON + 1
const SAMPLE_PAIR = { open: 600, close: 1140 }
const sample = (dayKey: number) => sampleHours(SAMPLE_PAIR, 1, dayKey)
const NO_ORG = { business_id: 'b', name: 'Dev Salon', settings: {} } as unknown as HoursReads['org']
const org = (operating_hours: unknown) => ({ business_id: 'b', name: 'Dev Salon', settings: { operating_hours } }) as unknown as HoursReads['org']
const reads = (policy: Partial<NonNullable<HoursReads['policy']>>, o: Partial<HoursReads> = {}): HoursReads => ({
  policy: { ...POLICIES[STORE.yokohama], ...policy } as HoursReads['policy'],
  closedDays: { closed_days: [] } as unknown as HoursReads['closedDays'],
  org: NO_ORG,
  ...o,
})
const closedOn = (date: string) => ({ closed_days: [{ id: 'c', store_id: 's', date, reason: null }] }) as unknown as HoursReads['closedDays']
const every = (open: string, close: string) => ({ mon: { open, close }, tue: { open, close }, wed: { open, close }, thu: { open, close }, fri: { open, close }, sat: { open, close }, sun: { open, close } })
const at = (dayKey: number, h = reads({})) => resolveStoreHours(h, dayKey, NOW, sample(dayKey), 'store-x')

describe('store-hours — the ONE resolver behind a practice store\'s 営業時間 (§v11 · S81)', () => {
  // The table is resolveDayHours's own output for these weekly_hours (the lane's equivalence-resolveDayHours.json, 9/27) —
  // recorded, because this territory test may not import src/lib (one fence row only: store-hours.ts). The live side-by-side
  // against the resolver itself is the S81 proof script (scripts/business/proof/s81-hours-match.test.ts).
  it('the week strip agrees with resolveDayHours over the seven stores\' recorded hours × 7 weekdays', () => {
    const week = (day: string, tue = day) => [day, day, tue, day, day, day, day] // index = Date#getDay, 0 = 日
    const TABLE: Record<string, string[]> = {
      [STORE.tokyo]: week('600-1140', 'closed'), [STORE.gym]: week('420-1320'), [STORE.jiyugaoka]: week('600-1200', 'closed'),
      [STORE.yokohama]: week('sample'), [STORE.laEstro]: week('sample'), [STORE.devSalon]: week('sample'), [STORE.devGinza]: week('sample'),
    }
    for (const [id, days] of Object.entries(TABLE)) {
      const h = resolveStoreHours({ policy: POLICIES[id] as HoursReads['policy'], closedDays: { closed_days: [] } as unknown as HoursReads['closedDays'], org: NO_ORG }, MON, NOW, sample(MON), id)
      if (days[0] === 'sample') {
        expect({ id, h }).toEqual({ id, h: sample(MON) }) // R6 — no store week, no org blob: the sample set, exactly as before
        continue
      }
      expect({ id, week: h.weeklyHours.map((d) => (d === null ? 'closed' : `${d.open}-${d.close}`)), src: h.hoursSource }).toEqual({ id, week: days, src: 'core' })
    }
  })

  it('R4/R7 — a 臨時休業 date closes the shown day alone (closed_date), never a 定休日; the week strip is untouched', () => {
    const h = at(MON, reads({ weekly_hours: every('09:00', '20:00') }, { closedDays: closedOn('2026-09-14') }))
    expect([h.shownDayClosed, h.closedWeekdays, h.operatingHours, h.hoursSource]).toEqual(['closed_date', [], { open: 540, close: 1200 }, 'core'])
    // the 定休日 path is named 'weekday'
    expect(at(TUE, reads({ weekly_hours: { ...every('09:00', '20:00'), tue: null } })).shownDayClosed).toBe('weekday')
  })

  it('R7 — a 臨時営業日 opens a 定休日 AND a 臨時休業 date with its own window (the resolver\'s order); 定休日 keeps its meaning', () => {
    const special = { special_open_days: [{ date: '2026-09-15', open: '11:00', close: '15:00' }] }
    const onWeekday = at(TUE, reads({ weekly_hours: { ...every('09:00', '20:00'), tue: null }, ...special }))
    expect([onWeekday.shownDayClosed, onWeekday.operatingHours, onWeekday.closedWeekdays]).toEqual([null, { open: 660, close: 900 }, [2]])
    const onClosure = at(TUE, reads({ weekly_hours: every('09:00', '20:00'), ...special }, { closedDays: closedOn('2026-09-15') }))
    expect([onClosure.shownDayClosed, onClosure.operatingHours]).toEqual([null, { open: 660, close: 900 }])
  })

  it('R6 — the default is never painted: no store week + no org blob → the sample set; a shown day nobody set → the usual pair, under core', () => {
    expect(at(MON, reads({ weekly_hours: null }))).toEqual(sample(MON))
    expect(at(MON, reads({ weekly_hours: null }, { org: null }))).toEqual(sample(MON))
    expect(at(MON, reads({ weekly_hours: {} }, { org: org({}) }))).toEqual(sample(MON))
    // the business saved Monday only: Tuesday (default) is served Monday's window — never 10:00–24:00
    const h = at(TUE, reads({ weekly_hours: null }, { org: org({ mon: { openMinute: 480, closeMinute: 720 } }) }))
    expect([h.hoursSource, h.operatingHours, h.weeklyHours[1], h.weeklyHours[2]]).toEqual(['core', { open: 480, close: 720 }, { open: 480, close: 720 }, { open: 480, close: 720 }])
    expect(h.weeklyHours.some((w) => w !== null && w.close - w.open === 14 * 60)).toBe(false)
  })

  it('R8 — V11-2a RETIRED: a malformed store weekday goes on to the business hours (or, unset, the usual pair), logged once', () => {
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const bad = { ...every('09:00', '20:00'), mon: { open: '10:00', close: '25:00' } }
      expect(at(MON, reads({ weekly_hours: bad }, { org: org({ mon: { openMinute: 480, closeMinute: 720 } }) })).operatingHours).toEqual({ open: 480, close: 720 })
      expect(at(MON, reads({ weekly_hours: bad })).operatingHours).toEqual({ open: 540, close: 1200 })
      expect(quiet).toHaveBeenCalledWith('[practice hours] malformed weekday sent on to the business hours / default:', 'store-x', '1')
    } finally {
      quiet.mockRestore()
    }
  })

  it('closedDaysRange — the shown day, `to` exclusive; sampleHours names its closed weekday; usualPairOf · weekFromPair · weekdayOfKey', () => {
    expect(closedDaysRange(MON, NOW)).toEqual({ from: '2026-09-14', to: '2026-09-15' })
    expect(closedDaysRange(MON + 17, NOW)).toEqual({ from: '2026-10-01', to: '2026-10-02' })
    expect([sample(MON).shownDayClosed, sample(TUE).shownDayClosed]).toEqual(['weekday', null])
    expect(closedWeekdaysOf(weekFromPair(SAMPLE_PAIR, [3, 6]))).toEqual([3, 6])
    expect(usualPairOf([null, { open: 600, close: 1140 }, null, null, null, null, { open: 540, close: 1020 }])).toEqual({ open: 600, close: 1140 })
    expect(usualPairOf([{ open: 540, close: 1020 }, { open: 600, close: 1140 }, null, null, null, null, null])).toEqual({ open: 540, close: 1020 })
    expect(usualPairOf([null, null, null, null, null, null, null])).toBeNull()
    expect([weekdayOfKey(MON), weekdayOfKey(MON - 1), weekdayOfKey(TUE)]).toEqual([1, 0, 2])
    expect(weekdayOfKey(jstDayKey(new Date('2026-09-13T15:30:00Z')))).toBe(1) // 00:30 JST Monday — the JST day, never the UTC one
  })
})
