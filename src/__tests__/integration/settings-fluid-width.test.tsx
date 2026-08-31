/** @jest-environment jsdom */
// ⚖ Liam 2026-08-31: the settings screen "should adapt to whatever the screen
// size is." It did not — the frame's `max-w-5xl` clamped the section surface to
// 926px at EVERY viewport ≥1268, which is exactly why the discard section's
// already-shipped wide compositions (two-up below 1048, four-up at ≥1048,
// master column 300→360 at ≥1180) were unreachable on any real desktop.
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

/** `mx-auto max-w-7xl py-4 md:py-6` — the SHARED (app) shell wrapper. */
function appShellMaxWidth(): number {
  const m = /className="mx-auto (max-w-\S+) py-4 md:py-6"/.exec(
    readSource('src/app/[locale]/(app)/layout.tsx'),
  )
  if (!m) throw new Error('app shell wrapper not found in src/app/[locale]/(app)/layout.tsx')
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

/** The width the SECTION renders into — what the discard compositions read. */
function sectionWidth(viewport: number, ceiling: number, inset: number): number {
  return frameWidth(viewport, ceiling) - 2 * inset - 2 * sectionPanelInset()
}

// The ceiling that shipped before this change (`max-w-5xl`), kept so every
// assertion below is a real before/after and not a self-referential pin.
const OLD_CEILING = NAMED_MAX_W['5xl']

function renderFrame(): HTMLElement {
  const { container } = render(<SettingsPageChrome title="設定">{null}</SettingsPageChrome>)
  return container.firstElementChild as HTMLElement
}

describe('設定 frame — the ceiling has one home and the chrome reads it', () => {
  it('the rendered frame carries the shared ceiling, not a spelled-out max-width', () => {
    const frame = renderFrame()
    expect(frame.classList.contains(SETTINGS_CONTENT_MAX_W)).toBe(true)
    expect(frame.classList.contains('max-w-5xl')).toBe(false)
    expect(maxWidthPx(SETTINGS_CONTENT_MAX_W)).toBe(1440)
  })

  it('the thin screen and the loading skeleton read the SAME constant', () => {
    // Three surfaces paint this frame. Two of them are invisible to the render
    // above — a phone-bundle screen and a Next loading file — and a skeleton at
    // one width behind a page at another is a visible jump on every load.
    for (const rel of [
      'thin/screens/SettingsScreen.tsx',
      'src/app/[locale]/(app)/settings/loading.tsx',
    ]) {
      const src = readSource(rel)
      expect(src).toContain('SETTINGS_CONTENT_MAX_W')
      expect(src).not.toContain('max-w-5xl')
    }
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

  it('DISCLOSURE: the shared app shell, not settings, is what caps the top end today', () => {
    // src/app/[locale]/(app)/layout.tsx wraps EVERY app page at max-w-7xl, so
    // above a ~1524px viewport the frame plateaus at 1280 and never reaches
    // 1440. Widening that wrapper is a whole-app decision and deliberately out
    // of this change's scope. If it ever moves, this fails on purpose — the
    // build note's numbers need revisiting with it.
    expect(appShellMaxWidth()).toBe(1280)
    expect(appShellMaxWidth()).toBeLessThan(maxWidthPx(SETTINGS_CONTENT_MAX_W))
    expect(frameWidth(4000, maxWidthPx(SETTINGS_CONTENT_MAX_W))).toBe(appShellMaxWidth())
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
