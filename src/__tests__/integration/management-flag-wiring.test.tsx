/** @jest-environment jsdom */
/**
 * F-7 (fix round B7, 2026-09-01) — the wiring pins verify report M26/M27/M28
 * name: two one-line JSX prop expressions inside AppointmentsView.tsx (the
 * staff→NewBookingDialog map, and `selfStaffId={props.authProfileId}`) and
 * one inside KaruteRecordListView.tsx (the staffList→NewKaruteDialog map)
 * had zero coverage. All fail open (the picker just stops hiding), so no
 * misfile risk — this is coverage debt on the transport only, not a new
 * rule (StaffCombobox's own hiding/self rules are pinned elsewhere:
 * management-flag-combobox.test.tsx).
 *
 * AppointmentsView / KaruteRecordListView are both heavy 'use client'
 * containers with no existing render-level test (even the thin-screen
 * suites mock AppointmentsView away rather than render it — see
 * thin-appointments-dim.test.tsx). Every dependency besides the dialog
 * under test is stubbed to null so this stays a narrow wiring pin, not a
 * new full-container harness. The dialogs (NewBookingDialog /
 * NewKaruteDialog) are unconditionally present in the JSX regardless of
 * open state, so no click/interaction is needed to observe what they
 * receive — mocking them to capture their props is enough.
 *
 * F1 (fix round 1, 2026-09-01, blind-verify M3d): a THIRD, separate one-line
 * map at AppointmentsView.tsx:330 (staff→ReservationStaffFilter's staffList)
 * had zero coverage too — the mock here returned `() => null` and captured
 * nothing. Deleting that mapping line leaves the full suite green with no
 * red test; it's the 予約 tab's own 担当 filter, distinct from the
 * NewBookingDialog map above. Same capture-mock treatment.
 */
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'ja',
}))
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/ja/appointments',
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/ja/karute',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('@/hooks/use-global-recorder', () => ({
  useGlobalRecorder: () => ({ state: 'idle' }),
}))
jest.mock('@/lib/notifications/hooks', () => ({
  useUnreadCount: () => 0,
}))
jest.mock('@/components/notifications/NotificationsPanel', () => ({
  NotificationsPanel: () => null,
}))
// @synqed-kk/ui ships ESM-only and isn't transformable in this suite (same
// stub every record-* test in this repo uses for it).
jest.mock('@synqed-kk/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require('react') as typeof import('react')
  const passthrough = ({ children, ...rest }: Record<string, unknown> = {}) =>
    createElement('div', rest, children as React.ReactNode)
  return new Proxy({}, { get: () => passthrough })
})
jest.mock('@/components/reservation/ReservationGrid', () => ({ ReservationGrid: () => null }))
jest.mock('@/components/karute/spike-lifted/reservation/ReservationMobileAgenda', () => ({
  ReservationMobileAgenda: () => null,
}))
type ReservationStaffFilterProps = { staffList?: { id: string; isManagement?: boolean }[] } | null
let capturedReservationStaffFilterProps: ReservationStaffFilterProps = null
jest.mock('@/components/karute/spike-lifted/reservation/ReservationStaffFilter', () => ({
  ReservationStaffFilter: (props: unknown) => {
    capturedReservationStaffFilterProps = props as ReservationStaffFilterProps
    return null
  },
}))
jest.mock('@/components/reservation/ReservationTotals', () => ({ ReservationTotals: () => null }))
jest.mock('@/components/appointments/BookingActionSheetWrapper', () => ({
  BookingActionSheetWrapper: () => null,
}))
jest.mock('@/components/appointments/CancelBookingSheet', () => ({ CancelBookingSheet: () => null }))
jest.mock('@/components/customers/redesign/list/CustomersStaffFilter', () => ({
  CustomersStaffFilter: () => null,
}))
jest.mock('@/components/customers/redesign/list/SegmentedFilterBar', () => ({
  SegmentedFilterBar: () => null,
}))
// KaruteRecordListView imports revealNoKaruteCustomer directly (PR-1b 検索
// リビール) — unlike NewKaruteDialog's own @/actions/karute import (inert
// here since NewKaruteDialog itself is mocked below), THIS import runs for
// real because KaruteRecordListView is the component under test. The real
// 'use server' module pulls in next/cache's unstable_cache, which needs a
// DOM API (TextEncoder) this jsdom suite doesn't polyfill — stub the one
// export this render path touches, same narrow-stub convention as every
// other heavy module above.
jest.mock('@/actions/karute', () => ({
  revealNoKaruteCustomer: jest.fn(async () => ({ candidate: null })),
}))

