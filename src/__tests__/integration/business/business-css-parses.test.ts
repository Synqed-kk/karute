/** ⚖ R130 (S52) — CLASS FIX for the stray `}` that R70's edit left in
 *  settings.css: every stylesheet under the Business tree must PARSE. A brace
 *  count or a regex pin is never the check again — postcss is the parser the
 *  Next build itself runs, so a sheet it rejects is a build that fails (and a
 *  browser that silently drops the next @media block). */
import { readdirSync, readFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import postcss from 'postcss'

const TREE = join(process.cwd(), 'src/app/[locale]/(business)/business')

function cssFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name)
    if (d.isDirectory()) return cssFilesUnder(p)
    return d.isFile() && d.name.endsWith('.css') ? [p] : []
  })
}

const FILES = cssFilesUnder(TREE)

describe('⚖ R130 — every Business stylesheet parses', () => {
  it('finds the room sheets (the glob is not empty)', () => {
    const names = FILES.map((f) => relative(TREE, f))
    expect(names).toEqual(expect.arrayContaining([
      join('settings', 'settings.css'),
      join('settings', 'switch.css'),
      join('settings', 'dialog.css'),
      join('settings', 'toast.css'),
    ]))
  })

  it.each(FILES.map((f) => [relative(TREE, f), f]))('%s parses without a CssSyntaxError', (_name, file) => {
    const css = readFileSync(file, 'utf8')
    expect(() => postcss.parse(css, { from: file })).not.toThrow()
  })

  it('the parser does refuse a stray closing brace (the check can go red)', () => {
    expect(() => postcss.parse('@media (pointer: coarse) { a { b: c; } }\n}\n')).toThrow(/Unexpected \}/)
  })
})

/** ⚖ S54 R165(2) — CLASS FIX for R130/R70: 44px is a HIT AREA, never a drawn size.
 *  The guarded class is a TOUCH-FLOOR size outside (pointer: coarse): a size
 *  declaration whose value is EXACTLY a touch-floor number (44px / 48px /
 *  2.75rem / 3rem) must live inside an `@media … (pointer: coarse)` block.
 *  Layout boxes (a 393px frame, a 120px input) are not the class and need no
 *  naming. Read from the PARSED tree, so a rule that is balanced but nested in
 *  the wrong place (attack M5: `.st-jump-head { min-height: 44px }` moved to top
 *  level) goes red — a source-text slice could not see that. A custom property
 *  counts when a size declaration in the same sheet reads it (the switch's
 *  `--st-sw-w/h` tokens). */
const SIZE = /^(?:min-|max-)?(?:width|height|block-size|inline-size)$/i
const TOUCH_FLOOR = new Set(['44px', '48px', '2.75rem', '3rem'])
const ROOM = join(TREE, 'settings')
/** ⚖ S57 R187(a) — the guard SCANS FOLDERS, never a hand-kept file list: every
 *  `.css` file found at test time in the room's folder and in the folder of the
 *  customer-card drawing (reserve-card.css). */
