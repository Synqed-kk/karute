/**
 * @jest-environment jsdom
 *
 * 売上・レジ — ⚖ Liam's 8/23 GUIDED ?-TOUR law, this room's half.
 *
 * THE LAW: every Business page ships the 画面の説明 tour in the 今日の運営 style
 * — a ? trigger, a spotlight walk of the page's sections in visual order, and
 * tap-any-element-to-learn during the walk. Sections SELF-REGISTER by declaring
 * `data-guide` + `data-guide-title` on themselves, so anything that renders is
 * explained and anything hidden drops out. Enforcement has two halves, and both
 * are here: at RUNTIME the walker picks up whatever is declared, and at BUILD
 * TIME every section declares itself the day it lands — which is the census.
 *
 * MECHANISM, and its honest ceiling. Territory's import fence allows only
 * react/next/node specifiers (business-isolation.test.ts, `ALLOWED_BARE`), so
 * react-dom does not resolve here and no suite in this folder can mount a React
 * tree — the house pattern every screen-interactions suite here already uses.
 * So the split is:
 *
 *   · THE CENSUS AND THE ORDER are derived from the screen's own JSX, which is
 *     static markup in source order, so source order IS DOM order.
 *   · THE ENGINE IS REALLY RUN, over a jsdom DOM built from that census and
 *     this room's OWN stylesheet rules — the same `spotTargets` /
 *     `spotHitIndex` / `wrapStep` the browser runs.
 *   · THE RENDERED DOM ITSELF is censused in Chromium by the room's probe
 *     (`probe/`, PROBE G), on `renderToString(<RegisterScreen/>)` hydrated for
 *     real. A mutation that removes a declaration goes red in BOTH places.
 *
 * jsdom does no layout, so `getBoundingClientRect` returns zeros for everything
 * and the visibility filter would drop the whole page. Every test that needs
 * geometry stubs it — what is proven here is the WIRING; the pixels are proven
 * in the browser.
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

type Declaration = { title: string; text: string; at: number }
const DECLARATIONS: Declaration[] = [
  ...SRC_CODE.matchAll(/data-guide-title="([^"]*)"\s*\n\s*data-guide="([^"]*)"/g),
].map((m) => ({ title: m[1], text: m[2], at: m.index ?? 0 }))

/** ⚖ THE ROOM'S DECLARED SECTIONS, in visual order. This list is the contract:
 *  a section that renders without joining it fails the round, and a section that
 *  leaves the page leaves this list in the same pass.
 *
 *  The room never paints all twenty AT ONCE — the zero-day card replaces the
 *  workspace, 閉店処理 replaces the two closing panels under a storeless lens,
 *  the 権限 note appears only for a role that is missing something, and ≤743
 *  shows one half at a time. That is exactly what the engine's visibility filter
 *  is for. What each STATE renders is censused in the browser probe; what the
 *  room may declare at all is here. */
const CENSUS = [
  '売上・レジ',
  'この役割でできること',
  '決済端末の状態',
  '本日の売上集計',
  '取引の件数',
  '本日の取引はまだありません',
  '取引・決済台帳',
  '台帳の絞り込み',
  'この取引でできること',
  '取引の事実',
  '決済手段の台帳',
  '予約時価格のスナップショット',
  '返金・取消の内容',
  '閉店への影響',
  '監査履歴',
  '現金ドロア',
  '閉店チェック',
  '閉店で記録される内容',
  '決済手段の内訳',
  '閉店処理',
]

/** The three regions the ≤743 band swaps between. Source position IS containment
 *  here: the screen renders the ledger panel, then the transaction panel, then
 *  the closing band, each nested exactly once and in that order. */
