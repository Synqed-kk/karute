/**
 * @jest-environment jsdom
 *
 * The PHONE's month door for the 予約 date-jump panel (R7b).
 *
 * The shell has no server actions, so the panel's months come from the screen
 * GET this screen already reads, with `view=month` and any day of the month
 * wanted. Nothing read the URL that door actually builds: the stress lens
 * added a `staff=self` to it and the whole thin suite stayed green. That param
 * matters — 月 counts are STORE-WIDE (the staff filter touches
 * reservationViews only, lib/appointments/screen.ts), so sending one would
 * quietly shrink the numbers staff read, with no visible symptom until someone
 * compared them by hand.
 */
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

// SWC exports are non-configurable getters. Preserve the real implementations
// in configurable module seams so the OFF tests can observe forbidden calls.
jest.mock('../../../thin/data/calendar-numbers-store', () => ({
  ...jest.requireActual('../../../thin/data/calendar-numbers-store'),
}))
jest.mock('../../../thin/screens/ScreenBoundary', () => ({
  ...jest.requireActual('../../../thin/screens/ScreenBoundary'),
}))

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'ja',
}))

type ViewProps = {
  loadMonthCells: (key: string) => Promise<unknown[]>
  monthData: MonthCell[] | null
}
let capturedProps: ViewProps | null = null
jest.mock('@/components/appointments/AppointmentsView', () => ({
  AppointmentsView: (props: ViewProps) => {
    capturedProps = props
    return <div data-testid="appointments-view">VIEW</div>
  },
}))
// Same two seam stubs the sibling thin suites carry (screen-prefetch statically
// imports global-recorder).
jest.mock('@/actions/recordings', () => ({ startRecordingSession: jest.fn() }))
jest.mock('@/lib/karute/take-store', () => ({
  appendTakeSegment: jest.fn(),
  createTake: jest.fn(),
  deleteTake: jest.fn(),
  stampTakeSession: jest.fn(),
}))

jest.mock('../../../thin/data/screen-neighbours', () => ({
  ...jest.requireActual('../../../thin/data/screen-neighbours'),
  warmAppointmentNeighbours: jest.fn(),
  cancelNeighbourWarm: jest.fn(),
}))
jest.mock('@synqed-kk/ui', () => ({
  MonthGrid: ({ cells }: { cells: { id: string; count: number }[] }) => (
    <div data-testid="panel-grid">
      {cells.map((cell) => <span key={cell.id} data-cell={cell.id}>{cell.count}</span>)}
    </div>
  ),
}))

