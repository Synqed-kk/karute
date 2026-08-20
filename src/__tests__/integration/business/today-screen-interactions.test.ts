/**
 * @jest-environment jsdom
 *
 * 今日の運営 board — interaction-parity tests (PACKET-PARITY-WAVE-2026-08-19
 * ADDENDUM 3). Territory's import fence allows only react/next/node specifiers
 * in this folder, so no DOM renderer and no @testing-library exist here. The
 * board's DOM-touching handlers are therefore small functions taking real
 * nodes (src/.../today/today-interactions.ts); this suite drives them with
 * plain jsdom — zero extra imports, every global from the jsdom runtime.
 *
 * jsdom does not do layout, so getBoundingClientRect returns zeros. Every test
 * that needs geometry stubs the rects it needs, which is honest: the geometry
 * itself is canon's and is proven arithmetically in canon-logic.test.ts. What
 * is proven HERE is the wiring — that a pointer at X on track T produces the
 * span canon's lattice says it should, that a release outside a lane refuses,
 * that a park/place round trip returns the card where it came from.
 */
import {
  applyMoves,
  blockChrome,
  clickClosesPopover,
  dragModeAt,
  deltaPctIn,
  fieldsPopAnchor,
  fractionIn,
  gapLayerFor,
  guardRailsFor,
  guardVerdictAt,
  isOverShelf,
  laneKeyAtY,
  laneSpans,
  nextSpan,
  parkChipText,
  reasonLine,
  sellLayerFor,
  slotStartAt,
  type GuardRail,
  type Moves,
} from '@/app/[locale]/(business)/business/today/today-interactions'
import { dragOrigin, stepPct } from '@/business/lib/canon-logic/drag-rules'
import { place, type BoardItem, type BoardLane } from '@/business/lib/today-board'

if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement): void {
    this.open = true
  }
}
if (typeof HTMLDialogElement.prototype.close !== 'function') {
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement): void {
    this.open = false
  }
}

const HOURS = { open: 600, close: 1140 } // 10:00–19:00
const STEP = stepPct(9)

/** jsdom has no layout: give a node the rect the test needs. */
function rect(el: Element, r: { left: number; top: number; width: number; height: number }) {
  el.getBoundingClientRect = () =>
    ({ left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height, width: r.width, height: r.height, x: r.left, y: r.top, toJSON: () => ({}) }) as DOMRect
}

function booking(over: Partial<BoardItem> & Pick<BoardItem, 'key' | 'caseId'>, start: number, end: number): BoardItem {
  return {
    kind: 'booking', state: 'confirmed', category: 'repeat',
    ...place(start, end, HOURS),
    title: '見本 はなこ', tag: '【ベッド1】', time: '',
    ticketCat: '単発', ticketCore: '¥6,600', held: false, micro: false,
    label: '', ...over,
  }
}

function lane(over: Partial<BoardLane> & Pick<BoardLane, 'key' | 'group'>): BoardLane {
  return {
    label: over.key, sub: '', absentNote: null, mine: false, items: [],
    window: over.group === 'staff' ? { from: HOURS.open, until: HOURS.close } : null,
    untilLabel: over.group === 'staff' ? '19:00' : null,
    listPrice: over.group === 'staff' ? 7000 : 0,
    stores: over.group === 'staff' ? null : ['store-a'],
    ...over,
  }
}