const GUARD_DIRS = [ROOM, join(process.cwd(), 'src/business/lib/reserve-card')]
const GUARDED = GUARD_DIRS.flatMap((dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.css'))
    .map((d) => join(dir, d.name)),
)

/** S54 P5c-R5c (S2): every length literal in the value, case-folded — so `44PX`,
 *  `max(44px, 1em)`, `clamp(…, 48px, …)` and `calc(44px - 2px)` are all seen. */
function touchFloorIn(value: string): boolean {
  for (const m of value.toLowerCase().matchAll(/(?<![\w.-])(\d*\.?\d+)(px|rem)(?![\w-])/g)) {
    if (TOUCH_FLOOR.has(`${Number(m[1])}${m[2]}`)) return true
  }
  return false
}

/** A media prelude counts as coarse ONLY when every comma-separated query is a
 *  positive `(pointer: coarse)` query: no `not` anywhere, no `or`. So
 *  `@media not all and (pointer: coarse)` and `(pointer: coarse), print` are
 *  OUTSIDE coarse. */
function isCoarseMedia(params: string): boolean {
  const queries = params.toLowerCase().split(',').map((q) => q.trim())
  return queries.length > 0 && queries.every((q) =>
    /\(\s*pointer\s*:\s*coarse\s*\)/.test(q) && !/(^|[\s(])(not|or)(?=[\s(])/.test(q))
}

function touchFloorOutsideCoarse(path: string, css = readFileSync(path, 'utf8')): string[] {
  const file = basename(path)
  const root = postcss.parse(css, { from: path })
  const sizeTokens = new Set<string>()
  root.walkDecls(SIZE, (d) => { for (const m of d.value.matchAll(/var\(\s*(--[\w-]+)/g)) sizeTokens.add(m[1]) })
  const out: string[] = []
  root.walkDecls((d) => {
    if (!SIZE.test(d.prop) && !sizeTokens.has(d.prop)) return
    for (let n: postcss.Container | postcss.Document | undefined = d.parent; n; n = n.parent) {
      if (n.type === 'atrule' && (n as postcss.AtRule).name.toLowerCase() === 'media' && isCoarseMedia((n as postcss.AtRule).params)) return
    }
    if (!touchFloorIn(d.value)) return
    out.push(`${file} ${(d.parent as postcss.Rule).selector} { ${d.prop}: ${d.value} }`)
  })
  return out
}

describe('⚖ S54 R165(2) — no touch-floor size (44px/48px) outside (pointer: coarse) in the room sheets', () => {
  /** ⚖ S57 R187(a) — the NAMED exceptions: file + selector + why. An entry may
   *  match nothing on a lower layer (it is never a failure to be unused). */
  const EXCEPTIONS: readonly { file: string; selector: string; reason: string }[] = [
    { file: 'settings.css', selector: '.biz .pg-settings .st-pv-card .wc-hold', reason: 'R165: pre-existing, queued to the offenders PR' },
    { file: 'reserve-card.css', selector: '.member-ground .tap44::before', reason: 'a hit-area pseudo-element, not a drawn size' },
    { file: 'reserve-card.css', selector: '.member-ground .salon-segs button', reason: "a drawing of the customer's phone, verbatim from Reserve, manifest-pinned" },
  ]
  const excepted = (line: string) =>
    EXCEPTIONS.some((e) => line.startsWith(`${e.file} ${e.selector} { `))

  it('the scan finds at least the files the old hand-kept list named, and reserve-card.css', () => {
    expect(GUARDED.map((f) => relative(process.cwd(), f))).toEqual(expect.arrayContaining([
      relative(process.cwd(), join(ROOM, 'settings.css')),
      relative(process.cwd(), join(ROOM, 'switch.css')),
      relative(process.cwd(), join(ROOM, 'dialog.css')),
      relative(process.cwd(), join(ROOM, 'toast.css')),
      join('src', 'business', 'lib', 'reserve-card', 'reserve-card.css'),
    ]))
  })

  it.each(GUARDED.map((f) => [basename(f), f]))('%s', (_name, file) => {
    expect(touchFloorOutsideCoarse(file).filter((x) => !excepted(x))).toEqual([])
  })

  it('the check goes red on M5 and a top-level 44px, stays quiet inside coarse and on a layout box', () => {
    const inside = '@media (hover: none) and (pointer: coarse) { .x .st-jump-head { min-height: 44px; } }'
    const moved = '.x .st-jump-head { min-height: 44px; }\n@media (pointer: coarse) { }'
    expect(touchFloorOutsideCoarse('probe.css', inside)).toEqual([])
    expect(touchFloorOutsideCoarse('probe.css', moved)).toEqual(['probe.css .x .st-jump-head { min-height: 44px }'])
    expect(touchFloorOutsideCoarse('probe.css', '@media (max-width: 899px) { .x { block-size: 48px; } }')).toEqual(['probe.css .x { block-size: 48px }'])
    expect(touchFloorOutsideCoarse('probe.css', '.x { height: 44px; }')).toEqual(['probe.css .x { height: 44px }'])
    expect(touchFloorOutsideCoarse('probe.css', '.y { width: 320px; }')).toEqual([])
  })

  it('S2: case-fold, max-*, values inside max/min/clamp/calc, and a NEGATED coarse query all go red', () => {
    const red = (css: string) => expect(touchFloorOutsideCoarse('probe.css', css)).toHaveLength(1)
    red('.z { height: 44PX; }')
    red('.z { HEIGHT: 44px; }')
    red('.z { max-height: 44px; }')
    red('.z { max-width: 48px; }')
    red('.z { min-height: max(44px, 1em); }')
    red('.z { min-height: min(3vh, 48px); }')
    red('.z { width: clamp(1rem, 2.75rem, 5rem); }')
    red('.z { height: calc(44px - 2px); }')
    red('@media not all and (pointer: coarse) { .z { height: 44px; } }')
    red('@media (pointer: coarse), print { .z { height: 44px; } }')
    red('@media (pointer: fine) { .z { height: 44px; } }')
    // still quiet: inside a positive coarse query (any case), and non-floor lengths
    expect(touchFloorOutsideCoarse('probe.css', '@MEDIA (POINTER: COARSE) { .z { max-height: max(44px, 1em); } }')).toEqual([])
    expect(touchFloorOutsideCoarse('probe.css', '.z { height: 144px; width: 4.4px; min-height: max(24px, 1em); }')).toEqual([])
  })
})

/** ⚖ S57 R187(b)(c) — the room's shared dialog (dialog.css), read from the
 *  PARSED tree (postcss, the parser the Next build runs):
 *  (b) every button inside the dialog has the room's touch hit area, and only
 *      under `(pointer: coarse)` — 44px is a hit area, never a drawn size;
 *  (c) the dialog's title (h4) and body (p) type is defined exactly once. */
const FILE = join(ROOM, 'dialog.css')
const root = postcss.parse(readFileSync(FILE, 'utf8'), { from: FILE })

const BUTTONS = '.biz .pg-settings .st-dlg button'

function inCoarse(node: postcss.Node): boolean {
  for (let n = node.parent; n; n = n.parent) {
    if (n.type === 'atrule' && (n as postcss.AtRule).name === 'media' && /\(\s*pointer\s*:\s*coarse\s*\)/.test((n as postcss.AtRule).params)) return true
  }
  return false
}

function rulesFor(selector: string): postcss.Rule[] {
  const out: postcss.Rule[] = []
  root.walkRules((r) => { if (r.selectors.includes(selector)) out.push(r) })
  return out
}

describe('⚖ S57 R187 — the shared dialog', () => {
  it('(b) every dialog button gets min-height: 44px inside (pointer: coarse)', () => {
    const hits = rulesFor(BUTTONS).flatMap((r) => r.nodes.filter(
      (n): n is postcss.Declaration => n.type === 'decl' && n.prop === 'min-height' && n.value === '44px'))
    expect(hits.length).toBe(1)
    expect(hits.every(inCoarse)).toBe(true)
  })

  it('(b) no rule for the dialog buttons sits outside the coarse block', () => {
    expect(rulesFor(BUTTONS).filter((r) => !inCoarse(r))).toEqual([])
  })

  it.each([
    ['.biz .pg-settings .st-dlg:not(.st-sheet) h4', { 'font-size': '14px', 'font-weight': '700', 'line-height': '1.4' }],
    ['.biz .pg-settings .st-dlg:not(.st-sheet) p', { 'font-size': '12px', 'font-weight': '400', 'line-height': '1.7' }],
  ])('(c) %s type is defined once', (selector, want) => {
    const rules = rulesFor(selector)
    expect(rules).toHaveLength(1)
    const got: Record<string, string> = {}
    rules[0].walkDecls((d) => { got[d.prop] = d.value })
    expect(got).toEqual(want)
  })
})

// S59 P7A (R195) — the adopters' own dialog h4/p carry no line-height, so dialog.css (R187c) alone decides it.
describe('⚖ S59 R195 — no leftover dialog line-height in the adopters', () => {
  it.each([
    ['store-page-rows.css', ['.biz .pg-settings .spr-dlg h4', '.biz .pg-settings .spr-dlg p']],
    ['store-page-type.css', ['.biz .pg-settings .sp-type-dlg h4', '.biz .pg-settings .sp-type-dlg p']],
  ])('%s', (file, selectors) => {
    const path = join(ROOM, file)
    const css = postcss.parse(readFileSync(path, 'utf8'), { from: path })
    const found: string[] = []
    css.walkRules((r) => { if (r.selectors.some((x) => selectors.includes(x))) r.walkDecls('line-height', (d) => { found.push(`${r.selector} ${d.value}`) }) })
    expect(found).toEqual([])
  })
})