type BookingProps = {
  staff?: { id: string; isManagement?: boolean }[]
  selfStaffId?: string | null
} | null
let capturedBookingProps: BookingProps = null
jest.mock('@/components/appointments/NewBookingDialog', () => ({
  NewBookingDialog: (props: unknown) => {
    capturedBookingProps = props as BookingProps
    return null
  },
}))

type KaruteProps = { staffList?: { id: string; isManagement?: boolean }[] } | null
let capturedKaruteProps: KaruteProps = null
jest.mock('@/components/karute/spike-lifted/list/NewKaruteDialog', () => ({
  NewKaruteDialog: (props: unknown) => {
    capturedKaruteProps = props as KaruteProps
    return null
  },
}))

import { render } from '@testing-library/react'
import { AppointmentsView } from '@/components/appointments/AppointmentsView'
import { KaruteRecordListView } from '@/components/karute/spike-lifted/list/KaruteRecordListView'

const SATO = { id: 'p-sato', name: '佐藤', avatarInitials: 'SA', isManagement: false }
const KITANO = { id: 'p-kitano', name: '北野', avatarInitials: 'KI', isManagement: true }

beforeEach(() => {
  capturedBookingProps = null
  capturedKaruteProps = null
  capturedReservationStaffFilterProps = null
})

describe('AppointmentsView → NewBookingDialog / ReservationStaffFilter wiring (M26, M27, M3d/F1)', () => {
  it('threads authProfileId as selfStaffId and keeps isManagement on every staff row', () => {
    render(
      <AppointmentsView
        staff={[SATO, KITANO]}
        activeStaffId={null}
        authProfileId="auth-1"
        customers={[]}
        locale="ja"
        orgSettings={null}
        initialView="day"
        selectedDateIso="2026-08-18T00:00:00.000Z"
        weekData={null}
        weekStartIso={null}
        monthData={null}
        monthStartIso={null}
        reservationViews={[]}
        reservationStaff={[]}
        colorRosterIds={[]}
        businessHours={{ start: 10, end: 19 }}
        staffFilter="all"
        menus={[]}
      />,
    )
    // M26
    expect(capturedBookingProps?.selfStaffId).toBe('auth-1')
    // M27
    expect(capturedBookingProps?.staff?.find((s) => s.id === KITANO.id)?.isManagement).toBe(true)
    expect(capturedBookingProps?.staff?.find((s) => s.id === SATO.id)?.isManagement).toBe(false)
    // M3d / F1: the SAME AppointmentsView.tsx:330 map feeds ReservationStaffFilter
    // (the 予約 tab's 担当 filter) — a separate line from the NewBookingDialog map
    // above, and until now uncovered because the mock returned null.
    expect(
      capturedReservationStaffFilterProps?.staffList?.find((s) => s.id === KITANO.id)
        ?.isManagement,
    ).toBe(true)
    expect(
      capturedReservationStaffFilterProps?.staffList?.find((s) => s.id === SATO.id)?.isManagement,
    ).toBe(false)
  })
})

describe('KaruteRecordListView → NewKaruteDialog wiring (M28)', () => {
  it('keeps isManagement on every staffList row', () => {
    render(
      <KaruteRecordListView
        items={[]}
        monthCount={0}
        staffList={[
          { id: SATO.id, name: SATO.name, initials: 'SA', isManagement: false },
          { id: KITANO.id, name: KITANO.name, initials: 'KI', isManagement: true },
        ]}
        currentStaffId="auth-1"
        customerOptions={[]}
      />,
    )
    expect(capturedKaruteProps?.staffList?.find((s) => s.id === KITANO.id)?.isManagement).toBe(
      true,
    )
    expect(capturedKaruteProps?.staffList?.find((s) => s.id === SATO.id)?.isManagement).toBe(
      false,
    )
  })
})
