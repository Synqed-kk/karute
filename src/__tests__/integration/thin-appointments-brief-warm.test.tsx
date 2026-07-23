/**
 * @jest-environment jsdom
 *
 * 予約 screen wiring for the pre-session-brief warmer (perf packet 28): once
 * the DTO settles for TODAY (device-local date), warmBriefsForToday fires
 * with the unique active (non-cancelled, non-no-show) clientIds from
 * reservationViews. Any other date must never call it.
 */
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))
// Screen internals are pinned elsewhere — this suite pins only the brief-warm
// wiring (same isolation precedent as thin-appointments-dim.test.tsx).
jest.mock('@/components/appointments/AppointmentsView', () => ({
  AppointmentsView: () => <div data-testid="appointments-view">VIEW</div>,
}))
jest.mock('../../../thin/data/brief-warm', () => ({
  warmBriefsForToday: jest.fn(),
}))

import { render, screen, waitFor } from '@testing-library/react'
import { setDataPort } from '@/lib/ports/data-port'
import { warmBriefsForToday } from '../../../thin/data/brief-warm'
import { dtoCache } from '../../../thin/screens/ScreenBoundary'
import { AppointmentsScreen } from '../../../thin/screens/AppointmentsScreen'

const baseDto = {
  view: 'day' as const,
  staffFilter: 'all',
  staff: [],
  activeStaffId: null,
  authProfileId: null,
  customers: [],
  reservationStaff: [],
  businessHours: { start: 9, end: 20 },
  weekData: null,
  weekStartIso: null,
  monthData: null,
}

function reservation(clientId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `r-${clientId}`,
    staffId: 's1',
    staffName: 'staff',
    startTimeHm: '10:00',
    durationMin: 60,
    customerName: 'customer',
    customerInitials: 'C',
    karuteNumber: null,
    service: 'cut',
    displayStatus: 'booked',
    isCancelled: false,
    isNoShow: false,
    statusReason: null,
    statusSetByName: null,
    statusSetAt: null,
    staffColorKey: 'blue',
    clientId,
    karuteRecordId: null,
    isFirstTimeVisit: false,
    pack: null,
    needsRenewal: false,
    noShowCount: 0,
    ...overrides,
  }
}

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response
}

function mountWithDto(dto: unknown, path: string) {
  history.replaceState({}, '', path)
  setDataPort({
    apiFetch: jest.fn().mockResolvedValue(jsonResponse(dto)),
  } as unknown as Parameters<typeof setDataPort>[0])
  return render(<AppointmentsScreen />)
}

beforeEach(() => {
  // Device-local "today" (this machine/CI runs Asia/Tokyo — see
  // global-pipeline.ts's identical device-local sessionDate construction).
  jest.useFakeTimers().setSystemTime(new Date('2026-07-23T12:00:00+09:00'))
  dtoCache.clear()
  jest.mocked(warmBriefsForToday).mockClear()
})

afterEach(() => {
  jest.useRealTimers()
})

it("today's settle warms exactly the active clientIds, excluding cancelled/no-show", async () => {
  const dto = {
    ...baseDto,
    selectedDateIso: '2026-07-23',
    reservationViews: [
      reservation('c1'),
      reservation('c2'),
      reservation('c3', { isCancelled: true }),
      reservation('c4', { isNoShow: true }),
    ],
  }
  mountWithDto(dto, '/appointments?date=2026-07-23')
  await waitFor(() => expect(screen.getByTestId('appointments-view')).toBeTruthy())

  expect(warmBriefsForToday).toHaveBeenCalledTimes(1)
  expect(warmBriefsForToday).toHaveBeenCalledWith(['c1', 'c2'])
})

it('a non-today settle never calls the warmer', async () => {
  const dto = {
    ...baseDto,
    selectedDateIso: '2026-07-24',
    reservationViews: [reservation('c1')],
  }
  mountWithDto(dto, '/appointments?date=2026-07-24')
  await waitFor(() => expect(screen.getByTestId('appointments-view')).toBeTruthy())

  expect(warmBriefsForToday).not.toHaveBeenCalled()
})
