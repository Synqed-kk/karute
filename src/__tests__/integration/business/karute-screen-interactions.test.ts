/**
 * @jest-environment jsdom
 *
 * カルテ — ⚖ Liam's 8/23 GUIDED ?-TOUR law, this room's half.
 *
 * THE LAW: every Business page ships the 画面の説明 tour in the 今日の運営 style
 * — a ? trigger, a spotlight walk of the page's sections in visual order, and
 * tap-any-element-to-learn during the walk. Sections SELF-REGISTER by declaring
 * `data-guide` + `data-guide-title` on themselves, so anything that renders is
 * explained and anything hidden drops out.
 *
 * THE CENSUS IS STRUCTURAL, and it is asked from BOTH sides — the room-4 lesson,
 * inherited: a census that only counts what declares itself can never notice
 * what does not.
 *
 *   · HERE, on the source: every `<section>` and every `<header>` this screen
 *     renders must carry the pair, and every HEADING it prints must sit inside a
 *     declared element. Derived from the JSX itself — there is no list to keep
 *     in sync, and a new section that forgets to declare fails the round the day
 *     it lands.
 *   · IN THE BROWSER, on the REAL rendered DOM (`probe/`, PROBE G): the census
 *     is taken again on both screens (the table and the record), every heading
 *     is TAPPED, and the card is measured against the hole. That is where
 *     containment is decided, because containment is a fact about rects and this
 *     file has no layout to decide it in.
 *
 * MECHANISM, and its honest ceiling. Territory's import fence allows only
 * react/next/node specifiers, so react-dom does not resolve here and no suite in
 * this folder can mount a React tree — the house pattern every screen-
 * interactions suite here already uses. The pure engine (`spotTargets` /
 * `spotHitIndex` / `wrapStep` / `spotCardAt`) IS really run, over rects and
 * nodes it is handed directly, because those are the engine's own inputs rather
 * than a replica of this room.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spotCardAt, spotHitIndex, spotTargets, wrapStep } from '@/business/lib/guide'

const ROOM_DIR = 'src/app/[locale]/(business)/business/karute'
const SRC = readFileSync(join(process.cwd(), `${ROOM_DIR}/KaruteScreen.tsx`), 'utf8')
const CSS = readFileSync(join(process.cwd(), `${ROOM_DIR}/karute.css`), 'utf8')
/** The SHARED engine, read whole (comments included): the room wires its own
 *  trigger and overlay to it, and the engine's contract for every other room is
 *  unchanged by this one. */
const GUIDE_CODE = readFileSync(join(process.cwd(), 'src/business/lib/guide.ts'), 'utf8')

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '')
const SRC_CODE = stripComments(SRC).replace(/^\s*\/\/.*$/gm, '')
const CSS_CODE = stripComments(CSS)

/** Every declaration the screen makes, in source order — which for static JSX is
 *  the order the browser puts them in the DOM. These pins are about PAIRING,
 *  UNIQUENESS and CONTAINMENT, never about sequence: the walk reads RENDERED
 *  position, and only the browser probe can measure that. */
type Declaration = { title: string; text: string; at: number }
const DECLARATIONS: Declaration[] = [
  ...SRC_CODE.matchAll(/data-guide-title="([^"]*)"\s*\n\s*data-guide="([^"]*)"/g),
].map((m) => ({ title: m[1], text: m[2], at: m.index ?? 0 }))

/** Every OPENING TAG of `<tag …>` in the source, whole. JSX attributes hold
 *  braces, template literals and quotes, so the scan tracks all three rather
 *  than stopping at the first `>` it sees — a regex would cut
 *  `className={`kr-row${…}`}` in half and report a section that declares
 *  nothing. */
