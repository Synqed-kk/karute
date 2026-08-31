/** @jest-environment jsdom */
// SettingsShell mobile drill-in scroll reset (field report 7/24): the shell's
// scroll container persists across the list→drill content swap, so tapping a
// card LOW in the settings list opened the section still scrolled down — the
// 設定に戻る back button (top of the drill view) sat above the fold and read
// as missing. A section must open at the top.
//
// The reset lives in ONE place: the shell's ONE SCROLL-RESET AUTHORITY effect,
// keyed on the section the user navigated to. DrillInView used to carry its own
// ancestor-zeroing copy; that is DELETED (its mount fired on a breakpoint
// crossing and reset readers who had navigated nowhere), and the "FIRST
// ≥md→<md crossing … PRESERVES scroll" case below asserts exactly that it no
// longer happens. Section mocks mirror settings-shell-pending-tabs.

import { act, fireEvent, render, screen } from '@testing-library/react'

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
jest.mock('@/components/settings/redesign/sections/MenusSection', () => ({
  MenusSection: () => <div data-testid="section-menus" />,
}))
jest.mock('@/components/settings/redesign/sections/AuditLogSection', () => ({
  AuditLogSection: () => <div data-testid="section-audit" />,
}))
jest.mock('@/components/settings/redesign/sections/DiscardReasonsSection', () => ({
  DiscardReasonsSection: () => null,
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
  canViewSync: true,
  canManageMenus: true,
  initialMenus: [],
  menuStores: [],
  initialStores: [] as StoreRow[],
  initialActiveStoreId: null,
  initialEntitlement: null,
}

/** jsdom ships no matchMedia, so the shell stays UNMEASURED (both branches) by
 *  default in this file — which is what tests 1 and 3 want. The desktop case
 *  installs one that reports a fixed width, so the shell measures and keeps
 *  only the desktop branch. */
function installMatchMedia(wide: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: wide,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

/** A matchMedia that can CROSS the breakpoint, so a rotation can be simulated:
 *  flip the width, then fire the `change` listeners the shell registered. */
function installCrossableMatchMedia(startWide: boolean) {
  let wide = startWide
  const handlers = new Set<() => void>()
  window.matchMedia = ((query: string) => ({
    get matches() {
      return wide
    },
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_t: string, fn: () => void) => void handlers.add(fn),
    removeEventListener: (_t: string, fn: () => void) => void handlers.delete(fn),
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  return (next: boolean) => {
    wide = next
    act(() => {
      for (const fn of handlers) fn()
    })
  }
}

/** Render into a container that is ALREADY scrolled, the way arriving from a
 *  scrolled route leaves the persistent scroll container. */
function renderInScrolledContainer(ui: React.ReactElement, offset = 250) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  container.scrollTop = offset
  const view = render(ui, { container })
  return { container, view }
}

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia
})

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

  it('desktop tab switch resets even with the mobile branch GONE — the shell owns the reset, it no longer rides on a hidden DrillInView', () => {
    // This case used to be vacuous. jsdom ships no matchMedia, so the shell
    // stayed unmeasured, kept BOTH branches, and the CSS-hidden DrillInView's
    // own layout effect did the zeroing — the test passed without the shell
    // ever having a reset of its own, and kept passing after the single-mount
    // change dropped that branch on real desktops (where a tab picked while
    // scrolled down opened mid-page, scrollTop 250). Measure DESKTOP here, so
    // the mobile branch is genuinely absent and only the shell's explicit
    // reset can satisfy it.
    installMatchMedia(true)
    const { container } = render(
      <SettingsShell {...baseProps} initialTab={'organization' as SettingsTabId} />,
    )
    // Measured wide: the drill-in branch (and its layout effect) is not in the
    // tree at all.
    expect(screen.queryByText('backToList')).toBeNull()

    container.scrollTop = 250
    fireEvent.click(screen.getAllByText('theme.label')[0])
    expect(screen.getAllByTestId('section-theme').length).toBeGreaterThan(0)
    expect(container.scrollTop).toBe(0)
  })

  it('a drill mounted directly via initialTab (deep link) also opens at the top', () => {
    const { container } = renderInScrolledContainer(
      <SettingsShell {...baseProps} initialTab={'sync' as SettingsTabId} />,
    )
    expect(container.scrollTop).toBe(0)
    document.body.removeChild(container)
  })
})

