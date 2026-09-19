/** @jest-environment jsdom */
/**
 * The phone's read layer for 予約 — the cache answering a path change (S2b),
 * the neighbour queue (S3) and the calendar numbers kept on the device (S4).
 *
 * These are the three pieces that decide whether a tap waits for the network,
 * so they are pinned on their own rather than only through a rendered screen:
 * the failure they exist to prevent is a WAIT, which a render test cannot see.
 */
// `mock`-prefixed so jest's hoisted factories may close over them — and read
// LAZILY (a getter, an arrow body), because a factory runs during the import
// below, which is before these declarations have been initialised.
// next-intl ships ESM only and this repo's jest does not transform it — every
// suite here mocks it (ScreenBoundary pulls it in for its loading/error cards).
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'ja',
}))
// The wire schema is proven by its own suite; here the body IS the fixture, so
// the warm's zod parse would reject a deliberately minimal month and the
// fail-open catch would swallow it — which is not what this file is about.
jest.mock('@/lib/app-api/appointments-screen-dto', () => ({
  AppointmentsScreenDTO: { parse: (raw: unknown) => raw },
}))
jest.mock('@/lib/ports/data-port', () => ({
  getDataPort: () => ({ apiFetch: mockFetch }),
}))
jest.mock('@/lib/global-recorder', () => ({
  globalRecorder: {
    get state() {
      return mockRecorderState
    },
  },
}))
const mockFetch = jest.fn()
let mockRecorderState = 'idle'

import {
  appointmentsScreenPath,
  cancelNeighbourWarm,
  neighbourInFlight,
  neighbourPaths,
  warmAppointmentNeighbours,
} from '../../../thin/data/screen-neighbours'
import {
  clearCalendarNumbers,
  readMonthNumbers,
  rememberMonthNumbers,
} from '../../../thin/data/calendar-numbers-store'
import { dtoCache, fetchedAtByPath } from '../../../thin/screens/ScreenBoundary'
import type { MonthCellDTOType } from '@/lib/app-api/appointments-screen-dto'

const TODAY = new Date('2026-09-16T00:00:00+09:00')
const SELECTED = new Date('2026-09-14T00:00:00+09:00')

const base = { today: TODAY, staff: null, locale: 'ja' as const }

/** Run the queue's animation frames by hand. */
function runFrames(n: number) {
  for (let i = 0; i < n; i++) jest.advanceTimersByTime(17)
}

function monthCells(): MonthCellDTOType[] {
  return [
    {
      id: '2026-09-01',
      dateIso: new Date('2026-09-01T00:00:00+09:00').toISOString(),
      inMonth: true,
      isToday: false,
      count: 4,
      density: 'medium',
      closed: false,
      newCount: 1,
      newCountKnown: true,
    } as unknown as MonthCellDTOType,
  ]
}

beforeEach(() => {
  jest.useFakeTimers()
  mockFetch.mockReset()
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
  dtoCache.clear()
  fetchedAtByPath.clear()
  clearCalendarNumbers()
  mockRecorderState = 'idle'
  cancelNeighbourWarm()
})
afterEach(() => {
  jest.useRealTimers()
})

describe('the path IS the cache key (S3)', () => {
  it('spells it exactly as the screen does — order included, absent params absent', () => {
    expect(appointmentsScreenPath({ locale: 'ja' })).toBe(
      '/api/app/v1/screens/appointments?locale=ja',
    )
    expect(
      appointmentsScreenPath({ date: '2026-09-14', view: 'week', staff: 'self', locale: 'ja' }),
    ).toBe('/api/app/v1/screens/appointments?date=2026-09-14&view=week&staff=self&locale=ja')
    // 'all' is never written to the URL by navigateTo, so it is never a key.
    expect(appointmentsScreenPath({ date: '2026-09-14', view: 'day', staff: null, locale: 'ja' })).toBe(
      '/api/app/v1/screens/appointments?date=2026-09-14&view=day&locale=ja',
    )
  })
})