describe('drag wiring — a pointer event becomes canon geometry', () => {
  it('reads the grabbed edge off the card the pointer actually hit', () => {
    const card = document.createElement('button')
    rect(card, { left: 100, top: 0, width: 200, height: 40 })
    expect(dragModeAt(card, 105)).toBe('resizeL')
    expect(dragModeAt(card, 200)).toBe('move')
    expect(dragModeAt(card, 295)).toBe('resize')
  })

  it('turns pointer travel into a percentage of the track it started on', () => {
    const track = document.createElement('div')
    rect(track, { left: 0, top: 0, width: 900, height: 40 })
    expect(deltaPctIn(track, 90)).toBeCloseTo(10, 9)
    expect(fractionIn(track, 450)).toBeCloseTo(0.5, 9)
    // A track with no width (collapsed group) must not produce Infinity.
    const collapsed = document.createElement('div')
    rect(collapsed, { left: 0, top: 0, width: 0, height: 0 })
    expect(deltaPctIn(collapsed, 90)).toBe(0)
    expect(fractionIn(collapsed, 90)).toBe(0)
  })

  it('a half-hour drag lands exactly one 30-minute step later', () => {
    const track = document.createElement('div')
    // 900px over 9 hours: one hour is 100px, one 30-minute step is 50px.
    rect(track, { left: 0, top: 0, width: 900, height: 40 })
    const origin = dragOrigin(0, 100 / 9, 'move', STEP)
    expect(nextSpan(origin, track, 50, STEP).x).toBeCloseTo(STEP, 6)
    // 20px of travel is under half a step, so it snaps back to where it was.
    expect(nextSpan(origin, track, 20, STEP).x).toBeCloseTo(0, 6)
    // And a resize grows the width, never the start.
    const grow = nextSpan(dragOrigin(0, 100 / 9, 'resize', STEP), track, 50, STEP)
    expect(grow.x).toBe(0)
    expect(grow.w).toBeCloseTo(100 / 9 + STEP, 6)
  })

  it('the vertical resolver finds the lane under the pointer, and refuses the gap between groups', () => {
    const board = document.createElement('div')
    for (const [key, group, top] of [['p-01', 'staff', 0], ['p-04', 'staff', 40], ['bed-01', 'beds', 120]] as const) {
      const el = document.createElement('div')
      el.className = 'lane'
      el.dataset.lane = key
      el.dataset.group = group
      rect(el, { left: 0, top, width: 900, height: 40 })
      board.appendChild(el)
    }
    expect(laneKeyAtY(board, 'staff', 20)).toBe('p-01')
    expect(laneKeyAtY(board, 'staff', 50)).toBe('p-04')
    // The bed lane is a different group — a staff card released over it finds
    // nothing, which is what makes canon's 「予約を置く行の中で離してください」
    // fire instead of a silent no-op.
    expect(laneKeyAtY(board, 'staff', 130)).toBeNull()
    expect(laneKeyAtY(board, 'beds', 130)).toBe('bed-01')
    // Between the two staff rows there is no lane at all.
    expect(laneKeyAtY(board, 'staff', 100)).toBeNull()
    expect(laneKeyAtY(null, 'staff', 20)).toBeNull()
  })

  it('the WHOLE shelf bar is the drop zone, not just its label', () => {
    const shelf = document.createElement('div')
    rect(shelf, { left: 0, top: 400, width: 900, height: 38 })
    expect(isOverShelf(shelf, 400)).toBe(true)
    expect(isOverShelf(shelf, 438)).toBe(true)
    expect(isOverShelf(shelf, 439)).toBe(false)
    expect(isOverShelf(null, 410)).toBe(false)
  })

  it('an empty-slot click names the half hour it landed on, clamped to closing', () => {
    const track = document.createElement('div')
    rect(track, { left: 0, top: 0, width: 900, height: 40 })
    expect(slotStartAt(track, 0, HOURS)).toBe(600) // 10:00
    expect(slotStartAt(track, 450, HOURS)).toBe(870) // 14:30
    expect(slotStartAt(track, 460, HOURS)).toBe(870) // still 14:30 — snapped
    // A click on the far right cannot create a booking that starts at closing.
    expect(slotStartAt(track, 899, HOURS)).toBe(1110) // 18:30
  })
})

