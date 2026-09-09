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
 *
 * ⚖ C-7 (slice ④'s cold read) — AND `@starting-style` IS STEPPED INTO TOO.
 * Slice ④ is the first to write one, and the old scanner skipped it WHOLE: the
 * `i = j` below jumps an at-rule's entire body, so every selector inside
 * `@starting-style { … }` walked past BOTH fences at once — the page fence and
 * the shell-name fence — and a shell selector hidden in an entrance block would
 * have shipped with nothing to catch it. Slice ④ also needs the nested
 * `@media { @starting-style { … } }` form for its reduced-motion answers, so
 * the counter is a GROUP depth now rather than a media depth: both group
 * at-rules step in, both are closed by the same trailing-`}` walk, and a rule
 * inside two of them is still read exactly once. Probed on decoys below.
 */
const selectorsOf = (css: string): string[] => {
  // ⚖ GREPTILE G-3 — the scan is STRING-AWARE and PAREN-AWARE. Counting raw
  // braces let `content: "}"` close a block that is still open, and everything
  // after it was read one level out; splitting heads on every comma turned
  // `:not(.a, .b)` into two selectors, one of which is `.b)` and fails the page
  // fence for no reason. Both were latent — nothing in the layer writes either
  // today — and both are the kind of thing that only shows up once someone
  // does. The lane's own `codeOnly` lexer already works this way.
  const out: string[] = []
  /** the next index at or after `from` where `ch` appears OUTSIDE any string */
  const scanTo = (from: number, stop: (c: string) => boolean): number => {
    let q: string | null = null
    for (let k = from; k < css.length; k += 1) {
      const c = css[k]
      if (q) {
        if (c === '\\') k += 1
        else if (c === q) q = null
        continue
      }
      if (c === '"' || c === "'") { q = c; continue }
      if (stop(c)) return k
    }
    return -1
  }
  /** commas at paren depth 0 and outside strings — nothing else separates */
  const splitHead = (head: string): string[] => {
    const parts: string[] = []
    let buf = ''
    let depth = 0
    let q: string | null = null
    for (let k = 0; k < head.length; k += 1) {
      const c = head[k]
      if (q) { buf += c; if (c === '\\') { buf += head[k + 1] ?? ''; k += 1 } else if (c === q) q = null; continue }
      if (c === '"' || c === "'") { q = c; buf += c; continue }
      if (c === '(') depth += 1
      if (c === ')') depth -= 1
      if (c === ',' && depth === 0) { parts.push(buf); buf = ''; continue }
      buf += c
    }
    parts.push(buf)
    return parts.map((x) => x.trim()).filter(Boolean)
  }
  let i = 0
  let groupDepth = 0
  while (i < css.length) {
    const brace = scanTo(i, (c) => c === '{')
    if (brace < 0) break
    const head = css.slice(i, brace).trim()
    // (C-7) the two group at-rules the layer writes: both hold ordinary style
    // rules, so both are stepped into and neither may hide a selector.
    if (head.startsWith('@media') || head.startsWith('@starting-style')) {
      groupDepth += 1
      i = brace + 1
      continue
    }
    let depth = 1
    let j = brace + 1
    while (j < css.length && depth > 0) {
      const at = scanTo(j, (c) => c === '{' || c === '}')
      if (at < 0) { j = css.length; break }
      depth += css[at] === '{' ? 1 : -1
      j = at + 1
    }
    if (head && !head.startsWith('@')) out.push(...splitHead(head))
    i = j
    while (groupDepth > 0) {
      const close = scanTo(i, (c) => !/\s/.test(c))
      if (close < 0 || css[close] !== '}') break
      i = close + 1
      groupDepth -= 1
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

  it('the scanner cannot be desynchronised by a string, or fooled by a comma inside :not()', () => {
    // ⚖ GREPTILE G-3, proved on decoys rather than asserted. Neither shape is in
    // the layer today; both are one edit away.
    // 1 · a `}` living inside a string used to close the block early, so the
    //     shell selector after it was read as part of an outer rule and walked
    //     past the fence.
    const decoyString = [
      '.biz .page-today .a::after { content: "}"; color: red; }',
      '.topbar .brand { color: red; }',
    ].join('\n')
    expect(selectorsOf(decoyString)).toEqual(['.biz .page-today .a::after', '.topbar .brand'])
    expect(selectorsOf(decoyString).filter((s) => !/^\.biz \.page(\.page-today|-today)(\s|$)/.test(s))).toEqual(['.topbar .brand'])
    // 2 · a comma inside `:not()` is not a selector boundary; splitting there
    //     produced `.b)` and failed the fence on a rule that is perfectly fine.
    const decoyNot = '.biz .page-today .x:not(.a, .b) { color: red; }'
    expect(selectorsOf(decoyNot)).toEqual(['.biz .page-today .x:not(.a, .b)'])
    expect(selectorsOf(decoyNot).filter((s) => !/^\.biz \.page(\.page-today|-today)(\s|$)/.test(s))).toEqual([])
  })

  it('an `@starting-style` block cannot hide a selector from either fence (C-7)', () => {
    // ⚖ C-7. Slice ④ is the first to write an entrance block, and the scanner
    // used to skip every at-rule that is not `@media` WHOLE — body and all — so
    // a shell selector inside one walked past the page fence and the shell-name
    // fence together. Both shapes the layer actually writes are probed: the
    // top-level entrance, and the reduced-motion one nested inside `@media`.
    const decoyStart = [
      '.biz .page-today .fields-pop { transition: opacity 140ms ease; }',
      '@starting-style {',
      '  .biz .page-today .fields-pop { opacity: 0; }',
      '  .topbar .brand { opacity: 0; }',
      '}',
      '.biz .page-today .toast { transition: opacity 140ms ease; }',
    ].join('\n')
    expect(selectorsOf(decoyStart)).toEqual([
      '.biz .page-today .fields-pop',
      '.biz .page-today .fields-pop',
      '.topbar .brand',
      '.biz .page-today .toast',
    ])
    expect(selectorsOf(decoyStart).filter((s) => !/^\.biz \.page(\.page-today|-today)(\s|$)/.test(s))).toEqual(['.topbar .brand'])

    // …and nested one level deeper, which is exactly the shape block R writes:
    // the rule after the two closing braces must still be read, i.e. BOTH
    // groups have to be closed by the trailing-`}` walk.
    const decoyNested = [
      '@media (prefers-reduced-motion: reduce) {',
      '  @starting-style {',
      '    .sidebar .x { transform: none; }',
      '  }',
      '}',
      '.biz .page-today .spot-card { transition: none; }',
    ].join('\n')
    expect(selectorsOf(decoyNested)).toEqual(['.sidebar .x', '.biz .page-today .spot-card'])
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

  it('the page root declares exactly the tokens the layer consumes, and no others', () => {
    // ⚖ GREPTILE G-1 — three tokens (--control / --line / --line-2) were removed
    // from PR-1's block because nothing in PR-1 read them; leaving them in
    // repainted 22 toolbar/popover/dialog borders and both hairlines of the
    // ruled warn-face card. Nothing held them out, so a one-line re-insert put
    // the whole bug back and both gates stayed green (delta lens MAJOR-1, its
    // mutant MXa). This is the assertion that holds them out.
    // ⚖ GREPTILE G-2 (PR-2) — `--control` joined the ladder for one round and
    // came straight back out, for the same reason it left PR-1: most of its
    // page consumers are LATER slices' (the dialogs, the guard-pop's cancel, the
    // tour) or a deliberate keep (the lock toggle), and a token is page-wide by
    // construction. PR-4 declares it, with `--line`, and owns the map. The pin
    // still reads EVERY `.biz .page.page-today` block, because the layer is
    // append-only and a later slice adds a second one rather than editing this.
    // ⚖ SLICE ④ — and that is what happened: the ladder is SIX now. `--control`
    // and `--line` are declared in ④'s own page-root block, with the 22-reader
    // map in its comment, because ④ owns the dialogs, the tour, the toast and
    // the segmented track — most of what the pair paints. `--line-2` is still
    // declared by nobody: its only two readers (:1271 / :1463) are the ruled H2
    // warn face. The list below is the whole ladder, not this slice's half.
    const ROOT = '.biz .page.page-today {'
    const blocks: string[] = []
    for (let at = LAYER_CODE.indexOf(ROOT); at > -1; at = LAYER_CODE.indexOf(ROOT, at + 1)) {
      blocks.push(LAYER_CODE.slice(LAYER_CODE.indexOf('{', at) + 1, LAYER_CODE.indexOf('}', at)))
    }
    expect(blocks.length).toBeGreaterThan(0)
    const declared = blocks.flatMap((b) => b.split(';').map((d) => d.split(':')[0].trim()).filter(Boolean))
    expect([...new Set(declared.filter((d) => d.startsWith('--')))].sort()).toEqual([
      '--card', '--control', '--line', '--muted', '--row', '--section',
    ])
    // The page root's non-token declarations, across every block including the
    // two inside media queries: the canvas, its gutters, and the 1760px cap.
    expect([...new Set(declared.filter((d) => !d.startsWith('--')))].sort()).toEqual(['background', 'margin', 'max-width', 'padding'])
    // …and `--line-2` nowhere else in the layer either — a page-scoped rule
    // further down would reach exactly the same descendants (the delta lens's
    // MXb mutant). ⚖ SLICE ④ narrowed this from the three names to the ONE that
    // no PR may ever declare: the other two now live in ④'s page-root block,
    // and the token-set pin above is what holds THEM to one home.
    expect(LAYER_CODE).not.toMatch(/--line-2\s*:/)
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
    // ⚖ FIX ROUND 2 (G1, 2026-09-09) — the class composition was LIFTED out of the
    // JSX into `railChipClass` (today-interactions.ts), because the breaker
    // swapped the ⇄ mark's two palettes inside the template literal and all
    // 10,687 tests stayed green. The wiring is pinned here, the mapping itself is
    // unit-pinned at the helper (today-rail-halfhour.test.ts §G1).
    expect(SRC).toContain("inert: v?.kind === 'blocked',")
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
    // The name said 「canon gives it」, then 「its own state names」 for the one
    // round PR-2 declared `--control`, and now says the first thing again:
    // Greptile's G-2 removed the declaration, so `var(--control)` is the
    // shell's #e4e4e9 once more — exactly canon's value for this rule. The rule
    // paints nothing either way (the width is 0); what it holds is the STATE
    // keeping its own declaration instead of inheriting `border-left: 0`.
    after('.biz .page-today .guard-band.legend-only { border-left-color: var(--control); }', '  border-left: 0;')
  })

  it('the OPEN ? keeps its accent under the pointer', () => {
    // Both 0,4,0. The hover would otherwise erase the dress that says the
    // 操作ヒント popover is open (canon :137 is 0,3,0 and cannot defend itself).
    after(
      '.biz .page-today .help-toggle[aria-expanded="true"] { background: var(--select-bg); color: var(--select-ink); border-color: var(--select-line); }',
      '.biz .page-today .help-toggle:hover {',
    )
  })

  it('a SELECTED 密度 option keeps its accent, at rest and under the pointer', () => {
    // At rest: the base rule is 0,3,1, exactly canon's `[aria-pressed="true"]`
    // (:227), and stands later — so the restatement has to come after it.
    after(
      '.biz .page-today .fields-pop .density-seg button[aria-pressed="true"] { color: var(--select-ink); border-color: var(--select-line); }',
      '.biz .page-today .fields-pop .density-seg button {',
    )
    // Under the pointer: the same answer the lock toggle got. Pinned as a RULE,
    // not as one string — no hover on this control may reach the layer without
    // excluding the pressed state, however it is spelled.
    expect(LAYER_CODE).toContain('.biz .page-today .fields-pop .density-seg button:not([aria-pressed="true"]):hover { background: #f1f3f7; }')
    expect(LAYER_CODE).not.toMatch(/\.density-seg button(?!:not\(\[aria-pressed="true"\]\)):hover/)
    // ⚖ FIX ROUND 1 (L1 #1) — and the family stays IN A ROOM. Nine controls on
    // this page wear `.density-seg`: three are the 表示設定 popover's (②'s) and
    // six are dialog controls (④'s, rider (k)). ②'s first version restyled all
    // nine and the ruling is that a slice paints its own room, so every rule
    // that PAINTS this family goes through `.fields-pop` or `.biz-dialog`.
    // ⚖ SLICE ④ — with ONE named exception, and it is named rather than left as
    // a hole: the press family declares `transition` / `transform` and nothing
    // else. Motion is not paint, all nine groups press the same way, and
    // scoping the entry would drag `.fields-pop .density-seg button`'s 0,2,1
    // into the `:is()` and raise the whole family's specificity for every other
    // member. So the exception is exactly the bare `.density-seg button` entry
    // inside an `:is()` list, and any other unroomed spelling still fails.
    for (const m of LAYER_CODE.match(/[^\n]*\.density-seg[^\n]*/g) ?? []) {
      expect(m).toMatch(/\.fields-pop \.density-seg|\.biz-dialog \.density-seg|^\s*\.biz \.page-today :is\(\.btn, \.segmented button, \.density-seg button,/)
    }
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
    // ⚖ FIX ROUND 1 (L1 #7) — the `> span` half is GONE: no sub-line span
    // exists under `.bh-left` in the product, so it painted nothing. The fence
    // below stays exactly as it was — the descendant form of EITHER may not
    // come back, whether or not this layer writes the narrow one.
    expect(LAYER_CODE).not.toContain('.biz .page-today .bh-left > span')
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

describe('今日の運営 reskin layer — slice ③ (money bar · card faces · time axis)', () => {
  it('is three blocks, in order, each with its own one-line revert', () => {
    // The PR body promises three independent reverts. That promise is only true
    // if the three blocks exist, are separate, and stand in the order the report
    // prints line ranges for — so it is pinned rather than described.
    const heads = ['── R-2 · The money bar', '── R-6 · Card faces', '── R-7 · Time axis']
    for (const h of heads) {
      expect(LAYER.indexOf(h)).toBeGreaterThan(-1)
      expect(LAYER.split(h)).toHaveLength(2)
      expect(LAYER.slice(LAYER.indexOf(h), LAYER.indexOf(h) + 200)).toContain('REVERT = delete this block')
    }
    // …and after slice ②'s block, because the layer is append-only and the
    // cascade of every restatement below depends on standing last.
    expect(LAYER.indexOf(heads[0])).toBeGreaterThan(LAYER.indexOf('── R-3 · Board head'))
    expect(LAYER.indexOf(heads[1])).toBeGreaterThan(LAYER.indexOf(heads[0]))
    expect(LAYER.indexOf(heads[2])).toBeGreaterThan(LAYER.indexOf(heads[1]))
  })

  it('declares no token of its own — the page ladder is still slice ①\'s four', () => {
    // ⚖ The TOKEN CORRECTION (9/8): `--control` and `--line` belong to PR-4, and
    // `--line-2` to nobody. This slice reads the ladder and declares nothing, so
    // the whole layer's declared custom properties are still ①'s four plus
    // canon's own `--label`, which the layer only re-seeds on `.timeline`.
    // (`var(--x)` is a READ and has no colon after the name, so this matches
    // declarations only.)
    // ⚖ SLICE ④ — the ladder gained `--control` and `--line` in ④'s own block,
    // which is the ruled home for the pair; this slice still declares none of
    // its own, which is what the assertion above and this list together say.
    const declared = [...new Set(LAYER_CODE.match(/--[a-z0-9-]+(?=\s*:)/g) ?? [])].sort()
    expect(declared).toEqual(['--card', '--control', '--label', '--line', '--muted', '--row', '--section'])
  })

  it('the 清掃 and 無断キャンセル hatches survive the card faces', () => {
    // THE tie of this slice. `.biz .page-today .event` is 0,3,0 — exactly canon
    // :604 / :605 — and stands later, so its indigo wash paints straight over
    // both beige weaves unless they are restated after it. Restated VERBATIM:
    // the packet's ruling is that these two do not move at all.
    const hatch = 'repeating-linear-gradient(135deg, #ebe6e0 0 4px, #f4f1ec 4px 8px)'
    for (const state of ['cleanup', 'noshow']) {
      after(`.biz .page-today .event.${state} { border-color: #d9d0c7; background: ${hatch}; }`, '.biz .page-today .event {')
    }
    // …and canon's own two lines are still canon's, untouched above the header.
    expect(CSS.indexOf(HEADER)).toBeGreaterThan(CSS.indexOf(`.biz .event.cleanup { border-color: #d9d0c7; background: ${hatch};`))
    expect(CSS.indexOf(HEADER)).toBeGreaterThan(CSS.indexOf(`.biz .event.noshow { border-color: #d9d0c7; background: ${hatch};`))
  })

  it('a 準備 / レジ締め micro card keeps the 2px canon gives it', () => {
    // Same 0,3,0 tie, on padding. An ~18px card with the base rule's
    // `padding: 5px 6px 4px 10px` has 2px of content box left.
    after('.biz .page-today .event.micro { padding: 0 2px; }', '.biz .page-today .event {')
    expect(CSS).toContain('.biz .event.micro { min-width: 0; padding: 0 2px; }')
  })

  it('the base card rule never touches the stripe or the plain card\'s ink', () => {
    // `box-shadow` on this rule at 0,3,0 would erase every state's 3px inset bar
    // AND canon's `[data-cat] { box-shadow: none }`; `color` would take the
    // plain card's indigo and the 休憩 / 勤務不可 family colours with it. The
    // fence is on the rule's own body, so a later, narrower rule may still say
    // either — the mock's hover lift does exactly that.
    const base = LAYER_CODE.slice(LAYER_CODE.indexOf('.biz .page-today .event {'))
    const body = base.slice(base.indexOf('{'), base.indexOf('}'))
    expect(body).not.toMatch(/(^|[;{\s])box-shadow\s*:/)
    expect(body).not.toMatch(/(^|[;{\s])color\s*:/)
    // …and the press feedback is PR-4's `:active`, not the mock's script class.
    expect(LAYER_CODE).not.toContain('.event.is-pressed')
  })

  it('the 仮置きエリア still lights up when a card is dragged over it', () => {
    // canon :560 and the reskin shelf are both 0,3,0; the restatement has to
    // stand after the rule that beat it, at 0,4,0.
    after(
      '.biz .page-today .park-shelf.over { border-color: var(--orange); background: var(--orange-soft); }',
      '.biz .page-today .park-shelf {',
    )
    expect(CSS).toContain('.biz .park-shelf.over { border-color: var(--orange); background: var(--orange-soft); }')
  })

  it('the money bar keeps the red count, the orange count and the entrance reset', () => {
    // Three ties, all decided by ORDER inside R-2:
    // 1 · canon `.register-cell b.warn` (:65) is 0,3,1 and so is the layer's
    //     `b`, so 施術済み・精算待ち / 未解決 would go ink instead of red;
    // 2 · canon `.ops-decisions b` (:75) is only 0,2,1, so 次に決めること would
    //     lose its orange to the same rule;
    // 3 · canon `.register-cell.act` (:70) is `border: 0` — the reset that stops
    //     a <button> drawing the browser's outset bevel — and the base rule's
    //     `border-right` ties it at 0,3,0. R-2 restates the whole reset and adds
    //     the strip's one uniform divider back on purpose.
    after('.biz .page-today .register-cell b.warn { color: var(--red-dark); }', '.biz .page-today .register-cell b {')
    after('.biz .page-today .ops-decisions b { color: var(--orange); }', '.biz .page-today .register-cell b {')
    after('.biz .page-today .register-cell.act,', '.biz .page-today .register-cell {')
    expect(LAYER_CODE).toMatch(/\.biz \.page-today \.register-cell\.act,\s*\n\.biz \.page-today \.ops-decisions \{\s*\n\s*border: 0;\s*\n\s*border-right: 1px solid #eef0f4;/)
  })

  it('the status pills keep 正常 green and 未達 amber', () => {
    // `.ops-right .chip` is 0,4,0 and canon's `.chip.ok` / `.chip.warn` (:41 /
    // :42) are 0,3,0, so this is a SPECIFICITY restatement, not merely an
    // ordering one — the pills would go flat grey without it.
    after('.biz .page-today .ops-right .chip.ok { background: #e7f5ee; color: #14532d; }', '.biz .page-today .ops-right .chip {')
    after('.biz .page-today .ops-right .chip.warn { background: #fdf1e3; color: #92400e; }', '.biz .page-today .ops-right .chip {')
  })

  it('never dresses a bare `.chip` — #844\'s signpost is not a status pill', () => {
    // `.chip` is canon's own pill and the product writes it in seven places. A
    // bare `.page-today .chip` rule would reach #844's 変更は「設定」＞予約と確保で
    // signpost inside 表示設定 (slice ②'s `.fields-pop .chip`) and the drag
    // proxy's chip. Pinned as a RULE over every selector the scanner finds, the
    // same shape the 密度 family got, so no spelling escapes it.
    const chipSelectors = selectorsOf(LAYER_CODE).filter((s) => /\.chip(?![\w-])/.test(s))
    expect(chipSelectors.length).toBeGreaterThan(3)
    for (const s of chipSelectors) {
      expect(s).toMatch(/\.ops-right \.chip|\.fields-pop \.chip|\.drag-proxy\.chip/)
    }
  })

  it('a card in a gesture never takes the hover lift', () => {
    // ⚖ FIX ROUND 1, F-2 / blind lens L1 MAJOR-1. Canon's two gesture states are
    // BOTH hovered while the gesture runs — the proxy is `pointer-events: none`
    // so the pointer sits on the `.dragging` husk, and the resize grips live
    // inside the card so it sits on the `.resizing` card — and neither can be
    // answered by a restatement, because `:hover` adds a pseudo-class the state
    // rule cannot match. So the guard belongs on the hover head, and it is
    // pinned as a RULE over every `.event` hover the layer writes, however it is
    // spelled and whatever else it declares.
    const hovers = selectorsOf(LAYER_CODE).filter((s) => /\.event(?![\w-])[^{]*:hover/.test(s))
    expect(hovers.length).toBeGreaterThan(4)
    for (const s of hovers) {
      for (const guard of [':not(.dragging)', ':not(.resizing)']) {
        expect(s).toContain(guard)
        expect(s.indexOf(guard)).toBeLessThan(s.indexOf(':hover'))
      }
    }
  })

  it('the card in hand wears the same type as the card on the board', () => {
    // ⚖ FIX ROUND 1, F-4 / blind lens L1 MAJOR-2, and ⚖ R8 GAP-11 in the
    // product's own words: 「everything else is the face he grabbed, to the
    // character」. The drag proxy renders the SAME cardFace() children, but the
    // product writes it with `data-cat` and no `data-book` — so a type rule
    // keyed on `[data-book]` alone stops at the board and the booking in hand
    // keeps canon's 12.5px state-coloured name. Pinned as a RULE: every head
    // that types a board booking must type the proxy with the same tail.
    const sels = selectorsOf(LAYER_CODE)
    const board = sels.filter((s) => s.includes('.event[data-book] >'))
    expect(board.length).toBeGreaterThan(3)
    for (const s of board) {
      expect(sels).toContain(s.replace('.event[data-book]', '.event.drag-proxy[data-cat]'))
    }
  })

  it('the ruler is two bands and the now pill lives in the upper one (D-6)', () => {
    // V2-1. The 36px ruler is the whole fix for the pill landing on 「13」: the
    // pill owns y 2…20, the labels are pushed to y 19 in the lower band, and
    // both overlays start at the ruler's bottom edge so the dot's centre sits
    // ON the line. Four numbers, one behaviour — pinned together.
    expect(LAYER_CODE).toContain('.biz .page-today .time-head { min-height: 36px; }')
    expect(LAYER_CODE).toContain('.biz .page-today .elapsed-wash { top: 36px; background: rgba(16, 24, 40, .045); }')
    expect(LAYER_CODE).toContain('.biz .page-today .now-line { top: 36px; }')
    expect(LAYER_CODE).toMatch(/\.biz \.page-today \.now-line::before \{[^}]*top: -4\.5px;[^}]*width: 9px;[^}]*height: 9px;/)
    expect(LAYER_CODE).toMatch(/\.biz \.page-today \.now-line span \{[^}]*top: -34px;/)
    expect(LAYER_CODE).toContain('padding: 19px 0 0 6px;')
    // canon's own 32px pair is still canon's — the layer beats it on
    // specificity (0,3,0 over 0,2,0), it does not edit it.
    expect(CSS.indexOf(HEADER)).toBeGreaterThan(CSS.indexOf('.biz .time-head { min-height: 32px; border-bottom: 1px solid var(--section); }'))
  })
})

describe('今日の運営 reskin layer — slice ④ (motion · the sliding thumb)', () => {
  /** The press family's `:is()` list, taken from the sheet rather than retyped —
   *  three rules share it (base, `:active`, and the reduced-motion pair) and a
   *  pin that retyped it would pass while the three drifted apart. */
  const isLists = (LAYER_CODE.match(/:is\(\.btn,[\s\S]*?\)/g) ?? []).map((s) => s.replace(/\s+/g, ' '))

  it('is four blocks, in order, after slice ③', () => {
    const heads = ['── T · The page', '── S · The segmented control', '── M · Motion', '── R · Reduced motion']
    for (const h of heads) {
      expect(LAYER.indexOf(h)).toBeGreaterThan(-1)
      expect(LAYER.split(h)).toHaveLength(2)
    }
    expect(LAYER.indexOf(heads[0])).toBeGreaterThan(LAYER.indexOf('── R-7 · Time axis'))
    expect(LAYER.indexOf(heads[1])).toBeGreaterThan(LAYER.indexOf(heads[0]))
    expect(LAYER.indexOf(heads[2])).toBeGreaterThan(LAYER.indexOf(heads[1]))
    expect(LAYER.indexOf(heads[3])).toBeGreaterThan(LAYER.indexOf(heads[2]))
    // …and REDUCED MOTION IS LAST, of the whole layer and not just of ④. A
    // reduced answer that some later rule stands after is not an answer: at
    // equal specificity the later rule wins, which is the entire reason this
    // block needs no `!important`. Pinned by BALANCING its braces and requiring
    // nothing but whitespace after them, so an appended rule is caught wherever
    // it lands.
    expect(LAYER_CODE.split('@media (prefers-reduced-motion: reduce)')).toHaveLength(2)
    const at = LAYER_CODE.indexOf('@media (prefers-reduced-motion: reduce)')
    expect(at).toBeGreaterThan(-1)
    let depth = 0
    let end = -1
    for (let k = LAYER_CODE.indexOf('{', at); k < LAYER_CODE.length; k += 1) {
      if (LAYER_CODE[k] === '{') depth += 1
      else if (LAYER_CODE[k] === '}') {
        depth -= 1
        if (depth === 0) { end = k; break }
      }
    }
    expect(end).toBeGreaterThan(-1)
    expect(LAYER_CODE.slice(end + 1).trim()).toBe('')
    expect(selectorsOf(LAYER_CODE.slice(at)).length).toBeGreaterThan(10)
  })

  it('the three press rules share ONE list, and it names no shell selector and no card', () => {
    // The list is written three times (base · `:active` · the reduced pair, which
    // repeats it twice), so the pin is that they are the SAME text. A member
    // added to one and not the others is the failure this catches. (Whitespace
    // is normalised first: two of the four sit inside the media block and carry
    // its indent, and an indent is not a member.)
    expect(isLists).toHaveLength(4)
    expect(new Set(isLists).size).toBe(1)
    // `.event` is NOT a member: the mock gave cards their own no-scale path, and
    // a scaling card is the one thing this family may never do.
    expect(isLists[0]).not.toMatch(/\.event(?![\w-])/)
    // the shell entries the mock's own list carries and this page may not own
    for (const shell of ['.nav a', '.rail-toggle', '.store-context']) {
      expect(isLists[0]).not.toContain(shell)
    }
    // ⚖ C-1 — `.close` is TEN elements here (nine dialogs + the inspector's at
    // TodayScreen :6924), so both are named by their ROOM and the bare `.close`
    // — a shell name — never appears.
    expect(isLists[0]).toContain('.biz-dialog .close')
    expect(isLists[0]).toContain('.inspector-close')
    expect(isLists[0]).not.toMatch(/[(,]\s*\.close[,)]/)
    // ⚖ C-5 — ②'s ruled CHILD form, never the mock's descendant one: the
    // descendant version reaches every calendar day cell, which ② measured at
    // 1537 computed differences, and all of those controls are named separately
    // in this list anyway.
    expect(isLists[0]).toContain('.time-nav > button')
    expect(isLists[0]).toContain('.time-nav > a')
    expect(LAYER_CODE).not.toMatch(/\.time-nav (button|a)[\s,{:.]/)
    // ⚖ C-2 — and the lock toggle is NOT a member. It is centred with canon's
    // `transform: translateY(-50%)` (:372), so the family's bare `scale(.97)`
    // would replace the centring and drop it 11px on every press.
    expect(isLists[0]).not.toContain('.lock-toggle')
    expect(LAYER_CODE).toContain('.biz .page-today .lock-toggle:active:not(:disabled) { transform: translateY(-50%) scale(.97); transition-duration: 100ms; }')
  })

  it('the lock toggle keeps its centring under reduced motion — never `none`', () => {
    // The whole reason it left the family. `transform: none` here is not 「no
    // motion」, it is 「11px lower, for every reduced-motion reader, forever」.
    const reduced = LAYER_CODE.slice(LAYER_CODE.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toContain('.biz .page-today .lock-toggle:active:not(:disabled) { transform: translateY(-50%); }')
    expect(reduced).not.toMatch(/\.lock-toggle:active:not\(:disabled\) \{ transform: none/)
  })

  it('a card in a gesture never takes the press face either', () => {
    // The same law ③'s hover heads obey, on the new axis: the proxy is
    // `pointer-events: none` so the pointer sits on the ⚖ flag-19 husk for a
    // whole move, and the resize grips live inside the card so it sits on the
    // `.resizing` card for a whole resize. Pinned as a RULE over every `.event`
    // `:hover` OR `:active` head the layer writes, however it is spelled.
    const heads = selectorsOf(LAYER_CODE).filter((s) => /\.event(?![\w-])[^{]*(:hover|:active)/.test(s))
    expect(heads.length).toBeGreaterThan(5)
    for (const s of heads) {
      for (const guard of [':not(.dragging)', ':not(.resizing)']) {
        expect(s).toContain(guard)
        expect(s.indexOf(guard)).toBeLessThan(Math.max(s.indexOf(':hover'), s.indexOf(':active')))
      }
    }
    // …and the press face is a FILTER, never a scale: a scaling card would
    // re-draw its own lane geometry under the operator's finger.
    expect(LAYER_CODE).toContain('.biz .page-today .event:not(.dragging):not(.resizing):active { filter: brightness(.97); }')
    expect(LAYER_CODE).not.toMatch(/\.event[^{]*:active[^}]*transform:\s*scale/)
  })

  it('nothing transitions the four properties a gesture writes every frame', () => {
    // `left` / `top` / `width` / `height` are what the drag, the resize and the
    // `--label` handle write directly; a transition on any of them turns a
    // 1:1 gesture into a lagging one.
    for (const rule of LAYER_CODE.split('}')) {
      if (!/transition\s*:/.test(rule)) continue
      if (!/\.event(?![\w-])|\.drag-proxy|\.label-resize|\.track(?![\w-])/.test(rule)) continue
      expect(rule).not.toMatch(/transition\s*:[^;]*\b(left|top|width|height)\b/)
    }
  })

  it('the pinned answers stay centred — at rest, entering, and under reduced motion', () => {
    // canon centres both with `translateX(-50%)` (:1029 / :1176). The entrance
    // declares a transform, so every place that declares one has to carry the
    // centring too or the pill slides in from half its own width off-centre.
    const pinned = '.biz .page-today .hold-pop.pinned,\n.biz .page-today .guard-pop.pinned { transform: translateX(-50%); }'
    expect(LAYER_CODE).toContain(pinned)
    expect(LAYER_CODE).toContain('.biz .page-today .guard-pop.pinned { opacity: 0; transform: translateX(-50%) translateY(4px) scale(.97); }')
    const reduced = LAYER_CODE.slice(LAYER_CODE.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toContain('.biz .page-today .guard-pop.pinned { opacity: 0; transform: translateX(-50%); }')
    // …and canon's own two lines are untouched above the header.
    expect(CSS.indexOf(HEADER)).toBeGreaterThan(CSS.indexOf('.biz .guard-pop.pinned { left: 50%; bottom: 18px; top: auto; transform: translateX(-50%); }'))
  })

  it('every entrance has a reduced-motion answer at the same shape', () => {
    // The answers are ordering, not `!important`: same selectors, written later.
    // ⚠ The DURATIONS below are documentary — business-shell.css :681-683 already
    // sets `transition-duration: .01ms !important` on `.biz *` under this query.
    // What this block really contributes is the transforms, which is what these
    // pins hold.
    const reduced = LAYER_CODE.slice(LAYER_CODE.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).not.toContain('!important')
    for (const sel of ['.fields-pop', '.cal-pop', '.hold-pop', '.guard-pop', '.inspector > *', '.biz-dialog', '.toast', '.spot-card', '.event']) {
      expect(reduced).toContain(`.biz .page-today ${sel}`)
    }
    // both `@starting-style` blocks exist, and the reduced one is the later of
    // the two — which is the whole mechanism.
    const starts = [...LAYER_CODE.matchAll(/@starting-style/g)].map((m) => m.index ?? -1)
    expect(starts.length).toBeGreaterThanOrEqual(4)
    expect(reduced).toContain('@starting-style')
    expect(starts[starts.length - 1]).toBeGreaterThan(LAYER_CODE.indexOf('@media (prefers-reduced-motion: reduce)'))
  })

  it('the thumb is wired the way SettingsScreen wires its own', () => {
    // TEXT pins, because the territory's import fence keeps a DOM renderer out
    // of this folder — the BEHAVIOURAL proof (mount, press スタッフ, watch the
    // transform travel, reduced = one frame) lives outside the repo in
    // build/harness/today-thumb.harness.test.tsx and is filed as evidence.
    const SRC_CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    // ONE decorative element, and it is the FIRST child of the group — the
    // thumb paints under the labels, so it may not come after them.
    expect((SRC_CODE.match(/<i className="seg-thumb" aria-hidden="true" ref=\{segThumbRef\} \/>/g) ?? [])).toHaveLength(1)
    const group = SRC_CODE.slice(SRC_CODE.indexOf('aria-label="ボード表示"'))
    expect(group.indexOf('<i className="seg-thumb"')).toBeLessThan(group.indexOf('.map('))
    expect(group.indexOf('ref={segWrapRef}')).toBeLessThan(group.indexOf('<i className="seg-thumb"'))
    // THE BOARD'S OWN CONSTANTS, not SettingsScreen's `.3` / `.4`.
    expect((SRC_CODE.match(/\{ response: 0\.22, damping: 1\.0, eps: 0\.3, reduced \}/g) ?? [])).toHaveLength(2)
    // reduced motion comes from the screen's own reader, never a second one.
    expect(SRC_CODE).toContain('const reduced = holdReduced()')
    // both springs are stopped on unmount, and the old pair is stopped before a
    // rebuild — `makeSpring` captures `reduced` at construction, so a spring
    // that is never rebuilt is a spring that lies.
    expect(SRC_CODE).toContain('useEffect(() => () => { segX.current?.stop(); segW.current?.stop() }, [])')
    expect(SRC_CODE).toContain('segX.current?.stop()\n    segW.current?.stop()')
    // the resize re-seat is added AND removed
    expect(SRC_CODE).toContain("window.addEventListener('resize', reseat)")
    expect(SRC_CODE).toContain("return () => window.removeEventListener('resize', reseat)")
    // first layout jumps, later layouts travel
    expect(SRC_CODE).toContain('segX.current!.jump(x)')
    expect(SRC_CODE).toContain('segX.current!.set(x)')
    // nothing pressed → no thumb at all
    expect(SRC_CODE).toContain("if (!on) { thumb.style.opacity = '0'; return }")
  })
})