describe('the neighbour queue (S3)', () => {
  it('queues one unit either way, then the other two views, then the month', () => {
    const paths = neighbourPaths({ ...base, view: 'week', selectedDate: SELECTED })
    expect(paths).toEqual([
      '/api/app/v1/screens/appointments?date=2026-09-07&view=week&locale=ja',
      '/api/app/v1/screens/appointments?date=2026-09-21&view=week&locale=ja',
      '/api/app/v1/screens/appointments?date=2026-09-14&view=day&locale=ja',
      '/api/app/v1/screens/appointments?date=2026-09-14&view=month&locale=ja',
      // The pop-down's own month — NO staff param, because the 月 counts are
      // store-wide and one would quietly shrink them.
      '/api/app/v1/screens/appointments?date=2026-09-01&view=month&locale=ja',
    ])
  })

  it('a 担当 filter rides on the view’s own warms, never on the pop-down’s month', () => {
    const paths = neighbourPaths({ ...base, staff: 'self', view: 'day', selectedDate: SELECTED })
    expect(paths.slice(0, 4).every((p) => p.includes('staff=self'))).toBe(true)
    expect(paths[4]).not.toContain('staff=')
  })

  it('a 月 view asks for no pop-down month — the page already IS one', () => {
    expect(neighbourPaths({ ...base, view: 'month', selectedDate: SELECTED })).toHaveLength(4)
  })

  it('fires ONE per animation frame, never a burst', () => {
    warmAppointmentNeighbours({ ...base, view: 'week', selectedDate: SELECTED })
    expect(mockFetch).toHaveBeenCalledTimes(0)
    runFrames(1)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    runFrames(1)
    expect(mockFetch).toHaveBeenCalledTimes(2)
    runFrames(10)
    expect(mockFetch).toHaveBeenCalledTimes(5)
  })

  it('skips what the cache already holds', () => {
    const paths = neighbourPaths({ ...base, view: 'week', selectedDate: SELECTED })
    dtoCache.set(paths[0], {})
    dtoCache.set(paths[1], {})
    warmAppointmentNeighbours({ ...base, view: 'week', selectedDate: SELECTED })
    runFrames(10)
    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(mockFetch.mock.calls.map((c) => c[0])).not.toContain(paths[0])
  })

  it('never asks twice for a path still in the air', async () => {
    const settlers: ((v: unknown) => void)[] = []
    mockFetch.mockImplementation(() => new Promise((res) => settlers.push(res)))
    warmAppointmentNeighbours({ ...base, view: 'week', selectedDate: SELECTED })
    runFrames(10)
    const first = mockFetch.mock.calls.length
    expect(neighbourInFlight().size).toBe(first)
    // The same land again (a background revalidate settling) queues nothing new.
    warmAppointmentNeighbours({ ...base, view: 'week', selectedDate: SELECTED })
    runFrames(10)
    expect(mockFetch).toHaveBeenCalledTimes(first)
    // …and every one of them lets go of its slot when it settles, however it
    // settles — otherwise the next land would find them falsely still pending.
    for (const settle of settlers) settle({ ok: false })
    await jest.runAllTimersAsync()
    expect(neighbourInFlight().size).toBe(0)
  })

  it('drops the rest of the queue when the view changes', () => {
    warmAppointmentNeighbours({ ...base, view: 'week', selectedDate: SELECTED })
    runFrames(1)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    cancelNeighbourWarm()
    runFrames(10)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('stands aside while a recording is running', () => {
    mockRecorderState = 'recording'
    warmAppointmentNeighbours({ ...base, view: 'week', selectedDate: SELECTED })
    runFrames(10)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('the calendar numbers kept on the device (S4)', () => {
  const path = '/api/app/v1/screens/appointments?date=2026-09-01&view=month&locale=ja'

  it('writes a month back and reads it again', () => {
    rememberMonthNumbers(path, monthCells())
    expect(readMonthNumbers(path)).toEqual(monthCells())
  })

  it('⚖ REFUSES a cell carrying anything name-shaped', () => {
    const poisoned = monthCells().map((c) => ({ ...c, customerName: '山田 花子' }))
    rememberMonthNumbers(path, poisoned as MonthCellDTOType[])
    expect(readMonthNumbers(path)).toBeNull()
    expect(window.localStorage.getItem('karute-calendar-numbers')).toBeNull()
  })

  it('what IS written is numbers and dates only — no name-shaped key anywhere', () => {
    rememberMonthNumbers(path, monthCells())
    const raw = window.localStorage.getItem('karute-calendar-numbers')!
    expect(raw).not.toMatch(/name|customer|client|memo|phone|email/i)
    // …and nothing that looks like a person's name in the values either.
    expect(raw).not.toMatch(/[ぁ-んァ-ヶ一-龠]/)
  })

  it('keeps two months at most, oldest out first', () => {
    for (const m of ['07', '08', '09']) {
      rememberMonthNumbers(`x-${m}`, monthCells())
      jest.advanceTimersByTime(5)
    }
    expect(readMonthNumbers('x-07')).toBeNull()
    expect(readMonthNumbers('x-08')).not.toBeNull()
    expect(readMonthNumbers('x-09')).not.toBeNull()
  })

  it('is wiped on sign-out', () => {
    rememberMonthNumbers(path, monthCells())
    clearCalendarNumbers()
    expect(readMonthNumbers(path)).toBeNull()
  })

  it('a corrupt or foreign value reads as ABSENT, never throws', () => {
    window.localStorage.setItem('karute-calendar-numbers', '{{not json')
    expect(readMonthNumbers(path)).toBeNull()
    window.localStorage.setItem('karute-calendar-numbers', JSON.stringify({ v: 99, entries: {} }))
    expect(readMonthNumbers(path)).toBeNull()
  })

  it('a warmed month is written down for the next launch', async () => {
    const paths = neighbourPaths({ ...base, view: 'day', selectedDate: SELECTED })
    const monthPath = paths[paths.length - 1]
    mockFetch.mockImplementation(async (p: string) =>
      p === monthPath
        ? { ok: true, json: async () => ({ monthData: monthCells() }) }
        : { ok: false, json: async () => null },
    )
    warmAppointmentNeighbours({ ...base, view: 'day', selectedDate: SELECTED })
    runFrames(10)
    await jest.runAllTimersAsync()
    expect(readMonthNumbers(monthPath)).toEqual(monthCells())
  })
})
