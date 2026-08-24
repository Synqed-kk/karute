/**
 * @jest-environment jsdom
 *
 * 売上・レジ — ⚖ Liam's 8/23 GUIDED ?-TOUR law, this room's half.
 *
 * THE LAW: every Business page ships the 画面の説明 tour in the 今日の運営 style
 * — a ? trigger, a spotlight walk of the page's sections in visual order, and
 * tap-any-element-to-learn during the walk. Sections SELF-REGISTER by declaring
 * `data-guide` + `data-guide-title` on themselves, so anything that renders is
 * explained and anything hidden drops out.
 *
 * ⚠ WHAT THIS FILE USED TO DO, AND WHY IT DOES NOT ANY MORE. The first cut held
 * a hand-written CENSUS array and compared it to the declarations it read out of
 * the JSX — and the room's probe held a SECOND hand-written list and compared it
 * to the rendered DOM. Two lists, both written from the same mental model, and a
 * section that rendered without joining EITHER of them was invisible to both:
 * the open-transaction panel shipped undeclared and every pin stayed green. A
 * census that only counts what declares itself can never notice what does not.
 *
 * So the census is STRUCTURAL now, and it has two halves that ask the question
 * from the other side:
 *
 *   · HERE, on the source: every `<section>` this screen renders must carry the
 *     pair. Derived from the JSX itself — there is no list to keep in sync, and
 *     a new section that forgets to declare fails the round the day it lands.
 *   · IN THE BROWSER, on the REAL rendered DOM (`probe/`, PROBE G2): every
 *     heading the page prints must sit INSIDE a declared rect, and every
 *     declaration must be on something that rendered. That is where containment
 *     is decided, because containment is a fact about the DOM and this file has
 *     no DOM to decide it in.
 *
 * THE JSDOM ROOM-BUILDER IS GONE for the same reason. It re-parented the
 * declarations it had just read into hand-made containers and then asserted
 * things about the structure it had itself invented — so it agreed with the
 * screen no matter what the screen's real nesting was. The ≤743 swap, the
 * visibility drop-outs and the rendered census are all measured for real, in
 * Chromium, by the room's probe. What is left here is what a source file can
 * honestly prove: that every section declares, that every declaration is a
 * complete sentence, that a printed heading is declared from ABOVE it, and that
 * the ? is wired to the shared engine.
 *
 * MECHANISM, and its honest ceiling. Territory's import fence allows only
 * react/next/node specifiers (business-isolation.test.ts, `ALLOWED_BARE`), so
 * react-dom does not resolve here and no suite in this folder can mount a React
 * tree — the house pattern every screen-interactions suite here already uses.
 * The pure engine (`spotTargets` / `spotHitIndex` / `wrapStep`) is still really
 * run, over rects and nodes it is handed directly, because those are the
 * engine's own inputs rather than a replica of this room.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spotHitIndex, spotTargets, wrapStep } from '@/business/lib/guide'

const ROOM_DIR = 'src/app/[locale]/(business)/business/register'
const SRC = readFileSync(join(process.cwd(), `${ROOM_DIR}/RegisterScreen.tsx`), 'utf8')
const CSS = readFileSync(join(process.cwd(), `${ROOM_DIR}/register.css`), 'utf8')

/** Source pins read CODE, not prose: the screen documents the tour in comments
 *  that quote the very attributes these pins look for. */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '')
const SRC_CODE = stripComments(SRC).replace(/^\s*\/\/.*$/gm, '')
const CSS_CODE = stripComments(CSS)

/** Every declaration the screen makes, in source order — which for static JSX is
 *  the order the browser puts them in the DOM, and therefore the order the walk
 *  visits them in. */
type Declaration = { title: string; text: string; at: number }
const DECLARATIONS: Declaration[] = [
  ...SRC_CODE.matchAll(/data-guide-title="([^"]*)"\s*\n\s*data-guide="([^"]*)"/g),
].map((m) => ({ title: m[1], text: m[2], at: m.index ?? 0 }))

/** Every OPENING TAG of `<tag …>` in the source, whole. JSX attributes hold
 *  braces, template literals and quotes, so the scan tracks all three rather
 *  than stopping at the first `>` it sees — a regex would cut
 *  `className={`rg-terminal${…}`}` in half and report a section that declares
 *  nothing. */
