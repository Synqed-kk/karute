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
  fractionIn,
  isOverShelf,
  laneKeyAtY,
  laneSpans,
  nextSpan,
  parkChipText,
  sellLayerFor,
  slotStartAt,
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
    expect(laneSpans(staffA)).toEqual([{ start: 660, end: 720 }])
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
  function paint(item: BoardItem, onOpen: () => void) {
    const { cls, opens } = blockChrome(item.kind)
    const el = document.createElement(opens ? 'button' : 'span')
    el.className = `event ${cls}${item.micro ? ' micro' : ''}`
    el.setAttribute('aria-label', item.label)
    if (opens) {
      el.addEventListener('click', () => onOpen())
    } else {
      el.setAttribute('role', 'note')
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
})
