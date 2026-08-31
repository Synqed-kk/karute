/** @jest-environment jsdom */
// ⚖ Liam 2026-08-31: the settings screen "should adapt to whatever the screen
// size is." It did not — the frame's `max-w-5xl` clamped the section surface to
// 926px at EVERY viewport ≥1268 on the web door.
//
// Precisely what that cost: the discard section's master–detail composition and
// its two-up definitions turn on at 880px of section width, so those WERE
// reachable before this change (from a 1222px web window). What 926px could
// never reach was four-up definitions (≥1048) and the mock's 360px master
// column (≥1180). Those two are what this unlocks.
//
// jsdom has no layout engine, so this suite does not measure pixels — it
// COMPUTES them from the real class chain, with every input read from the file
// that owns it (the rendered frame's own classList, the sidebar's own width
// literal, the app shell's own max-width, SectionPanel's own padding/border).
// A change to any of those either flows into these numbers or throws on an
// unresolvable utility; nothing here is a hand-copied constant that can rot.
// The arithmetic was cross-checked against a real Chromium layout of the same
// chain — see .build-evidence/FLUID-WIDTH-chromium-measure.txt.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '@testing-library/react'

jest.mock('@synqed-kk/ui', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}))

import { SettingsPageChrome } from '@/components/settings/SettingsPageChrome'
import { SETTINGS_CONTENT_MAX_W } from '@/components/settings/settings-frame'

const readSource = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')

// Only the entries this chain actually uses. An unlisted utility throws rather
// than guessing — a silently-wrong width is the failure mode this suite exists
// to prevent.
const NAMED_MAX_W: Record<string, number> = { '5xl': 1024, '7xl': 1280 }
const SPACING: Record<string, number> = { '4': 16, '6': 24 }

function maxWidthPx(utility: string): number {
  const arbitrary = /^max-w-\[(\d+)px\]$/.exec(utility)
  if (arbitrary) return Number(arbitrary[1])
  const named = /^max-w-([\w.]+)$/.exec(utility)
  if (named && NAMED_MAX_W[named[1]] !== undefined) return NAMED_MAX_W[named[1]]
  throw new Error(`unresolvable max-width utility: ${utility}`)
}

function paddingPx(utility: string): number {
  const m = /^(?:md:)?p-([\w.]+)$/.exec(utility)
  if (!m || SPACING[m[1]] === undefined) throw new Error(`unresolvable padding: ${utility}`)
  return SPACING[m[1]]
}

// ── The chain above the settings frame, each read from its own source ────────

/** `w-[244px] shrink-0` — src/components/layout/sidebar.tsx (md+ only). */
function sidebarWidth(): number {
  const m = /w-\[(\d+)px\] shrink-0/.exec(readSource('src/components/layout/sidebar.tsx'))
  if (!m) throw new Error('sidebar desktop width not found in src/components/layout/sidebar.tsx')
  return Number(m[1])
}

/** `mx-auto max-w-7xl py-4 md:py-6` — the SHARED (app) shell wrapper, web door. */
function appShellMaxWidth(): number {
  const m = /className="mx-auto (max-w-\S+) py-4 md:py-6"/.exec(
    readSource('src/app/[locale]/(app)/layout.tsx'),
  )
  if (!m) throw new Error('app shell wrapper not found in src/app/[locale]/(app)/layout.tsx')
  return maxWidthPx(m[1])
}

/** The thin bundle's OWN shell wrapper — the same clamp on the phone/iPad door,
 *  in a different file. Missing it is how "1440 binds somewhere" gets believed. */
function thinChromeMaxWidth(): number {
  const m = /className="mx-auto (max-w-\S+) py-4 /.exec(readSource('thin/chrome/Chrome.tsx'))
  if (!m) throw new Error('thin chrome wrapper not found in thin/chrome/Chrome.tsx')
  return maxWidthPx(m[1])
}

/** SectionPanel's own padding + border — the last two subtractions. */
function sectionPanelInset(): number {
  const src = readSource('src/components/settings/redesign/SettingsShell.tsx')
  const m = /function SectionPanel[\s\S]*?className="([^"]+)"/.exec(src)
  if (!m) throw new Error('SectionPanel className not found in SettingsShell.tsx')
  const classes = m[1].split(/\s+/)
  const pad = classes.find((c) => /^p-[\w.]+$/.test(c))
  if (!pad) throw new Error(`SectionPanel has no padding utility: ${m[1]}`)
  const border = classes.includes('border') ? 1 : 0
  return paddingPx(pad) + border
}