// ─────────────────────────────────────────────────────────────
// Only a SECTION CHANGE may move the reader (round-3 verifier finding)
// ─────────────────────────────────────────────────────────────
describe('SettingsShell — a rotation is not a tab change, so it must not move the reader', () => {
  it('ROTATION with the tab unchanged PRESERVES scroll — the reset is keyed on the section, not on the width', () => {
    // The defect: `isWide` sits in the reset effect's deps for the `md` guard,
    // so a phone rotating to landscape (isWide false→true) re-ran the effect
    // and zeroed the position of whoever was mid-read. Probed at scrollTop 480
    // → 0 going portrait→landscape, while the reverse (→ false, early return)
    // kept it — a reader losing their place on one rotation direction only.
    const crossTo = installCrossableMatchMedia(false)
    const { container } = render(<SettingsShell {...baseProps} />)
    // Measured phone: drill into a section from the list.
    fireEvent.click(screen.getAllByText('theme.label')[0])
    expect(screen.getAllByTestId('section-theme').length).toBeGreaterThan(0)

    // The reader scrolls down inside that section.
    container.scrollTop = 480

    // Rotate to landscape — crosses 48rem, no tab change.
    crossTo(true)
    expect(container.scrollTop).toBe(480)

    // …and back. Neither direction moves them.
    crossTo(false)
    expect(container.scrollTop).toBe(480)
  })

  it('rotating UP off a scrolled LIST carries the offset onto the desktop view — only the user\'s own navigation moves the page', () => {
    // The user navigated nowhere, so the page must not move.
    //
    // This case does NOT discriminate `activeTab` from `desktopActiveTab` —
    // off the list `activeTab` stays null and `desktopActiveTab` stays
    // 'organization' on both sides of the crossing, so neither key resets here.
    // (An earlier comment claimed otherwise; it was wrong. The transition that
    // actually separates the two keys is the mobile drill-in null→'organization',
    // pinned by the first test in this file and by the first-click case below.)
    // What this pins is the width-independence itself: a crossing is never
    // navigation, whichever way it goes.
    const crossTo = installCrossableMatchMedia(false)
    const { container } = render(<SettingsShell {...baseProps} />)
    // On the list (no section drilled into), scrolled well down it.
    expect(screen.queryByText('backToList')).toBeNull()
    container.scrollTop = 600

    crossTo(true)
    expect(container.scrollTop).toBe(600)
  })

  it('a real tab change still resets, even right after a rotation (the ref must not latch the reset away)', () => {
    const crossTo = installCrossableMatchMedia(false)
    const { container } = render(<SettingsShell {...baseProps} />)
    fireEvent.click(screen.getAllByText('theme.label')[0])

    container.scrollTop = 480
    crossTo(true)
    expect(container.scrollTop).toBe(480)

    // Now on the desktop strip, pick a DIFFERENT tab: that is a section change,
    // so it opens at the top.
    fireEvent.click(screen.getAllByText('organization')[0])
    expect(screen.getAllByTestId('section-organization').length).toBeGreaterThan(0)
    expect(container.scrollTop).toBe(0)
  })

  it('FIRST ≥md→<md crossing with a section open PRESERVES scroll — the crossing mounts the mobile branch, and that mount must not reset', () => {
    // The round-3 hole. The shell's own guard wrote nothing here, but the
    // down-crossing MOUNTS the mobile branch, and DrillInView carried its own
    // ancestor-zeroing layout effect that fired on mount. Probed: the FIRST
    // down-crossing wrote 0, the second preserved (by then `crossed` has
    // latched, both branches are already mounted, nothing remounts) — a reader
    // losing their place exactly once, which is the hardest kind to report.
    // One owner now, so there is no second writer to fire.
    const crossTo = installCrossableMatchMedia(true)
    const { container } = render(<SettingsShell {...baseProps} />)
    // Desktop: pick a section from the tab strip, then read down into it.
    fireEvent.click(screen.getAllByText('theme.label')[0])
    expect(screen.getAllByTestId('section-theme').length).toBeGreaterThan(0)
    container.scrollTop = 480

    crossTo(false) // ≥md → <md, the first crossing: mounts the mobile branch
    expect(screen.getAllByText('backToList').length).toBeGreaterThan(0)
    expect(container.scrollTop).toBe(480)

    crossTo(true) // and the second crossing, which never had the defect
    expect(container.scrollTop).toBe(480)
  })

  it('NO crossing resets, in either direction, from either starting width — the width is not navigation', () => {
    // The named cover for "a width transition must never reach the reset".
    // Both starting widths, both directions, section open and section closed.
    for (const startWide of [true, false]) {
      const crossTo = installCrossableMatchMedia(startWide)
      const { container, unmount } = render(<SettingsShell {...baseProps} />)
      container.scrollTop = 350
      crossTo(!startWide)
      expect(container.scrollTop).toBe(350)
      crossTo(startWide)
      expect(container.scrollTop).toBe(350)
      crossTo(!startWide)
      expect(container.scrollTop).toBe(350)
      unmount()
      delete (window as { matchMedia?: unknown }).matchMedia
    }
  })

  it('desktop FIRST click on the already-highlighted tab resets once; the second click is a no-op', () => {
    // ADJUDICATED AS INTENDED. Arriving on desktop with activeTab null shows the
    // first tab highlighted, but the identity is still null — so the first click
    // on that highlighted tab moves null→'organization' and resets, even though
    // the panel content does not change. Ruling: a tab click is the user's own
    // navigation, so the reset stands. The second click is the same identity and
    // does nothing.
    //
    // This is also the case that discriminates the two candidate identities: a
    // null-collapsed key (`activeTab ?? visibleTabs[0].id`) maps null and
    // 'organization' onto the same value, so it would see NO change here and
    // skip the reset.
    installMatchMedia(true)
    const { container } = render(<SettingsShell {...baseProps} />)
    // Desktop, nothing clicked yet: 組織 is the highlighted tab already.
    expect(screen.getAllByTestId('section-organization').length).toBeGreaterThan(0)

    container.scrollTop = 250
    fireEvent.click(screen.getAllByText('organization')[0])
    expect(container.scrollTop).toBe(0) // reset run #1

    container.scrollTop = 250
    fireEvent.click(screen.getAllByText('organization')[0])
    expect(container.scrollTop).toBe(250) // no second run
  })

  it('BACK-TO-LIST resets — decided: symmetric with drilling in, the list opens at the top too', () => {
    // Explicit decision, pinned so it cannot drift silently: 設定に戻る is the
    // user's own navigation, so it moves the page, exactly like tapping into a
    // section does. (Round 3 did NOT reset here — the shell bailed below md and
    // DrillInView only reset on the way in. Deliberate change.)
    installMatchMedia(false)
    const { container } = render(<SettingsShell {...baseProps} />)
    fireEvent.click(screen.getAllByText('theme.label')[0])
    expect(screen.getAllByTestId('section-theme').length).toBeGreaterThan(0)

    container.scrollTop = 400
    fireEvent.click(screen.getByText('backToList'))
    // Back on the list…
    expect(screen.queryByText('backToList')).toBeNull()
    expect(container.scrollTop).toBe(0)
  })

  it('MOUNT still resets once, at BOTH widths — settings opens at the top when arriving from a scrolled route', () => {
    // Deliberate and stated in the shell: the scroll container is shared with
    // the route the user came from, so without this an arrival from a scrolled
    // page opens 設定 mid-page. It is the one reset that is not a tab change.
    installMatchMedia(true)
    const desktop = renderInScrolledContainer(<SettingsShell {...baseProps} />, 320)
    expect(desktop.container.scrollTop).toBe(0)
    document.body.removeChild(desktop.container)
    desktop.view.unmount()

    delete (window as { matchMedia?: unknown }).matchMedia
    installMatchMedia(false)
    const phone = renderInScrolledContainer(<SettingsShell {...baseProps} />, 320)
    expect(phone.container.scrollTop).toBe(0)
    document.body.removeChild(phone.container)
  })
})
