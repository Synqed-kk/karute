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
// It also pins the BOUNDED FALLBACK: swapping branches on every crossing would
// unmount one section and mount the other, and a mount is a read — on 監査ログ
// a read is also an audit-row WRITE, so a rotating phone wrote rows without
// bound. After the FIRST crossing both branches go back in the tree for good,
// CSS-gated, i.e. the pre-change render. The arithmetic pinned below: the first
// crossing costs one mount, every crossing after it costs zero, the instance
// the user was editing in stays mounted, and no non-deep-link path exceeds the
// pre-change 2 mounts.
//
// Section-mock list and the "only the server-action boundary is mocked"
// idiom are lifted from thin-settings-discards-mount.test.tsx — the real
// DiscardReasonsSection stays mounted so the thing being counted is a REAL
// section's real read, not a stand-in.
import { StrictMode } from 'react'
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
// 外観 is the one stub that is NOT `() => null`: it stands in for a section the
// user is mid-edit in — a controlled input whose value lives inside the section,
// plus a mount tally (the role listDiscardReasons plays for 破棄の記録). The
// RULING test at the bottom needs both to tell a reused instance from a fresh
// one. Same requireActual-React factory idiom as customer-card-rails.test.tsx.
const mockThemeMounts = jest.fn()
jest.mock('@/components/settings/redesign/sections/ThemeSection', () => {
  const React = jest.requireActual('react') as typeof import('react')
  return {
    ThemeSection: () => {
      const [draft, setDraft] = React.useState('')
      React.useEffect(() => {
        mockThemeMounts()
      }, [])
      return React.createElement('input', {
        'aria-label': 'theme-draft',
        value: draft,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
      })
    },
  }
})
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

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { SettingsShell, type SettingsTabId } from '@/components/settings/redesign/SettingsShell'
import { MD_QUERY } from '@/hooks/use-is-wide'
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

/** The two branch containers, found by the exact classes that gate them in CSS.
 *  Asserting on these (not just on read counts) is what makes a swapped guard —
 *  the wrong branch surviving at a given width — fail instead of passing on an
 *  identical-looking read count. */
//  Scoped to DIRECT children of the shell root on purpose: sections render
//  their own `md:hidden` / `hidden md:block` elements inside (DiscardReasonsSection
//  has one), so an unscoped query would match a section's header and report a
//  branch that isn't there.
const branch = (c: HTMLElement, selector: string) =>
  c.firstElementChild?.querySelector(`:scope > ${selector}`) ?? null
const mobileBranch = (c: HTMLElement) => branch(c, '.md\\:hidden')
const desktopBranch = (c: HTMLElement) => branch(c, '.hidden.md\\:block')

/** next-intl is identity-mocked, so labels render as their own keys. */
const DISCARDS_LABEL = 'discardReasons.label'
const THEME_LABEL = 'theme.label'
const BACK_LABEL = 'backToList'