function openingTags(src: string, tag: string): string[] {
  const out: string[] = []
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
    out.push(src.slice(i, j + 1))
    i = src.indexOf(`<${tag}`, j)
  }
  return out
}

const SECTIONS = openingTags(SRC_CODE, 'section')
/** What to call a section in a failure message — its accessible name if it has
 *  one, otherwise its class list. */
const nameOf = (tag: string) =>
  /aria-label(?:ledby)?="([^"]*)"/.exec(tag)?.[1] ?? /className="([^"]*)"/.exec(tag)?.[1] ?? tag.slice(0, 70)

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

describe('⚖ Liam 8/23 — the room declares every section it renders', () => {
  it('THE CENSUS IS STRUCTURAL — every <section> the screen renders carries the pair', () => {
    // Derived from the JSX, never listed. This is the pin the open-transaction
    // panel walked straight past: it rendered a whole half of the page — its own
    // heading, its actions, its five sub-sections — and declared nothing, so the
    // walk stepped from the ledger into the transaction's inner blocks with
    // nothing explaining the panel they belong to.
    expect(SECTIONS.length).toBeGreaterThan(8)
    for (const tag of SECTIONS) {
      expect({
        section: nameOf(tag),
        declares: tag.includes('data-guide-title=') && tag.includes('data-guide='),
      }).toEqual({ section: nameOf(tag), declares: true })
    }
  })

  it('no title is claimed twice — two sections with one name is one of them unreachable', () => {
    const titles = DECLARATIONS.map((d) => d.title)
    expect(titles.length).toBe(new Set(titles).size)
    expect(titles.length).toBeGreaterThanOrEqual(SECTIONS.length)
  })

  it('every declaration carries BOTH attributes, and each is a sentence, not a label', () => {
    // A `data-guide` with no title (or the other way round) renders a step with
    // half a card — and `spotTargets` picks the element up regardless, so the
    // pairing has to be pinned rather than assumed.
    expect(SRC_CODE.match(/data-guide-title="/g) ?? []).toHaveLength(DECLARATIONS.length)
    expect(SRC_CODE.match(/data-guide="/g) ?? []).toHaveLength(DECLARATIONS.length)
    for (const d of DECLARATIONS) {
      expect({ title: d.title, empty: d.text.trim() === '' }).toEqual({ title: d.title, empty: false })
      expect({ title: d.title, sentence: d.text.trim().endsWith('。') }).toEqual({ title: d.title, sentence: true })
    }
  })

  /** ⚖ THE TAP TARGET IS THE HEADING — the room-3 finding, inherited as a build
   *  rule from day one. A reader taps the WORD 決済手段の台帳, because the word is
   *  the thing they are asking about; the walk has to jump there. A declaration
   *  on the BOX alone leaves the 見出し a few pixels above the rect, so the tap
   *  hits the scrim and CLOSES the tour on the exact gesture it advertises.
   *
   *  A heading is inside its section's rect exactly when the declaration sits on
   *  an ANCESTOR of it, and the shape that breaks that is the heading as a
   *  PREVIOUS SIBLING — which reads in source as the heading appearing BEFORE
   *  its own declaration. That is the tripwire here, and the pairs are DERIVED:
   *  a declared title is matched against a heading node whose whole text is that
   *  same title. Sections whose heading is not their title (the open transaction
   *  is headed by the customer's name) and sections that print no heading at all
   *  (the strips, the filter row) simply have no pair to check — and the rects
   *  themselves are measured for real, in Chromium, by the room's probe. */
  it('every section that PRINTS its own heading declares from ABOVE it — the heading is IN the rect', () => {
    let checked = 0
    for (const d of DECLARATIONS) {
      const heading = new RegExp(`>${escapeRe(d.title)}</(?:h1|h2|strong|div)>`).exec(SRC_CODE)
      if (heading === null) continue
      checked += 1
      expect({ title: d.title, declaresFromAbove: d.at < heading.index }).toEqual({
        title: d.title,
        declaresFromAbove: true,
      })
    }
    // Guard of the guard: a derivation that matched nothing would pass silently.
    expect(checked).toBeGreaterThanOrEqual(10)
  })

  it('the facts a money desk owes the reader are IN the declarations', () => {
    const by = (title: string) => DECLARATIONS.find((d) => d.title === title)!.text
    // Step 0 carries what the page is FOR — and the one claim that makes every
    // figure on it checkable.
    expect(by('売上・レジ')).toContain('記録された取引から計算')
    // The totals are FACTS and the counters are FILTERS. The tour says which is
    // which, because on screen they wear the same strip.
    expect(by('本日の売上集計')).toContain('押しても絞り込みは変わりません')
    expect(by('取引の件数')).toContain('絞り込みボタン')
    // The open transaction says it is ONE row's worth of page, so a reader who
    // walked in from the ledger knows what they are looking at.
    expect(by('開いている取引')).toContain('台帳で選んだ1件')
    // 受付価格 is the record, and a later price change never re-prices a sale.
    expect(by('予約時価格のスナップショット')).toContain('計算しなおしません')
    // The refund is refused — and what it WOULD do is shown anyway.
    expect(by('返金・取消の内容')).toContain('隠しません')
    // ONE VERDICT, and the tour says so where a reader could otherwise suspect
    // two.
    expect(by('閉店への影響')).toContain('同じ判定')
    // The threshold is a dial, and an over-threshold difference needs a reason
    // AND an approval.
    expect(by('現金ドロア')).toContain('許容額')
    // 監査履歴 states its direction.
    expect(by('監査履歴')).toContain('新しいもの')
  })

  it('the ≤743 band really swaps the two halves — the sheet says so, the probe measures it', () => {
    // The band's own rules, read off the shipped stylesheet rather than
    // restated. What each state actually RENDERS is measured in Chromium
    // (PROBE D4); what the sheet promises is here.
    const band = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 743px)'))
    expect(band).toContain('.biz .pg-register .rg-detail { display: none; }')
    expect(band).toContain('.biz .pg-register.is-detail .rg-ledger { display: none; }')
    expect(band).toContain('.biz .pg-register.is-detail .rg-detail { display: block; }')
    // ⚠ THE CLOSING PANELS NO LONGER NEED HIDING HERE. They used to sit under the
    // ledger at every width, so a phone reader who opened a transaction had the
    // day's close beneath it and the sheet had to say so. Since the restructure
    // they live in the OTHER MODE and are not mounted at all while the reader is
    // in 取引 — the rule is gone because the shape that needed it is.
    expect(band).not.toContain('.rg-closing { display: none;')
    expect(SRC_CODE).toContain("{close && cash && mode === 'close' && (")
  })

  it('⑯ the phone’s 閉店 screen is ordered around COUNTING, and nothing is hidden', () => {
    // A closer standing at the register at 21:00 has a drawer of cash in one hand
    // and the phone in the other: the count is the FIRST thing they do and the
    // checklist is what they read once the number is in. On a laptop the two
    // columns are side by side and order is not a question — on a phone the order
    // IS the experience.
    const band = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 743px)'))
    expect(band).toContain('.biz .pg-register .rg-right { display: contents; }')
    expect(band).toMatch(/\.rg-cash \{ order: 1; \}/)
    expect(band).toMatch(/\.rg-close \{ order: 2; \}/)
    expect(band).toMatch(/\.rg-reconpanel \{ order: 3; \}/)
    // ⑰/⑱ the day-strips and the record fold to one line each — IN 閉店 ONLY, and
    // every one of them opens again on a tap. Folded is not gone.
    expect(band).toContain('.biz .pg-register.is-close .rg-fold { display: flex; }')
    expect(band).toMatch(/is-close \.rg-money:not\(\.is-open\)/)
    expect(band).toMatch(/is-close \.rg-counts:not\(\.is-open\)/)
    expect(band).toMatch(/\.rg-record:not\(\.is-open\) \{ display: none; \}/)
    // …the exception band keeps its HEADLINE while it is folded, because an
    // exception a closer cannot see is the worst possible fold.
    expect(band).toContain('.biz .pg-register.is-close .rg-terminal-more { display: inline-flex; }')
    expect(band).toMatch(/is-close \.rg-terminal:not\(\.is-open\) \.rg-terminal-stat/)
    // Every fold is a real control with a real state, not a CSS trick.
    for (const key of ['money', 'counts', 'terminal', 'record']) {
      expect({ key, wired: SRC_CODE.includes(`toggleFold('${key}')`) }).toEqual({ key, wired: true })
    }
    expect(SRC_CODE).toContain('const toggleFold = (key: FoldKey) => setFolds((f) => ({ ...f, [key]: !f[key] }))')
  })

  it('⑫ the refusal line is the SAME STRING as the tooltip, and only touch widths see it', () => {
    const band = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 743px)'))
    // Hidden by default, shown in the phone band — `span.` and not `.`, because
    // two of these lines live inside boxes whose own sheet says `span` is a
    // BLOCK, and a refusal that reappears on a pointer width because a
    // neighbouring rule out-specifies it is worse than no refusal at all.
    expect(CSS_CODE).toContain('.biz .pg-register span.rg-refusal { display: none; }')
    expect(band).toMatch(/span\.rg-refusal \{ display: block;/)
    expect(SRC_CODE).toContain('aria-label={`${label} — ${reason}`}')
    expect(SRC_CODE).toContain('<span className="rg-refusal" aria-hidden="true">{reason}</span>')
  })
})

describe('⚖ Liam 8/23 — the engine really walks this room', () => {
  /** The engine's own inputs, handed to it directly. Nothing here is a replica
   *  of the room: it is two nested boxes and two declared nodes, which is what
   *  `spotTargets` and `spotHitIndex` are functions OF. The room's real shape is
   *  walked in the browser. */
  const rect = (box: { left: number; top: number; width: number; height: number }) =>
    ({
      ...box,
      right: box.left + box.width,
      bottom: box.top + box.height,
      x: box.left,
      y: box.top,
      toJSON: () => box,
    }) as DOMRect

  it('the registry is the DOM — anything declared joins, in DOM order', () => {
    document.body.innerHTML =
      '<div id="root"><div data-guide-title="A" data-guide="a。"></div><div data-guide-title="B" data-guide="b。"></div></div>'
    const root = document.getElementById('root')!
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-guide]'))) {
      el.getBoundingClientRect = () => rect({ left: 0, top: 0, width: 100, height: 20 })
    }
    expect(spotTargets(root).map((el) => el.dataset.guideTitle)).toEqual(['A', 'B'])
  })

  it('a section that is not on screen DROPS OUT of the walk and out of the count', () => {
    // The ≤743 swap, the zero-day card and a role-gated strip all reach the
    // engine as exactly this: an element with no box.
    const root = document.getElementById('root')!
    const b = root.querySelector<HTMLElement>('[data-guide-title="B"]')!
    b.getBoundingClientRect = () => rect({ left: 0, top: 0, width: 0, height: 0 })
    expect(spotTargets(root).map((el) => el.dataset.guideTitle)).toEqual(['A'])
  })

  it('TAP-TO-JUMP resolves to the SMALLEST declared section under the tap', () => {
    // The room's declarations NEST — the ledger panel contains its filter row,
    // the open transaction contains its five blocks — so a tap lands inside two
    // or three declared regions and the smallest has to win, or a reader tapping
    // the thing they are asking about gets the outer panel's answer.
    const panel = { left: 0, top: 0, width: 380, height: 600 }
    const filters = { left: 10, top: 60, width: 360, height: 40 }
    expect(spotHitIndex(100, 70, [panel, filters])).toBe(1)
    // …and the order the rects arrive in cannot decide it.
    expect(spotHitIndex(100, 70, [filters, panel])).toBe(0)
    // A tap on nothing declared is -1, which is what closes the tour.
    expect(spotHitIndex(900, 70, [panel, filters])).toBe(-1)
  })

  it('THE RING closes at both ends, over this room’s own step count', () => {
    const total = DECLARATIONS.length
    expect(total).toBeGreaterThan(0)
    expect(wrapStep(total - 1, total)).toBe(total - 1)
    expect(wrapStep(total, total)).toBe(0) // 次へ on the last step returns to the first
    expect(wrapStep(-1, total)).toBe(total - 1) // 前へ from the first goes to the last
    // A page with nothing declared has no tour to be on.
    expect(wrapStep(1, 0)).toBe(-1)
  })
})

describe('⚖ Liam 8/23 — the ? is wired to the walk, and the keyboard is not stranded', () => {
  it('the trigger OPENS the tour at step 0, and the overlay exists only while it is open', () => {
    expect(SRC_CODE).toContain('onClick={() => setTourIdx(0)}')
    expect(SRC_CODE).toContain('{tourOpen && (')
    expect(SRC_CODE).toContain('const tourOpen = tourIdx >= 0')
    // The four layers, in the board's own order.
    for (const cls of ['rg-spot-catch', 'rg-spot-hover', 'rg-spot-hole', 'rg-spot-card']) {
      expect(SRC_CODE).toContain(`className="${cls}"`)
    }
    // The catcher is what makes tap-to-jump reachable at all: it hit-tests, and
    // a tap on nothing declared closes the tour.
    expect(SRC_CODE).toContain('const hit = spotHitIndex(e.clientX, e.clientY, tourRectsRef.current)')
    expect(SRC_CODE).toContain('if (hit >= 0) setTourIdx(hit)')
    expect(SRC_CODE).toContain('else setTourIdx(-1)')
    // THE CARD CARRIES THE SECTION'S OWN COPY, read off the element the walk is
    // standing on. A tour that opens a card and explains nothing is a dead lever
    // one layer prettier.
    expect(SRC_CODE).toContain(
      "const nextStep = { title: el.dataset.guideTitle ?? '', text: el.dataset.guide ?? '', idx: i, total: targets.length }",
    )
    expect(SRC_CODE).toContain("<b>{tourStep?.title ?? ''}</b>")
    expect(SRC_CODE).toContain('<span className="rg-spot-text">{tourStep?.text ?? \'\'}</span>')
  })

  it('次へ rings, and says so on the last step', () => {
    expect(SRC_CODE).toContain('onClick={() => setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))}')
    expect(SRC_CODE).toContain('onClick={() => setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))}')
    expect(SRC_CODE).toContain("{tourStep && tourStep.idx === tourStep.total - 1 ? '最初へ' : '次へ'}")
    // The count is the LIVE total, so a section that dropped out is not counted.
    expect(SRC_CODE).toContain('${tourStep.idx + 1} / ${tourStep.total}')
  })

  it('the keyboard walks it, Escape closes it, and focus goes back to the ?', () => {
    expect(SRC_CODE).toContain("if (e.key === 'ArrowRight') setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))")
    expect(SRC_CODE).toContain("if (e.key === 'ArrowLeft') setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))")
    expect(SRC_CODE).toContain("if (e.key === 'Escape') setTourIdx(-1)")
    // Enter advances because focus is ON 次へ while the tour runs — and the ?
    // gets focus back when it closes, rather than the reader being dropped at
    // the top of the document.
    expect(SRC_CODE).toContain('tourNextRef.current?.focus()')
    expect(SRC_CODE).toContain('helpRef.current?.focus()')
    expect(SRC_CODE).toContain('const wasOpen = useRef(false)')
  })

  it('the walk is scoped to the ROOM, and re-measures when the page moves under it', () => {
    // The shell's rail and topbar are not this page; the room is also rendered
    // on its own in the evidence harness, where `document` would be the harness.
    expect(SRC_CODE).toContain('const targets = spotTargets(rootRef.current)')
    expect(SRC_CODE).toContain('ref={rootRef}')
    // The hole is drawn in viewport coordinates, so a scroll or a resize has to
    // re-measure or it drifts off the section it is explaining.
    expect(SRC_CODE).toContain("window.addEventListener('resize', bump)")
    expect(SRC_CODE).toContain("window.addEventListener('scroll', bump, true)")
    // ⚖ page-scroll: the overlay adds no scroller of its own, and caps no height.
    expect(CSS_CODE).not.toMatch(/\.rg-spot[^{]*\{[^}]*overflow/)
    expect(CSS_CODE).not.toMatch(/\.rg-spot[^{]*\{[^}]*max-height/)
  })

  it('the overlay does not borrow a NEIGHBOUR’s class names', () => {
    // 今日の運営 states bare `.biz .spot-*` rules and 受信トレイ owns the `ib-`
    // spelling; App Router leaves both sheets in the document after a soft-nav.
    // A shared name here would be three rooms' overlays fighting over one paint.
    expect(CSS_CODE).not.toMatch(/\.biz\s+\.spot-/)
    expect(SRC_CODE).not.toMatch(/className="(?!rg-)[a-z-]*spot-/)
  })
})