function openingTags(src: string, tag: string): Array<{ text: string; at: number; end: number }> {
  const out: Array<{ text: string; at: number; end: number }> = []
  let i = src.indexOf(`<${tag}`)
  while (i >= 0) {
    let depth = 0
    let quote = ''
    let j = i + tag.length + 1
    for (; j < src.length; j += 1) {
      const c = src[j]
      if (quote !== '') {
        if (c === quote) quote = ''
        continue
      }
      if (c === '"' || c === "'" || c === '`') quote = c
      else if (c === '{') depth += 1
      else if (c === '}') depth -= 1
      else if (c === '>' && depth === 0) break
    }
    out.push({ text: src.slice(i, j + 1), at: i, end: j + 1 })
    i = src.indexOf(`<${tag}`, j)
  }
  return out
}

/** The source span of the element opened at `open`, found by counting its own
 *  opening and closing tags. Good enough for `section` / `header`, which never
 *  self-close in this file — and the pin below proves that too. */
function spanOf(src: string, tag: string, open: { at: number; end: number }): string {
  let depth = 1
  let i = open.end
  while (depth > 0 && i < src.length) {
    const nextOpen = src.indexOf(`<${tag}`, i)
    const nextClose = src.indexOf(`</${tag}>`, i)
    if (nextClose < 0) break
    if (nextOpen >= 0 && nextOpen < nextClose) { depth += 1; i = nextOpen + tag.length + 1; continue }
    depth -= 1
    i = nextClose + tag.length + 3
  }
  return src.slice(open.at, i)
}

const SECTIONS = openingTags(SRC_CODE, 'section')
const HEADERS = openingTags(SRC_CODE, 'header')
const DECLARED = [...SECTIONS, ...HEADERS].filter((t) => t.text.includes('data-guide-title='))

/** What to call an element in a failure message — its accessible name if it has
 *  one, otherwise its class list. */