const LEDGER_AT = SRC_CODE.indexOf('className="rg-panel rg-ledger"')
const DETAIL_AT = SRC_CODE.indexOf('className="rg-panel rg-detail"')
const CLOSING_AT = SRC_CODE.indexOf('className="rg-closing"')
const inLedger = (d: Declaration) => d.at > LEDGER_AT && d.at < DETAIL_AT
const inDetail = (d: Declaration) => d.at > DETAIL_AT && d.at < CLOSING_AT
const inClosing = (d: Declaration) => d.at > CLOSING_AT
const atPageLevel = (d: Declaration) => !inLedger(d) && !inDetail(d) && !inClosing(d)
const LEDGER_ONLY = DECLARATIONS.filter(inLedger).map((d) => d.title)
const DETAIL_ONLY = DECLARATIONS.filter(inDetail).map((d) => d.title)
const CLOSING_ONLY = DECLARATIONS.filter(inClosing).map((d) => d.title)

/** Every `display` rule this room's OWN sheet states in the ≤743 band, in sheet
 *  order — derived rather than restated, which is what makes the phone census a
 *  fact about the shipped stylesheet and not about the test's own scaffolding.
 *  Both directions are collected on purpose: the band hides the transaction half
 *  AND un-hides it under `.is-detail`. Last matching rule wins, which is what
 *  the cascade does here (the override is later AND more specific). */
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

/** Build the room's shape in jsdom: the shell class, the page root, the three
 *  regions, and every declared section in its own place. Rects are stubbed —
 *  zero for anything the sheet hides at this width, a real box otherwise, which
 *  is exactly what a browser reports for `display: none`. */
