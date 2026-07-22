/** @jest-environment jsdom */
// StaffSection — featureStaffInvites `prop ?? env` (design-parity packet 12
// §S4a, T3). thin's process.env is {} (thin/vite.config.ts:125), so reading
// NEXT_PUBLIC_FEATURE_STAFF_INVITES directly always read false in native
// even though it's ON in prod web — this pins the fix: an explicit prop
// wins; when omitted (web, always) the component falls back to the env var
// exactly as before.
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${key}:${JSON.stringify(vals)}` : key,
}))
jest.mock('@/components/staff/StaffList', () => ({
  StaffList: () => <div data-testid="staff-list" />,
}))
jest.mock('@/components/settings/redesign/sections/staff/InviteStaffDialog', () => ({
  InviteStaffDialog: () => <div data-testid="invite-dialog" />,
}))

import { StaffSection } from '@/components/settings/redesign/sections/StaffSection'

const ORIGINAL_ENV = process.env.NEXT_PUBLIC_FEATURE_STAFF_INVITES

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.NEXT_PUBLIC_FEATURE_STAFF_INVITES
  else process.env.NEXT_PUBLIC_FEATURE_STAFF_INVITES = ORIGINAL_ENV
})

describe('StaffSection — featureStaffInvites prop ?? env', () => {
  it('prop=true wins regardless of env → invite dialog renders', () => {
    delete process.env.NEXT_PUBLIC_FEATURE_STAFF_INVITES
    render(
      <StaffSection staffList={[]} activeStaffId={null} canManageStaff canInviteStaff featureStaffInvites />,
    )
    expect(screen.getByTestId('invite-dialog')).toBeTruthy()
  })

  it('prop=false wins over env=true → invite dialog does NOT render', () => {
    process.env.NEXT_PUBLIC_FEATURE_STAFF_INVITES = 'true'
    render(
      <StaffSection
        staffList={[]}
        activeStaffId={null}
        canManageStaff
        canInviteStaff
        featureStaffInvites={false}
      />,
    )
    expect(screen.queryByTestId('invite-dialog')).toBeNull()
  })

  it('prop omitted, env=true → falls back to env, invite dialog renders (web behavior, unchanged)', () => {
    process.env.NEXT_PUBLIC_FEATURE_STAFF_INVITES = 'true'
    render(<StaffSection staffList={[]} activeStaffId={null} canManageStaff canInviteStaff />)
    expect(screen.getByTestId('invite-dialog')).toBeTruthy()
  })

  it('prop omitted, env unset → falls back to env (false), invite dialog does NOT render', () => {
    delete process.env.NEXT_PUBLIC_FEATURE_STAFF_INVITES
    render(<StaffSection staffList={[]} activeStaffId={null} canManageStaff canInviteStaff />)
    expect(screen.queryByTestId('invite-dialog')).toBeNull()
  })

  it('canInviteStaff=false hides the dialog regardless of the flag', () => {
    render(
      <StaffSection
        staffList={[]}
        activeStaffId={null}
        canManageStaff
        canInviteStaff={false}
        featureStaffInvites
      />,
    )
    expect(screen.queryByTestId('invite-dialog')).toBeNull()
  })
})
