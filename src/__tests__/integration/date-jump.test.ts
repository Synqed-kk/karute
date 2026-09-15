/**
 * 予約 date-jump panel — the pure state layer (src/lib/appointments/date-jump.ts).
 *
 * What these pin, in the order they matter:
 *  1. PENDING ≠ EMPTY — a month that has not loaded carries no cells, so the
 *     panel cannot hand MonthGrid zero-count cells that read as "that month is
 *     completely free".
 *  2. The fetch policy — visible month alone first, neighbours only once it
 *     lands, a failed month retried on the next visit and NOT while it is on
 *     screen (that loop is the bug the policy's shape prevents).
 *  3. Month keys are JST calendar months, including across a year boundary.
 */

import {
  dateJumpReducer,
  firstDayOfMonthKey,
  initialDateJumpState,
  monthKeyInJst,
  monthKeyOf,
  monthsToLoad,
  shiftMonthKey,
  splitMonthKey,
  toMonthGridCells,
  type DateJumpState,
} from '@/lib/appointments/date-jump'
import { ymdInJst } from '@/lib/date/jst'
import type { MonthGridCell } from '@synqed-kk/ui'

const cell = (iso: string): MonthGridCell => ({
  id: iso,
  date: new Date(`${iso}T00:00:00+09:00`),
  inMonth: true,
  isToday: false,
  count: 3,
  density: 'medium',
})

const SEPT = [cell('2026-09-01')]

function reduce(state: DateJumpState, ...actions: Parameters<typeof dateJumpReducer>[1][]) {
  return actions.reduce(dateJumpReducer, state)
}

describe('month keys are JST calendar months', () => {
  it('reads the JST month of an instant, not the runtime-local one', () => {
    // 2026-09-30 23:30 JST is 14:30 UTC the same day; 2026-10-01 00:30 JST is
    // 2026-09-30 15:30 UTC — the one a UTC server would file under September.
    expect(monthKeyInJst(new Date('2026-09-30T23:30:00+09:00'))).toBe('2026-09')
    expect(monthKeyInJst(new Date('2026-10-01T00:30:00+09:00'))).toBe('2026-10')
  })

  it('shifts across a year boundary in both directions', () => {
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01')
    expect(shiftMonthKey('2027-01', -1)).toBe('2026-12')
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12')
    expect(shiftMonthKey('2026-09', 12)).toBe('2027-09')
    expect(shiftMonthKey('2026-09', -12)).toBe('2025-09')
  })

  it('zero-pads and round-trips', () => {
    expect(monthKeyOf(2026, 3)).toBe('2026-03')
    expect(splitMonthKey('2026-03')).toEqual([2026, 3])
    // The anchor every range/format helper takes is the JST 1st, not a UTC one.
    expect(ymdInJst(firstDayOfMonthKey('2027-01'))).toBe('2027-01-01')
  })
})

describe('the cache: pending is not empty', () => {
  it('a pending month carries NO cells (the panel must not render zero counts)', () => {
    const state = reduce(initialDateJumpState('2026-09'), { type: 'pending', month: '2026-10' })
    const entry = state.cache.get('2026-10')
    expect(entry?.status).toBe('pending')
    expect(entry?.cells).toBeUndefined()
  })

  it('a failed month carries no cells either', () => {
    const state = reduce(initialDateJumpState('2026-09'), { type: 'failed', month: '2026-10' })
    expect(state.cache.get('2026-10')).toEqual({ status: 'failed' })
  })

  it('loading replaces pending with the real cells', () => {
    const state = reduce(
      initialDateJumpState('2026-09'),
      { type: 'pending', month: '2026-09' },
      { type: 'loaded', month: '2026-09', cells: SEPT },
    )
    expect(state.cache.get('2026-09')).toEqual({ status: 'loaded', cells: SEPT })
  })

  it('seeds the page 月 data without a fetch, and re-seeds it on re-open', () => {
    const seeded = initialDateJumpState('2026-09', SEPT)
    expect(seeded.cache.get('2026-09')).toEqual({ status: 'loaded', cells: SEPT })
    expect(monthsToLoad(seeded)).toEqual(['2026-10', '2026-08'])

    const browsed = reduce(seeded, { type: 'shiftMonth', delta: 3 })
    expect(browsed.visibleMonth).toBe('2026-12')
    const reopened = reduce(browsed, { type: 'open', month: '2026-09', seed: SEPT })
    expect(reopened.visibleMonth).toBe('2026-09')
    expect(reopened.level).toBe('grid')
    // Months fetched while browsing survive the re-open — the cache is the point.
    expect(reopened.cache.get('2026-09')).toEqual({ status: 'loaded', cells: SEPT })
  })
})