describe('the board answers to its own moves', () => {
  const staffA = lane({ key: 'p-01', group: 'staff', items: [booking({ key: 'a-staff', caseId: 'apt-1' }, 660, 720)] })
  const staffB = lane({ key: 'p-04', group: 'staff' })
  const bed = lane({ key: 'bed-01', group: 'beds', items: [booking({ key: 'a-bed', caseId: 'apt-1' }, 660, 720)] })
  const lanes = [staffA, staffB, bed]

  it('with no moves at all, the board is exactly what the server sent', () => {
    const out = applyMoves(lanes, {}, [], [], HOURS)
    expect(out.map((l) => l.items.map((i) => i.caseId))).toEqual([['apt-1'], [], ['apt-1']])
  })

  it('a move carries the card to the new lane AND drags its bed copy along', () => {
    const moves: Moves = { 'apt-1': { laneKey: 'p-04', x: 0, w: 100 / 9 } }
    const out = applyMoves(lanes, moves, [], [], HOURS)
    // Gone from its old lane, arrived on the new one…
    expect(out[0].items).toHaveLength(0)
    expect(out[1].items.map((i) => i.caseId)).toEqual(['apt-1'])
    // …and the bed lane keeps its own row but takes the new span, so the two
    // halves of one booking can never show different times.
    expect(out[2].items[0].x).toBe(0)
    expect(out[2].items[0].startMin).toBe(600)
    expect(out[2].items[0].endMin).toBe(660)
    expect(out[1].items[0].time).toBe('10:00〜11:00')
  })

  it('a parked card leaves BOTH lanes, and returns to both', () => {
    const parkedOut = applyMoves(lanes, {}, ['apt-1'], [], HOURS)
    expect(parkedOut.every((l) => l.items.length === 0)).toBe(true)
    // Unparking is the absence of the park — the card is back where it was.
    expect(applyMoves(lanes, {}, [], [], HOURS)[0].items).toHaveLength(1)
  })

  it('a card created in the dialog joins the lane it was created on', () => {
    const fresh = booking({ key: 'local-1', caseId: null }, 900, 960)
    const out = applyMoves(lanes, {}, [], [{ laneKey: 'p-04', item: fresh }], HOURS)
    expect(out[1].items.map((i) => i.key)).toEqual(['local-1'])
  })

  it('every lane element reports its own minute span for the checks to read', () => {
    expect(laneSpans(staffA)).toEqual([{ start: 660, end: 720, isBreak: false }])
  })
})

describe('the sell layer moves with the board', () => {
  const opts = { gridMin: 60, nowMinute: null, locked: [], showPrice: true, hi: 7260, hqMin: 6600, depth: 9 }

  it('a free lane and a free bed advertise the whole day; a booking on either takes its hour off sale', () => {
    const lanes = [lane({ key: 'p-01', group: 'staff' }), lane({ key: 'bed-01', group: 'beds' })]
    const before = sellLayerFor(lanes, HOURS, opts)
    expect(before.cells.filter((c) => c.group === 'staff')).toHaveLength(9)

    // Drop a card at 12:00 on the staff lane. Nothing else changed.
    const moved = applyMoves(
      [lane({ key: 'p-01', group: 'staff', items: [booking({ key: 'x', caseId: 'apt-9' }, 720, 780)] }), lanes[1]],
      {},
      [],
      [],
      HOURS,
    )
    const after = sellLayerFor(moved, HOURS, opts)
    expect(after.cells.some((c) => c.group === 'staff' && c.h === 720)).toBe(false)
    expect(after.cells.filter((c) => c.group === 'staff')).toHaveLength(8)
    // …and moving it away puts the hour back on sale: the layer is derived, not
    // a list something has to remember to update.
    const back = sellLayerFor(applyMoves([lanes[0], lanes[1]], {}, [], [], HOURS), HOURS, opts)
    expect(back.cells.filter((c) => c.group === 'staff')).toHaveLength(9)
  })

  it('a locked lane sells nothing, and the chip count follows', () => {
    const lanes = [lane({ key: 'p-01', group: 'staff' }), lane({ key: 'bed-01', group: 'beds' })]
    expect(sellLayerFor(lanes, HOURS, { ...opts, locked: ['p-01'] }).staffBands).toHaveLength(0)
    expect(sellLayerFor(lanes, HOURS, { ...opts, locked: ['p-01'] }).chipLabel).toBe('オンライン販売中 0窓')
  })

  it('the store lever moves every price on the board at once', () => {
    const lanes = [lane({ key: 'p-01', group: 'staff' }), lane({ key: 'bed-01', group: 'beds' })]
    const low = sellLayerFor(lanes, HOURS, { ...opts, hi: 6600 })
    const high = sellLayerFor(lanes, HOURS, { ...opts, hi: 7260 })
    expect(high.max).toBeGreaterThan(low.max)
    expect(high.max / low.max).toBeCloseTo(7260 / 6600, 2)
  })
})

