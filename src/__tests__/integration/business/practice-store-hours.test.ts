// ⚖ §v11 V11-1…V11-3 — store-hours.ts, the territory-local reading of a practice store's core weekly_hours.
import { jstDayKey } from '@/business/lib/clock'
import { closedWeekdaysOf, resolveStoreDay, usualPairOf, weekdayOfKey, weekFromPair, weekOf, type WeeklyHours } from '@/business/lib/practice-door/store-hours'
import { POLICIES, STORE } from './practice-door-recorded'

const show = (d: ReturnType<typeof resolveStoreDay>) => (d.source === 'sample' ? 'sample' : d.closed ? 'closed' : `${d.open}-${d.close}`)
const every = (open: string, close: string) => ({ mon: { open, close }, tue: { open, close }, wed: { open, close }, thu: { open, close }, fri: { open, close }, sat: { open, close }, sun: { open, close } })

describe('store-hours — a practice store\'s own 営業時間 · 定休日 (§v11)', () => {
  // PROVENANCE — the table below IS `resolveDayHours`'s output (src/lib/operating-hours.ts; the fence keeps that import
  // out of territory, so it is recorded, not called). Saved as the lane's evidence/board-fix/pr-a/equivalence-resolveDayHours.json
  // (2026-09-27, tip 944e0cb03). Re-derive: in a worktree, write an UNCOMMITTED src/__tests__/integration/zz-oracle.scratch.test.ts
  // that calls resolveDayHours({ date: 12:00 JST on Sun 2026-09-13 + wd, weeklyHours: <the POLICIES weekly_hours below>,
  // closedDates: new Set(), orgHours: null, orgSaved: new Set() }) for wd 0…6 and writes source !== 'store' → 'sample',
  // closed → 'closed', else `${openMinute}-${closeMinute}` to ORACLE_OUT; run it with
  // ORACLE_OUT=<file> NEXT_PUBLIC_SUPABASE_URL=https://test-dummy.supabase.co SUPABASE_SERVICE_ROLE_KEY=dummy-not-a-key node_modules/.bin/jest src/__tests__/integration/zz-oracle.scratch.test.ts
  // then delete the scratch file (a file outside territory never rides a Business PR).
  it('agrees with resolveDayHours over the seven stores\' recorded hours × 7 weekdays (its recorded output — see PROVENANCE)', () => {
    const week = (day: string, tue = day) => [day, day, tue, day, day, day, day] // index = Date#getDay, 0 = 日
    const TABLE: Record<string, string[]> = {
      [STORE.tokyo]: week('600-1140', 'closed'), [STORE.gym]: week('420-1320'), [STORE.jiyugaoka]: week('600-1200', 'closed'),
      [STORE.yokohama]: week('sample'), [STORE.laEstro]: week('sample'), [STORE.devSalon]: week('sample'), [STORE.devGinza]: week('sample'),
    }
    for (const [id, days] of Object.entries(TABLE)) expect({ id, days: days.map((_, wd) => show(resolveStoreDay(POLICIES[id].weekly_hours, wd))) }).toEqual({ id, days })
    // ⚖ §v11 V11-7 — and the plane's WEEK (weekOf) says the same seven days; no core hours → no core week (the sample set).
    for (const [id, days] of Object.entries(TABLE)) {
      const week = weekOf(POLICIES[id].weekly_hours)
      expect({ id, week: week?.map((d) => (d === null ? 'closed' : `${d.open}-${d.close}`)) ?? Array(7).fill('sample') }).toEqual({ id, week: days })
    }
  })

  it('resolveStoreDay: no hours (null · no row · {}) → sample; a null or absent day → 定休日; 24:00 = 1440; a malformed or empty window (open ≥ close) → sample', () => {
    for (const none of [null, undefined, {}]) expect(resolveStoreDay(none, 1)).toEqual({ source: 'sample' })
    expect(resolveStoreDay({ mon: { open: '09:00', close: '18:00' } }, 2)).toEqual({ source: 'core', closed: true })
    expect(resolveStoreDay({ mon: null, tue: { open: '09:00', close: '18:00' } }, 1)).toEqual({ source: 'core', closed: true })
    expect(resolveStoreDay({ mon: { open: '09:30', close: '24:00' } }, 1)).toEqual({ source: 'core', closed: false, open: 570, close: 1440 })
    for (const bad of [{ open: '10:00', close: '10:00' }, { open: '18:00', close: '09:00' }, { open: '9', close: '18:00' }, { open: '09:00', close: '24:30' }, { open: '09:60', close: '18:00' }]) expect(resolveStoreDay({ mon: bad }, 1)).toEqual({ source: 'sample' })
  })

  it('weekOf + closedWeekdaysOf (§v11 V11-7): the week normalized; EVERY closed weekday, ascending; a malformed day or a week with no open day → no core week', () => {
    const wedSat = { ...every('10:00', '19:00'), sat: null, wed: null, thu: { open: '11:00', close: '22:00' } }
    const [W, T] = [{ open: 600, close: 1140 }, { open: 660, close: 1320 }]
    expect(weekOf(wedSat)).toEqual([W, W, W, null, T, W, null])
    expect(closedWeekdaysOf(weekOf(wedSat)!)).toEqual([3, 6])
    expect(closedWeekdaysOf(weekOf(POLICIES[STORE.tokyo].weekly_hours)!)).toEqual([2])
    expect(closedWeekdaysOf(weekOf(POLICIES[STORE.gym].weekly_hours)!)).toEqual([])
    expect(weekOf({ ...every('10:00', '19:00'), fri: { open: '19:00', close: '10:00' } })).toBeNull() // V11-2a
    for (const none of [null, undefined, {}, { mon: null }, { mon: null, tue: null }]) expect(weekOf(none)).toBeNull() // V11-2b
    expect(weekFromPair({ open: 600, close: 1140 }, [1])).toEqual([0, 1, 2, 3, 4, 5, 6].map((wd) => (wd === 1 ? null : { open: 600, close: 1140 })))
  })

  it('usualPairOf: the most frequent open window of the week; a tie → the earliest weekday\'s (日 = 0 first); no open day → null', () => {
    expect(usualPairOf(weekOf(POLICIES[STORE.gym].weekly_hours)!)).toEqual({ open: 420, close: 1320 })
    expect(usualPairOf(weekOf({ ...every('10:00', '19:00'), sat: { open: '09:00', close: '17:00' }, sun: { open: '09:00', close: '17:00' } })!)).toEqual({ open: 600, close: 1140 })
    const tie: WeeklyHours = { mon: { open: '10:00', close: '19:00' }, sun: { open: '09:00', close: '17:00' } }
    expect(usualPairOf(weekOf(tie)!)).toEqual({ open: 540, close: 1020 })
    expect(usualPairOf([null, null, null, null, null, null, null])).toBeNull()
  })

  it('weekdayOfKey: the JST weekday of a day index (the recorded today 9/14 is a Monday, 9/13 a Sunday)', () => {
    const today = jstDayKey(new Date('2026-09-14T04:24:00Z'))
    expect([weekdayOfKey(today), weekdayOfKey(today - 1), weekdayOfKey(today + 1)]).toEqual([1, 0, 2])
    expect(weekdayOfKey(jstDayKey(new Date('2026-09-13T15:30:00Z')))).toBe(1) // 00:30 JST Monday — the JST day, never the UTC one
  })
})
