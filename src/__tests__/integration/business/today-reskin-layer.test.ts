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
 * OF THE LAYER'S TWO PROOFS, CI RUNS ONLY THIS ONE. (It runs the rest of the
 * repo's suite too — the point is that neither of the layer's own two proofs
 * reaches CI except this file.) These pins are source
 * pins: the append shape, the seeds, and the five places where the order of two
 * rules IS the behaviour. They read today.css as text. Nothing here renders a
 * page, so nothing here can prove a computed value.
 *
 * The rendered proof — every canon state class forced on a real element in
 * headless Chromium, its computed values compared with the layer on and with
 * the layer stripped — is an OUT-OF-REPO gate: build/harness/check.mjs in this
 * lane's packet folder, run before every push of this branch, its output and
 * its mutation red-runs filed beside the PR. The repo does not carry it and CI
 * does not execute it; there is no Playwright step in this pipeline. Putting
 * one there is a separate change to shared CI and is not this lane's to make.
 * So: if you edit the layer and only this file is green, the cascade has NOT
 * been re-proved — run the checker, or say in the PR that you did not.
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
/** The layer with its prose removed. Every assertion about what the layer DOES
 *  runs against this: the lock-toggle block explains its guard by quoting the
 *  selector it forbids, and a pin that reads comments would fail on the
 *  explanation of the very thing it checks. Ordering reads it too — a comment
 *  naming a rule before the rule exists is not the rule. */
const LAYER_CODE = LAYER.replace(/\/\*[\s\S]*?\*\//g, '')
/** EVERY selector the layer writes, not every line that looks like one.
 *
 * ⚖ RIDER (d) — blind round F-6. The old fence filtered lines on `/^[.@]/` and
 * tested the whole line, so three shapes walked straight past it, all three
 * probed and confirmed: a comma-joined SECOND selector
 * (`.biz .page-today .panel, .topbar .brand {`), a selector that opens on an
 * attribute (`[data-role="rail"] .lane {`), and one that opens on an element
 * (`button.segmented-x {`). A rule head is now taken as the text before its
 * `{` and split on commas, so the fence sees what the browser sees. `@media`
 * heads are stepped INTO rather than counted; any other at-rule is skipped
 * whole.
 */
const selectorsOf = (css: string): string[] => {
  const out: string[] = []
  const closeRe = /^\s*\}/
  let i = 0
  let mediaDepth = 0
  while (i < css.length) {
    const brace = css.indexOf('{', i)
    if (brace < 0) break
    const head = css.slice(i, brace).trim()
    if (head.startsWith('@media')) {
      mediaDepth += 1
      i = brace + 1
      continue
    }
    let depth = 1
    let j = brace + 1
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth += 1
      else if (css[j] === '}') depth -= 1
      j += 1
    }
    if (head && !head.startsWith('@')) {
      for (const s of head.split(',').map((x) => x.trim()).filter(Boolean)) out.push(s)
    }
    i = j
    while (mediaDepth > 0) {
      const m = css.slice(i).match(closeRe)
      if (!m) break
      i += m[0].length
      mediaDepth -= 1
    }
  }
  return out
}

/** `a` must be written after `b`, or the cascade reverses. */
const after = (a: string, b: string) => {
  expect(LAYER_CODE.indexOf(a)).toBeGreaterThan(-1)
  expect(LAYER_CODE.indexOf(b)).toBeGreaterThan(-1)
  return expect(LAYER_CODE.indexOf(a)).toBeGreaterThan(LAYER_CODE.indexOf(b))
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
      expect(LAYER_CODE).not.toContain(shell)
    }
    expect(LAYER_CODE).not.toContain('!important')
    expect(LAYER_CODE).not.toContain(':has(')
    expect(LAYER_CODE).not.toContain('html.freeze')
    // Every selector in the layer opens on the page, not on `.biz` alone —
    // and "every" means every one of them: `selectorsOf` reads rule heads and
    // splits them on commas, so a shell name hidden in a second selector, or
    // behind an attribute or an element name, is caught like any other.
    const selectors = selectorsOf(LAYER_CODE)
    expect(selectors.length).toBeGreaterThan(40)
    expect(selectors.filter((s) => !/^\.biz \.page(\.page-today|-today)(\s|$)/.test(s))).toEqual([])
  })
})