describe('the 仮置きエリア chip', () => {
  it('says what was taken off the board and where it came from', () => {
    const item = booking({ key: 'a', caseId: 'apt-1' }, 660, 720)
    expect(parkChipText(item, HOURS, '2026年8月19日(水)')).toEqual({
      title: '見本 はなこ様（仮押さえ・未配置）',
      line1: '60分・単発 ¥6,600',
      line2: '元: 2026年8月19日(水) 11:00〜12:00 — 置きたい日の枠へドラッグ',
    })
  })

  it('a card with no ticket line says only its length', () => {
    const item = booking({ key: 'a', caseId: 'apt-1', ticketCat: null, ticketCore: null }, 660, 750)
    expect(parkChipText(item, HOURS, '本日').line1).toBe('90分')
  })
})

describe('popovers and dialogs', () => {
  it('a click inside the popover keeps it open; anywhere else closes it', () => {
    const wrap = document.createElement('div')
    const inside = document.createElement('button')
    wrap.appendChild(inside)
    const outside = document.createElement('div')
    document.body.append(wrap, outside)
    expect(clickClosesPopover(wrap, inside)).toBe(false)
    expect(clickClosesPopover(wrap, wrap)).toBe(false)
    expect(clickClosesPopover(wrap, outside)).toBe(true)
    // A popover whose wrapper has gone (a re-render mid-click) closes rather
    // than sticking open with nothing to dismiss it.
    expect(clickClosesPopover(null, inside)).toBe(true)
  })

  /** 表示設定 must FIT WHOLE — no internal scrolling, nothing cut off (⚖ Liam
   *  2026-08-20). The panel's real content height, measured in a real browser
   *  on the real board at both target widths (the板 is 368px wide at each, so
   *  the content reflows identically): 672px. Canon's own panel is 711px and
   *  clears the same bar, so the height the rule has to survive is canon's. */
  const PANEL_CONTENT = 672
  const CANON_PANEL_CONTENT = 711
  // The 表示設定 button as the board actually places it: right end of the
  // board tools, near the top of the page.
  const BOARD_BUTTON = { top: 130.5, bottom: 164.5, left: 1153.5, right: 1225.5 }

  it.each([
    ['1440x900 — MacBook logical', 1440, 900],
    ['1280x800', 1280, 800],
  ])('表示設定 fits whole at %s, with nothing to scroll', (_label, width, height) => {
    for (const content of [PANEL_CONTENT, CANON_PANEL_CONTENT]) {
      const a = fieldsPopAnchor(BOARD_BUTTON, 368, content, { width, height })
      // The panel is allowed its ENTIRE content height — the +2 is canon's own
      // rounding allowance, so `height >= content` means nothing is cut off and
      // the overflow-y: auto never engages.
      expect(a.height).toBeGreaterThanOrEqual(content)
      // ...and the whole of it is on screen, top and bottom.
      expect(a.top).toBeGreaterThanOrEqual(12)
      expect(a.top + a.height).toBeLessThanOrEqual(height - 12)
      // Horizontally too: opens to the LEFT of the button, fully inside.
      expect(a.left).toBeGreaterThanOrEqual(12)
      expect(a.left + 368).toBeLessThanOrEqual(width - 12)
      expect(a.left + 368).toBeLessThanOrEqual(BOARD_BUTTON.left)
    }
  })

  it('slides UP off the button rather than hanging below it and overflowing', () => {
    // Under the button there are only 900 - 164.5 - 12 = 723.5px, which the
    // 672px panel happens to clear — but canon's 711px one at 1280x800 does
    // not. The rule is the same either way: the panel moves, it never scrolls.
    const a = fieldsPopAnchor(BOARD_BUTTON, 368, CANON_PANEL_CONTENT, { width: 1280, height: 800 })
    expect(a.top).toBeLessThan(BOARD_BUTTON.bottom)
    expect(a.height).toBe(CANON_PANEL_CONTENT + 2)
  })

  it('falls back to internal scrolling only when the viewport truly cannot hold it', () => {
    // canon :1554 — 「高さが足りない場合だけ内部スクロールへ戻す」.
    const a = fieldsPopAnchor(BOARD_BUTTON, 368, PANEL_CONTENT, { width: 1280, height: 500 })
    expect(a.height).toBe(500 - 24)
    expect(a.top).toBe(12)
  })

  it('flips to the right of the button when there is no room on the left', () => {
    const hugging = { top: 130.5, bottom: 164.5, left: 20, right: 92 }
    const a = fieldsPopAnchor(hugging, 368, PANEL_CONTENT, { width: 1440, height: 900 })
    expect(a.left).toBe(hugging.right + 8)
  })

  it('a dialog opens modal and closes, and closing twice is not an error', () => {
    const dialog = document.createElement('dialog')
    document.body.appendChild(dialog)
    expect(dialog.open).toBe(false)
    dialog.showModal()
    expect(dialog.open).toBe(true)
    dialog.close()
    expect(dialog.open).toBe(false)
    dialog.close()
    expect(dialog.open).toBe(false)
  })
})