import { act, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { DateJumpPanel } from '@/components/appointments/DateJumpPanel'
import { capacityRowFields, type MonthCell } from '@/lib/adapters/reservation'
import { monthNewCount } from '@/lib/appointments/metric-menu'
import { setDataPort } from '@/lib/ports/data-port'
import { emitRefresh } from '../../../thin/ports/nav.vite'
import { cacheDto, dtoCache, fetchedAtByPath } from '../../../thin/screens/ScreenBoundary'
import { rememberMonthNumbers, clearCalendarNumbers } from '../../../thin/data/calendar-numbers-store'
import * as numbersStore from '../../../thin/data/calendar-numbers-store'
import * as screenBoundary from '../../../thin/screens/ScreenBoundary'
import { clearThinActiveStore, setThinActiveStore } from '../../../thin/chrome/store-pref'
import { setSessionState } from '@/lib/auth/mobile/session-store'
import type { Session } from '@supabase/supabase-js'
import { AppointmentsScreen } from '../../../thin/screens/AppointmentsScreen'

const DTO = {
  view: 'day',
  selectedDateIso: '2026-09-14',
  staffFilter: 'all',
  staff: [],
  activeStaffId: null,
  authProfileId: null,
  customers: [],
  reservationViews: [],
  reservationStaff: [],
  colorRosterIds: [],
  businessHours: { start: 10, end: 19 },
  weekData: null,
  weekStartIso: null,
  monthData: null,
}

const MONTH_CELL = {
  id: '2026-12-01',
  dateIso: new Date('2026-12-01T00:00:00+09:00').toISOString(),
  inMonth: true,
  isToday: false,
  count: 4,
  density: 'medium' as const,
  // ⚖ PKT-2 — the jump panel's door prints no 新規. Passed through untouched,
  // like the capacity fact below.
  newCount: 0,
  // ⚖ R1-2 — and the flag that says whether that 0 is a number anyone may
  // print. Defaulted TRUE on the wire, so a cell from a server that predates
  // the flag reads as known rather than blanking a cell it always showed.
  newCountKnown: true,
  // The capacity fact every month cell now carries. The jump panel's own
  // months read counts only, so they legitimately carry the no-capacity
  // defaults — which is exactly what this door must pass through untouched.
  ...capacityRowFields(undefined),
  // A2 — the 休 fact. Present on the wire so this stays a verbatim round-trip;
  // a server that predates the key is the schema default's job, pinned in
  // appointments-dto-skew.test.ts.
  closed: false,
}

const jsonResponse = (body: unknown, ok = true): Response =>
  ({ ok, status: ok ? 200 : 503, json: async () => body }) as unknown as Response

/** Mount the screen and hand back the loader it injected + the fetch spy. */
async function mountScreen(monthBody: unknown = { ...DTO, view: 'month', monthData: [MONTH_CELL] }) {
  const apiFetch = jest
    .fn<Promise<Response>, [string]>()
    .mockResolvedValueOnce(jsonResponse(DTO)) // the screen's own DTO
    .mockResolvedValue(jsonResponse(monthBody)) // every month read after it
  setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
  const mounted = render(<AppointmentsScreen />)
  await waitFor(() => expect(screen.getByTestId('appointments-view')).toBeTruthy())
  return { apiFetch, load: capturedProps!.loadMonthCells, rerender: mounted.rerender }
}

beforeEach(() => {
  mockPersistCalendarNumbers = undefined
  clearCalendarNumbers()
  setSessionState({ status: 'signed-in', session: { user: { id: 'u1' } } as Session })
  dtoCache.clear()
  fetchedAtByPath.clear()
  window.localStorage.removeItem('karute-active-store')
  history.replaceState({}, '', '/appointments?date=2026-09-14&staff=self')
  capturedProps = null
})

it('asks the screen GET for that month, and carries NO staff param', async () => {
  const { apiFetch, load } = await mountScreen()
  await load('2026-12')

  const monthCall = apiFetch.mock.calls.find((c) => String(c[0]).includes('view=month'))
  expect(monthCall).toBeDefined()
  const url = new URL(String(monthCall![0]), 'https://shell.invalid')
  expect(url.pathname).toBe('/api/app/v1/screens/appointments')
  expect(url.searchParams.get('view')).toBe('month')
  // Any day of the month wanted — the route derives the window from it.
  expect(url.searchParams.get('date')).toBe('2026-12-01')
  // THE POINT: store-wide counts, so no staff scope — not even the one the
  // page's own URL is currently filtered by (?staff=self above).
  expect(url.searchParams.has('staff')).toBe(false)
  expect(String(monthCall![0])).not.toContain('staff')
})

it('returns the month cells verbatim — the DTO shape needs no translation', async () => {
  const { load } = await mountScreen()
  await expect(load('2026-12')).resolves.toEqual([MONTH_CELL])
})

it('hydrates withheld and known new counts onto the screen month cells', async () => {
  // The view is a seam stub here: assert its hydrated props, not the loader's
  // unmodified DTO cells, so dropping the screen's flag copy fails this pin.
  for (const known of [false, true]) {
    dtoCache.clear()
    capturedProps = null
    const cells = [
      { ...MONTH_CELL, newCount: 2, newCountKnown: known },
      {
        ...MONTH_CELL,
        id: '2026-12-02',
        dateIso: new Date('2026-12-02T00:00:00+09:00').toISOString(),
        newCount: 3,
      },
    ]
    setDataPort({
      apiFetch: jest.fn(async () => jsonResponse({ ...DTO, view: 'month', monthData: cells })),
    } as unknown as Parameters<typeof setDataPort>[0])
    const { unmount } = render(<AppointmentsScreen />)
    await waitFor(() => expect(screen.getByTestId('appointments-view')).toBeTruthy())

    const hydrated = capturedProps!.monthData!
    expect(hydrated).toHaveLength(2)
    expect(hydrated[0].newCountKnown).toBe(known)
    expect(hydrated[1].newCountKnown).toBe(true)
    expect(hydrated.map((c) => c.newCount)).toEqual([2, 3])
    expect(hydrated.reduce((sum, c) => sum + c.count, 0)).toBe(8)
    if (known) expect(hydrated.reduce((sum, c) => sum + (c.newCount ?? 0), 0)).toBe(5)
    unmount()
  }
})

it('hydrates an older wire cell without new-count keys as a known zero', async () => {
  const oldCell: Partial<typeof MONTH_CELL> = { ...MONTH_CELL }
  delete oldCell.newCount
  delete oldCell.newCountKnown
  setDataPort({
    apiFetch: jest.fn(async () => jsonResponse({ ...DTO, view: 'month', monthData: [oldCell] })),
  } as unknown as Parameters<typeof setDataPort>[0])
  render(<AppointmentsScreen />)
  await waitFor(() => expect(screen.getByTestId('appointments-view')).toBeTruthy())

  const hydrated = capturedProps!.monthData!
  expect(hydrated).toHaveLength(1)
  expect(hydrated[0].newCountKnown).toBe(true)
  expect(hydrated[0].newCount).toBe(0)
  expect(monthNewCount([hydrated[0]], 'new')).toBe(0)
})

it('THROWS on a failed read rather than reporting an empty month', async () => {
  const { load } = await mountScreen()
  setDataPort({
    apiFetch: jest.fn(async () => jsonResponse({}, false)),
  } as unknown as Parameters<typeof setDataPort>[0])
  await expect(load('2026-12')).rejects.toThrow('503')
})

it('THROWS when the response carries no monthData — never a silently free month', async () => {
  const { load } = await mountScreen({ ...DTO, view: 'month', monthData: null })
  await expect(load('2026-12')).rejects.toThrow('monthData')
})


it('round-trips fixture month cells to the identical rendered toMonthCells output', async () => {
  mockPersistCalendarNumbers = true
  const cells = [MONTH_CELL, {
    ...MONTH_CELL, id: '2026-12-02', dateIso: '2026-12-01T15:00:00.000Z',
    count: 7, newCount: 2, newCountKnown: false, closed: true, isToday: true,
  }]
  const monthDto = { ...DTO, selectedDateIso: '2026-12-01', view: 'month', monthData: cells }
  setDataPort({ apiFetch: jest.fn(async () => jsonResponse(monthDto)) } as unknown as Parameters<typeof setDataPort>[0])
  const mounted = render(<AppointmentsScreen />)
  await waitFor(() => expect(capturedProps?.monthData).toHaveLength(2))
  const before = capturedProps!.monthData
  mounted.unmount()

  rememberMonthNumbers('/api/app/v1/screens/appointments?date=2026-12-01&view=month&locale=ja', cells)
  dtoCache.clear()
  capturedProps = null
  setDataPort({ apiFetch: jest.fn(async () => jsonResponse({ ...DTO, selectedDateIso: '2026-12-01' })) } as unknown as Parameters<typeof setDataPort>[0])
  render(<AppointmentsScreen />)
  await waitFor(() => expect(capturedProps?.monthData).toEqual(before))
  expect(capturedProps!.monthData).toHaveLength(2)
})


function mountPanel() {
  return render(<DateJumpPanel
    open onClose={() => {}} anchorRef={createRef<HTMLDivElement>()}
    selectedDate={new Date('2026-09-14T00:00:00+09:00')}
    seedCells={capturedProps!.monthData} loadMonthCells={capturedProps!.loadMonthCells as Parameters<typeof DateJumpPanel>[0]['loadMonthCells']}
    onPickDay={() => {}} weekdayLabels={['M', 'T', 'W', 'T', 'F', 'S', 'S']}
  />)
}

it('release 28 OFF equals main: cold panel skeleton then network cells despite a stored v2 blob', async () => {
  const path = '/api/app/v1/screens/appointments?date=2026-09-01&view=month&locale=ja'
  const cells = [{ ...MONTH_CELL, id: '2026-09-01', dateIso: '2026-08-31T15:00:00.000Z' }]
  window.localStorage.setItem('karute-calendar-numbers', JSON.stringify({
    v: 2, entries: { [JSON.stringify(['u1', 'all', path])]: { at: 1, monthData: cells } },
  }))
  const { apiFetch } = await mountScreen()
  expect(capturedProps!.monthData).toBeNull()
  let settle!: (response: Response) => void
  apiFetch.mockImplementation(() => new Promise((resolve) => { settle = resolve }))
  mountPanel()
  expect(screen.getByRole('status')).toHaveTextContent('dateJump.loading')
  const skeleton = screen.getAllByTestId('panel-grid')[0]
  expect(skeleton.querySelectorAll('[data-cell]').length).toBeGreaterThanOrEqual(28)
  expect(skeleton).not.toHaveTextContent('4')
  const monthCall = apiFetch.mock.calls.at(-1)![0]
  const url = new URL(monthCall, 'https://shell.invalid')
  expect(url.searchParams.get('view')).toBe('month')
  expect(url.searchParams.get('date')).toBe('2026-09-01')
  expect(url.searchParams.has('staff')).toBe(false)
  await act(async () => { settle(jsonResponse({ ...DTO, view: 'month', monthData: cells })) })
  expect(screen.getByRole('status')).toHaveTextContent('')
  expect(screen.getAllByTestId('panel-grid').some((grid) => grid.textContent === '4')).toBe(true)
})


it.each(['sign-out', 'refresh'] as const)('loader drops a response after %s without changing either cache or the panel', async (event) => {
  // ON makes the durable-cache assertion discriminate even after release 28.
  mockPersistCalendarNumbers = true
  const { apiFetch } = await mountScreen()
  let settle!: (body: unknown) => void
  apiFetch.mockResolvedValueOnce({ ok: true, json: () => new Promise((resolve) => { settle = resolve }) } as Response)
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    mountPanel()
    await act(async () => { await Promise.resolve() })
    const path = apiFetch.mock.calls.at(-1)![0]
    const before = screen.getAllByTestId('panel-grid').map((grid) => grid.textContent)
    expect(screen.getByRole('status')).toHaveTextContent('dateJump.loading')
    // Any mount re-fetch triggered by refresh remains a day DTO, not month data.
    apiFetch.mockResolvedValue(jsonResponse(DTO))
    await act(async () => {
      if (event === 'sign-out') {
        setSessionState({ status: 'signed-out' })
        setSessionState({ status: 'signed-in', session: { user: { id: 'u2' } } as Session })
      } else emitRefresh()
      settle({ ...DTO, view: 'month', monthData: [MONTH_CELL] })
    })
    expect(dtoCache.has(path)).toBe(false)
    expect(fetchedAtByPath.has(path)).toBe(false)
    expect(window.localStorage.getItem('karute-calendar-numbers')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('dateJump.loading')
    expect(screen.getAllByTestId('panel-grid').map((grid) => grid.textContent)).toEqual(before)
    expect(warn).not.toHaveBeenCalled()
  } finally {
    warn.mockRestore()
  }
})

it('switch ON: loader still caches with an intact fence', async () => {
  mockPersistCalendarNumbers = true
  const { apiFetch, load } = await mountScreen()
  await expect(load('2026-12')).resolves.toEqual([MONTH_CELL])
  const path = apiFetch.mock.calls.at(-1)![0]
  expect(dtoCache.get(path)).toEqual(expect.objectContaining({ monthData: [MONTH_CELL] }))
  expect(fetchedAtByPath.has(path)).toBe(true)
  const calls = apiFetch.mock.calls.length
  await expect(load('2026-12')).resolves.toEqual([MONTH_CELL])
  expect(apiFetch).toHaveBeenCalledTimes(calls)
  const raw = window.localStorage.getItem('karute-calendar-numbers')
  expect(raw).toContain(MONTH_CELL.id)
})


const SEPTEMBER_PATH = '/api/app/v1/screens/appointments?date=2026-09-01&view=month&locale=ja'
const SEPTEMBER_CELL = { ...MONTH_CELL, id: '2026-09-01', dateIso: '2026-08-31T15:00:00.000Z' }
const SEPTEMBER_DTO = { ...DTO, view: 'month', monthData: [SEPTEMBER_CELL] }

it('release 28 OFF: opening the same month twice makes two network reads without remembering', async () => {
  const { apiFetch } = await mountScreen(SEPTEMBER_DTO)
  const read = jest.spyOn(numbersStore, 'readMonthNumbers')
  const remember = jest.spyOn(numbersStore, 'rememberMonthNumbers')
  const fence = jest.spyOn(screenBoundary, 'captureCacheFence')
  const write = jest.spyOn(screenBoundary, 'cacheDto')
  try {
    const before = new Map(dtoCache)
    const timestamps = new Map(fetchedAtByPath)
    for (let open = 0; open < 2; open++) {
      const panel = mountPanel()
      await waitFor(() => expect(screen.getAllByTestId('panel-grid').some((grid) => grid.textContent === '4')).toBe(true))
      panel.unmount()
    }
    expect(apiFetch.mock.calls.filter(([path]) => path.includes('view=month') && path.includes('date=2026-09-01'))).toHaveLength(2)
    expect(dtoCache).toEqual(before)
    expect(fetchedAtByPath).toEqual(timestamps)
    expect(read).not.toHaveBeenCalled()
    expect(remember).not.toHaveBeenCalled()
    expect(fence).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
    expect(window.localStorage.getItem('karute-calendar-numbers')).toBeNull()
  } finally {
    read.mockRestore()
    remember.mockRestore()
    fence.mockRestore()
    write.mockRestore()
  }
})

it('release 28 OFF: the real neighbour warm cannot seed or answer the pop-down from its fresh month DTO', async () => {
  const { apiFetch, rerender } = await mountScreen(SEPTEMBER_DTO)
  const neighbours = jest.requireActual<typeof import('../../../thin/data/screen-neighbours')>('../../../thin/data/screen-neighbours')
  const oldMonth = { ...SEPTEMBER_DTO, monthData: [{ ...SEPTEMBER_CELL, count: 37 }] }
  apiFetch.mockResolvedValue(jsonResponse(oldMonth))
  jest.useFakeTimers()
  try {
    neighbours.warmAppointmentNeighbours({
      view: 'day', selectedDate: new Date('2026-09-14T00:00:00+09:00'),
      today: new Date('2026-09-14T00:00:00+09:00'), staff: null, locale: 'ja',
    })
    await act(async () => { await jest.runAllTimersAsync() })
    expect(dtoCache.get(SEPTEMBER_PATH)).toEqual(expect.objectContaining({ monthData: oldMonth.monthData }))
    expect(fetchedAtByPath.has(SEPTEMBER_PATH)).toBe(true)
    expect(window.localStorage.getItem('karute-calendar-numbers')).toBeNull()
  } finally {
    neighbours.cancelNeighbourWarm()
    jest.useRealTimers()
  }
  // Re-render AFTER the actual warm, exercising the non-memoized seed.
  const read = jest.spyOn(numbersStore, 'readMonthNumbers')
  rerender(<AppointmentsScreen />)
  try {
    expect(capturedProps!.monthData).toBeNull()
    expect(read).not.toHaveBeenCalled()
    apiFetch.mockResolvedValue(jsonResponse(SEPTEMBER_DTO))
    const before = apiFetch.mock.calls.length
    mountPanel()
    await waitFor(() => expect(screen.getAllByTestId('panel-grid').some((grid) => grid.textContent === '4')).toBe(true))
    expect(apiFetch.mock.calls.slice(before).filter(([path]) => path.includes('view=month') && path.includes('date=2026-09-01'))).toHaveLength(1)
    expect(screen.getAllByTestId('panel-grid').every((grid) => !grid.textContent?.includes('37'))).toBe(true)
    expect(dtoCache.get(SEPTEMBER_PATH)).toEqual(expect.objectContaining({ monthData: oldMonth.monthData }))
  } finally {
    read.mockRestore()
  }
})

it('release 28 OFF: cached-return then sign-out dispatches no outgoing counts from memory', async () => {
  const { apiFetch } = await mountScreen(SEPTEMBER_DTO)
  cacheDto(SEPTEMBER_PATH, { ...SEPTEMBER_DTO, monthData: [{ ...SEPTEMBER_CELL, count: 37 }] })
  let settle!: (response: Response) => void
  apiFetch.mockImplementation(() => new Promise((resolve) => { settle = resolve }))
  // The real panel calls the loader synchronously; sign-out occurs before
  // a cached-return promise could dispatch its outgoing count of 37.
  mountPanel()
  await act(async () => {
    setSessionState({ status: 'signed-out' })
    setSessionState({ status: 'signed-in', session: { user: { id: 'u2' } } as Session })
  })
  expect(screen.getAllByTestId('panel-grid').every((grid) => !grid.textContent?.includes('37'))).toBe(true)
  expect(screen.getByRole('status')).toHaveTextContent('dateJump.loading')
  expect(apiFetch.mock.calls.filter(([path]) => path.includes('view=month'))).toHaveLength(1)
  await act(async () => { settle(jsonResponse(SEPTEMBER_DTO)) })
  expect(screen.getAllByTestId('panel-grid').some((grid) => grid.textContent === '4')).toBe(true)
})

it('release 28 OFF: a lens change without reload opens with only the next network response', async () => {
  setThinActiveStore('store-A')
  const { apiFetch, rerender } = await mountScreen(SEPTEMBER_DTO)
  const oldMonth = { ...SEPTEMBER_DTO, monthData: [{ ...SEPTEMBER_CELL, count: 37 }] }
  cacheDto(SEPTEMBER_PATH, oldMonth)
  // The facade heal clears the lens; clamped staff need not reseed/refresh.
  clearThinActiveStore('store-A')
  let settle!: (response: Response) => void
  apiFetch.mockImplementation(() => new Promise((resolve) => { settle = resolve }))
  rerender(<AppointmentsScreen />)
  expect(capturedProps!.monthData).toBeNull()
  mountPanel()
  await act(async () => { await Promise.resolve() })
  expect(screen.getAllByTestId('panel-grid').every((grid) => !grid.textContent?.includes('37'))).toBe(true)
  expect(screen.getByRole('status')).toHaveTextContent('dateJump.loading')
  expect(apiFetch.mock.calls.filter(([path]) => path.includes('view=month'))).toHaveLength(1)
  await act(async () => { settle(jsonResponse(SEPTEMBER_DTO)) })
  expect(screen.getAllByTestId('panel-grid').some((grid) => grid.textContent === '4')).toBe(true)
  expect(dtoCache.get(SEPTEMBER_PATH)).toEqual(oldMonth)
})
