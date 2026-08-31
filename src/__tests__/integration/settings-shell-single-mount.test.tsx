/** @jest-environment jsdom */
// SettingsShell mounted BOTH branches at once — the mobile drill-in tree
// (`md:hidden`) and the desktop tab panel (`hidden md:block`) — with CSS
// `display` the only thing separating them. CSS-hidden is still mounted, so
// every section's data-reading effect ran TWICE per settings visit: two
// privacy.audit_log.view rows per 監査ログ open (the 7/22 sim drive's 4-for-2),
// two full 破棄の記録 ledger walks (recordings pages + stores.list + chunked
// customer batches) per 破棄の記録 open, and so on for every other section.
//
// The fix measures the `md` breakpoint after mount and keeps only the visible
// branch in the tree. This file pins the read count at BOTH widths, the live
// swap across the breakpoint, and the deliberate unmeasured fallback (SSR and
// the first client paint still render both, CSS-gated exactly as before, so
// the hydrated tree matches the server HTML).
//
// Section-mock list and the "only the server-action boundary is mocked"
// idiom are lifted from thin-settings-discards-mount.test.tsx — the real
// DiscardReasonsSection stays mounted so the thing being counted is a REAL
// section's real read, not a stand-in.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

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
  rows: [],
  counts: { thisMonth: 0, total: 0, byStaff: [] },
  truncated: false,
}))
jest.mock('@/actions/recording-discards', () => ({
  listDiscardReasons: () => listDiscardReasons(),
  getDiscardTranscript: jest.fn(async () => ({ ok: true, segments: [], durationSeconds: null })),
}))

import { SettingsShell, type SettingsTabId } from '@/components/settings/redesign/SettingsShell'
import type { StaffMember } from '@/lib/staff'
import type { StoreRow } from '@/actions/stores'

// ── controllable matchMedia (jsdom ships none) ───────────────────────────
// `matches` is a GETTER so the MediaQueryList the shell captured in its
// effect reports the CURRENT width when its change handler re-reads it —
// exactly how a real MediaQueryList behaves on a resize.
let wide = false
const changeHandlers = new Set<() => void>()
const askedQueries: string[] = []

function installMatchMedia() {
  window.matchMedia = ((query: string) => {
    askedQueries.push(query)
    return {
      get matches() {
        return wide
      },
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_t: string, fn: () => void) => {
        changeHandlers.add(fn)
      },
      removeEventListener: (_t: string, fn: () => void) => {
        changeHandlers.delete(fn)
      },
      dispatchEvent: () => false,
    }
  }) as unknown as typeof window.matchMedia
}

/** Cross the breakpoint the way the browser does: flip the width, then fire
 *  the `change` listeners the shell registered. */
function crossBreakpointTo(nextWide: boolean) {
  wide = nextWide
  act(() => {
    for (const fn of changeHandlers) fn()
  })
}

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
  menuStores: [] as StoreRow[],
  initialStores: [] as StoreRow[],
  initialActiveStoreId: null,
  initialEntitlement: null,
}

/** Let every pending effect (including a second mount's) land before counting. */
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })

/** next-intl is identity-mocked, so labels render as their own keys. */
const DISCARDS_LABEL = 'discardReasons.label'
const BACK_LABEL = 'backToList'

beforeEach(() => {
  listDiscardReasons.mockClear()
  changeHandlers.clear()
  askedQueries.length = 0
  wide = false
  installMatchMedia()
})

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia
})