describe('今日の運営 reskin layer — the seeds', () => {
  it('the name column is 142px, and 136px where the board is narrow', () => {
    expect(LAYER_CODE).toContain('.biz .page-today .timeline { --label: 142px; }')
    // 136, not 134: at 134 the longest name (テスト さぶろう, 94.7px) had 0.3px
    // of headroom in its 95px box — a rounding difference away from an ellipsis.
    expect(LAYER_CODE).toContain('@media (max-width: 1320px) { .biz .page-today .timeline { --label: 136px; } }')
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

  it('the page root declares the five tokens these PRs consume, and no others', () => {
    // ⚖ GREPTILE G-1 — three tokens (--control / --line / --line-2) were removed
    // from PR-1's block because nothing in PR-1 read them; leaving them in
    // repainted 22 toolbar/popover/dialog borders and both hairlines of the
    // ruled warn-face card. Nothing held them out, so a one-line re-insert put
    // the whole bug back and both gates stayed green (delta lens MAJOR-1, its
    // mutant MXa). This is the assertion that holds them out.
    // ⚖ PR-2 — `--control` joins the ladder, in PR-2's OWN block, because PR-2
    // is where its consumers live (the toolbar and the popovers). The layer is
    // append-only, so it is a SECOND `.biz .page.page-today` rule rather than an
    // edit to PR-1's: this pin therefore reads every such block there is.
    const ROOT = '.biz .page.page-today {'
    const blocks: string[] = []
    for (let at = LAYER_CODE.indexOf(ROOT); at > -1; at = LAYER_CODE.indexOf(ROOT, at + 1)) {
      blocks.push(LAYER_CODE.slice(LAYER_CODE.indexOf('{', at) + 1, LAYER_CODE.indexOf('}', at)))
    }
    expect(blocks.length).toBeGreaterThan(0)
    const declared = blocks.flatMap((b) => b.split(';').map((d) => d.split(':')[0].trim()).filter(Boolean))
    expect([...new Set(declared.filter((d) => d.startsWith('--')))].sort()).toEqual(['--card', '--control', '--muted', '--row', '--section'])
    // The page root's non-token declarations, across every block including the
    // two inside media queries: the canvas, its gutters, and the 1760px cap.
    expect([...new Set(declared.filter((d) => !d.startsWith('--')))].sort()).toEqual(['background', 'margin', 'max-width', 'padding'])
    // …and nowhere else in the layer either — a page-scoped rule further down
    // would reach exactly the same descendants (the delta lens's MXb mutant).
    expect(LAYER_CODE).not.toMatch(/--line(-2)?\s*:/)
    expect(LAYER_CODE.match(/--control\s*:/g)).toHaveLength(1)
  })

  it('the two tint calibrations keep their grammar and change only the paint', () => {
    // Same 135deg / 5px / 10px hatch as canon :606, one calibration quieter —
    // and canon keeps the red-dark text and the `cursor: not-allowed` it owns.
    expect(LAYER_CODE).toContain('background: repeating-linear-gradient(135deg, #f6d3d0 0 5px, #fff7f6 5px 10px);')
    expect(LAYER_CODE).not.toContain('.biz .page-today .event.absence { color:')
    expect(LAYER_CODE).toContain('.biz .page-today .guard-rail-cell.blocked { border: 0; background: #f3f4f7; color: #a1a1aa; }')
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
    expect(LAYER_CODE).toContain('.biz .page-today .lock-toggle:not([aria-pressed="true"]):hover { background: #f1f3f7; }')
    // …and the guard is pinned as a RULE, not as one exact string: no hover on
    // this control may reach the layer without excluding the pressed state,
    // however it is spelled or whatever else it declares.
    expect(LAYER_CODE).not.toMatch(/\.lock-toggle(?!:not\(\[aria-pressed="true"\]\)):hover/)
  })

  it('a refused 60分 chip still goes red while something is in hand', () => {
    // TodayScreen writes BOTH classes on the same chip when the live verdict is
    // 置けない (`state` = 'blocked', plus ' inert'), so the grey tint at 0,4,0
    // was beating canon's `.inert` at 0,3,0 and the refusal lost its colour.
    expect(SRC).toContain("${v?.kind === 'blocked' ? ' inert' : ''}")
    after(
      '.biz .page-today .guard-rail-cell.blocked.inert {',
      '.biz .page-today .guard-rail-cell.blocked {',
    )
    // The tint zeroes the border width canon's `.blocked` supplied, so the
    // restatement has to bring the whole shorthand back — and it is written as
    // the COMBINATION so it cannot leak that border onto the chips canon draws
    // without one (the base cell :888 has a radius and no border).
    expect(LAYER_CODE).toContain('.biz .page-today .guard-rail-cell.blocked.inert { border: 1px solid #e6a09a; background: var(--red-soft); color: var(--red-dark); }')
    expect(LAYER_CODE).not.toContain('.biz .page-today .guard-rail-cell.inert {')
  })

  it("an absent staff member's sub-line stays red", () => {
    // 0,3,1 (`> span`) beats canon's `.absent` at 0,3,0 — the one tie in the
    // layer that a plain class read misses, because the element wins it.
    after('.biz .page-today .lane-label > span.absent { color: var(--red-dark); }', '.biz .page-today .lane-label > span {')
  })

  it('a guard-off band keeps the left rule colour canon gives it', () => {
    after('.biz .page-today .guard-band.legend-only { border-left-color: var(--control); }', '  border-left: 0;')
  })

  it('the OPEN ? keeps its accent under the pointer', () => {
    // Both 0,4,0. The hover would otherwise erase the dress that says the
    // 操作ヒント popover is open (canon :137 is 0,3,0 and cannot defend itself).
    after(
      '.biz .page-today .help-toggle[aria-expanded="true"] { background: #eef2ff; color: #3f5be8; border-color: #c7d2fb; }',
      '.biz .page-today .help-toggle:hover {',
    )
  })

  it('a SELECTED 密度 option keeps its accent, at rest and under the pointer', () => {
    // At rest: the base rule is 0,3,1, exactly canon's `[aria-pressed="true"]`
    // (:227), and stands later — so the restatement has to come after it.
    after(
      '.biz .page-today .density-seg button[aria-pressed="true"] { color: var(--select-ink); border-color: var(--select-line); }',
      '.biz .page-today .density-seg button {',
    )
    // Under the pointer: the same answer the lock toggle got. Pinned as a RULE,
    // not as one string — no hover on this control may reach the layer without
    // excluding the pressed state, however it is spelled.
    expect(LAYER_CODE).toContain('.biz .page-today .density-seg button:not([aria-pressed="true"]):hover { background: #f1f3f7; }')
    expect(LAYER_CODE).not.toMatch(/\.density-seg button(?!:not\(\[aria-pressed="true"\]\)):hover/)
  })

  it('the toolbar does not reach into the popovers it sits beside', () => {
    // D-PR2-1 / D-PR2-2. Three popovers and the month calendar render INSIDE
    // `.board-head`, and the calendar renders inside `.time-nav` itself, so the
    // mock's descendant selectors reach them. Measured by putting each form
    // back and diffing every computed property (mutants P3/P4/P5): the day
    // cells go 44px → 30px and the 空き green goes grey, the month header grows
    // a point, and the five plain weekday labels change their grey. Both forms
    // are pinned as RULES: no descendant version may come back.
    expect(LAYER_CODE).toContain('.biz .page-today .bh-left > strong {')
    expect(LAYER_CODE).toContain('.biz .page-today .bh-left > span {')
    expect(LAYER_CODE).not.toMatch(/\.page-today \.board-head (strong|span)\s*[,{]/)
    expect(LAYER_CODE).toContain('.biz .page-today .time-nav > button,')
    expect(LAYER_CODE).toContain('.biz .page-today .time-nav > a {')
    expect(LAYER_CODE).not.toMatch(/\.page-today \.time-nav (button|a)[\s,{:.]/)
    // …and the canon rules that would have lost are still canon's own.
    expect(CSS).toContain('.biz .cal-cell.open { background: var(--green-soft); color: var(--green-dark); }')
    expect(CSS).toContain('gap: 1px; min-height: 44px;')
    expect(CSS).toContain('.biz .cal-head strong { font-size: 14px; }')
  })
})
