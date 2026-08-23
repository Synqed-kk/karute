/**
 * @jest-environment jsdom
 *
 * 受信トレイ — ⚖ Liam's 8/23 GUIDED ?-TOUR law, this room's half.
 *
 * THE LAW: every Business page ships the 画面の説明 tour in the 今日の運営 style
 * — a ? trigger, a spotlight walk of the page's sections in visual order, and
 * tap-any-element-to-learn during the walk. Sections SELF-REGISTER by declaring
 * `data-guide` + `data-guide-title` on themselves, so anything that renders is
 * explained and anything hidden drops out. Enforcement has two halves, and both
 * are here: at RUNTIME the walker picks up whatever is declared (Liam's "when I
 * add a function it should automatically pick it up"), and at BUILD TIME every
 * section declares itself the day it lands — which is what the census below is.
 *
 * MECHANISM, and its honest ceiling. Territory's import fence allows only
 * react/next/node specifiers (business-isolation.test.ts, `ALLOWED_BARE`), so
 * react-dom does not resolve here and no suite in this folder can mount a React
 * tree — the house pattern every screen-interactions suite in this directory
 * already uses. So the split is:
 *
 *   · THE CENSUS AND THE ORDER are derived from the screen's own JSX, which is
 *     static markup in source order, so source order IS DOM order.
 *   · THE ENGINE IS REALLY RUN, over a jsdom DOM built from that census and
 *     from this room's OWN stylesheet rules — the same `spotTargets` /
 *     `spotHitIndex` / `wrapStep` the browser runs.
 *   · THE RENDERED DOM ITSELF is censused in Chromium by the room's probe
 *     (`rebuild-probe/`, PROBE G), on `renderToString(<InboxScreen/>)` hydrated
 *     for real. That is where "the rendered set equals this list" is proven; a
 *     mutation that removes a declaration goes red in BOTH places.
 *
 * jsdom does no layout, so `getBoundingClientRect` returns zeros for everything
 * and the visibility filter would drop the whole page. Every test that needs
 * geometry stubs it — the same thing today-screen-interactions.test.ts does,
 * and honest for the same reason: what is proven here is the WIRING, and the
 * pixels are proven in the browser.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spotHitIndex, spotTargets, wrapStep } from '@/business/lib/guide'

const ROOM_DIR = 'src/app/[locale]/(business)/business/inbox'
const SRC = readFileSync(join(process.cwd(), `${ROOM_DIR}/InboxScreen.tsx`), 'utf8')
const CSS = readFileSync(join(process.cwd(), `${ROOM_DIR}/inbox.css`), 'utf8')

/** Source pins read CODE, not prose: the screen documents the tour in comments
 *  that quote the very attributes these pins look for. */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '')
const SRC_CODE = stripComments(SRC).replace(/^\s*\/\/.*$/gm, '')
const CSS_CODE = stripComments(CSS)

/** Every declaration the screen makes, in source order — which for static JSX
 *  is the order the browser puts them in the DOM, and therefore the order the
 *  walk visits them in. */
type Declaration = { title: string; text: string; at: number }
const DECLARATIONS: Declaration[] = [
  ...SRC_CODE.matchAll(/data-guide-title="([^"]*)"\s*\n\s*data-guide="([^"]*)"/g),
].map((m) => ({ title: m[1], text: m[2], at: m.index ?? 0 }))

/** ⚖ THE ROOM'S DECLARED SECTIONS, in visual order. This list is the contract:
 *  a section that renders without joining it fails the round (25c, with teeth),
 *  and a section that leaves the page has to leave this list in the same pass.
 *
 *  The room never paints all twelve AT ONCE — the all-clear card replaces the
 *  whole workspace, and ≤743 shows one half at a time — and that is exactly
 *  what the engine's visibility filter is for. What each STATE renders is
 *  censused in the browser probe; what the room may declare at all is here. */
const CENSUS = [
  '受信トレイ',
  '対応状況',
  'すべて対応済み',
  '店舗の対応キュー',
  '最新状態を確認',
  '対応キューの絞り込み',
  'この対応でできること',
  '対応の事実',
  '連絡同意',
  '証跡',
  '返信の下書き',
  '履歴',
]

