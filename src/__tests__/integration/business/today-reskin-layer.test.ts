/**
 * @jest-environment node
 *
 * 今日の運営 — the appended RESKIN LAYER (PKT-RESKIN-BUILD-2026-09-08, PR-1).
 *
 * The layer is written at the END of today.css and never interleaved, which
 * buys one thing and costs another. It buys a reskin that is a single
 * deletable block: every ruled pixel above it is still byte-diffable against
 * the sheet it was signed off on. It costs the cascade — an appended rule at
 * EQUAL specificity silently beats a canon STATE rule that stands above it, so
 * a hover can erase a selection and a tint can erase a refusal, with nothing
 * in the diff to show for it.
 *
 * These pins are the cheap half of the proof: the append shape, the seeds, and
 * the five places where the order of two rules IS the behaviour. The expensive
 * half — computed values on the rendered page under every state class — lives
 * in the build round's Playwright checker (build/harness/check.mjs), which is
 * what actually drives the states; this file is what stops a later edit from
 * quietly re-sorting the layer under it.
 *
 * Territory's import fence: node specifiers only, so this is text on the file.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/today.css'), 'utf8')
const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')

const HEADER = '/* ═══ RESKIN LAYER (2026-09-08) — appended, never interleaved; one block per R-number; see PKT-RESKIN-BUILD ═══ */'
/** Everything from the header on: the layer, and nothing but the layer. */
const LAYER = CSS.slice(CSS.indexOf(HEADER))
/** `a` must be written after `b`, or the cascade reverses. */
const after = (a: string, b: string) => {
  expect(LAYER.indexOf(a)).toBeGreaterThan(-1)
  expect(LAYER.indexOf(b)).toBeGreaterThan(-1)
  return expect(LAYER.indexOf(a)).toBeGreaterThan(LAYER.indexOf(b))
}

describe('今日の運営 reskin layer — the append shape', () => {
  it('is one block at the very end, under one header, with canon untouched above it', () => {
    expect(CSS.split(HEADER)).toHaveLength(2)
    // The last canon rule in the sheet (the tour's 終了 button) still stands
    // ABOVE the header — i.e. nothing was interleaved into canon's body.
    expect(CSS.indexOf(HEADER)).toBeGreaterThan(CSS.indexOf('.biz .spot-foot .spot-done { margin-left: auto; }'))
    // …and canon's own state rules are all above it too, which is exactly why
    // the restatements below have to exist.
    expect(CSS.indexOf(HEADER)).toBeGreaterThan(CSS.indexOf('.biz .lock-toggle[aria-pressed="true"] {'))
    expect(CSS.indexOf(HEADER)).toBeGreaterThan(CSS.indexOf('.biz .decision-card[aria-current="true"] {'))
  })

  it('never names the shell, and never reaches for the escape hatches', () => {
    // today.css is a ROUTE sheet that survives navigation (flag 69), so a shell
    // selector written here would repaint every other room by visit order.
    for (const shell of ['.nav a', '.rail-toggle', '.store-context', '.store-pop', '.sidebar', '.topbar']) {
      expect(LAYER).not.toContain(shell)
    }
    expect(LAYER).not.toContain('!important')
    expect(LAYER).not.toContain(':has(')
    expect(LAYER).not.toContain('html.freeze')
    // Every selector in the layer opens on the page, not on `.biz` alone.
    const selectors = LAYER.split('\n').filter((l) => /^[.@]/.test(l))
    expect(selectors.length).toBeGreaterThan(40)
    expect(selectors.filter((l) => !/^(@media|\.biz \.page(\.page-today|-today) )/.test(l))).toEqual([])
  })
})

