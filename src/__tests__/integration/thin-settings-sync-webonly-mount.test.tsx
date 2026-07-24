/** @jest-environment jsdom */
// Packet 20 §S5 wired-mount pin: the REAL thin settings wiring
// (SettingsScreenInner with its actual PENDING_TAB_IDS/WEB_ONLY_TAB_IDS
// constants, not hand-passed props) on the 同期 tab, resolving every t()
// call against the REAL messages/ja.json — closing the gap between
// settings-shell-pending-tabs.test.tsx (SettingsShell with fabricated prop
// arrays, identity-echo next-intl mock) and thin-pending-tabs-drift.test.ts
// (static source parsing). This is the one place the literal production ja
// copy is pinned against the component's actual key usage
// (useTranslations('settings.sync') + t('webOnly')) — a call-site key typo
// passes the mock-echo tests and i18n-key-parity.test.ts but fails HERE.
//
// next-intl itself ships ESM-only (jest's transformIgnorePatterns can't
// parse it), so like every suite in this directory the module is mocked —
// but unlike the identity-echo idiom, this mock RESOLVES keys against the
// real ja messages and throws on a miss, which is the link under test.
//
// Sections are mocked away as in thin-settings-audit-log-mount.test.tsx
// (their real bodies pull server-only modules that don't run under jsdom).
// SyncSection's mock renders a testid so the negative assertion detects the
// real section leaking through if the webOnlyTabIds intercept ever breaks.
import { fireEvent, render, screen } from '@testing-library/react'

jest.mock('next-intl', () => {
  const messages = jest.requireActual('../../../messages/ja.json')
  const resolve = (path: string): unknown =>
    path.split('.').reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
      messages,
    )
  return {
    useTranslations: (ns?: string) => {
      const t = (key: string) => {
        const path = ns ? `${ns}.${key}` : key
        const value = resolve(path)
        if (typeof value !== 'string') {
          throw new Error(`missing ja message for key: ${path}`)
        }
        return value
      }
      return Object.assign(t, {
        has: (key: string) => typeof resolve(ns ? `${ns}.${key}` : key) === 'string',
      })
    },
    useLocale: () => 'ja',
  }
})

jest.mock('@/components/settings/redesign/sections/OrganizationSection', () => ({
  OrganizationSection: () => null,
}))
jest.mock('@/components/settings/redesign/sections/StoresSection', () => ({
  StoresSection: () => null,
}))
jest.mock('@/components/settings/redesign/sections/ThemeSection', () => ({
  ThemeSection: () => null,
}))
jest.mock('@/components/settings/redesign/sections/AISection', () => ({
  AISection: () => null,
}))
jest.mock('@/components/settings/redesign/sections/CoachingSection', () => ({
  CoachingSection: () => null,
}))
jest.mock('@/components/settings/redesign/sections/RecordingSection', () => ({
  RecordingSection: () => null,
}))
jest.mock('@/components/settings/redesign/sections/StaffSection', () => ({
  StaffSection: () => null,
}))
jest.mock('@/components/settings/redesign/sections/SyncSection', () => ({
  SyncSection: () => <div data-testid="section-sync" />,
}))
jest.mock('@/components/settings/redesign/sections/PacksSection', () => ({
  PacksSection: () => null,
}))
jest.mock('@/components/settings/redesign/sections/AuditLogSection', () => ({
  AuditLogSection: () => null,
}))

import { SettingsScreenInner } from '../../../thin/screens/SettingsScreen'
import type { SettingsScreenDTOType } from '@/lib/app-api/settings-screen-dto'

const dto: SettingsScreenDTOType = {
  orgSettings: null,
  staffList: [],
  activeStaffId: null,
  isOwner: true,
  canViewAllStores: true,
  canManageStaff: true,
  canInviteStaff: true,
  canViewAudit: true,
  // The server-truth DTO can only deep-link 'audit' (settings-screen-dto.ts
  // z.enum) — users reach 同期 by tapping, so this test taps like they do.
  initialTab: null,
  auditTargetId: null,
  initialActiveStoreId: null,
  initialStores: [],
  initialEntitlement: null,
  featureStaffInvites: false,
  featureMultiStore: false,
}

describe('thin settings wiring — page frame (Liam field report 7/24)', () => {
  it('mounts SettingsShell inside the SettingsPageChrome container geometry — dropping the frame ships settings edge-to-edge again', () => {
    const { container } = render(<SettingsScreenInner dto={dto} />)
    const frame = container.firstElementChild as HTMLElement
    // Geometry mirrors src/components/settings/SettingsPageChrome.tsx:13
    // (p-4 is the phone gutter; max-w-5xl/space-y-6 the web rhythm).
    for (const cls of ['mx-auto', 'max-w-5xl', 'space-y-6', 'p-4', 'md:p-6']) {
      expect(frame.classList.contains(cls)).toBe(true)
    }
  })
})

describe('thin settings wiring — 同期 tab web-only carve-out (packet 20 §S5)', () => {
  it('tapping 予約同期 renders the real ja web-only copy through the wired constants, never SyncSection or 準備中', () => {
    render(<SettingsScreenInner dto={dto} />)

    // 予約同期 label appears in both the mobile drill-in list and the desktop
    // tab strip (dual-tree render, documented in
    // settings-shell-pending-tabs.test.tsx) — tapping either selects the tab.
    fireEvent.click(screen.getAllByText('予約同期')[0])

    expect(
      screen.getAllByText('予約同期の設定はWeb版からご利用ください').length,
    ).toBeGreaterThan(0)
    expect(screen.queryByTestId('section-sync')).toBeNull()
    expect(screen.queryByText('この画面は準備中です')).toBeNull()
  })
})