const nameOf = (tag: string) =>
  /aria-label(?:ledby)?="([^"]*)"/.exec(tag)?.[1] ?? /className="([^"]*)"/.exec(tag)?.[1] ?? tag.slice(0, 70)

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ Liam 8/23 — the room declares every section it renders', () => {
  it('THE CENSUS IS STRUCTURAL — every <section> and <header> carries the pair', () => {
    const undeclared = [...SECTIONS, ...HEADERS]
      .filter((t) => !t.text.includes('data-guide-title=') || !t.text.includes('data-guide='))
      .map((t) => nameOf(t.text))
    expect({ undeclared }).toEqual({ undeclared: [] })
  })

  it('there is no self-closing section or header to slip past the span scan', () => {
    for (const t of [...SECTIONS, ...HEADERS]) expect(t.text.endsWith('/>')).toBe(false)
  })

  it('every declaration is PAIRED, non-empty, and a whole sentence', () => {
    // Every `data-guide-title` is IMMEDIATELY followed by its `data-guide`, so a
    // title with no explanation (or an explanation with no title) fails here.
    // Counted across every tag, not just sections: the さらに表示 control declares
    // itself on a plain <div>, which the engine picks up exactly the same way.
    expect(DECLARATIONS.length).toBe([...SRC_CODE.matchAll(/data-guide-title=/g)].length)
    expect(DECLARATIONS.length).toBeGreaterThan(DECLARED.length - 1)
    for (const d of DECLARATIONS) {
      expect({ title: d.title, ok: d.title.length > 0 }).toEqual({ title: d.title, ok: true })
      // A card that says 「一覧」 and nothing else explains nothing. The walk is
      // the room's only standing explainer, so each step earns its own sentences.
      expect({ title: d.title, len: d.text.length > 40 }).toEqual({ title: d.title, len: true })
      expect({ title: d.title, ends: d.text.trim().endsWith('。') }).toEqual({ title: d.title, ends: true })
    }
  })

  it('no two sections claim the same title — a reader must know which one they are on', () => {
    const titles = DECLARATIONS.map((d) => d.title)
    expect(new Set(titles).size).toBe(titles.length)
  })

  it('EVERY HEADING THE PAGE PRINTS SITS INSIDE A DECLARED ELEMENT (T6)', () => {
    // A reader taps the WORD — 詳細記録, 記録の履歴 — because it is the thing they
    // are asking about. A declaration on the box alone leaves that word a few
    // pixels outside the rect, so the tap lands on the scrim and CLOSES the walk.
    const spans = DECLARED.map((t) =>
      spanOf(SRC_CODE, SECTIONS.includes(t) ? 'section' : 'header', t),
    )
    const headings = [
      ...[...SRC_CODE.matchAll(/<h1[\s>]/g)].map((m) => ({ what: 'h1', at: m.index ?? 0 })),
      ...[...SRC_CODE.matchAll(/<h2[\s>]/g)].map((m) => ({ what: 'h2', at: m.index ?? 0 })),
      ...[...SRC_CODE.matchAll(/className="kr-sec-title"/g)].map((m) => ({ what: 'kr-sec-title', at: m.index ?? 0 })),
    ]
    expect(headings.length).toBeGreaterThan(6)
    const orphans = headings
      .filter((h) => !spans.some((s) => {
        const start = SRC_CODE.indexOf(s)
        return h.at > start && h.at < start + s.length
      }))
      .map((h) => `${h.what}@${h.at}`)
    expect({ orphans }).toEqual({ orphans: [] })
  })

  it('the census DIFFERS between the two screens — hidden sections drop out by themselves', () => {
    // The room shows the table or the record, never both, so the walk on one is
    // not the walk on the other. That is the engine's law rather than a branch
    // anybody wrote, and the browser probe measures it; here the SOURCE proves
    // the two sets are genuinely different sets.
    const listSide = ['担当でしぼる', 'カルテを探す', '状態でしぼる', 'カルテの一覧']
    const recordSide = ['お客様とカルテ', 'セッションの結果', '本日のセッション', '詳細記録', '録音・文字起こし', '記録の履歴']
    const titles = DECLARATIONS.map((d) => d.title)
    for (const t of [...listSide, ...recordSide]) expect(titles).toContain(t)
    // …and the shared head belongs to neither side, which is why it is declared
    // outside both.
    expect(titles).toContain('カルテ')
  })

  it('the conditional sections declare too — they are the ones the walk drops', () => {
    for (const title of ['さらに表示', 'カルテのないお客様', '破棄されたカルテ', '写真記録', 'AI提案メッセージ', 'カルテがありません']) {
      expect(DECLARATIONS.map((d) => d.title)).toContain(title)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the ? is wired to the FAMILY engine, not to a copy of it', () => {
  it('imports the shared engine and defines none of it locally', () => {
    expect(SRC_CODE).toContain("from '@/business/lib/guide'")
    for (const fn of ['spotCardAt', 'spotHitIndex', 'spotTargets', 'wrapStep']) {
      expect(SRC_CODE).toContain(fn)
      // A local definition would be a second home for a positioning rule that
      // has one (⚖ A8) — and would silently diverge from 今日の運営's.
      expect(SRC_CODE).not.toMatch(new RegExp(`function ${fn}\\b`))
      expect(GUIDE_CODE).toContain(`export function ${fn}`)
    }
  })

  it('the trigger is a labelled ? that reports whether the walk is running', () => {
    expect(SRC_CODE).toContain('aria-label="画面の説明"')
    expect(SRC_CODE).toContain('aria-haspopup="dialog"')
    expect(SRC_CODE).toContain('aria-expanded={tourOpen}')
    expect(SRC_CODE).toContain('aria-controls="krTour"')
    expect(SRC_CODE).toContain('onClick={() => setTourIdx(0)}')
  })

  it('the walk is scoped to the ROOM, never the document — the rail is not this page', () => {
    expect(SRC_CODE).toContain('spotTargets(rootRef.current)')
  })

  it('ONE keyboard listener, innermost-first: the tour owns Escape while it is up', () => {
    // Two listeners would both fire on one Escape and close the record AND the
    // walk at once.
    expect(SRC_CODE.match(/document\.addEventListener\('keydown'/g)?.length).toBe(1)
    expect(SRC_CODE).toMatch(/if \(tourOpen\) \{[\s\S]*?Escape[\s\S]*?return[\s\S]*?\}/)
  })

  it('the keyboard is never stranded — focus goes to 次へ and comes back to the ?', () => {
    expect(SRC_CODE).toContain('tourNextRef.current?.focus()')
    expect(SRC_CODE).toContain('helpRef.current?.focus()')
    // `wasOpen` is what keeps the close half from firing on the first render.
    expect(SRC_CODE).toContain('if (!wasOpen.current) return')
  })

  it('a scroll or a resize RE-MEASURES the hole — it is drawn in viewport coordinates', () => {
    expect(SRC_CODE).toContain("window.addEventListener('resize', bump)")
    expect(SRC_CODE).toContain("window.addEventListener('scroll', bump, true)")
    expect(SRC_CODE).toContain("window.removeEventListener('scroll', bump, true)")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the engine itself, really run on real nodes', () => {
  const rect = (el: HTMLElement, r: { left: number; top: number; width: number; height: number }) => {
    el.getBoundingClientRect = () => ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => ({}) }) as DOMRect
  }

  it('spotTargets picks up anything that DECLARES itself, and drops what has no box', () => {
    document.body.innerHTML = `
      <div id="room">
        <header data-guide-title="カルテ" data-guide="…"></header>
        <section data-guide-title="カルテの一覧" data-guide="…"></section>
        <section data-guide-title="さらに表示" data-guide="…"></section>
        <div>undeclared</div>
      </div>`
    const room = document.getElementById('room')!
    const els = [...room.querySelectorAll<HTMLElement>('[data-guide]')]
    rect(els[0], { left: 0, top: 0, width: 800, height: 60 })
    rect(els[1], { left: 0, top: 80, width: 800, height: 400 })
    // The third is not on screen — a section behind the other view — and drops
    // out of the walk BY ITSELF, which is the whole property.
    rect(els[2], { left: 0, top: 0, width: 0, height: 0 })
    const targets = spotTargets(room)
    expect(targets.map((t) => t.dataset.guideTitle)).toEqual(['カルテ', 'カルテの一覧'])
  })

  it('spotHitIndex resolves SMALLEST-FIRST, so the table cannot swallow its filter row', () => {
    const table = { left: 0, top: 100, width: 900, height: 500 }
    const filters = { left: 10, top: 110, width: 300, height: 40 }
    expect(spotHitIndex(50, 120, [table, filters])).toBe(1)
    expect(spotHitIndex(50, 400, [table, filters])).toBe(0)
    // A tap on nothing declared is -1, which is what ends the walk.
    expect(spotHitIndex(50, 20, [table, filters])).toBe(-1)
  })

  it('the walk is a RING — 次へ on the last step returns to the first', () => {
    expect(wrapStep(0, 9)).toBe(0)
    expect(wrapStep(9, 9)).toBe(0)
    expect(wrapStep(-1, 9)).toBe(8)
    expect(wrapStep(0, 0)).toBe(-1)
  })

  it('the card never covers the region it is explaining', () => {
    const target = { left: 40, top: 120, width: 700, height: 160 }
    const card = { width: 300, height: 160 }
    const at = spotCardAt(target, card, { width: 1280, height: 900 })
    expect(at.top).toBeGreaterThanOrEqual(target.top + target.height)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the overlay and the room obey the ⚖ page-scroll ruling', () => {
  it('no tour layer owns a scroller or caps a height', () => {
    // The overlay's OWN rules, picked out by selector rather than by a slice of
    // the file — a slice runs on into the responsive ladder and would pass or
    // fail on rules that are not the overlay's.
    const overlay = CSS_CODE.split('}')
      .filter((b) => b.slice(0, b.indexOf('{')).includes('kr-spot'))
      .join('}')
    expect(overlay.length).toBeGreaterThan(200)
    expect(overlay).not.toMatch(/overflow/)
    expect(overlay).not.toMatch(/overscroll-behavior/)
    // `max-width` on the card is a CLAMP so it fits a phone; a `max-height`
    // would be a scroller waiting to happen, and there is none.
    expect(overlay).not.toMatch(/max-height/)
    expect(overlay).toMatch(/max-width: calc\(100vw - 20px\)/)
  })

  it('every overlay name is kr-prefixed — 今日の運営 owns the bare `.spot-*` ones', () => {
    for (const name of ['kr-spot-hole', 'kr-spot-catch', 'kr-spot-hover', 'kr-spot-card', 'kr-spot-foot']) {
      expect(CSS_CODE).toContain(`.biz .pg-karute .${name}`)
    }
    // A bare `.spot-…` rule here would be two rooms' overlays fighting over one
    // paint after a soft-nav (the ⚖ sibling-sheet fence).
    expect(CSS_CODE).not.toMatch(/\.biz \.spot-/)
  })

  it('a step below the fold is scrolled to by the PAGE, not by a layer of its own', () => {
    expect(SRC_CODE).toContain("el.scrollIntoView({ block: 'center' })")
  })

  it('reduced motion removes the hole’s slide — the walk still walks', () => {
    const reduced = CSS_CODE.slice(CSS_CODE.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toContain('.kr-spot-hole { transition: none; }')
    expect(reduced).toContain('.kr-row { transition: none; }')
    // …and the base rules those cancel really exist, or the override is theatre.
    expect(CSS_CODE).toMatch(/\.kr-spot-hole \{[\s\S]*?transition:/)
    expect(CSS_CODE).toMatch(/\.kr-row \{[\s\S]*?transition: background-color/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the room’s own client rules', () => {
  it('react-dom is nowhere in the room’s runtime', () => {
    expect(SRC).not.toContain('react-dom')
  })

  it('the screen writes NOTHING — every piece of client state is browsing', () => {
    // ELEVEN, and every one of them is browsing: the three narrowing controls,
    // the walk's depth, the open record, the disclosed warning, and the five the
    // tour needs to draw itself. Nothing staged, nothing to survive a navigation.
    const states = [...SRC_CODE.matchAll(/useState[<(]/g)].length
    expect(states).toBe(11)
    for (const s of [
      'setScope', 'setFilter', 'setQuery', 'setSteps', 'setSelected', 'setReassignOpen',
      'setTourIdx', 'setTourTick', 'setTourStep', 'setTourPos', 'setTourHover',
    ]) {
      expect(SRC_CODE).toContain(s)
    }
    // No fetch, no action, no form post: there is nothing here that could write.
    expect(SRC_CODE).not.toMatch(/fetch\(|useTransition|<form|action=\{/)
  })

  it('narrowing the list restarts the walk — a filter is a fresh question', () => {
    expect(SRC_CODE).toContain('const narrow = (next: () => void) => { next(); setSteps(1) }')
    for (const call of ['narrow(() => setScope(', 'narrow(() => setFilter(', 'narrow(() => setQuery(']) {
      expect(SRC_CODE).toContain(call)
    }
  })

  it('a record the narrowing no longer shows is CLOSED, not left open behind it', () => {
    expect(SRC_CODE).toContain('if (selected !== null && !matched.some((r) => r.id === selected)) setSelected(null)')
  })

  it('the swap moves FOCUS with the screen, in both directions', () => {
    expect(SRC_CODE).toContain('backRef.current?.focus()')
    expect(SRC_CODE).toContain('document.getElementById(row)?.focus()')
    // The row's id has to survive the swap, because the row is gone by the time
    // focus has to return to it.
    expect(SRC_CODE).toContain('id={`krRow-${r.id}`}')
    expect(SRC_CODE).toContain('openedFrom.current = `krRow-${r.id}`')
  })

  it('the reassign warning belongs to the record it was opened on', () => {
    expect(SRC_CODE).toContain('useEffect(() => { setReassignOpen(false) }, [selected])')
  })

  it('one screen at a time is STATE, and the sheet is what hides the other one', () => {
    expect(SRC_CODE).toContain("`${ROOT}${detailOpen ? ' is-detail' : ''}`")
    expect(CSS_CODE).toContain('.biz .pg-karute .kr-detail { display: none; }')
    expect(CSS_CODE).toContain('.biz .pg-karute.is-detail .kr-list-view { display: none; }')
    expect(CSS_CODE).toContain('.biz .pg-karute.is-detail .kr-detail { display: block; }')
  })
})