describe('monthsToLoad — the whole fetch policy', () => {
  it('asks for the visible month ALONE while it is still unknown', () => {
    expect(monthsToLoad(initialDateJumpState('2026-09'))).toEqual(['2026-09'])
  })

  it('asks for nothing while the visible month is in flight', () => {
    const state = reduce(initialDateJumpState('2026-09'), { type: 'pending', month: '2026-09' })
    expect(monthsToLoad(state)).toEqual([])
  })

  it('prefetches BOTH neighbours once the visible month lands', () => {
    const state = reduce(initialDateJumpState('2026-09'), {
      type: 'loaded',
      month: '2026-09',
      cells: SEPT,
    })
    expect(monthsToLoad(state)).toEqual(['2026-10', '2026-08'])
  })

  it('does not re-ask for neighbours it already has or is already fetching', () => {
    const state = reduce(
      initialDateJumpState('2026-09'),
      { type: 'loaded', month: '2026-09', cells: SEPT },
      { type: 'loaded', month: '2026-10', cells: SEPT },
      { type: 'pending', month: '2026-08' },
    )
    expect(monthsToLoad(state)).toEqual([])
  })

  it('retries a failed month when it is visited again — and only the month itself', () => {
    const failed = reduce(initialDateJumpState('2026-09'), {
      type: 'failed',
      month: '2026-09',
    })
    // On screen and failed: the panel only re-asks when the visible month
    // changes or finishes loading, so this list being non-empty is the RETRY,
    // not a loop — and it never drags the neighbours in with it.
    expect(monthsToLoad(failed)).toEqual(['2026-09'])

    const away = reduce(failed, { type: 'setMonth', month: '2026-11' })
    const back = reduce(away, { type: 'setMonth', month: '2026-09' })
    expect(monthsToLoad(back)).toEqual(['2026-09'])
  })

  it('retries a failed NEIGHBOUR on the next prefetch', () => {
    const state = reduce(
      initialDateJumpState('2026-09'),
      { type: 'loaded', month: '2026-09', cells: SEPT },
      { type: 'failed', month: '2026-10' },
      { type: 'loaded', month: '2026-08', cells: SEPT },
    )
    expect(monthsToLoad(state)).toEqual(['2026-10'])
  })
})

/**
 * R2 — the blind round's freshness finding. The cache used to live as long as
 * the page: book a customer into next month, reopen the panel, read the old
 * number. Reopening now ages every cached month without emptying it.
 */