/** The two panels the ≤743 band swaps between. Source position IS containment
 *  here: the screen renders the queue panel, then the detail panel, in that
 *  order and nested exactly once, so a declaration between the two markers is
 *  inside the queue and one after the second marker is inside the detail. A
 *  section moved from one panel to the other changes these sets. */
const QUEUE_AT = SRC_CODE.indexOf('className="ib-panel ib-queue"')
const DETAIL_AT = SRC_CODE.indexOf('className="ib-panel ib-detail"')
const inQueue = (d: Declaration) => d.at > QUEUE_AT && d.at < DETAIL_AT
const inDetail = (d: Declaration) => d.at > DETAIL_AT
const atPageLevel = (d: Declaration) => !inQueue(d) && !inDetail(d)
const QUEUE_ONLY = DECLARATIONS.filter(inQueue).map((d) => d.title)
const DETAIL_ONLY = DECLARATIONS.filter(inDetail).map((d) => d.title)

/** Every `display` rule this room's OWN sheet states in the ≤743 band, in sheet
 *  order — derived rather than restated, which is what makes the phone census
 *  below a fact about the shipped stylesheet and not about the test's own
 *  scaffolding. Both directions are collected on purpose: the band hides the
 *  thread half AND un-hides it under `.is-detail`, so a reading that only
 *  looked for `display: none` would report both halves gone at once. Last
 *  matching rule wins, which is what the cascade does here (the override is
 *  later AND more specific, so the two agree). */
function phoneDisplay(): Array<{ sel: string; value: string }> {
  const band = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 743px)'))
  return [...band.matchAll(/([^{}]+)\{([^}]*)\}/g)].flatMap((m) => {
    const display = /(?:^|;)\s*display:\s*([^;]+)/.exec(m[2])
    if (!display) return []
    return m[1]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.startsWith('.biz') && !s.includes('::'))
      .map((sel) => ({ sel, value: display[1].trim() }))
  })
}

const rect = (box: { left: number; top: number; width: number; height: number }) =>
  ({
    ...box,
    right: box.left + box.width,
    bottom: box.top + box.height,
    x: box.left,
    y: box.top,
    toJSON: () => box,
  }) as DOMRect

/** Build the room's shape in jsdom: the shell class, the page root, the two
 *  panels, and every declared section in its own place. Rects are stubbed —
 *  zero for anything the sheet hides at this width, a real box otherwise, which
 *  is exactly what a browser reports for `display: none`. */
function room({ phone = false, detail = false } = {}): HTMLElement {
  document.body.innerHTML = ''
  const shell = document.createElement('div')
  shell.className = 'biz'
  const page = document.createElement('div')
  page.className = `page pg-inbox${detail ? ' is-detail' : ''}`
  shell.append(page)
  document.body.append(shell)

  const declare = (parent: Element, d: Declaration) => {
    const el = document.createElement('div')
    el.dataset.guideTitle = d.title
    el.dataset.guide = d.text
    parent.append(el)
  }
  const panel = (cls: string) => {
    const el = document.createElement('section')
    el.className = cls
    page.append(el)
    return el
  }
  for (const d of DECLARATIONS.filter(atPageLevel)) declare(page, d)
  const queue = panel('ib-panel ib-queue')
  for (const d of DECLARATIONS.filter(inQueue)) declare(queue, d)
  const detailPanel = panel('ib-panel ib-detail')
  for (const d of DECLARATIONS.filter(inDetail)) declare(detailPanel, d)

  const rules = phone ? phoneDisplay() : []
  const gone = (el: HTMLElement) => {
    let verdict = ''
    for (const r of rules) if (el.closest(r.sel) !== null) verdict = r.value
    return verdict === 'none'
  }
  let top = 0
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('.biz *'))) {
    if (gone(el)) {
      el.getBoundingClientRect = () => rect({ left: 0, top: 0, width: 0, height: 0 })
      continue
    }
    top += 40
    const box = { left: 20, top, width: 600, height: 30 }
    el.getBoundingClientRect = () => rect(box)
  }
  return page
}