/** The settings frame's own horizontal inset at md+ (`p-4 md:p-6` → p-6). */
function frameInset(frame: HTMLElement): number {
  const md = [...frame.classList].find((c) => /^md:p-[\w.]+$/.test(c))
  if (!md) throw new Error(`settings frame has no md padding: ${frame.className}`)
  return paddingPx(md)
}

/** Frame width at a desktop viewport, for a given frame ceiling. */
function frameWidth(viewport: number, ceiling: number): number {
  return Math.min(viewport - sidebarWidth(), appShellMaxWidth(), ceiling)
}

/** Same, on the thin door — which has no sidebar, so the frame widens earlier. */
function thinFrameWidth(viewport: number, ceiling: number): number {
  return Math.min(viewport, thinChromeMaxWidth(), ceiling)
}

/** The width the SECTION renders into — what the discard compositions read. */
function sectionWidth(viewport: number, ceiling: number, inset: number): number {
  return frameWidth(viewport, ceiling) - 2 * inset - 2 * sectionPanelInset()
}

function thinSectionWidth(viewport: number, ceiling: number, inset: number): number {
  return thinFrameWidth(viewport, ceiling) - 2 * inset - 2 * sectionPanelInset()
}

// The three files that PAINT this frame. Each must interpolate the shared
// constant and spell no max-width of its own — a plain string-contains check let
// two real mutations through: swapping `${SETTINGS_CONTENT_MAX_W}` for a literal
// while leaving the now-unused import behind, and appending a responsive
// override — an `md:`-variant max-width — after it. Neither the thin screen nor
// the loading file is covered by `eslint src`, so this suite is their only guard.
//
// The override is described rather than spelled ON PURPOSE: Tailwind v4 scans
// this file too (globals.css `@source "../**/*.{ts,tsx}"` covers __tests__), so a
// class literal written in a COMMENT here emits a real rule into the shipped
// stylesheet. Spelling one cost 46 bytes of dead CSS before this reword.
const FRAME_WRAPPERS = [
  'src/components/settings/SettingsPageChrome.tsx',
  'thin/screens/SettingsScreen.tsx',
  'src/app/[locale]/(app)/settings/loading.tsx',
]

// The ceiling that shipped before this change (`max-w-5xl`), kept so every
// assertion below is a real before/after and not a self-referential pin.
const OLD_CEILING = NAMED_MAX_W['5xl']

function renderFrame(): HTMLElement {
  const { container } = render(<SettingsPageChrome title="設定">{null}</SettingsPageChrome>)
  return container.firstElementChild as HTMLElement
}

describe('設定 frame — the ceiling has one home and every wrapper reads it', () => {
  it('the rendered web frame carries exactly ONE max-width, and it is the shared one', () => {
    const frame = renderFrame()
    // Exactly one, not "contains one": an appended `md:`-variant max-width would
    // sit right beside it and win at md+ — every viewport this suite is about.
    const declared = [...frame.classList].filter((c) => /(?:^|:)max-w-/.test(c))
    expect(declared).toEqual([SETTINGS_CONTENT_MAX_W])
    expect(maxWidthPx(SETTINGS_CONTENT_MAX_W)).toBe(1440)
  })

  it.each(FRAME_WRAPPERS)('%s interpolates the constant and declares no max-width', (rel) => {
    const src = readSource(rel)
    // (a) the className really is a template that interpolates the constant —
    //     an unused import next to a hard-coded literal does not pass.
    expect(src).toMatch(/className=\{`[^`]*\$\{SETTINGS_CONTENT_MAX_W\}[^`]*`\}/)
    // (b) the token appears nowhere else in the file. Deliberately strict —
    //     it costs a wrapper nothing (the ceiling is the constant's job) and it
    //     is what catches an appended responsive override.
    expect(src).not.toMatch(/max-w-/)
  })

  it('the ceiling is a CONTIGUOUS literal, so Tailwind can actually see it', () => {
    // Tailwind v4 finds classes by scanning source text. A composed string
    // (`max-w-[${n}px]`) emits no rule at all and the ceiling silently does
    // nothing — the page would look capped and every number here would still
    // pass. Emission also needs globals.css's `@source "../**/*.{ts,tsx}"` to
    // keep covering src/**.
    // ponytail: source-level only. Reading the BUILT stylesheet would prove
    // emission end to end but costs a full vite build per jest run — accepted
    // residual, proven once per branch instead (both directions) in
    // .build-evidence/FLUID-WIDTH-GATE-bundle-delta.txt.
    expect(readSource('src/components/settings/settings-frame.ts')).toContain(
      `SETTINGS_CONTENT_MAX_W = '${SETTINGS_CONTENT_MAX_W}'`,
    )
  })
})