beforeEach(() => {
  listDiscardReasons.mockClear()
  mockThemeMounts.mockClear()
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
    const { container } = render(<SettingsShell {...baseProps} />)
    await settle()
    // Measured wide: the DESKTOP branch is in the tree and the mobile one is
    // NOT. Both halves asserted — "no back button" alone would still pass if
    // the guards were swapped and the mobile branch had merely re-rendered as
    // the list, so the surviving branch is named positively here.
    expect(desktopBranch(container)).not.toBeNull()
    expect(mobileBranch(container)).toBeNull()
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

  it("StrictMode's double-invoked mount effect must NOT latch `crossed` — the win has to survive dev", async () => {
    // The fallback latches on a `change` EVENT, not on "wide was already set",
    // precisely because StrictMode mounts→unmounts→remounts effects in dev: a
    // latch inferred from the previous state would fire on that second initial
    // measurement and quietly turn the single-mount render off for every dev
    // session (and every StrictMode test), where nobody would see the extra
    // reads until production told a different story.
    crossBreakpointTo(true)
    const { container } = render(
      <StrictMode>
        <SettingsShell {...baseProps} />
      </StrictMode>,
    )
    await settle()
    // Two initial measurements, zero crossings: measured and NOT crossed, so
    // the mobile branch is still out of the tree.
    expect(desktopBranch(container)).not.toBeNull()
    expect(mobileBranch(container)).toBeNull()
  })

  it('the shell measures the md breakpoint itself — the one MD_QUERY, not a re-spelled literal', () => {
    render(<SettingsShell {...baseProps} />)
    expect(askedQueries).toContain(MD_QUERY)
  })

  it("MD_QUERY tracks Tailwind's resolved --breakpoint-md — an override would render settings BLANK", () => {
    // The hook and the `md:hidden` / `hidden md:block` classes must agree on
    // where `md` is. If they ever disagree the shell keeps ONE branch and the
    // CSS hides it, so the settings page paints EMPTY on the widths between
    // the two values — silently, with no error anywhere. Read Tailwind's own
    // resolved default and assert the app neither overrides it nor drifts from
    // it, so that day is a red test instead of a blank page.
    const abs = (p: string) => path.join(process.cwd(), p)
    const read = (p: string) => {
      // Existence-tolerant only in the sense that a missing file FAILS with the
      // path in the message instead of throwing ENOENT out of the matcher. A
      // package restructure must go red here, never quietly pass by scanning a
      // file that no longer exists.
      try {
        return readFileSync(abs(p), 'utf8')
      } catch {
        throw new Error(`expected stylesheet is missing: ${p} — resolve it and re-point this test`)
      }
    }
    const declarationsIn = (css: string) =>
      [...css.matchAll(/--breakpoint-md:\s*([^;]+);/g)].map((m) => m[1].trim())

    // globals.css says `@import "tailwindcss"`, and the tailwindcss package's
    // "." export resolves the `style` condition to index.css — NOT theme.css.
    // index.css carries its own inlined @theme and never imports theme.css, so
    // index.css is the file the build actually reads. (Round-2 read theme.css:
    // right value, wrong file — the two agree today, and nothing was checking
    // that they still would.)
    const declared = declarationsIn(read('node_modules/tailwindcss/index.css'))
    // Exactly one declaration, and MD_QUERY is built from it verbatim (rem
    // kept as rem — a px spelling would drift at any root font size ≠ 16).
    expect(declared).toEqual(['48rem'])
    expect(MD_QUERY).toBe(`(min-width: ${declared[0]})`)
    // The sibling copy must agree with it. If a future tailwind splits these
    // two apart, this reds instead of one of them drifting unnoticed.
    expect(declarationsIn(read('node_modules/tailwindcss/theme.css'))).toEqual(declared)

    // …and nothing the app imports overrides it. A `@theme { --breakpoint-md: … }`
    // in ANY of these would move the CSS `md` without moving MD_QUERY.
    const cssFiles: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(dir, e.name))
        else if (e.name.endsWith('.css')) cssFiles.push(path.join(dir, e.name))
      }
    }
    walk(abs('src'))
    expect(cssFiles).toContain(abs('src/app/globals.css'))

    // globals.css's other three @imports, resolved through each package's
    // exports map (`style` condition), since they live outside src:
    //   tw-animate-css                    → dist/tw-animate.css
    //   shadcn/tailwind.css               → dist/tailwind.css
    //   @synqed-kk/ui/src/themes/tokens.css → that bare path
    const importedFromNodeModules = [
      'node_modules/tw-animate-css/dist/tw-animate.css',
      'node_modules/shadcn/dist/tailwind.css',
      'node_modules/@synqed-kk/ui/src/themes/tokens.css',
    ]
    const overriding = [
      ...cssFiles.filter((f) => /--breakpoint-md\s*:/.test(readFileSync(f, 'utf8'))),
      ...importedFromNodeModules.filter((f) => /--breakpoint-md\s*:/.test(read(f))),
    ]
    expect(overriding).toEqual([])
  })
})