describe('what a non-booking item wears, and whether it opens', () => {
  /** The JSX branch for a non-booking item, on real nodes: same element choice,
   *  same class string, same click wiring as TodayScreen's renderItem. */
  function paint(item: BoardItem, onOpen: () => void, onToast: (m: string) => void = () => {}) {
    const { cls, opens, locked } = blockChrome(item.kind)
    const el = document.createElement(opens ? 'button' : 'span')
    el.className = `event ${cls}${item.micro ? ' micro' : ''}`
    el.setAttribute('aria-label', item.label)
    if (opens) {
      el.addEventListener('click', () => onOpen())
    } else {
      el.setAttribute('role', 'note')
      if (locked) el.addEventListener('pointerdown', () => onToast(locked))
    }
    document.body.appendChild(el)
    return el
  }

  function offShift(title: string, label: string): BoardItem {
    return {
      key: `off-${title}`,
      kind: 'absence', state: null, category: null, ...place(1020, HOURS.close, HOURS),
      title, tag: '', time: '17:00〜閉店', ticketCat: null, ticketCore: null,
      held: false, micro: false, caseId: null, label,
    }
  }

  it('the 終業 / 勤務前 / 本日勤務なし hatches wear the 勤務不可 red, not the beige block', () => {
    // canon fable-store-today.html :3928 — one hatch grammar for every
    // shift-derived "no shop floor here" span, `.event.absence`.
    for (const title of ['終業', '勤務前', '本日勤務なし']) {
      const el = paint(offShift(title, `見本 ごろう、${title}`), () => {})
      expect(el.className).toBe('event absence')
      expect(el.className).not.toContain('block')
    }
    // A real 予定ブロック keeps the beige card, and 清掃 keeps its own hatch.
    expect(paint({ ...offShift('準備', 'x'), kind: 'block', micro: true }, () => {}).className).toBe('event block micro')
    expect(paint({ ...offShift('清掃', 'x'), kind: 'cleanup' }, () => {}).className).toBe('event cleanup')
  })

  it('a shift-derived hatch is a note, not a control; a 予定ブロック still opens', () => {
    // canon renders every .absence as `<span role="note">` (:3964, :3988, and the
    // hand-written 勤務不可 at :1878) and binds it to "変更はシフト管理で" — so on
    // this board the wash never raises ブロック情報. The element choice also keeps
    // the hatch off `button:disabled { opacity: .45 }`, which would wash the red
    // out to under half strength and read as a paler red than canon's.
    let opened = 0
    const hatch = paint(offShift('終業', '見本 ごろう、17:00以降、終業のため予約不可'), () => { opened += 1 })
    expect(hatch.tagName).toBe('SPAN')
    expect(hatch.getAttribute('role')).toBe('note')
    expect(hatch).not.toBeInstanceOf(HTMLButtonElement)
    hatch.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(opened).toBe(0)

    const card = paint({ ...offShift('準備', '見本 ごろう、準備・予約不可'), kind: 'block' }, () => { opened += 1 })
    expect(card.tagName).toBe('BUTTON')
    card.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(opened).toBe(1)
  })

  it('pressing any hatch says where the change belongs, instead of nothing happening', () => {
    // canon fable-store-today.html :4409 — every .event.absence takes a
    // pointerdown handler that raises ONE sentence. A refusal the board never
    // explains reads as a broken drag; this is the explanation.
    const said: string[] = []
    for (const title of ['勤務不可', '終業', '勤務前', '本日勤務なし']) {
      const el = paint(offShift(title, `見本 ごろう、${title}`), () => {}, (m) => said.push(m))
      el.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    }
    expect(said).toEqual(Array(4).fill('勤務不可はシフト管理で変更します — ボード上では動かせません'))

    // A 予定ブロック is not shift-derived: it opens ブロック情報, so it has
    // nothing to refuse and says nothing.
    const card = paint({ ...offShift('準備', 'x'), kind: 'block' }, () => {}, (m) => said.push(m))
    card.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(said).toHaveLength(4)
  })
})