describe('設定 frame — wide viewports actually get wider', () => {
  it.each([1280, 1440, 1680])('at a %ipx viewport the section clears the old 928 clamp', (vw) => {
    const inset = frameInset(renderFrame())
    expect(sectionWidth(vw, OLD_CEILING, inset)).toBe(926) // what shipped before
    expect(sectionWidth(vw, maxWidthPx(SETTINGS_CONTENT_MAX_W), inset)).toBeGreaterThan(928)
  })

  it('the section reaches the widths the discard compositions were built for', () => {
    const inset = frameInset(renderFrame())
    const ceiling = maxWidthPx(SETTINGS_CONTENT_MAX_W)
    // 1048 = four-up definitions · 1180 = the 360px master column.
    expect(sectionWidth(1440, ceiling, inset)).toBeGreaterThanOrEqual(1048)
    expect(sectionWidth(1680, ceiling, inset)).toBeGreaterThanOrEqual(1180)
  })

  it('never exceeds the ceiling, however wide the window gets', () => {
    const ceiling = maxWidthPx(SETTINGS_CONTENT_MAX_W)
    expect(frameWidth(4000, ceiling)).toBeLessThanOrEqual(ceiling)
  })

  it('DISCLOSURE: TWO shared shells, one per door, cap the top end — not settings', () => {
    // Both doors wrap every screen at max-w-7xl, in two different files:
    //   web  — src/app/[locale]/(app)/layout.tsx
    //   thin — thin/chrome/Chrome.tsx
    // So 1440 never binds anywhere today; the frame plateaus at 1280 on both.
    // Widening either is a whole-app decision, deliberately out of scope. If
    // either moves, this fails on purpose and the build note's numbers get
    // revisited with it.
    const ceiling = maxWidthPx(SETTINGS_CONTENT_MAX_W)
    expect(appShellMaxWidth()).toBe(1280)
    expect(thinChromeMaxWidth()).toBe(1280)
    expect(Math.max(appShellMaxWidth(), thinChromeMaxWidth())).toBeLessThan(ceiling)
    expect(frameWidth(4000, ceiling)).toBe(appShellMaxWidth())
    expect(thinFrameWidth(4000, ceiling)).toBe(thinChromeMaxWidth())
  })

  it('DISCLOSURE: the iPad door widens too — this is not web-only headroom', () => {
    // The binary ships to iPad (ios/App/App.xcodeproj: TARGETED_DEVICE_FAMILY
    // = "1,2") and the thin door has no 244px sidebar, so its frame widens from
    // a 1025pt viewport up — every iPad in landscape. Intended per ⚖ 8/31;
    // pinned so nobody re-reads this change as desktop-only.
    const inset = frameInset(renderFrame())
    const ceiling = maxWidthPx(SETTINGS_CONTENT_MAX_W)
    // iPad Pro 12.9" landscape.
    expect(thinSectionWidth(1366, OLD_CEILING, inset)).toBe(926)
    expect(thinSectionWidth(1366, ceiling, inset)).toBe(1182)
    // Portrait phones sit far below the ceiling and do not move at all.
    expect(thinSectionWidth(430, ceiling, inset)).toBe(thinSectionWidth(430, OLD_CEILING, inset))
  })
})

describe('設定 frame — nothing at or below 1268 moves', () => {
  // Up to 1268 the viewport minus the sidebar is no wider than the OLD ceiling,
  // so the ceiling was never what bound — raising it is pure headroom. (1268 is
  // where the old cap starts binding, hence "capped at every viewport ≥1268";
  // it is the last width the two ceilings still agree on, not the first they
  // differ on.)
  it.each([768, 900, 1024, 1200, 1267, 1268])(
    'a %ipx viewport renders exactly as before',
    (vw) => {
      const inset = frameInset(renderFrame())
      expect(sectionWidth(vw, maxWidthPx(SETTINGS_CONTENT_MAX_W), inset)).toBe(
        sectionWidth(vw, OLD_CEILING, inset),
      )
    },
  )

  it('1269 is the first viewport where the two ceilings differ — by exactly one pixel', () => {
    const inset = frameInset(renderFrame())
    const ceiling = maxWidthPx(SETTINGS_CONTENT_MAX_W)
    expect(sectionWidth(1269, ceiling, inset) - sectionWidth(1269, OLD_CEILING, inset)).toBe(1)
  })
})
