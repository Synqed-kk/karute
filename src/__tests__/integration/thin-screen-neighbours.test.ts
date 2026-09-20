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
// Match metric-menu.test.ts: override the registry module for ON-only cases.
let mockPersistCalendarNumbers: boolean | undefined
jest.mock('@/lib/appointments/booking-switches', () => {
  const actual = jest.requireActual('@/lib/appointments/booking-switches')
  return { BOOKING_SWITCHES: {
    ...actual.BOOKING_SWITCHES,
    get persistCalendarNumbers() {
      return mockPersistCalendarNumbers ?? actual.BOOKING_SWITCHES.persistCalendarNumbers
    },
  } }
})

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'ja',
}))
// The wire schema is proven by its own suite; here the body IS the fixture, so
// the warm's zod parse would reject a deliberately minimal month and the
// fail-open catch would swallow it — which is not what this file is about.
jest.mock('@/lib/app-api/appointments-screen-dto', () => ({
  ...jest.requireActual('@/lib/app-api/appointments-screen-dto'),
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
import { emitRefresh } from '../../../thin/ports/nav.vite'
import { dtoCache, fetchedAtByPath } from '../../../thin/screens/ScreenBoundary'
import type { MonthCellDTOType } from '@/lib/app-api/appointments-screen-dto'

import { setThinActiveStore } from '../../../thin/chrome/store-pref'
import { setSessionState } from '@/lib/auth/mobile/session-store'
import type { Session } from '@supabase/supabase-js'

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
  mockPersistCalendarNumbers = undefined
  jest.useFakeTimers()
  mockFetch.mockReset()
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
  dtoCache.clear()
  fetchedAtByPath.clear()
  window.localStorage.clear()
  setSessionState({ status: 'signed-in', session: { user: { id: 'u1' } } as Session })
  clearCalendarNumbers()
  mockRecorderState = 'idle'
  cancelNeighbourWarm()
})
afterEach(() => {
  jest.useRealTimers()
})

describe('the path IS the cache key (S3)', () => {
  it('an old Monday month cache entry cannot answer the new locale request', () => {
    mockPersistCalendarNumbers = true
    const legacyPath = '/api/app/v1/screens/appointments?date=2026-09-01&view=month&locale=ja'
    const path = appointmentsScreenPath({ date: '2026-09-01', view: 'month', locale: 'ja' })
    dtoCache.set(legacyPath, { monthData: monthCells() })
    rememberMonthNumbers(legacyPath, monthCells())
    expect(readMonthNumbers(legacyPath)).toEqual(monthCells())
    expect(path).not.toBe(legacyPath)
    expect(dtoCache.has(path)).toBe(false)
    expect(readMonthNumbers(path)).toBeNull()
  })

  it('spells it exactly as the screen does — order included, absent params absent', () => {
    expect(appointmentsScreenPath({ locale: 'ja' })).toBe(
      '/api/app/v1/screens/appointments?locale=ja&weekStart=locale',
    )
    expect(
      appointmentsScreenPath({ date: '2026-09-14', view: 'week', staff: 'self', locale: 'ja' }),
    ).toBe('/api/app/v1/screens/appointments?date=2026-09-14&view=week&staff=self&locale=ja&weekStart=locale')
    // 'all' is never written to the URL by navigateTo, so it is never a key.
    expect(appointmentsScreenPath({ date: '2026-09-14', view: 'day', staff: null, locale: 'ja' })).toBe(
      '/api/app/v1/screens/appointments?date=2026-09-14&view=day&locale=ja&weekStart=locale',
    )
  })
})

describe('the neighbour queue (S3)', () => {
  it('queues one unit either way, then the other two views, then the month', () => {
    const paths = neighbourPaths({ ...base, view: 'week', selectedDate: SELECTED })
    expect(paths).toEqual([
      '/api/app/v1/screens/appointments?date=2026-09-07&view=week&locale=ja&weekStart=locale',
      '/api/app/v1/screens/appointments?date=2026-09-21&view=week&locale=ja&weekStart=locale',
      '/api/app/v1/screens/appointments?date=2026-09-14&view=day&locale=ja&weekStart=locale',
      '/api/app/v1/screens/appointments?date=2026-09-14&view=month&locale=ja&weekStart=locale',
      // The pop-down's own month — NO staff param, because the 月 counts are
      // store-wide and one would quietly shrink them.
      '/api/app/v1/screens/appointments?date=2026-09-01&view=month&locale=ja&weekStart=locale',
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
  beforeEach(() => { mockPersistCalendarNumbers = true })
  const path = '/api/app/v1/screens/appointments?date=2026-09-01&view=month&locale=ja&weekStart=locale'

  it('isolates the same path across store lenses read at call time', () => {
    setThinActiveStore('store-A')
    rememberMonthNumbers(path, monthCells())
    setThinActiveStore('store-B')
    expect(readMonthNumbers(path)).toBeNull()
    setThinActiveStore('store-A')
    expect(readMonthNumbers(path)).toEqual(monthCells())
  })

  it('keeps the null all-store lens apart from a store id', () => {
    rememberMonthNumbers(path, monthCells())
    setThinActiveStore('store-A')
    expect(readMonthNumbers(path)).toBeNull()
    rememberMonthNumbers(path, monthCells().map((c) => ({ ...c, count: 9 })))
    window.localStorage.removeItem('karute-active-store')
    expect(readMonthNumbers(path)).toEqual(monthCells())
  })

  it('namespaces the same store and path by the synchronous session user', () => {
    setThinActiveStore('store-A')
    rememberMonthNumbers(path, monthCells())
    setSessionState({ status: 'signed-in', session: { user: { id: 'u2' } } as Session })
    setThinActiveStore('store-A')
    expect(readMonthNumbers(path)).toBeNull()
    setSessionState({ status: 'signed-in', session: { user: { id: 'u1' } } as Session })
    expect(readMonthNumbers(path)).toEqual(monthCells())
    setSessionState({ status: 'recovering' })
    expect(readMonthNumbers(path)).toEqual(monthCells())
  })

  it('does not read or persist numbers without a known user', () => {
    setSessionState({ status: 'signed-out' })
    rememberMonthNumbers(path, monthCells())
    expect(readMonthNumbers(path)).toBeNull()
    expect(window.localStorage.getItem('karute-calendar-numbers')).toBeNull()
  })

  it('reads every v1 blob as absent, even with a matching new key', () => {
    rememberMonthNumbers(path, monthCells())
    const blob = JSON.parse(window.localStorage.getItem('karute-calendar-numbers')!)
    blob.v = 1
    blob.entries[path] = { at: 1, monthData: monthCells() }
    window.localStorage.setItem('karute-calendar-numbers', JSON.stringify(blob))
    expect(readMonthNumbers(path)).toBeNull()
  })

  it('writes a month back and reads it again', () => {
    rememberMonthNumbers(path, monthCells())
    expect(readMonthNumbers(path)).toEqual(monthCells())
  })

  it('drops a name-shaped field without refusing the calendar numbers', () => {
    const poisoned = monthCells().map((c) => ({ ...c, customerName: '山田 花子' }))
    rememberMonthNumbers(path, poisoned as MonthCellDTOType[])
    expect(readMonthNumbers(path)).toEqual(monthCells())
    const raw = window.localStorage.getItem('karute-calendar-numbers')!
    expect(raw).not.toContain('customerName')
    expect(raw).not.toContain(poisoned[0].customerName)
  })

  it('drops unknown top-level and nested DTO fields from the raw stored JSON', () => {
    const extra = monthCells().map((cell) => ({
      ...cell, futureLabel: 'synthetic-top-level', futurePayload: { value: 'synthetic-nested' },
    }))
    rememberMonthNumbers(path, extra)
    const raw = window.localStorage.getItem('karute-calendar-numbers')!
    expect(raw).not.toContain('futureLabel')
    expect(raw).not.toContain('synthetic-top-level')
    expect(raw).not.toContain('futurePayload')
    expect(raw).not.toContain('synthetic-nested')
    expect(readMonthNumbers(path)).toEqual(monthCells())
  })

  it.each(['id', 'dateIso'] as const)('refuses non-date text in %s', (field) => {
    rememberMonthNumbers(path, monthCells().map((cell) => ({ ...cell, [field]: 'not-a-date' })))
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

  it.each([
    ['string', 'broken'],
    ['object', {}],
    ['null cell', [null]],
    ['string count', [{ ...monthCells()[0], count: 'x' }]],
    ['missing id', [{ ...monthCells()[0], id: undefined }]],
    ['empty month', []],
    ['invalid density', [{ ...monthCells()[0], density: 'invalid' }]],
    ['missing closed', [{ ...monthCells()[0], closed: undefined }]],
    ['missing newCount', [{ ...monthCells()[0], newCount: undefined }]],
    ['wrong flag type', [{ ...monthCells()[0], newCountKnown: 1 }]],
    ['wrong inMonth type', [{ ...monthCells()[0], inMonth: 'true' }]],
    ['wrong isToday type', [{ ...monthCells()[0], isToday: 0 }]],
    ['invalid date', [{ ...monthCells()[0], dateIso: 'invalid' }]],
    ['invalid cell id', [{ ...monthCells()[0], id: 'invalid' }]],
    ['mixed valid and corrupt', [monthCells()[0], null]],
  ])('reads malformed %s as absent and removes it on the next write', (_label, monthData) => {
    rememberMonthNumbers(path, monthCells())
    const blob = JSON.parse(window.localStorage.getItem('karute-calendar-numbers')!)
    const key = Object.keys(blob.entries)[0]
    blob.entries[key].monthData = monthData
    window.localStorage.setItem('karute-calendar-numbers', JSON.stringify(blob))
    expect(() => expect(readMonthNumbers(path)).toBeNull()).not.toThrow()
    rememberMonthNumbers('another-month', monthCells())
    const rewritten = JSON.parse(window.localStorage.getItem('karute-calendar-numbers')!)
    expect(rewritten.entries).not.toHaveProperty(key)
    expect(readMonthNumbers('another-month')).toEqual(monthCells())
  })

  it.each([null, [], 'broken', { at: 'wrong', monthData: monthCells() }])(
    'reads a malformed entry as absent: %j', (entry) => {
      rememberMonthNumbers(path, monthCells())
      const blob = JSON.parse(window.localStorage.getItem('karute-calendar-numbers')!)
      blob.entries[Object.keys(blob.entries)[0]] = entry
      window.localStorage.setItem('karute-calendar-numbers', JSON.stringify(blob))
      expect(() => expect(readMonthNumbers(path)).toBeNull()).not.toThrow()
    },
  )

  it.each([null, [], 'broken'])('reads malformed entries containers as absent: %j', (entries) => {
    window.localStorage.setItem('karute-calendar-numbers', JSON.stringify({ v: 2, entries }))
    expect(() => expect(readMonthNumbers(path)).toBeNull()).not.toThrow()
    rememberMonthNumbers(path, monthCells())
    expect(readMonthNumbers(path)).toEqual(monthCells())
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


describe('release 28 shipped persistence OFF', () => {
  const key = 'karute-calendar-numbers'
  const path = 'shipped-default-month'
  const seed = () => window.localStorage.setItem(key, JSON.stringify({
    v: 2, entries: { [JSON.stringify(['u1', 'all', path])]: { at: 1, monthData: monthCells() } },
  }))

  it('writes nothing with the shipped default', () => {
    rememberMonthNumbers(path, monthCells())
    expect(window.localStorage.getItem(key)).toBeNull()
  })

  it('reads nothing even with a valid v2 blob', () => {
    seed()
    expect(readMonthNumbers(path)).toBeNull()
    // Prove this is a readable fixture, not a malformed-blob false positive.
    mockPersistCalendarNumbers = true
    expect(readMonthNumbers(path)).toEqual(monthCells())
  })

  it('still clears old blobs with the switch off', () => {
    seed()
    clearCalendarNumbers()
    expect(window.localStorage.getItem(key)).toBeNull()
  })

  it('still clears old blobs on sign-out with the switch off', () => {
    seed()
    setSessionState({ status: 'signed-out' })
    expect(window.localStorage.getItem(key)).toBeNull()
  })
})


describe('neighbour request fence', () => {
  it.each(['sign-out', 'refresh'] as const)('drops a month settling after %s, including persistence when explicitly ON', async (event) => {
    mockPersistCalendarNumbers = true
    let settle!: (body: unknown) => void
    mockFetch.mockResolvedValue({ ok: true, json: () => new Promise((resolve) => { settle = resolve }) })
    warmAppointmentNeighbours({ ...base, view: 'month', selectedDate: SELECTED })
    runFrames(1)
    cancelNeighbourWarm()
    await Promise.resolve()
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const path = mockFetch.mock.calls[0][0]
    if (event === 'sign-out') {
      setSessionState({ status: 'signed-out' })
      setSessionState({ status: 'signed-in', session: { user: { id: 'u2' } } as Session })
    } else emitRefresh()
    settle({ monthData: monthCells() })
    await jest.runAllTimersAsync()
    expect(dtoCache.has(path)).toBe(false)
    expect(fetchedAtByPath.has(path)).toBe(false)
    expect(window.localStorage.getItem('karute-calendar-numbers')).toBeNull()
    expect(neighbourInFlight().size).toBe(0)
  })

  it('still caches with an intact fence and the shipped persistence default', async () => {
    const dto = { monthData: monthCells() }
    mockFetch.mockResolvedValue({ ok: true, json: async () => dto })
    warmAppointmentNeighbours({ ...base, view: 'month', selectedDate: SELECTED })
    runFrames(1)
    cancelNeighbourWarm()
    await jest.runAllTimersAsync()
    const path = mockFetch.mock.calls[0][0]
    expect(dtoCache.get(path)).toEqual(dto)
    expect(fetchedAtByPath.has(path)).toBe(true)
    expect(window.localStorage.getItem('karute-calendar-numbers')).toBeNull()
  })
})
