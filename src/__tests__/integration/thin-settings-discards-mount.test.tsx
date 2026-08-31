/** @jest-environment jsdom */
// 破棄の記録 on the PHONE — the tab is LIVE (phone-facade packet). This is the
// real-render proof that killing its 準備中 actually delivered the section:
// mounting the thin settings wiring on the discards tab must render the REAL
// DiscardReasonsSection and fire its list read, not the placeholder panel.
//
// Same idiom as thin-settings-audit-log-mount.test.tsx: every OTHER section is
// mocked away (their real bodies pull server-only modules that don't run under
// jsdom), the section under test stays REAL, and only the server-action
// boundary (@/actions/recording-discards — the module the vite boundary swaps
// for thin/ports/actions.vite.ts in the real bundle) is mocked.
//
// The three-way bundle pairing that had to move with this (PENDING_TAB_IDS ⋄
// PENDING_SECTION_FILES ⋄ pending-sections-excluded.tsx) has its own guard in
// thin-pending-tabs-drift.test.ts; this file pins the RENDER.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => Object.assign((k: string) => k, { has: () => false }),
  useLocale: () => 'ja',
}))

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
jest.mock('@/components/settings/redesign/sections/AuditLogSection', () => ({
  AuditLogSection: () => null,
}))

const listDiscardReasons = jest.fn(async () => ({
  ok: true as const,
  rows: [
    {
      id: 'row-1',
      recordingSessionId: 'rs-1',
      createdAt: '2026-08-31T02:00:00.000Z',
      staffId: 'card-A',
      staffName: '原 奏恵',
      reason: 'お客様が席を外したため録り直します',
    },
  ],
  counts: {
    thisMonth: 1,
    total: 1,
    byStaff: [{ staffId: 'card-A', staffName: '原 奏恵', thisMonth: 1 }],
  },
  truncated: false,
}))
jest.mock('@/actions/recording-discards', () => ({
  listDiscardReasons: () => listDiscardReasons(),
  getDiscardTranscript: jest.fn(async () => ({ ok: true, segments: [], durationSeconds: null })),
}))

import { SettingsScreenInner } from '../../../thin/screens/SettingsScreen'
import { SettingsShell, type SettingsTabId } from '@/components/settings/redesign/SettingsShell'
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
  canManageMenus: false,
  syncStatus: null,
  // The DTO's initialTab is deliberately narrower than SettingsTabId ('audit'
  // is the only ?tab= value the web page derives), so the discards tab is
  // reached the way a manager reaches it: by opening it.
  initialTab: null,
  auditTargetId: null,
  initialActiveStoreId: null,
  initialStores: [],
  initialEntitlement: null,
  featureStaffInvites: false,
  featureMultiStore: false,
  serviceNoun: '施術',
}

/** next-intl is mocked to the identity function, so a tab's label renders as
 *  its own key. TABS' discards entry uses `discardReasons.label` (the i18n
 *  collision idiom — `settings.discardReasons` is an object). */
const TAB_LABEL = 'discardReasons.label'

describe('thin settings wiring — 破棄の記録 tab is live on the phone', () => {
  beforeEach(() => {
    listDiscardReasons.mockClear()
  })

  it('opening the tab renders the REAL section and reads the ledger — no 準備中 placeholder', async () => {
    render(<SettingsScreenInner dto={dto} />)

    // Both the mobile list and the desktop tab strip render the label in
    // jsdom (SettingsShell's deliberate dual tree, shared with web) — either
    // entry point sets the same activeTab.
    //
    // That same dual tree also MOUNTS the section twice here (mobile drill-in
    // + desktop panel), so the ledger is read twice per open — pre-existing
    // SettingsShell behavior shared with web, not thin wiring, and pinned as
    // such on the 監査ログ tab (thin-settings-audit-log-mount.test.tsx). No
    // count is asserted here on purpose: one pin for the shell class is
    // enough, and this file is about the RENDER. Harmless on this screen —
    // both reads are GETs and neither writes an audit row.
    fireEvent.click(screen.getAllByText(TAB_LABEL)[0])

    await waitFor(() => {
      expect(listDiscardReasons).toHaveBeenCalled()
    })

    // The written reason a manager came here to read is on the screen.
    expect(await screen.findAllByText('お客様が席を外したため録り直します')).not.toHaveLength(0)
    // PendingTabPanel's hardcoded ja copy — the thing this build deleted.
    expect(screen.queryByText('この画面は準備中です')).toBeNull()
  })

  it('a viewer WITHOUT staff.manage is never offered the tab, and nothing reads the ledger', async () => {
    render(<SettingsScreenInner dto={{ ...dto, canManageStaff: false }} />)

    expect(screen.queryAllByText(TAB_LABEL)).toHaveLength(0)
    // No waitFor to assert an absence — give any stray mount's effect a tick.
    await new Promise((r) => setTimeout(r, 0))
    expect(listDiscardReasons).not.toHaveBeenCalled()
  })

  it('…and the shell\'s own render gate holds even with the tab ALREADY active — defense in depth, not just a hidden tab', async () => {
    // The tab filter is what the test above pins. This pins the OTHER half:
    // SettingsShell's `canManageStaff ? <DiscardReasonsSection/> : null`. The
    // gate is reachable because activeTab is set independently of the filtered
    // tab list (a deep link, a stale ?tab=, a capability lost between paint
    // and click), and deleting the guard would render the section — and read
    // the ledger — for a staffer who may not see it. Mounted on the shell
    // directly: the thin DTO's initialTab is deliberately narrower than
    // SettingsTabId, so 'discards' cannot be reached through SettingsScreen.
    render(
      <SettingsShell
        orgSettings={null}
        staffList={[]}
        activeStaffId={null}
        locale="ja"
        isOwner={false}
        canViewAllStores={false}
        canManageStaff={false}
        canInviteStaff={false}
        canViewAudit={false}
        canViewSync={false}
        canManageMenus={false}
        initialTab={'discards' as SettingsTabId}
        initialStores={[]}
        menuStores={[]}
        initialActiveStoreId={null}
        initialMenus={[]}
        initialEntitlement={null}
      />,
    )

    await new Promise((r) => setTimeout(r, 0))
    expect(listDiscardReasons).not.toHaveBeenCalled()
    expect(screen.queryByText('お客様が席を外したため録り直します')).toBeNull()
  })
})