describe('SettingsShell — one branch mounted, so opening a section reads once', () => {
  it('desktop width: picking 破棄の記録 from the tab strip reads the ledger ONCE (was twice — the CSS-hidden drill-in read it too)', async () => {
    crossBreakpointTo(true)
    render(<SettingsShell {...baseProps} />)
    await settle()
    // Measured wide: the tab strip is the only branch in the tree.
    expect(screen.queryByText(BACK_LABEL)).toBeNull()
    expect(listDiscardReasons).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText(DISCARDS_LABEL))
    await waitFor(() => {
      expect(listDiscardReasons).toHaveBeenCalled()
    })
    await settle()

    expect(listDiscardReasons).toHaveBeenCalledTimes(1)
  })

  it('phone width: tapping the 破棄の記録 list card reads the ledger ONCE (was twice — the CSS-hidden desktop panel read it too)', async () => {
    render(<SettingsShell {...baseProps} />)
    await settle()
    expect(listDiscardReasons).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText(DISCARDS_LABEL))
    await waitFor(() => {
      expect(listDiscardReasons).toHaveBeenCalled()
    })
    await settle()

    expect(listDiscardReasons).toHaveBeenCalledTimes(1)
    // Phone = the drill-in, complete with its 設定に戻る affordance.
    expect(screen.getByText(BACK_LABEL)).toBeTruthy()
  })

  it('the shell measures the md breakpoint itself — 48rem, Tailwind v4 default (globals.css declares no --breakpoint-md override)', () => {
    render(<SettingsShell {...baseProps} />)
    expect(askedQueries).toContain('(min-width: 48rem)')
  })
})

describe('SettingsShell — crossing the breakpoint swaps branches live', () => {
  it('phone → desktop: the tab strip takes over, the section stays selected, and it mounts exactly once more', async () => {
    render(<SettingsShell {...baseProps} />)
    await settle()
    fireEvent.click(screen.getByText(DISCARDS_LABEL))
    await waitFor(() => {
      expect(listDiscardReasons).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByText(BACK_LABEL)).toBeTruthy()

    listDiscardReasons.mockClear()
    crossBreakpointTo(true)
    await settle()

    // Drill-in gone, tab strip up, 破棄の記録 still the selected tab.
    expect(screen.queryByText(BACK_LABEL)).toBeNull()
    expect(screen.getByText(DISCARDS_LABEL)).toBeTruthy()
    // The new branch's mount reads once — not twice, and not zero.
    expect(listDiscardReasons).toHaveBeenCalledTimes(1)
  })

  it('desktop → phone: the drill-in takes over and keeps the tab the user had open', async () => {
    crossBreakpointTo(true)
    render(<SettingsShell {...baseProps} />)
    await settle()
    // Pick a tab from the desktop strip, then shrink across the breakpoint.
    fireEvent.click(screen.getByText(DISCARDS_LABEL))
    await waitFor(() => {
      expect(listDiscardReasons).toHaveBeenCalledTimes(1)
    })

    crossBreakpointTo(false)
    await settle()

    // Drilled into the SAME section — not bounced back to the list.
    expect(screen.getByText(BACK_LABEL)).toBeTruthy()
    expect(listDiscardReasons).toHaveBeenCalledTimes(2)
  })
})

describe('SettingsShell — the unmeasured window keeps today’s dual render', () => {
  it('with no matchMedia at all (SSR / first paint / non-browser host) BOTH branches render, CSS-gated exactly as before', async () => {
    delete (window as { matchMedia?: unknown }).matchMedia

    const { container } = render(<SettingsShell {...baseProps} />)
    await settle()

    expect(container.querySelector('.md\\:hidden')).not.toBeNull()
    expect(container.querySelector('.hidden.md\\:block')).not.toBeNull()
  })

  it('KNOWN RESIDUAL — a ?tab= deep link still reads twice on its FIRST paint, then settles to one mounted branch', async () => {
    // The measurement is a post-mount effect by design (SSR parity: the first
    // client render must match the server HTML, so both branches are in that
    // render). A deep-linked tab therefore already has its section mounted in
    // BOTH branches when that render commits, and React flushes the children's
    // passive effects before the measurement's re-render — so both reads fire.
    // A useLayoutEffect measurement does NOT change this (probed, same count):
    // React flushes pending passive effects before the sync re-render a layout
    // effect schedules.
    //
    // Everything downstream of that one paint is fixed: every tab the user
    // opens afterwards mounts once (the two tests above), and a non-deep-linked
    // visit never double-mounted in the first place (the mobile branch shows
    // the LIST while the desktop panel shows the first tab).
    crossBreakpointTo(true)
    render(<SettingsShell {...baseProps} initialTab={'discards' as SettingsTabId} />)
    await settle()

    expect(listDiscardReasons).toHaveBeenCalledTimes(2)
    // …and the tree has settled to the desktop branch alone, so the NEXT tab
    // this visitor opens costs one read, not two.
    expect(screen.queryByText(BACK_LABEL)).toBeNull()
  })
})