// ── スキマガードの配置ガイド ────────────────────────────────────────────────
// The rail is a pure derivation over the same board reading everything else
// uses, so it is provable without a renderer. What the SCREEN adds is the
// strip, and the strip's states come from here one-to-one.
describe('the 配置ガイド rail', () => {
  const GUARD = {
    services: [{ name: '整体60', dur: 60 }, { name: '骨盤90', dur: 90 }],
    newClientSessionMin: 90,
    protectedLabel: '新規',
    gapFillMinMin: 30,
    leadTimeMin: 0,
    mode: 'standard' as const,
  }
  const railInput = (over: Partial<Parameters<typeof guardRailsFor>[1]> = {}) => ({
    open: HOURS.open, close: HOURS.close, stepMin: 30, dur: 60, protectedDur: 90,
    nowMinute: null, locked: [], guard: GUARD, ...over,
  })
  const at = (rail: GuardRail, minute: number) => rail.cells.find((c) => c.start === minute)!

  it('every exact 30-minute start on the board gets a cell', () => {
    const rails = guardRailsFor([lane({ key: 'p-01', group: 'staff' })], railInput())
    expect(rails).toHaveLength(1)
    expect(rails[0].cells.map((c) => c.start)).toEqual(
      Array.from({ length: 18 }, (_, i) => 600 + i * 30),
    )
  })

  it('a start that keeps the protected window is purple ✓ and says so', () => {
    // An empty 10:00–19:00 shift is 540 minutes: six 90-minute windows before,
    // and placing 60 at the very start leaves 480 → five. That IS a loss, so
    // the honest ✓ needs a pocket a 60 fits into without costing a 新規 window:
    // 10:00–12:30 (150 min) holds one 90, and 60 at 10:00 leaves 90 → still one.
    const busy = lane({ key: 'p-01', group: 'staff', window: { from: 600, until: 750 }, untilLabel: '12:30' })
    const cell = at(guardRailsFor([busy], railInput())[0], 600)
    expect(cell.state).toBe('safe')
    expect(cell.label).toBe('✓10:00')
    expect(cell.sentence).toBe('新規90分の空きを守れます')
  })

  it('a start that costs the protected window is amber △ and prices the loss', () => {
    const short = lane({ key: 'p-01', group: 'staff', window: { from: 600, until: 690 }, untilLabel: '11:30' })
    const cell = at(guardRailsFor([short], railInput())[0], 600)
    expect(cell.state).toBe('degraded')
    expect(cell.label).toBe('△10:00')
    expect(cell.sentence).toContain('新規90分の空き1→0（1枠減・損を減らす）')
  })

  it('a start with no room at all is grey — and says why, in canon\'s sentence', () => {
    const rails = guardRailsFor([lane({ key: 'p-01', group: 'staff', window: { from: 600, until: 640 } })], railInput())
    const cell = at(rails[0], 600)
    expect(cell.state).toBe('blocked')
    expect(cell.label).toBe('—')
    expect(cell.sentence).toBe('この開始には60分の連続した空きがありません')
  })

  it('the card in hand is not an obstacle to itself', () => {
    const held = booking({ key: 'k1', caseId: 'apt-1' }, 600, 660)
    const withCard = lane({ key: 'p-01', group: 'staff', window: { from: 600, until: 750 }, untilLabel: '12:30', items: [held] })
    expect(at(guardRailsFor([withCard], railInput())[0], 600).state).toBe('blocked')
    expect(at(guardRailsFor([withCard], railInput({ excludeId: 'apt-1' }))[0], 600).state).toBe('safe')
  })

  it('a locked lane and a bed lane get no rail at all', () => {
    expect(guardRailsFor([lane({ key: 'p-01', group: 'staff' })], railInput({ locked: ['p-01'] }))).toEqual([])
    expect(guardRailsFor([lane({ key: 'bed-01', group: 'beds' })], railInput())).toEqual([])
  })

  it('the drop asks about the card in hand, at ITS length, not the rail\'s 60', () => {
    const l = lane({ key: 'p-01', group: 'staff', window: { from: 600, until: 750 }, untilLabel: '12:30' })
    expect(guardVerdictAt([l], 'p-01', 600, railInput({ dur: 60 }))!.state).toBe('safe')
    // The same start with a 180-minute booking has no pocket long enough.
    expect(guardVerdictAt([l], 'p-01', 600, railInput({ dur: 180 }))!.state).toBe('blocked')
    expect(guardVerdictAt([l], 'nobody', 600, railInput())).toBeNull()
  })

  it('reasonLine speaks the engine\'s refusal, never a generic one', () => {
    expect(reasonLine({ code: 'R-REP', params: { label: '新規（90分）' } }, 90)).toBe('ここに置くと新規（90分）が入らなくなります')
    expect(reasonLine({ code: 'R-DEAD', params: { n: 25 } }, 90)).toBe('ここに置くと25分の売れない空きが残ります')
    expect(reasonLine({ code: 'R-SALV', params: { n: 40 } }, 90)).toBe('ここに置くと40分の割引でしか売れない空きが残ります')
    expect(reasonLine({ code: 'R-UNAVAILABLE', params: { dur: 60 } }, 90)).toBe('この開始には既存60分を配置できません')
    expect(reasonLine({ code: 'EXEMPT', params: { trigger: 'wall', wallType: 'shiftEnd' } }, 90)).toBe('端はシフト終了に接するため空きになりません')
    expect(reasonLine({ code: 'EXEMPT', params: { trigger: 'wall', wallType: 'break' } }, 90)).toBe('端は休憩に接するため空きになりません')
    expect(reasonLine({ code: 'EXEMPT', params: { trigger: 'leadTime' } }, 90)).toBe('端はリードタイムに接するため空きになりません')
    expect(reasonLine(undefined, 90)).toBe('配置できません')
  })

  it('the スキマ枠 layer answers from the same lanes as everything else', () => {
    // A 35-minute tail no menu fills exactly, over the 30-minute dial: orange.
    const l = lane({ key: 'p-01', group: 'staff', window: { from: 720, until: 755 }, untilLabel: '12:35' })
    const bed = lane({ key: 'bed-01', group: 'beds' })
    const out = gapLayerFor([l, bed], {
      gridMin: 60, sessionMin: 60, gapFillMin: 30, gapFillDiscountPct: 10, nowMinute: null,
      locked: [], frame: { hi: 6600, lo: 4620, hqMin: 6600, hqMax: 7260 }, depth: 0, guard: GUARD,
    })
    expect(out.packed).toEqual([])
    expect(out.scraps.filter((c) => c.group === 'staff')).toHaveLength(1)
    expect(out.scraps[0].price).toBeGreaterThan(0)
  })
})