describe('⚖ Liam 8/23 — the room declares every section it renders', () => {
  it('the census is EXACT — every section carries the pair, and nothing else claims one', () => {
    // Set equality in both directions: a section added without a declaration is
    // missing from the left, and a declaration for something that no longer
    // renders is left over on the right. Either way the round fails.
    expect(DECLARATIONS.map((d) => d.title).sort()).toEqual([...CENSUS].sort())
  })

  it('the walk is in VISUAL ORDER — head, the numbers, the queue, then the open thread', () => {
    expect(DECLARATIONS.map((d) => d.title)).toEqual(CENSUS)
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

  /** ⚖ THE TAP TARGET IS THE HEADING — found live on the deployed page (1280,
   *  8/23). A reader taps the WORD 連絡同意, because the word is the thing they
   *  are asking about; the walk has to jump there. It did the opposite: four
   *  sections declared themselves on the BOX and left their own 見出し a few
   *  pixels above the declared rect, so the tap hit the scrim and CLOSED the
   *  tour on the exact gesture the tour advertises.
   *
   *  A heading is inside its section's rect exactly when the declaration sits on
   *  an ANCESTOR of it, and the only shape in this room's markup that breaks
   *  that is the heading as a PREVIOUS SIBLING — which reads in source as the
   *  heading appearing BEFORE its own declaration. That is the tripwire here.
   *  The rects themselves are measured for real, in Chromium, by the room's
   *  probe (PROBE G's heading-tap scene), which is where a heading that drifts
   *  out of a rect for any OTHER reason would be caught.
   *
   *  Sections absent from this list print no heading of their own: 対応状況 /
   *  この対応でできること / 対応キューの絞り込み are labelled for assistive tech
   *  only, and 最新状態を確認 IS its own label — the declaration is on the
   *  control the reader taps. すべて対応済み's card carries its heading inside
   *  the declared section already. */
  const HEADINGS: Array<[string, string]> = [
    ['受信トレイ', '<h1>受信トレイ</h1>'],
    ['店舗の対応キュー', '<strong id="ibQueueTitle">店舗の対応キュー</strong>'],
    ['対応の事実', '<div className="ib-title">対応の事実</div>'],
    ['連絡同意', '<div className="ib-title">連絡同意</div>'],
    ['証跡', '<div className="ib-title">証跡</div>'],
    ['返信の下書き', '<div className="ib-title">返信の下書き</div>'],
    ['履歴', '<div className="ib-title">履歴</div>'],
  ]

  it('every section that PRINTS a heading declares from ABOVE it — the heading is IN the rect', () => {
    for (const [title, heading] of HEADINGS) {
      const headingAt = SRC_CODE.indexOf(heading)
      const declaredAt = SRC_CODE.indexOf(`data-guide-title="${title}"`)
      expect({ title, prints: headingAt >= 0 }).toEqual({ title, prints: true })
      expect({ title, declaresFromAbove: declaredAt >= 0 && declaredAt < headingAt }).toEqual({
        title,
        declaresFromAbove: true,
      })
    }
  })

  it('the facts the room owes the reader are IN the declarations', () => {
    const by = (title: string) => DECLARATIONS.find((d) => d.title === title)!.text
    // The two paragraphs this page used to print every morning, as step 0.
    expect(by('受信トレイ')).toContain('店舗が次に行う対応')
    expect(by('受信トレイ')).toContain('顧客カルテの施術内容はここには表示しません')
    // The counters are filters — the whole reason the strip stopped being a
    // poster.
    expect(by('対応状況')).toContain('絞り込み')
    // The queue's order is derived, not a preference the store has to maintain.
    expect(by('店舗の対応キュー')).toContain('期限と予約への影響順')
    // 最新状態を確認 refuses today, and the card says why rather than leaving a
    // dead-looking button unexplained.
    expect(by('最新状態を確認')).toContain('見本データ')
    // The three consent states, including the one that is NOT a refusal.
    expect(by('連絡同意')).toContain('まだ聞いていない')
    // 履歴 states its direction.
    expect(by('履歴')).toContain('新しいもの')
  })
})

describe('⚖ Liam 8/23 — the engine really walks this room', () => {
  it('the walk picks up exactly what is declared, in DOM order', () => {
    expect(spotTargets(room()).map((el) => el.dataset.guideTitle)).toEqual(CENSUS)
  })

  it('a section that is not on screen DROPS OUT of the walk and out of the count', () => {
    const page = room()
    const consent = spotTargets(page).find((el) => el.dataset.guideTitle === '連絡同意')!
    consent.getBoundingClientRect = () => rect({ left: 0, top: 0, width: 0, height: 0 })
    const walk = spotTargets(page).map((el) => el.dataset.guideTitle)
    expect(walk).not.toContain('連絡同意')
    expect(walk).toHaveLength(CENSUS.length - 1)
  })

  it('≤743 — the thread half is absent while the reader is on the list', () => {
    // The sheet hides `.ib-detail` in this band, so the sections inside the open
    // thread are not on screen and the tour does not pretend they are.
    expect(DETAIL_ONLY.length).toBeGreaterThan(0)
    const walk = spotTargets(room({ phone: true })).map((el) => el.dataset.guideTitle)
    expect(walk).toEqual(CENSUS.filter((t) => !DETAIL_ONLY.includes(t)))
  })

  it('≤743 — the LIST half is absent once a thread is open', () => {
    // …and the swap the other way: `.pg-inbox.is-detail .ib-queue` is hidden, so
    // the queue, its filter row and 最新状態を確認 leave the walk. Opening the
    // tour unhides nothing — the engine reads the page as it stands.
    expect(QUEUE_ONLY.length).toBeGreaterThan(0)
    const walk = spotTargets(room({ phone: true, detail: true })).map((el) => el.dataset.guideTitle)
    expect(walk).toEqual(CENSUS.filter((t) => !QUEUE_ONLY.includes(t)))
  })

  it('TAP-TO-JUMP resolves to the SMALLEST declared section under the tap', () => {
    // The queue panel CONTAINS its filter row and 最新状態を確認, so a tap on the
    // filter row lands inside two declared regions. The smaller one wins, or a
    // reader tapping the thing they are asking about gets the panel's answer.
    expect(QUEUE_ONLY).toContain('対応キューの絞り込み')
    expect(QUEUE_ONLY).toContain('最新状態を確認')
    const queue = { left: 0, top: 0, width: 380, height: 600 }
    const filters = { left: 10, top: 60, width: 360, height: 40 }
    expect(spotHitIndex(100, 70, [queue, filters])).toBe(1)
    // …and the order the rects arrive in cannot decide it.
    expect(spotHitIndex(100, 70, [filters, queue])).toBe(0)
    // A tap on nothing declared is -1, which is what closes the tour.
    expect(spotHitIndex(900, 70, [queue, filters])).toBe(-1)
  })

  it('THE RING closes at both ends, over this room’s own step count', () => {
    const total = CENSUS.length
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
    for (const cls of ['ib-spot-catch', 'ib-spot-hover', 'ib-spot-hole', 'ib-spot-card']) {
      expect(SRC_CODE).toContain(`className="${cls}"`)
    }
    // The catcher is what makes tap-to-jump reachable at all: it hit-tests, and
    // a tap on nothing declared closes the tour.
    expect(SRC_CODE).toContain('const hit = spotHitIndex(e.clientX, e.clientY, tourRectsRef.current)')
    expect(SRC_CODE).toContain('if (hit >= 0) setTourIdx(hit)')
    expect(SRC_CODE).toContain('else setTourIdx(-1)')
    // THE CARD CARRIES THE SECTION'S OWN COPY, read off the element the walk is
    // standing on. A tour that opens a card and explains nothing is the dead
    // lever the disclosure was, one layer prettier.
    expect(SRC_CODE).toContain(
      "const nextStep = { title: el.dataset.guideTitle ?? '', text: el.dataset.guide ?? '', idx: i, total: targets.length }",
    )
    expect(SRC_CODE).toContain("<b>{tourStep?.title ?? ''}</b>")
    expect(SRC_CODE).toContain('<span className="ib-spot-text">{tourStep?.text ?? \'\'}</span>')
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
    expect(CSS_CODE).not.toMatch(/\.ib-spot[^{]*\{[^}]*overflow/)
    expect(CSS_CODE).not.toMatch(/\.ib-spot[^{]*\{[^}]*max-height/)
  })
})
