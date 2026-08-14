/** @jest-environment jsdom */
// T4 investigation (packet 18): sim drive 7/22 observed 4 privacy.audit_log_view
// rows for ~2 opens of the 監査ログ tab. Reproduces the thin settings wiring's
// REAL mount of AuditLogSection (unlike settings-shell-pending-tabs.test.tsx,
// which mocks every section away) — mocking only the server-action boundary
// (@/actions/audit-log), the same seam audit-log-action.test.ts mocks.
//
// Verdict: the dupe is PRE-EXISTING WEB behavior, not thin wiring. SettingsShell
// renders BOTH the mobile drill-in tree AND the desktop tab-panel tree at once —
// CSS (`md:hidden` / `hidden md:block`) only hides one visually; jsdom (and any
// real browser) mounts both. settings-shell-pending-tabs.test.tsx already
// documents this ("both the mobile drill-in view and the desktop tab panel
// render the SAME activeTab simultaneously in jsdom, no CSS media-query
// collapse"). Post-PR-M1 (contract §3.1): the client-gated logOpen flag is
// gone — every listAuditLog call now writes its own privacy.audit_log.view
// row unconditionally, so each independently-mounted AuditLogSection's first
// fetch still means two rows per open, matching the sim drive's 4-for-2 (2
// mounts today; a load-more would add MORE rows now, not zero — the
// unconditional write is the whole point of the contract change). Per the
// packet: do NOT change SettingsShell (its dual-tree render is deliberate,
// tested, shared with web) — this test PINS today's actual mount/fetch count.
import { render, waitFor } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => Object.assign((k: string) => k, { has: () => false }),
  useLocale: () => 'ja',
}))

// Every OTHER section mocked away (same list + reasoning as
// settings-shell-pending-tabs.test.tsx): their real bodies pull in
// server-only modules (e.g. next/cache via org-settings.ts) that don't run
// under jsdom. AuditLogSection stays REAL — it's the one under
// investigation. None of these render anyway (desktopActiveTab and the
// mobile drill-in both stay on 'audit' for the whole test — no tab clicks).
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
  SyncSection: () => null,
}))
jest.mock('@/components/settings/redesign/sections/MenusSection', () => ({
  MenusSection: () => null,
}))
jest.mock('@/components/settings/redesign/sections/PacksSection', () => ({
  PacksSection: () => null,
}))

const listAuditLog = jest.fn(async (_filters: Record<string, unknown>) => ({
  ok: true as const,
  events: [],
  total: 0,
  page: 1,
  hasMore: false,
  breakGlassTotal: 0,
  warningsTotal: 0,
  changesTotal: 0,
  targetLabels: {},
}))
jest.mock('@/actions/audit-log', () => ({
  listAuditLog: (filters: Record<string, unknown>) => listAuditLog(filters),
}))
// AuditLogSection imports listEntryEditHistory (edit-row expansion) — mock the
// actions module so the real 'use server' file never loads into jsdom (it
// drags Next server internals in; failure is load-order-dependent).
jest.mock('@/actions/karute', () => ({
  listEntryEditHistory: jest.fn(async () => ({ edits: [], truncated: false })),
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
  canViewSync: true,
  // false keeps this fixture's rendered tab set unchanged — the メニュー tab
  // has its own pin in thin-settings-sync-webonly-mount.test.tsx.
  canManageMenus: false,
  syncStatus: null,
  initialTab: 'audit',
  auditTargetId: null,
  initialActiveStoreId: null,
  initialStores: [],
  initialEntitlement: null,
  featureStaffInvites: false,
  featureMultiStore: false,
}

describe('thin settings wiring — 監査ログ tab mount (packet 18 T4)', () => {
  beforeEach(() => {
    listAuditLog.mockClear()
  })

  it('today: mounts AuditLogSection twice (mobile drill-in + desktop panel) and fires listAuditLog twice, each writing its own row — pin, not a fix (pre-existing SettingsShell dual-tree render, shared with web)', async () => {
    render(<SettingsScreenInner dto={dto} />)

    await waitFor(() => {
      expect(listAuditLog).toHaveBeenCalled()
    })

    expect(listAuditLog).toHaveBeenCalledTimes(2)
  })
})
