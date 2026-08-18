/** @jest-environment jsdom */
// SettingsShell pendingTabIds (design-parity packet 12 §S1): an OPTIONAL
// prop, default/omitted = web output UNCHANGED — every tab renders its real
// section (the pin). The thin caller passes the 4 pending tab ids
// (stores/staff/sync/audit) → THOSE tabs render SettingsShell's own in-shell
// 準備中 panel instead; organization/theme/ai/coaching/recording/packs stay
// live regardless of what's in pendingTabIds.
//
// Also covers webOnlyTabIds (design-parity packet 20 §S5) — same shape as
// pendingTabIds but for tabs that stay permanently web-only (同期): renders
// WebOnlyTabPanel's i18n copy instead of the hardcoded ja 準備中 copy, and
// takes precedence when a tab is listed in BOTH props.
//
// Every section is mocked to isolate the SHELL's own tab-switching/
// pendingTabIds/webOnlyTabIds branches from section internals (their own
// coverage is elsewhere). `initialTab` drives which tab is active on mount —
// both the mobile drill-in view and the desktop tab panel render the SAME
// activeTab simultaneously in jsdom (no CSS media-query collapse), so
// assertions use getAllBy* rather than assuming a single match.
import { render, screen } from '@testing-library/react'

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
jest.mock('@/components/settings/redesign/sections/SyncStatusCard', () => ({
  SyncStatusCard: () => <div data-testid="section-sync-status-card" />,
}))
jest.mock('@/components/settings/redesign/sections/PacksSection', () => ({
  PacksSection: () => <div data-testid="section-packs" />,
}))
jest.mock('@/components/settings/redesign/sections/MenusSection', () => ({
  MenusSection: () => <div data-testid="section-menus" />,
}))
jest.mock('@/components/settings/redesign/sections/AuditLogSection', () => ({
  AuditLogSection: () => <div data-testid="section-audit" />,
}))

import { SettingsShell, type SettingsTabId } from '@/components/settings/redesign/SettingsShell'
import type { StaffMember } from '@/lib/staff'
import type { StoreRow } from '@/actions/stores'

const PENDING_JA = 'この画面は準備中です'

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
  canViewSync: true,
  canManageMenus: true,
  initialMenus: [],
  menuStores: [],
  initialStores: [] as StoreRow[],
  initialActiveStoreId: null,
  initialEntitlement: null,
}

describe('SettingsShell — pendingTabIds (design-parity packet 12 §S1)', () => {
  it('default (prop omitted): every tab renders its real section — web output unchanged', () => {
    render(<SettingsShell {...baseProps} initialTab={'stores' as SettingsTabId} />)
    expect(screen.getAllByTestId('section-stores').length).toBeGreaterThan(0)
    expect(screen.queryByText(PENDING_JA)).toBeNull()
  })

  it('a tab in pendingTabIds renders the 準備中 panel instead of its real section', () => {
    render(
      <SettingsShell
        {...baseProps}
        initialTab={'stores' as SettingsTabId}
        pendingTabIds={['stores', 'staff', 'sync', 'audit']}
      />,
    )
    expect(screen.queryByTestId('section-stores')).toBeNull()
    expect(screen.getAllByText(PENDING_JA).length).toBeGreaterThan(0)
  })

  it.each(['staff', 'sync', 'audit'] as const)(
    '%s also renders the 準備中 panel when pending',
    (tabId) => {
      render(
        <SettingsShell
          {...baseProps}
          initialTab={tabId}
          pendingTabIds={['stores', 'staff', 'sync', 'audit']}
        />,
      )
      expect(screen.queryByTestId(`section-${tabId}`)).toBeNull()
      expect(screen.getAllByText(PENDING_JA).length).toBeGreaterThan(0)
    },
  )

  it.each(['organization', 'theme', 'ai', 'coaching', 'recording', 'packs'] as const)(
    '%s stays LIVE even while stores/staff/sync/audit are pending',
    (tabId) => {
      render(
        <SettingsShell
          {...baseProps}
          initialTab={tabId}
          pendingTabIds={['stores', 'staff', 'sync', 'audit']}
        />,
      )
      expect(screen.getAllByTestId(`section-${tabId}`).length).toBeGreaterThan(0)
      expect(screen.queryByText(PENDING_JA)).toBeNull()
    },
  )
})

describe('SettingsShell — webOnlyTabIds (design-parity packet 20 §S5)', () => {
  const WEB_ONLY_COPY = 'webOnly'

  it('a tab in webOnlyTabIds renders the i18n web-only copy, not 準備中', () => {
    render(
      <SettingsShell {...baseProps} initialTab={'sync' as SettingsTabId} webOnlyTabIds={['sync']} />,
    )
    expect(screen.queryByTestId('section-sync')).toBeNull()
    expect(screen.getAllByText(WEB_ONLY_COPY).length).toBeGreaterThan(0)
    expect(screen.queryByText(PENDING_JA)).toBeNull()
  })

  it('web regression pin: with no webOnlyTabIds prop, sync renders SyncSection exactly as today', () => {
    render(<SettingsShell {...baseProps} initialTab={'sync' as SettingsTabId} />)
    expect(screen.getAllByTestId('section-sync').length).toBeGreaterThan(0)
    expect(screen.queryByText(WEB_ONLY_COPY)).toBeNull()
    expect(screen.queryByText(PENDING_JA)).toBeNull()
  })

  it('precedence pin: a tab in BOTH webOnlyTabIds and pendingTabIds renders the web-only panel, not 準備中', () => {
    render(
      <SettingsShell
        {...baseProps}
        initialTab={'sync' as SettingsTabId}
        webOnlyTabIds={['sync']}
        pendingTabIds={['sync']}
      />,
    )
    expect(screen.queryByTestId('section-sync')).toBeNull()
    expect(screen.getAllByText(WEB_ONLY_COPY).length).toBeGreaterThan(0)
    expect(screen.queryByText(PENDING_JA)).toBeNull()
  })
})

describe('SettingsShell — syncStatus (Liam ruling 7/24, packet 31)', () => {
  const fixtureStatus = { enabled: true, lastRunAt: null, lastRunStatus: null, lastRunError: null }

  it('syncStatus provided → the card renders, WebOnlyTabPanel does NOT, even with sync in webOnlyTabIds', () => {
    render(
      <SettingsShell
        {...baseProps}
        initialTab={'sync' as SettingsTabId}
        webOnlyTabIds={['sync']}
        syncStatus={fixtureStatus}
      />,
    )
    expect(screen.getAllByTestId('section-sync-status-card').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('section-sync')).toBeNull()
    expect(screen.queryByText('webOnly')).toBeNull()
  })

  it('syncStatus null + sync in webOnlyTabIds → the web-only panel (today\'s fallback behavior)', () => {
    render(
      <SettingsShell
        {...baseProps}
        initialTab={'sync' as SettingsTabId}
        webOnlyTabIds={['sync']}
        syncStatus={null}
      />,
    )
    expect(screen.queryByTestId('section-sync-status-card')).toBeNull()
    expect(screen.getAllByText('webOnly').length).toBeGreaterThan(0)
  })

  it('web default (syncStatus prop omitted) → SyncSection renders untouched, no card', () => {
    render(<SettingsShell {...baseProps} initialTab={'sync' as SettingsTabId} />)
    expect(screen.getAllByTestId('section-sync').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('section-sync-status-card')).toBeNull()
  })
})