describe('SettingsShell — the first breakpoint crossing restores the dual render, and bounds the cost', () => {
  it('phone → desktop: the desktop branch comes back CSS-gated, the phone branch STAYS, and the ledger is read exactly once more', async () => {
    const { container } = render(<SettingsShell {...baseProps} />)
    await settle()
    fireEvent.click(screen.getByText(DISCARDS_LABEL))
    await waitFor(() => {
      expect(listDiscardReasons).toHaveBeenCalledTimes(1)
    })
    expect(mobileBranch(container)).not.toBeNull()
    expect(desktopBranch(container)).toBeNull()

    crossBreakpointTo(true)
    await settle()

    // BOTH branches in the tree now — the pre-change render, restored.
    expect(mobileBranch(container)).not.toBeNull()
    expect(desktopBranch(container)).not.toBeNull()
    // 破棄の記録 is still the open section on both sides: the phone branch keeps
    // its drill-in (設定に戻る still there), the desktop branch shows it in the
    // strip and the panel.
    expect(screen.getByText(BACK_LABEL)).toBeTruthy()
    expect(screen.getAllByText(DISCARDS_LABEL).length).toBeGreaterThan(1)
    // Exactly ONE more read — the restored branch's own mount. Two total for
    // the visit, which is the pre-change cost, not more.
    expect(listDiscardReasons).toHaveBeenCalledTimes(2)
  })

  it('every crossing after the first is FREE — nothing unmounts, so nothing re-reads (the unbounded 監査ログ write was here)', async () => {
    render(<SettingsShell {...baseProps} />)
    await settle()
    fireEvent.click(screen.getByText(DISCARDS_LABEL))
    await waitFor(() => {
      expect(listDiscardReasons).toHaveBeenCalledTimes(1)
    })

    crossBreakpointTo(true)
    await settle()
    expect(listDiscardReasons).toHaveBeenCalledTimes(2)

    // Rotate the phone back and forth. Before the bounded fallback each of
    // these unmounted one section and mounted the other, and on 監査ログ every
    // such mount WRITES a privacy.audit_log.view row — unbounded.
    listDiscardReasons.mockClear()
    for (let i = 0; i < 6; i++) crossBreakpointTo(i % 2 === 0)
    await settle()
    expect(listDiscardReasons).not.toHaveBeenCalled()
  })

  it('desktop → phone: same arithmetic in the other direction — one extra mount, then zero', async () => {
    crossBreakpointTo(true)
    const { container } = render(<SettingsShell {...baseProps} />)
    await settle()
    // Pick a tab from the desktop strip, then shrink across the breakpoint.
    fireEvent.click(screen.getByText(DISCARDS_LABEL))
    await waitFor(() => {
      expect(listDiscardReasons).toHaveBeenCalledTimes(1)
    })

    crossBreakpointTo(false)
    await settle()

    // Drilled into the SAME section — not bounced back to the list — and the
    // desktop branch it came from is still mounted beside it.
    expect(screen.getByText(BACK_LABEL)).toBeTruthy()
    expect(mobileBranch(container)).not.toBeNull()
    expect(desktopBranch(container)).not.toBeNull()
    expect(listDiscardReasons).toHaveBeenCalledTimes(2)

    crossBreakpointTo(true)
    crossBreakpointTo(false)
    await settle()
    expect(listDiscardReasons).toHaveBeenCalledTimes(2)
  })

  // REFUTED FINDING (PR #805 review): "crossing md remounts the section, so
  // section-local editing state is lost." There was never state to lose across
  // the swap — BEFORE this branch the shell rendered the section TWICE, one
  // instance per branch, each with its own independent state, and crossing the
  // breakpoint revealed the OTHER instance's stale state; an edit made below md
  // stayed in the now-hidden twin. No preservation property existed to regress.
  // Carrying state across branches would need the section reparented (portals /
  // a single hoisted tree) — a real structural cost for a swap that only happens
  // on a resize or rotation, so it is deliberately not attempted.
  //
  // What the bounded fallback DOES give, and what this test now pins: the
  // instance the user was actually editing in is never unmounted, so an A→B→A
  // round trip returns to their own text. The twin that comes forward is a
  // fresh instance showing its own empty state — exactly the pre-change
  // behavior, no better and no worse.
  it('RULING (PR#805 review): the first crossing mounts the TWIN fresh; the branch the user was editing in keeps its text through an A→B→A round trip', async () => {
    const { container } = render(<SettingsShell {...baseProps} />)
    await settle()

    // Drill into 外観 on the phone branch and start editing inside the section.
    fireEvent.click(screen.getByText(THEME_LABEL))
    await settle()
    expect(mockThemeMounts).toHaveBeenCalledTimes(1)

    const draftIn = (branch: Element | null) =>
      branch?.querySelector('input[aria-label="theme-draft"]') as HTMLInputElement | null

    const editing = draftIn(mobileBranch(container))!
    fireEvent.change(editing, { target: { value: '編集中' } })
    expect(editing.value).toBe('編集中')

    crossBreakpointTo(true)
    await settle()

    // The twin (desktop branch) mounts fresh — its own empty state, one more
    // mount — while the phone instance the edit lives in is untouched.
    expect(mockThemeMounts).toHaveBeenCalledTimes(2)
    expect(draftIn(desktopBranch(container))!.value).toBe('')
    expect(draftIn(mobileBranch(container))!.value).toBe('編集中')

    // A→B→A: back below md, and the user's own text is still there. Nothing
    // remounted on the way back either.
    crossBreakpointTo(false)
    await settle()
    expect(mockThemeMounts).toHaveBeenCalledTimes(2)
    expect(draftIn(mobileBranch(container))!.value).toBe('編集中')
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
    const { container } = render(
      <SettingsShell {...baseProps} initialTab={'discards' as SettingsTabId} />,
    )
    await settle()

    expect(listDiscardReasons).toHaveBeenCalledTimes(2)
    // …and the tree has settled to the desktop branch alone, so the NEXT tab
    // this visitor opens costs one read, not two.
    expect(screen.queryByText(BACK_LABEL)).toBeNull()
    expect(mobileBranch(container)).toBeNull()
  })

  it('KNOWN RESIDUAL — deep link + a crossing is the ONE path above the pre-change 2: three reads, then zero forever', async () => {
    // The only path where the bounded fallback costs more than the render it
    // replaces. The deep-linked section mounted in BOTH branches on the first
    // paint (the residual above), measurement then dropped one, and the first
    // crossing restores it — so that branch mounts a second time: 2 + 1 = 3
    // reads, against 2 for the pre-change permanent dual render. One extra
    // audit row, once, on a deep-linked visit that also rotates. Every
    // crossing after it is free, which is the property that mattered: the
    // pre-fallback code charged a read PER ROTATION with no ceiling at all.
    // Closing this last one would mean not dropping the branch on a deep-link
    // visit — i.e. charging that visitor two reads for every section they open
    // afterwards, which is strictly worse.
    crossBreakpointTo(true)
    render(<SettingsShell {...baseProps} initialTab={'discards' as SettingsTabId} />)
    await settle()
    expect(listDiscardReasons).toHaveBeenCalledTimes(2)

    crossBreakpointTo(false)
    await settle()
    expect(listDiscardReasons).toHaveBeenCalledTimes(3)

    for (let i = 0; i < 6; i++) crossBreakpointTo(i % 2 === 0)
    await settle()
    expect(listDiscardReasons).toHaveBeenCalledTimes(3)
  })
})
