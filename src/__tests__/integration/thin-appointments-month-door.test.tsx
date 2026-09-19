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
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
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

import { render, screen, waitFor } from '@testing-library/react'
import { capacityRowFields, type MonthCell } from '@/lib/adapters/reservation'
import { monthNewCount } from '@/lib/appointments/metric-menu'
import { setDataPort } from '@/lib/ports/data-port'
import { dtoCache } from '../../../thin/screens/ScreenBoundary'
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
  render(<AppointmentsScreen />)
  await waitFor(() => expect(screen.getByTestId('appointments-view')).toBeTruthy())
  return { apiFetch, load: capturedProps!.loadMonthCells }
}

beforeEach(() => {
  dtoCache.clear()
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