describe('re-opening refreshes the counts without blanking them', () => {
  it('marks every cached month stale and offers the visible one again', () => {
    const loaded = reduce(
      initialDateJumpState('2026-09'),
      { type: 'loaded', month: '2026-09', cells: SEPT },
      { type: 'loaded', month: '2026-10', cells: SEPT },
    )
    // Nothing to do while the panel stays open.
    expect(monthsToLoad(loaded)).toEqual(['2026-08'])

    const reopened = reduce(loaded, { type: 'open', month: '2026-09' })
    expect(reopened.cache.get('2026-09')).toMatchObject({ status: 'loaded', stale: true })
    expect(reopened.cache.get('2026-10')).toMatchObject({ status: 'loaded', stale: true })
    // Stale is offered on exactly the same terms as missing — visible first.
    expect(monthsToLoad(reopened)).toEqual(['2026-09'])
  })

  it('keeps the stale cells on screen while the re-read runs, then swaps them', () => {
    const reopened = reduce(
      initialDateJumpState('2026-09'),
      { type: 'loaded', month: '2026-09', cells: SEPT },
      { type: 'open', month: '2026-09' },
    )
    const reading = reduce(reopened, { type: 'pending', month: '2026-09' })
    // Pending, but the old cells are still there to render — and `stale` is
    // gone, so the re-read is not offered a second time while it runs.
    expect(reading.cache.get('2026-09')).toEqual({ status: 'pending', cells: SEPT })
    expect(monthsToLoad(reading)).toEqual([])

    const fresh = [cell('2026-09-02')]
    const done = reduce(reading, { type: 'loaded', month: '2026-09', cells: fresh })
    expect(done.cache.get('2026-09')).toEqual({ status: 'loaded', cells: fresh })
    expect(monthsToLoad(done)).toEqual(['2026-10', '2026-08'])
  })

  it('a failed REFRESH keeps the cells it already had — only a never-answered month is bare', () => {
    const refreshFailed = reduce(
      initialDateJumpState('2026-09'),
      { type: 'loaded', month: '2026-09', cells: SEPT },
      { type: 'open', month: '2026-09' },
      { type: 'pending', month: '2026-09' },
      { type: 'failed', month: '2026-09' },
    )
    expect(refreshFailed.cache.get('2026-09')).toEqual({ status: 'failed', cells: SEPT })

    const neverAnswered = reduce(initialDateJumpState('2026-09'), {
      type: 'failed',
      month: '2026-09',
    })
    expect(neverAnswered.cache.get('2026-09')?.cells).toBeUndefined()
  })

  it('the 月-view seed replaces its month rather than ageing it', () => {
    const reopened = reduce(
      initialDateJumpState('2026-09'),
      { type: 'loaded', month: '2026-09', cells: [cell('2026-09-03')] },
      { type: 'open', month: '2026-09', seed: SEPT },
    )
    expect(reopened.cache.get('2026-09')).toEqual({ status: 'loaded', cells: SEPT })
    // Fresh from the server this render — nothing to re-ask for.
    expect(monthsToLoad(reopened)).toEqual(['2026-10', '2026-08'])
  })
})

describe('levels', () => {
  it('opens the month chips on the VISIBLE month year, wherever the year row was left', () => {
    const state = reduce(
      initialDateJumpState('2026-09'),
      { type: 'setLevel', level: 'months' },
      { type: 'shiftYear', delta: 2 },
    )
    expect(state.year).toBe(2028)

    const back = reduce(state, { type: 'setLevel', level: 'grid' })
    expect(back.level).toBe('grid')
    expect(back.visibleMonth).toBe('2026-09') // a year walk navigates nothing

    const again = reduce(back, { type: 'setLevel', level: 'months' })
    expect(again.year).toBe(2026)
  })

  it('picking a month chip lands on the grid at that month', () => {
    const state = reduce(
      initialDateJumpState('2026-09'),
      { type: 'setLevel', level: 'months' },
      { type: 'setMonth', month: monthKeyOf(2027, 3) },
    )
    expect(state.visibleMonth).toBe('2027-03')
    expect(state.level).toBe('grid')
  })

  it('shiftMonth walks the grid one month at a time, across the year end', () => {
    const state = reduce(
      initialDateJumpState('2026-11'),
      { type: 'shiftMonth', delta: 1 },
      { type: 'shiftMonth', delta: 1 },
    )
    expect(state.visibleMonth).toBe('2027-01')
  })
})

describe('toMonthGridCells', () => {
  it('turns the wire shape into what MonthGrid renders, dates included', () => {
    const [out] = toMonthGridCells([
      {
        id: '2026-09-14',
        dateIso: '2026-09-13T15:00:00.000Z',
        inMonth: true,
        isToday: true,
        count: 11,
        density: 'busy',
      },
    ])
    expect(out.id).toBe('2026-09-14')
    expect(out.date instanceof Date).toBe(true)
    expect(ymdInJst(out.date)).toBe('2026-09-14')
    expect(out).toMatchObject({ inMonth: true, isToday: true, count: 11, density: 'busy' })
  })
})