describe('今日の運営 reskin layer — the seeds', () => {
  it('the name column is 142px, and 134px where the board is narrow', () => {
    expect(LAYER).toContain('.biz .page-today .timeline { --label: 142px; }')
    expect(LAYER).toContain('@media (max-width: 1320px) { .biz .page-today .timeline { --label: 134px; } }')
    // Canon's own two seeds are left exactly where they are — the layer beats
    // them on specificity (0,3,0 over 0,2,0), it does not edit them.
    expect(CSS).toContain('.biz .timeline { position: relative; min-width: 0; --label: 112px; }')
    expect(CSS).toContain('  .biz .timeline { --label: 98px; }')
  })

  it('the screen constant is only the unresolved fallback, and the handle is untouched', () => {
    expect(SRC).toContain('const LABEL_DEFAULT = 142')
    expect(SRC).not.toContain('const LABEL_DEFAULT = 112')
    // ⚖ V3-1 keeps the drag handle's own limits: the column is still resizable
    // between canon's 90 and 240, and the seed is not one of them.
    const INT = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/today-interactions.ts'), 'utf8')
    expect(INT).toContain('export const LABEL_MIN = 90')
    expect(INT).toContain('export const LABEL_MAX = 240')
  })

  it('the two tint calibrations keep their grammar and change only the paint', () => {
    // Same 135deg / 5px / 10px hatch as canon :606, one calibration quieter —
    // and canon keeps the red-dark text and the `cursor: not-allowed` it owns.
    expect(LAYER).toContain('background: repeating-linear-gradient(135deg, #f6d3d0 0 5px, #fff7f6 5px 10px);')
    expect(LAYER).not.toContain('.biz .page-today .event.absence { color:')
    expect(LAYER).toContain('.biz .page-today .guard-rail-cell.blocked { border: 0; background: #f3f4f7; color: #a1a1aa; }')
  })
})

describe('今日の運営 reskin layer — THE STATE-CLASS LAW (order is the behaviour)', () => {
  it('a hovered decision card that is OPEN keeps its wash', () => {
    // Both rules are 0,4,0. Written the other way round, moving the pointer over
    // the decision the inspector is showing would wipe the selection's own dress.
    after(
      '.biz .page-today .decision-card[aria-current="true"] { background: var(--select-bg); box-shadow: inset 3px 0 0 var(--select-line); }',
      '.biz .page-today .decision-card:hover {',
    )
    // …and selected still wins over urgent, which is the same rule read twice.
    after(
      '.biz .page-today .decision-card[aria-current="true"] {',
      '.biz .page-today .decision-card.urgent { box-shadow: inset 3px 0 0 #d97706; }',
    )
  })

  it('a hovered lock toggle on a LOCKED lane keeps its accent wash', () => {
    // The fix is the selector, not a restatement: a bare `.page-today
    // .lock-toggle:hover` is 0,4,0 and beats canon's pressed dress at 0,3,0.
    expect(LAYER).toContain('.biz .page-today .lock-toggle:not([aria-pressed="true"]):hover { background: #f1f3f7; }')
    expect(LAYER).not.toContain('.biz .page-today .lock-toggle:hover {')
  })

  it('a refused 60分 chip still goes red while something is in hand', () => {
    // TodayScreen writes BOTH classes on the same chip when the live verdict is
    // 置けない (`state` = 'blocked', plus ' inert'), so the grey tint at 0,4,0
    // was beating canon's `.inert` at 0,3,0 and the refusal lost its colour.
    expect(SRC).toContain("${v?.kind === 'blocked' ? ' inert' : ''}")
    after(
      '.biz .page-today .guard-rail-cell.inert {',
      '.biz .page-today .guard-rail-cell.blocked {',
    )
    // The tint zeroes the border width canon's `.blocked` supplied, so the
    // restatement has to bring the whole shorthand back, not just the colour.
    expect(LAYER).toContain('.biz .page-today .guard-rail-cell.inert { border: 1px solid #e6a09a; background: var(--red-soft); color: var(--red-dark); }')
  })

  it("an absent staff member's sub-line stays red", () => {
    // 0,3,1 (`> span`) beats canon's `.absent` at 0,3,0 — the one tie in the
    // layer that a plain class read misses, because the element wins it.
    after('.biz .page-today .lane-label > span.absent { color: var(--red-dark); }', '.biz .page-today .lane-label > span {')
  })

  it('a guard-off band keeps the left rule colour canon gives it', () => {
    after('.biz .page-today .guard-band.legend-only { border-left-color: var(--control); }', '  border-left: 0;')
  })
})
