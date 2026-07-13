/**
 * @jest-environment jsdom
 *
 * Render coverage for the staff-limit wall (P4). Two contracts:
 *   1. DISARMED / no cap (staffCap null): the header renders EXACTLY the
 *      pre-wall surface — plain count suffix, enabled add button, no hint.
 *      This is the production-safety promise while billing is off.
 *   2. ARMED at the limit: N/M meter + amber hint + disabled add button.
 * next-intl is mocked key-echo style (matches subscription-summary-card).
 */
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${key}:${JSON.stringify(vals)}` : key,
  useLocale: () => 'ja',
}))

// StaffList's action/dialog imports pull server-only chains — stub the
// boundaries; this test only exercises the header cap UI.
jest.mock('@/actions/staff', () => ({
  deleteStaff: jest.fn(),
  uploadStaffAvatar: jest.fn(),
}))
jest.mock('@/actions/voice', () => ({
  revokeVoiceAction: jest.fn(),
}))
jest.mock('@/components/staff/StaffForm', () => ({
  StaffForm: () => null,
}))
jest.mock('@/components/staff/PinSetup', () => ({
  PinSetup: () => null,
}))
jest.mock('@/components/staff/VoiceEnrollmentDialog', () => ({
  VoiceEnrollmentDialog: () => null,
}))
jest.mock('@/components/coaching/redesign/StaffConsentStatusBadge', () => ({
  StaffConsentStatusBadge: () => null,
}))

import { StaffList } from '@/components/staff/StaffList'

const staff = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    full_name: `スタッフ${i}`,
    created_at: '2026-01-01T00:00:00Z',
  }))

describe('staff-limit wall', () => {
  it('no cap (disarmed / unlimited): original surface, enabled button, no hint', () => {
    render(
      <StaffList
        staffList={staff(2)}
        activeStaffId="s0"
        canManageStaff
        staffCap={null}
      />,
    )
    expect(screen.getByText('staffCountSuffix:{"n":2}')).toBeTruthy()
    expect(screen.queryByText(/staffLimitHint/)).toBeNull()
    expect(screen.queryByText(/staffCountWithLimit/)).toBeNull()
    const add = screen.getByRole('button', { name: /add/ })
    expect(add.hasAttribute('disabled')).toBe(false)
  })

  it('armed below the limit: N/M meter, enabled button, no hint', () => {
    render(
      <StaffList
        staffList={staff(1)}
        activeStaffId="s0"
        canManageStaff
        staffCap={{ limit: 2, atLimit: false }}
      />,
    )
    expect(screen.getByText('staffCountWithLimit:{"n":1,"limit":2}')).toBeTruthy()
    expect(screen.queryByText(/staffLimitHint/)).toBeNull()
    const add = screen.getByRole('button', { name: /add/ })
    expect(add.hasAttribute('disabled')).toBe(false)
  })

  it('armed at the limit: meter + hint + disabled add button', () => {
    render(
      <StaffList
        staffList={staff(2)}
        activeStaffId="s0"
        canManageStaff
        staffCap={{ limit: 2, atLimit: true }}
      />,
    )
    expect(screen.getByText('staffCountWithLimit:{"n":2,"limit":2}')).toBeTruthy()
    expect(screen.getAllByText(/staffLimitHint/).length).toBeGreaterThan(0)
    const add = screen.getByRole('button', { name: /add/ })
    expect(add.hasAttribute('disabled')).toBe(true)
  })

  it('cap UI never renders for non-managers even at the limit', () => {
    render(
      <StaffList
        staffList={staff(2)}
        activeStaffId="s0"
        canManageStaff={false}
        staffCap={{ limit: 2, atLimit: true }}
      />,
    )
    expect(screen.queryByText(/staffLimitHint/)).toBeNull()
    expect(screen.queryByRole('button', { name: /add/ })).toBeNull()
  })
})