function room({ phone = false, detail = false } = {}): HTMLElement {
  document.body.innerHTML = ''
  const shell = document.createElement('div')
  shell.className = 'biz'
  const page = document.createElement('div')
  page.className = `page pg-register${detail ? ' is-detail' : ''}`
  shell.append(page)
  document.body.append(shell)

  const declare = (parent: Element, d: Declaration) => {
    const el = document.createElement('div')
    el.dataset.guideTitle = d.title
    el.dataset.guide = d.text
    parent.append(el)
  }
  const region = (cls: string, tag = 'section') => {
    const el = document.createElement(tag)
    el.className = cls
    page.append(el)
    return el
  }
  for (const d of DECLARATIONS.filter(atPageLevel)) declare(page, d)
  const ledger = region('rg-panel rg-ledger')
  for (const d of DECLARATIONS.filter(inLedger)) declare(ledger, d)
  const detailPanel = region('rg-panel rg-detail')
  for (const d of DECLARATIONS.filter(inDetail)) declare(detailPanel, d)
  const closing = region('rg-closing', 'div')
  for (const d of DECLARATIONS.filter(inClosing)) declare(closing, d)

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

  it('the walk is in VISUAL ORDER — head, the money, the numbers, the ledger, the open transaction, the close', () => {
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

  /** ⚖ THE TAP TARGET IS THE HEADING — the room-3 finding, inherited as a build
   *  rule from day one. A reader taps the WORD 決済手段の台帳, because the word is
   *  the thing they are asking about; the walk has to jump there. A declaration
   *  on the BOX alone leaves the 見出し a few pixels above the rect, so the tap
   *  hits the scrim and CLOSES the tour on the exact gesture it advertises.
   *
   *  A heading is inside its section's rect exactly when the declaration sits on
   *  an ANCESTOR of it, and the shape that breaks that is the heading as a
   *  PREVIOUS SIBLING — which reads in source as the heading appearing BEFORE
   *  its own declaration. That is the tripwire here. The rects themselves are
   *  measured for real, in Chromium, by the room's probe.
   *
   *  Sections absent from this list print no heading of their own: the strips,
   *  the filter row and この取引でできること are labelled for assistive tech only. */
  const HEADINGS: Array<[string, string]> = [
    ['売上・レジ', '<h1>売上・レジ</h1>'],
    ['取引・決済台帳', '<strong id="rgLedgerTitle">取引・決済台帳</strong>'],
    ['取引の事実', '<div className="rg-title">取引の事実</div>'],
    ['決済手段の台帳', '<div className="rg-title">決済手段の台帳</div>'],
    ['予約時価格のスナップショット', '<div className="rg-title">予約時価格のスナップショット</div>'],
    ['返金・取消の内容', '<div className="rg-title">返金・取消の内容</div>'],
    ['閉店への影響', '<div className="rg-title">閉店への影響</div>'],
    ['監査履歴', '<div className="rg-title">監査履歴</div>'],
    ['現金ドロア', '<strong id="rgCashTitle">現金ドロア</strong>'],
    ['閉店チェック', '<strong id="rgCloseTitle">閉店チェック</strong>'],
    ['決済手段の内訳', '<div className="rg-title">決済手段の内訳</div>'],
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

  it('the facts a money desk owes the reader are IN the declarations', () => {
    const by = (title: string) => DECLARATIONS.find((d) => d.title === title)!.text
    // Step 0 carries what the page is FOR — and the one claim that makes every
    // figure on it checkable.
    expect(by('売上・レジ')).toContain('記録された取引から計算')
    // The totals are FACTS and the counters are FILTERS. The tour says which is
    // which, because on screen they wear the same strip.
    expect(by('本日の売上集計')).toContain('押しても絞り込みは変わりません')
    expect(by('取引の件数')).toContain('絞り込みボタン')
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
})

describe('⚖ Liam 8/23 — the engine really walks this room', () => {
  it('the walk picks up exactly what is declared, in DOM order', () => {
    expect(spotTargets(room()).map((el) => el.dataset.guideTitle)).toEqual(CENSUS)
  })

  it('a section that is not on screen DROPS OUT of the walk and out of the count', () => {
    const page = room()
    const tenders = spotTargets(page).find((el) => el.dataset.guideTitle === '決済手段の台帳')!
    tenders.getBoundingClientRect = () => rect({ left: 0, top: 0, width: 0, height: 0 })
    const walk = spotTargets(page).map((el) => el.dataset.guideTitle)
    expect(walk).not.toContain('決済手段の台帳')
    expect(walk).toHaveLength(CENSUS.length - 1)
  })

  it('≤743 — the transaction half is absent while the reader is on the ledger', () => {
    // The sheet hides `.rg-detail` in this band, so the sections inside the open
    // transaction are not on screen and the tour does not pretend they are.
    expect(DETAIL_ONLY.length).toBeGreaterThan(0)
    const walk = spotTargets(room({ phone: true })).map((el) => el.dataset.guideTitle)
    expect(walk).toEqual(CENSUS.filter((t) => !DETAIL_ONLY.includes(t)))
  })

  it('≤743 — the LEDGER and the CLOSE are absent once a transaction is open', () => {
    // …and the swap the other way: `.pg-register.is-detail .rg-ledger` and the
    // closing band are hidden, so the ledger, its filter row and the whole close
    // leave the walk. A reader who opened one transaction should not have the
    // day's close under it, and the tour reads the page as it stands.
    expect(LEDGER_ONLY.length).toBeGreaterThan(0)
    expect(CLOSING_ONLY.length).toBeGreaterThan(0)
    const walk = spotTargets(room({ phone: true, detail: true })).map((el) => el.dataset.guideTitle)
    expect(walk).toEqual(CENSUS.filter((t) => !LEDGER_ONLY.includes(t) && !CLOSING_ONLY.includes(t)))
  })

  it('TAP-TO-JUMP resolves to the SMALLEST declared section under the tap', () => {
    // The ledger panel CONTAINS its filter row, so a tap on the filter row lands
    // inside two declared regions. The smaller one wins, or a reader tapping the
    // thing they are asking about gets the panel's answer.
    expect(LEDGER_ONLY).toContain('台帳の絞り込み')
    const ledger = { left: 0, top: 0, width: 380, height: 600 }
    const filters = { left: 10, top: 60, width: 360, height: 40 }
    expect(spotHitIndex(100, 70, [ledger, filters])).toBe(1)
    // …and the order the rects arrive in cannot decide it.
    expect(spotHitIndex(100, 70, [filters, ledger])).toBe(0)
    // A tap on nothing declared is -1, which is what closes the tour.
    expect(spotHitIndex(900, 70, [ledger, filters])).toBe(-1)
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
