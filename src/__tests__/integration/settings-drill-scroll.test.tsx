/** @jest-environment jsdom */
// SettingsShell mobile drill-in scroll reset (field report 7/24): the shell's
// scroll container persists across the list→drill content swap, so tapping a
// card LOW in the settings list opened the section still scrolled down — the
// 設定に戻る back button (top of the drill view) sat above the fold and read
// as missing. DrillInView must open at the top: its mount effect zeroes every
// scrollable ancestor. Section mocks mirror settings-shell-pending-tabs.

import { fireEvent, render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
}))

jest.mock('@/components/settings/redesign/sections/OrganizationSection', () => ({
  OrganizationSection: () => <div data-testid="section-organization" />,
}))
jest.mock('@/components/settings/redesign/sections/StoresSection', () => ({
  StoresSection: () => <div data-testid="section-stores" />,
}))
jest.mock('@/components/settings/redesign/sections/ThemeSection', () => ({
  ThemeSection: () => <div data-testid="section-theme" />,
}))
jest.mock('@/components/settings/redesign/sections/AISection', () => ({
  AISection: () => <div data-testid="section-ai" />,
}))
jest.mock('@/components/settings/redesign/sections/CoachingSection', () => ({
  CoachingSection: () => <div data-testid="section-coaching" />,
}))
jest.mock('@/components/settings/redesign/sections/RecordingSection', () => ({
  RecordingSection: () => <div data-testid="section-recording" />,
}))
jest.mock('@/components/settings/redesign/sections/StaffSection', () => ({
  StaffSection: () => <div data-testid="section-staff" />,
}))
jest.mock('@/components/settings/redesign/sections/SyncSection', () => ({
  SyncSection: () => <div data-testid="section-sync" />,
}))
jest.mock('@/components/settings/redesign/sections/PacksSection', () => ({
  PacksSection: () => <div data-testid="section-packs" />,
}))
jest.mock('@/components/settings/redesign/sections/AuditLogSection', () => ({
  AuditLogSection: () => <div data-testid="section-audit" />,
}))

import { SettingsShell, type SettingsTabId } from '@/components/settings/redesign/SettingsShell'
import type { StaffMember } from '@/lib/staff'
import type { StoreRow } from '@/actions/stores'

const baseProps = {
  orgSettings: null,
  staffList: [] as StaffMember[],
  activeStaffId: null,
  locale: 'ja',
  isOwner: true,
  canViewAllStores: true,
  canManageStaff: true,
  canInviteStaff: true,
  canViewAudit: true,
  initialStores: [] as StoreRow[],
  initialActiveStoreId: null,
  initialEntitlement: null,
}

describe('SettingsShell — drill-in opens at the top (7/24 back-button field report)', () => {
  it('tapping a list card resets the scrolled container so 設定に戻る is visible', () => {
    const { container } = render(<SettingsShell {...baseProps} />)
    // Simulate the list scrolled down (jsdom has no layout — scrollTop is a
    // plain settable property, exactly what the effect zeroes).
    container.scrollTop = 250
    // Mobile list card and desktop tab chip both render the label in jsdom
    // (no media-query collapse) — the list card is first in DOM order.
    fireEvent.click(screen.getAllByText('organization')[0])
    expect(screen.getAllByTestId('section-organization').length).toBeGreaterThan(0)
    expect(container.scrollTop).toBe(0)
  })

  it('desktop tab switch (drill view stays mounted) also resets — no inherited offset', () => {
    const { container } = render(
      <SettingsShell {...baseProps} initialTab={'organization' as SettingsTabId} />,
    )
    // Drilled: the mobile list is unmounted, so 'theme.label' matches only
    // the desktop tab chip. The CSS-hidden DrillInView stays MOUNTED across
    // desktop tab switches — the reset must re-run per section change, not
    // only on mount (Greptile #595 finding).
    container.scrollTop = 250
    fireEvent.click(screen.getAllByText('theme.label')[0])
    expect(screen.getAllByTestId('section-theme').length).toBeGreaterThan(0)
    expect(container.scrollTop).toBe(0)
  })

  it('a drill mounted directly via initialTab (deep link) also opens at the top', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    container.scrollTop = 250
    render(<SettingsShell {...baseProps} initialTab={'sync' as SettingsTabId} />, {
      container,
    })
    expect(container.scrollTop).toBe(0)
    document.body.removeChild(container)
  })
})
