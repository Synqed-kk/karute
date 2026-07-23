/**
 * @jest-environment jsdom
 *
 * 予約 pending-dim SCOPE (Liam field report 7/23): the dim + input block must
 * cover ONLY a cross-path fetch — date/view/filter nav where the rendered dto
 * is still the OLD day and misreading it is the real hazard. A SAME-path
 * background revalidate (the packet-24 cache's revisit refresh, or a
 * post-mutation refresh) must keep the screen fully interactive — the
 * pre-fix wiring dimmed and input-blocked every 予約 revisit for the whole
 * network round trip.
 */
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))
// Screen internals are pinned elsewhere (app-api-screens-appointments) — this
// suite pins the WRAPPER's dim derivation only.
jest.mock('@/components/appointments/AppointmentsView', () => ({
  AppointmentsView: () => <div data-testid="appointments-view">VIEW</div>,
}))

import { act, render, screen, waitFor } from '@testing-library/react'
import { setDataPort } from '@/lib/ports/data-port'
import { emitRefresh, redirect } from '../../../thin/ports/nav.vite'
import { dtoCache } from '../../../thin/screens/ScreenBoundary'
import { AppointmentsScreen } from '../../../thin/screens/AppointmentsScreen'

// Minimal valid empty-day DTO — validated by the screen's own zod parse, so
// schema drift fails loudly here rather than rendering garbage.
const DTO = {
  view: 'day',
  selectedDateIso: '2026-07-23',
  staffFilter: 'all',
  staff: [],
  activeStaffId: null,
  authProfileId: null,
  customers: [],
  reservationViews: [],
  reservationStaff: [],
  businessHours: { start: 9, end: 20 },
  weekData: null,
  weekStartIso: null,
  monthData: null,
}

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response
}

const dimmed = (container: HTMLElement) =>
  container.querySelector('[aria-busy="true"]') !== null

beforeEach(() => {
  dtoCache.clear()
  history.replaceState({}, '', '/appointments?date=2026-07-23')
})

it('same-path background revalidate does NOT dim or input-block the screen', async () => {
  let resolveSecond: (r: Response) => void = () => {}
  const apiFetch = jest
    .fn<Promise<Response>, unknown[]>()
    .mockResolvedValueOnce(jsonResponse(DTO))
    .mockImplementationOnce(() => new Promise<Response>((res) => (resolveSecond = res)))
  setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

  const { container } = render(<AppointmentsScreen />)
  await waitFor(() => expect(screen.getByTestId('appointments-view')).toBeTruthy())
  expect(dimmed(container)).toBe(false)

  // Post-mutation / revisit revalidate: SAME path, fetch #2 in flight.
  act(() => emitRefresh())
  expect(apiFetch).toHaveBeenCalledTimes(2)
  // THE pin: content stays fully interactive during the same-path refetch —
  // the pre-fix `fetching`-keyed wiring fails exactly here.
  expect(dimmed(container)).toBe(false)
  expect(container.querySelector('.pointer-events-none')).toBeNull()

  await act(async () => resolveSecond(jsonResponse(DTO)))
})

it('cross-path date-nav DOES dim + block while the new day fetches', async () => {
  const apiFetch = jest
    .fn<Promise<Response>, unknown[]>()
    .mockResolvedValueOnce(jsonResponse(DTO))
    .mockImplementationOnce(() => new Promise<Response>(() => {}))
  setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

  const { container } = render(<AppointmentsScreen />)
  await waitFor(() => expect(screen.getByTestId('appointments-view')).toBeTruthy())

  // In-place date nav: the rendered dto is still the OLD day — misreading
  // hazard, the dim must stay.
  act(() => redirect('/appointments?date=2026-07-24'))
  await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2))
  expect(dimmed(container)).toBe(true)
  expect(container.querySelector('.pointer-events-none')).not.toBeNull()
})
