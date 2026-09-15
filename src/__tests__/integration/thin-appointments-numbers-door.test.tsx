/**
 * @jest-environment jsdom
 *
 * The PHONE door for the 予約 numbers (PKT-1b-WIRE W-B/W-C).
 *
 * The week rows and the day line are rendered by the SHARED AppointmentsView,
 * so whatever the web page hands that view, the thin screen has to hand it
 * too — otherwise the phone silently renders `soloMode: false` (no 未設定
 * discriminator) and a null day line while the web page shows both. Both
 * fields already ride the DTO; nothing read them on this door until now, so
 * dropping either one is invisible without this test.
 */
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

type ViewProps = {
  soloMode: boolean
  dayTotals: { dateIso: string; count: number } | null
}
let capturedProps: ViewProps | null = null
jest.mock('@/components/appointments/AppointmentsView', () => ({
  AppointmentsView: (props: ViewProps) => {
    capturedProps = props
    return <div data-testid="appointments-view">VIEW</div>
  },
}))
// The same two seam stubs the sibling thin suites carry (screen-prefetch
// statically imports global-recorder).
jest.mock('@/actions/recordings', () => ({ startRecordingSession: jest.fn() }))
jest.mock('@/lib/karute/take-store', () => ({
  appendTakeSegment: jest.fn(),
  createTake: jest.fn(),
  deleteTake: jest.fn(),
  stampTakeSession: jest.fn(),
}))

import { render, screen, waitFor } from '@testing-library/react'
import { setDataPort } from '@/lib/ports/data-port'
import { dtoCache } from '../../../thin/screens/ScreenBoundary'
import { AppointmentsScreen } from '../../../thin/screens/AppointmentsScreen'

const DAY_ROW = {
  dateNumber: 15,
  monthNumber: 9,
  weekdayLabel: '火',
  isToday: false,
  count: 11,
  bookedMinutes: 270,
  availableMinutes: 480,
  newCustomerCount: 5,
  visibleBookings: [],
  hiddenCount: 0,
  dateIso: '2026-09-15',
  capacityDefensible: true,
  hoursSaved: true,
  closed: false,
  cancelledCount: 1,
  noShowDayCount: 0,
  returningCount: 2,
}

const DTO = {
  view: 'day',
  selectedDateIso: '2026-09-15',
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
  dayTotals: DAY_ROW,
  soloMode: true,
}

const jsonResponse = (body: unknown, ok = true): Response =>
  ({ ok, status: ok ? 200 : 503, json: async () => body }) as unknown as Response

async function mountScreen(body: unknown = DTO) {
  const apiFetch = jest.fn<Promise<Response>, [string]>().mockResolvedValue(jsonResponse(body))
  setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
  render(<AppointmentsScreen />)
  await waitFor(() => expect(screen.getByTestId('appointments-view')).toBeTruthy())
}

beforeEach(() => {
  capturedProps = null
  dtoCache.clear()
})

describe('the thin 予約 door — the numbers reach the shared view', () => {
  it("hands the DTO's soloMode through (W-C)", async () => {
    await mountScreen()
    expect(capturedProps!.soloMode).toBe(true)
  })

  it("hands the DTO's dayTotals through (W-B)", async () => {
    await mountScreen()
    expect(capturedProps!.dayTotals).not.toBeNull()
    expect(capturedProps!.dayTotals!.dateIso).toBe('2026-09-15')
    expect(capturedProps!.dayTotals!.count).toBe(11)
  })

  it('an OLD server that sends neither key degrades to false / null, never undefined', async () => {
    const legacy: Record<string, unknown> = { ...DTO }
    delete legacy.dayTotals
    delete legacy.soloMode
    await mountScreen(legacy)
    expect(capturedProps!.soloMode).toBe(false)
    expect(capturedProps!.dayTotals).toBeNull()
  })
})
