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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyBlockMoves,
  applyMoves,
  blockChrome,
  blockClash,
  blockDragModeAt,
  blockEdgeZones,
  blockStepPct,
  cardNodes,
  chipProxySize,
  clampLabelWidth,
  labelWidthOf,
  liveTimeLabel,
  stretchOrCarry,
  spotCardAt,
  spotHitIndex,
  spotTargets,
  wrapStep,
  LABEL_MAX,
  LABEL_MIN,
  clickClosesPopover,
  dragModeAt,
  deltaPctIn,
  fieldsPopAnchor,
  fitsDrag,
  fractionIn,
  freePartnerLane,
  gapLayerFor,
  guardRailsFor,
  guardVerdictAt,
  isOverShelf,
  laneKeyAtY,
  laneSpans,
  nextSpan,
  parkChipText,
  proxyTransform,
  reasonLine,
  sellLayerFor,
  slotStartAt,
  onShownBoard,
  sameStore,
  unparkOutcome,
  type GuardRail,
  type Moves,
} from '@/app/[locale]/(business)/business/today/today-interactions'
import { dragOrigin, stepPct } from '@/business/lib/canon-logic/drag-rules'
import { buildSellLayer, type SellCell } from '@/business/lib/canon-logic/availability'
import { DENSITY_CEILING } from '@/business/lib/canon-logic/pricing'
import { minuteOf, place, type BoardItem, type BoardLane } from '@/business/lib/today-board'

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

/** ⚖ Liam flag 28 (2026-08-21). The reported bug: dragging a chip off the shelf
 *  produced an elongated orange slab — the proxy was measured from the CHIP's
 *  rect, whose width is driven by the 元: sentence, while it drew only two of
 *  the chip's three lines. What travels now is a board card at the booking's own
 *  duration. */
describe('the chip in hand is a board card at the booking’s own length', () => {
  function boardWithTrack(width: number, height: number): HTMLElement {
    const board = document.createElement('div')
    const lane = document.createElement('div')
    lane.className = 'lane'
    const track = document.createElement('div')
    track.className = 'track'
    rect(track, { left: 0, top: 0, width, height })
    lane.appendChild(track)
    board.appendChild(lane)
    return board
  }

  it('sizes the proxy from the booking’s minutes against the board, never from the chip box', () => {
    // 900px over a nine-hour board: one hour is 100px. The chip that carries
    // this booking is ~250px wide whatever its length — that number is gone.
    const board = boardWithTrack(900, 72)
    expect(chipProxySize(board, HOURS, 60)?.w).toBeCloseTo(100, 9)
    expect(chipProxySize(board, HOURS, 30)?.w).toBeCloseTo(50, 9)
    expect(chipProxySize(board, HOURS, 90)?.w).toBeCloseTo(150, 9)
    // Height is the lane's card height: the track less .event's 2px top+bottom.
    expect(chipProxySize(board, HOURS, 60)?.h).toBe(68)
    // A denser board draws shorter cards, and the proxy follows it.
    expect(chipProxySize(boardWithTrack(900, 52), HOURS, 60)?.h).toBe(48)
  })

  it('the minutes it is sized from are the parked record’s — the same figure the chip prints', () => {
    const item = booking({ key: 'a', caseId: 'apt-1' }, 660, 720)
    const lenMin = item.endMin - item.startMin
    expect(parkChipText(item, HOURS, '本日').line1.startsWith(`${lenMin}分`)).toBe(true)
    expect(chipProxySize(boardWithTrack(900, 72), HOURS, lenMin)?.w).toBeCloseTo(100, 9)
  })

  it('the screen sizes the travelling copy from the board, never from the chip it grabbed', () => {
    const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
    expect(SRC).toContain('const size = chipProxySize(boardRef.current, hours, chip.lenMin) ?? ctx.grab')
    expect(SRC).toContain("setProxy({ kind: 'chip', title: chip.title, line1: chip.line1, category: chip.category, w: size.w, h: size.h })")
    // Centred on the pointer — because `shelfLanding` centres the landing on the
    // pointer, so the thing in hand and the dashed ghost describe one rectangle.
    expect(SRC).toContain('ctx.grab = { dx: size.w / 2, dy: size.h / 2, w: size.w, h: size.h }')
    expect(SRC).toContain('shelfLanding(fractionIn(track, e.clientX), w, chip.home.x, STEP)')
    // A 30分 proxy is a card-sized box, so it wears the card's insides.
    const CSS = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/today.css'), 'utf8')
    const chipProxy = CSS.slice(CSS.indexOf('.biz .drag-proxy.chip {'), CSS.indexOf('.biz .drag-proxy.chip strong'))
    expect(chipProxy).toContain('padding: 5px 2px 4px 6px;')
    expect(chipProxy).toContain('align-content: start;')
    expect(CSS).toContain('.biz .drag-proxy.chip small { font-size: 11px; opacity: .82; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }')
  })

  it('says null — keep the chip’s own box — when nothing measurable is on screen', () => {
    expect(chipProxySize(null, HOURS, 60)).toBeNull()
    // A board with no lanes rendered yet, and a collapsed group with no width.
    expect(chipProxySize(document.createElement('div'), HOURS, 60)).toBeNull()
    expect(chipProxySize(boardWithTrack(0, 0), HOURS, 60)).toBeNull()
  })
})

/** ⚖ Liam flag 29 (2026-08-21). The reported bug: pressing a card's edge picked
 *  the whole card up — `applyDragFrame` created the flying proxy on every mode,
 *  and `applyBlockFrame` was its twin. Canon stretches the card where it stands
 *  (dragMove :4488–4508) and returns before any lane, shelf or proxy work. */
describe('an edge press stretches the card where it stands, it does not pick it up', () => {
  function card(x: number, w: number): HTMLElement {
    const el = document.createElement('button')
    el.className = 'event confirmed'
    // What React drew, in React's own spelling.
    el.style.setProperty('--x', `${x}%`)
    el.style.setProperty('--w', `${w}%`)
    const t = document.createElement('small')
    t.className = 'e-time'
    t.textContent = '11:00〜12:00'
    el.appendChild(t)
    return el
  }

  it('only a MOVE puts the booking in the operator’s hand', () => {
    const el = card(10, 20)
    expect(stretchOrCarry([el], 'move', { x: 30, w: 20 })).toBe(true)
    // …and a move paints nothing on the node: the card in flight is the proxy,
    // the node is the husk React is still drawing at the committed span.
    expect(el.style.getPropertyValue('--x')).toBe('10%')
    expect(el.style.getPropertyValue('--w')).toBe('20%')
    // Both resize modes refuse the hand — which is the proxy gate, since this
    // answer is the only thing the board consults before creating one.
    expect(stretchOrCarry([el], 'resize', { x: 10, w: 33.5 })).toBe(false)
    expect(stretchOrCarry([el], 'resizeL', { x: 3.75, w: 26.25 })).toBe(false)
  })

  it('a right-edge drag grows the width in place and never moves the start', () => {
    const el = card(10, 20)
    stretchOrCarry([el], 'resize', { x: 10, w: 33.5 })
    expect(el.style.getPropertyValue('--w')).toBe('33.5%')
    expect(el.style.getPropertyValue('--x')).toBe('10%')
  })

  it('a left-edge drag moves the start as well as the width', () => {
    const el = card(10, 20)
    stretchOrCarry([el], 'resizeL', { x: 3.75, w: 26.25 })
    expect(el.style.getPropertyValue('--x')).toBe('3.75%')
    expect(el.style.getPropertyValue('--w')).toBe('26.25%')
  })

  it('the teardown hands the node back at the span React last wrote', () => {
    const el = card(10, 20)
    stretchOrCarry([el], 'resizeL', { x: 3.75, w: 26.25 })
    // clearDrag's restore: the same call, with the origin span.
    stretchOrCarry([el], 'resizeL', { x: 10, w: 20 })
    expect(el.style.getPropertyValue('--x')).toBe('10%')
    expect(el.style.getPropertyValue('--w')).toBe('20%')
  })

  it('the span it paints is canon’s lattice, not a second spelling of it', () => {
    const track = document.createElement('div')
    // 900px over nine hours: one 30-minute step is 50px.
    rect(track, { left: 0, top: 0, width: 900, height: 40 })
    const span = nextSpan(dragOrigin(0, 100 / 9, 'resize', STEP), track, 50, STEP)
    const el = card(0, 100 / 9)
    stretchOrCarry([el], 'resize', span)
    expect(el.style.getPropertyValue('--w')).toBe(`${span.w}%`)
    expect(span.w).toBeCloseTo(100 / 9 + STEP, 6)
  })

  it('the card says the time it is being stretched to, and takes it back on release', () => {
    const el = card(10, 20)
    liveTimeLabel([el], '11:00〜12:30')
    expect(el.querySelector('.e-time')?.textContent).toBe('11:00〜12:30')
    liveTimeLabel([el], '11:00〜12:00')
    expect(el.querySelector('.e-time')?.textContent).toBe('11:00〜12:00')
  })

  it('the screen asks it once per frame, and hangs the whole hand half off the answer', () => {
    const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
    // Both pipelines, one call each, BEFORE anything is created or hunted.
    expect(SRC).toContain('const inHand = stretchOrCarry(ctx.nodes, ctx.origin.mode, span)')
    expect(SRC.match(/const inHand = stretchOrCarry/g)).toHaveLength(2)
    // The booking pipeline takes EVERY drawing of the card (staff row + bed
    // row); the block pipeline takes its one box. A card drag that captured
    // only `e.currentTarget` would leave the room's row stale mid-stretch.
    expect(SRC).toContain('nodes: cardNodes(boardRef.current, item.caseId),')
    expect(SRC).toContain('const inHand = stretchOrCarry([ctx.node], ctx.origin.mode, span)')
    // The proxy, the emphasis, the shelf and the lane hunt are all inside it.
    for (const fn of ['function applyDragFrame()', 'function applyBlockFrame()']) {
      const from = SRC.indexOf(fn)
      const frame = SRC.slice(from, SRC.indexOf('\n  }\n', from))
      expect(frame).toMatch(/const inHand = stretchOrCarry\((ctx\.nodes|\[ctx\.node\]), ctx\.origin\.mode, span\)/)
      // Nothing before the first gate creates a proxy, moves one, or hunts a
      // lane — the whole hand half of the frame lives behind the answer.
      const beforeGate = frame.slice(0, frame.indexOf('if (inHand) {'))
      expect(beforeGate).toContain('const inHand =')
      expect(beforeGate).not.toContain('setProxy({')
      expect(beforeGate).not.toContain('moveProxy(')
      expect(beforeGate).not.toContain('laneKeyAtY(')
    }
    // Both teardowns hand the node back at the origin span.
    for (const fn of ['function clearDrag()', 'function clearBlockDrag()']) {
      const body = SRC.slice(SRC.indexOf(fn), SRC.indexOf(fn) + 800)
      expect(body).toMatch(/stretchOrCarry\((ctx\.nodes|\[ctx\.node\]), ctx\.origin\.mode, ctx\.origin\)/)
    }
    // A stretched card wears canon's live look, never the move's husk…
    expect(SRC).toContain("live.mode === 'move' ? ' dragging' : ' resizing'")
    expect(SRC).toContain("blockLive.mode === 'move' ? ' dragging' : ' resizing'")
    const CSS = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/today.css'), 'utf8')
    expect(CSS).toContain('.biz .event.resizing { opacity: .88; z-index: 30; cursor: grabbing; box-shadow: 0 8px 22px rgba(24, 24, 27, .22); }')
    // …and it must be written BELOW the state colours, or [data-cat] takes the
    // lift away at the same specificity. This ordering is the rule, pinned.
    expect(CSS.indexOf('.biz .event.resizing {')).toBeGreaterThan(CSS.indexOf('.biz .event[data-cat] {'))
  })

  it('a box with no time line — a block, a micro — is left alone', () => {
    const block = document.createElement('button')
    const small = document.createElement('small')
    small.textContent = '13:00〜14:00'
    block.appendChild(small)
    liveTimeLabel([block], '13:00〜14:30')
    expect(block.querySelector('small')?.textContent).toBe('13:00〜14:00')
    // …and a stretch with nothing to stretch is a no-op, not a crash.
    expect(stretchOrCarry([], 'resize', { x: 0, w: 10 })).toBe(false)
    expect(stretchOrCarry([], 'move', { x: 0, w: 10 })).toBe(true)
  })
  it('stretches EVERY drawing of the booking — the person’s row and the room’s', () => {
    // A booking is a person AND a room, so the board draws it twice. Stretching
    // only the grabbed one left the bed row saying 60分 while the card in hand
    // said 90分, until the release caught it up.
    const board = document.createElement('div')
    const staff = card(10, 20)
    const bed = card(10, 20)
    for (const [group, el] of [['staff', staff], ['beds', bed]] as const) {
      const lane = document.createElement('div')
      lane.className = 'lane'
      lane.dataset.group = group
      el.dataset.book = 'apt-1'
      lane.appendChild(el)
      board.appendChild(lane)
    }
    expect(cardNodes(board, 'apt-1')).toHaveLength(2)
    expect(cardNodes(board, 'apt-none')).toHaveLength(0)
    expect(cardNodes(null, 'apt-1')).toHaveLength(0)
    stretchOrCarry(cardNodes(board, 'apt-1'), 'resize', { x: 10, w: 30 })
    expect(staff.style.getPropertyValue('--w')).toBe('30%')
    expect(bed.style.getPropertyValue('--w')).toBe('30%')
    liveTimeLabel(cardNodes(board, 'apt-1'), '11:00〜13:00')
    expect(staff.querySelector('.e-time')?.textContent).toBe('11:00〜13:00')
    expect(bed.querySelector('.e-time')?.textContent).toBe('11:00〜13:00')
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

/** WO-2d, Liam flags 14/15. canon's window layers are derived from the board as
 *  it STANDS: `renderPublicLayer` (:5343) and `renderGapFillLayer` (:5235) run
 *  once and are not called again until a move commits. Measured in a real
 *  browser on canon itself — its `.cell-price` / `.cell-packed` / `.cell-gapfill`
 *  set is byte-identical idle → mid-drag → after the drop (1 distinct state
 *  across 30 pointer frames). A drag's liveness is the CSS reveal at :594–598,
 *  which lifts and emphasises boxes already derived; it is not a re-derivation.
 *
 *  Ours fed the layers the IN-FLIGHT pointer position, which re-ran the bed
 *  ledger every frame: 3 distinct states across the same 30 frames, with boxes
 *  on OTHER lanes appearing and vanishing and a ¥3,860（30分） turning into a
 *  ¥7,710 mid-gesture. */
describe('the window layers price the committed board, never the card in flight', () => {
  const GUARD = {
    services: [{ name: '整体60', dur: 60 }, { name: '骨盤90', dur: 90 }],
    newClientSessionMin: 90, protectedLabel: '新規', gapFillMinMin: 30, leadTimeMin: 0,
    mode: 'standard' as const,
  }
  const sellOpts = { gridMin: 60, nowMinute: null, locked: [], showPrice: true, hi: 7260, hqMin: 6600, depth: 9 }
  const gapOpts = {
    gridMin: 60, sessionMin: 60, gapFillMin: 30, gapFillDiscountPct: 10, nowMinute: null,
    locked: [], frame: { hi: 7260, lo: 6600, hqMin: 6600, hqMax: 7260 }, depth: 9, guard: GUARD,
  }
  // One card at 12:00 on p-01, one bed. A drag carries it to 15:05 on p-04 —
  // an off-grid landing, so the スキマ枠 layer answers differently too.
  const lanes = [
    lane({ key: 'p-01', group: 'staff', items: [booking({ key: 'a', caseId: 'apt-1' }, 720, 780)] }),
    lane({ key: 'p-04', group: 'staff' }),
    lane({ key: 'bed-01', group: 'beds', items: [booking({ key: 'a-bed', caseId: 'apt-1' }, 720, 780)] }),
  ]
  const committed: Moves = {}
  const inFlight: Moves = { 'apt-1': { laneKey: 'p-04', ...place(905, 965, HOURS) } }

  it('the two boards genuinely disagree — so WHICH one the layers read is the whole question', () => {
    const still = sellLayerFor(applyMoves(lanes, committed, [], [], HOURS), HOURS, sellOpts)
    const flying = sellLayerFor(applyMoves(lanes, inFlight, [], [], HOURS), HOURS, sellOpts)
    // 12:00 is off sale while the card sits there; 15:00 goes off sale the
    // moment the card is treated as already landed.
    expect(still.cells.some((c) => c.group === 'staff' && c.laneKey === 'p-01' && c.h === 720)).toBe(false)
    expect(flying.cells.some((c) => c.group === 'staff' && c.laneKey === 'p-04' && c.h === 900)).toBe(false)
    expect(flying.cells.some((c) => c.group === 'staff' && c.laneKey === 'p-01' && c.h === 720)).toBe(true)
  })

  it('the screen feeds both layers the committed board, and builds it from `moves` alone', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
    // The committed board is applyMoves over `moves` — NOT `liveMoves`, which
    // carries the pointer's current position. (`addedHere` is `added` narrowed
    // to the day on screen, ⚖ Liam 22 — it carries no pointer state either.)
    // ⚖ Liam flag 26 folded ONE pass in front of it — `placedLanes` is
    // props.lanes with this session's BLOCK moves applied — and nothing else
    // changed: the booking argument is still `moves`, never `liveMoves`.
    const memo = /const committedLanes = useMemo\(\s*\(\) => applyMoves\(placedLanes, moves, parked, addedHere, hours\)/
    expect(memo.test(src)).toBe(true)
    expect(src).toContain('applyBlockMoves(props.lanes, blockMoves, hours)')
    expect(src).toContain('sellLayerFor(committedLanes')
    expect(src).toContain('gapLayerFor(committedLanes')
    expect(src).not.toContain('sellLayerFor(boardLanes')
    expect(src).not.toContain('gapLayerFor(boardLanes')
    // …and the live board is still what the guard and the drop target read,
    // because those DO have to answer where the card is heading.
    expect(src).toContain('guardRailsFor(boardLanes')
  })

  it('the スキマ枠 layer disagrees too — an off-grid landing opens a 55-minute tail', () => {
    const before = gapLayerFor(applyMoves(lanes, committed, [], [], HOURS), gapOpts)
    const after = gapLayerFor(applyMoves(lanes, inFlight, [], [], HOURS), gapOpts)
    expect(before.scraps).toEqual([])
    expect(after.scraps.filter((c) => c.group === 'staff').map((c) => [c.s, c.e])).toEqual([[965, 1020]])
  })
})

/** WO-2d, Liam flag 15: "a free run crossing a boundary (15:50→16:00) should
 *  merge and advertise ONE 60-minute box". Canon's answer, driven against
 *  canon's own exposed `__gapPackingV5` on this exact family and matched
 *  0/54 mismatches: it merges ONLY when the customer grid cannot fit the same
 *  number of sessions (k_grid < k_pack → PACK MODE, canon :5164–5178). At 70
 *  minutes the grid fits one 60 too, so canon takes the hour-aligned box and
 *  drops the 10-minute head. Below the dial that head is not advertised at all. */
describe('a free run that crosses the hour — when canon merges and when the grid wins', () => {
  const GUARD = {
    services: [{ name: '整体60', dur: 60 }, { name: '骨盤90', dur: 90 }],
    newClientSessionMin: 90, protectedLabel: '新規', gapFillMinMin: 30, leadTimeMin: 0,
    mode: 'standard' as const,
  }
  const run = (from: number, until: number) =>
    gapLayerFor(
      [lane({ key: 'p-01', group: 'staff', window: { from, until }, untilLabel: '' }), lane({ key: 'bed-01', group: 'beds' })],
      {
        gridMin: 60, sessionMin: 60, gapFillMin: 30, gapFillDiscountPct: 10, nowMinute: null,
        locked: [], frame: { hi: 7260, lo: 6600, hqMin: 6600, hqMax: 7260 }, depth: 9, guard: GUARD,
      },
    )
  const staff = (o: ReturnType<typeof run>, k: 'packed' | 'scraps') => o[k].filter((c) => c.group === 'staff').map((c) => [c.s, c.e])

  it('exactly 60 free minutes from 15:50 → ONE 60-minute box at 15:50, no fragments', () => {
    const out = run(950, 1010)
    expect(staff(out, 'packed')).toEqual([[950, 1010]])
    expect(staff(out, 'scraps')).toEqual([])
  })

  it('70 free minutes from 15:50 → the grid wins: the hour box, and the 10-minute head is not advertised', () => {
    const out = run(950, 1020)
    expect(staff(out, 'packed')).toEqual([])
    expect(staff(out, 'scraps')).toEqual([]) // 10 minutes is under the 30-minute dial
  })

  it('120 free minutes from 15:50 → the grid fits one, packing fits two, so packing wins', () => {
    expect(staff(run(950, 1070), 'packed')).toEqual([[950, 1010], [1010, 1070]])
  })

  it('105 free minutes from 15:50 → hour box plus a 35-minute tail, offered orange', () => {
    const out = run(950, 1055)
    expect(staff(out, 'packed')).toEqual([])
    expect(staff(out, 'scraps')).toEqual([[1020, 1055]])
  })
})

/** WO-2e ITEM 1 — ⚖ Liam 2026-08-20, length-matched drag emphasis.
 *
 *  Canon deepens every derived window for the length of a drag (:594–598).
 *  Liam's ruling: the emphasis must answer "where does THIS fit at full value",
 *  so only windows advertising the dragged booking's own length take it and the
 *  rest go calm. At rest nothing changes — canon's border grammar is untouched.
 *
 *  There is no DOM renderer in this territory (import fence: react/next/node
 *  only), so the RULE is driven directly against real derived layers, the
 *  WIRING is pinned as a source contract, and the PAINT as a stylesheet
 *  contract. Between them nothing in the chain is assumed. */
describe('the drag emphasis follows the dragged length, and nothing else', () => {
  const GUARD = {
    services: [{ name: '整体60', dur: 60 }, { name: 'ストレッチ30', dur: 30 }],
    newClientSessionMin: 90, protectedLabel: '新規', gapFillMinMin: 30, leadTimeMin: 0,
    mode: 'standard' as const,
  }
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
  const CSS = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/today.css'), 'utf8')

  it('a window fits only its own advertised length — never a longer or shorter card', () => {
    expect(fitsDrag(60, 60)).toBe(true)
    expect(fitsDrag(30, 30)).toBe(true)
    // A 60-minute card does NOT fit a 30-minute window, and vice versa: the
    // question is "at full value", not "does it physically overlap".
    expect(fitsDrag(30, 60)).toBe(false)
    expect(fitsDrag(60, 30)).toBe(false)
    expect(fitsDrag(60, 90)).toBe(false)
    // And at rest — nothing in flight — nothing is emphasised at all.
    expect(fitsDrag(60, null)).toBe(false)
    expect(fitsDrag(30, null)).toBe(false)
  })

  it('over a real board: a 30-minute card lights the 30分 box and leaves the hour boxes calm', () => {
    // 見本 A works 14:00–17:30. That leaves a 210-minute run: the grid takes
    // three hours and a 30-minute end an exact menu fills — one 詰め込み box.
    const lanes = [
      lane({ key: 'p-01', group: 'staff', window: { from: 840, until: 1050 }, untilLabel: '17:30' }),
      lane({ key: 'bed-01', group: 'beds' }),
    ]
    const sell = sellLayerFor(lanes, HOURS, { gridMin: 60, nowMinute: null, locked: [], showPrice: true, hi: 7260, hqMin: 6600, depth: 9 })
    const gap = gapLayerFor(lanes, {
      gridMin: 60, sessionMin: 60, gapFillMin: 30, gapFillDiscountPct: 10, nowMinute: null,
      locked: [], frame: { hi: 7260, lo: 6600, hqMin: 6600, hqMax: 7260 }, depth: 9, guard: GUARD,
    })
    const hourBoxes = sell.cells.filter((c) => c.group === 'staff')
    const packed = gap.packed.filter((c) => c.group === 'staff')
    expect(hourBoxes.length).toBeGreaterThan(0)
    expect(packed.map((c) => c.e - c.s)).toEqual([30])

    // Dragging a 30-minute booking: the 30分 box only.
    expect(hourBoxes.filter((c) => fitsDrag(60, 30))).toHaveLength(0)
    expect(packed.filter((c) => fitsDrag(c.e - c.s, 30))).toHaveLength(1)
    // Dragging a 60-minute booking: every hour box, and NOT the 30分 one.
    expect(hourBoxes.filter((c) => fitsDrag(60, 60))).toHaveLength(hourBoxes.length)
    expect(packed.filter((c) => fitsDrag(c.e - c.s, 60))).toHaveLength(0)
    // Dragging a 90-minute booking: nothing on this board fits it at full value.
    expect(hourBoxes.filter((c) => fitsDrag(60, 90))).toHaveLength(0)
    expect(packed.filter((c) => fitsDrag(c.e - c.s, 90))).toHaveLength(0)
  })

  it('the screen keys the class off the dragged length and clears it on every exit', () => {
    // The two boxes ask about their OWN advertised length…
    expect(SRC).toContain("`cell-price${fitsDrag(60, dragLen) ? ' fits' : ''}`")
    expect(SRC).toContain('packedHere && fitsDrag(c.e - c.s, dragLen)')
    // …a スキマ枠 is a discount, not a session, so it never takes the class.
    expect(SRC).not.toContain("'cell-gapfill fits'")
    // …the length is the card's own, not the span the pointer is dragging out…
    expect(SRC).toContain('setDragLen(ctx.item.endMin - ctx.item.startMin)')
    // …and BOTH gestures reach it, which `:has(.event.dragging)` could not.
    // ⚖ Liam flag 26 added the third: a block drag lifts the layer too (canon's
    // bindBlockDrag puts `.dragging` on the block), but carries no length, so it
    // reveals without emphasising — `dragLen` stays null through the gesture.
    // ⚖ Liam flag 29 added the fourth, for the same reason: an edge drag lifts
    // the layer (canon sets `dragActive` before its mode branch) and carries no
    // length either — the card is not looking for a window, it is growing into
    // one, so `live` reveals and `dragLen` stays null.
    expect(SRC).toContain("dragLen != null || live || blockLive ? 'dragging-live' : ''")
    expect(SRC).not.toContain('setDragLen(ctx.item.endMin - ctx.item.startMin)\n      setBlockLive')
    // Every teardown path clears it: release/cancel/blur go through clearDrag,
    // the shelf's three endings through clearChipDrag.
    for (const fn of ['function clearDrag()', 'function clearChipDrag()']) {
      const body = SRC.slice(SRC.indexOf(fn), SRC.indexOf(fn) + 800)
      expect(body).toContain('setDragLen(null)')
    }
    // …including the two lost-pointer self-heals, which route into those two.
    expect(SRC).toContain('if (e.buttons === 0) { cancelDrag(); return }')
    expect(SRC).toContain('if (e.buttons === 0) { clearChipDrag(); return }')
  })

  it('the stylesheet emphasises only .fits, and calms a 詰め込み box that does not', () => {
    expect(CSS).toContain('.biz .timeline.dragging-live .cell-price.fits {')
    expect(CSS).toContain('.biz .timeline.dragging-live .cell-packed:not(.fits) { background: rgba(130, 151, 233, .07); border-color: transparent; }')
    // The old uniform-deepen selectors are gone: no window rule is gated on a
    // card being on the board any more (comments about them are not rules).
    expect(CSS.split('\n').filter((l) => !l.trimStart().startsWith('`') && /:has\(/.test(l) && /cell-(price|packed)/.test(l))).toEqual([])
    // At rest the border grammar is exactly canon's: 詰め込み keeps its border.
    expect(CSS).toContain('border: 1.5px solid rgba(63, 91, 232, .55)')
  })
})

/** WO-2e ITEM 2 — ⚖ Liam 2026-08-20, the fixture day is livened with odd-minute
 *  bookings so canon's PACK MODE has something to say. WO-2d proved the renderer
 *  already merges exactly where canon does; what it could not do was SHOW it,
 *  because every booking sat on a clean 30-minute boundary and all ten pockets
 *  came out GRID MODE. These assertions are on the demo world itself. */
describe('the sample day produces a merged cross-boundary window', () => {
  const FIXTURES = readFileSync(join(process.cwd(), 'src/business/lib/fixtures.ts'), 'utf8')

  it('the default store keeps its odd-minute bookings', () => {
    // 見本 あずさ: 14:05–15:05 and 17:12–18:12. The run between them is 127
    // minutes from an odd start — two packed sessions where the hour grid fits
    // one, which is canon's own PACK MODE test (k_grid < k_pack, :5164).
    expect(FIXTURES).toContain("slot('apt-29', 'thin-02', STORE_A, 'p-06', 'menu-01', 0, 14, 5, 60,")
    expect(FIXTURES).toContain("slot('apt-33', 'cus-06', STORE_A, 'p-06', 'menu-01', 0, 17, 12, 60,")
    // …and 代官山 gets one too, so the layer is not a single-store trick.
    expect(FIXTURES).toContain("slot('apt-34', 'cus-08', STORE_B, 'p-05', 'menu-05', 0, 15, 45, 45,")
    // The 20/30-minute menus stay: ⚖ Liam kept them and their bordered boxes.
    expect(FIXTURES).toContain("duration_minutes: 30")
    expect(FIXTURES).toContain("duration_minutes: 20")
  })

  it('that shape of run really does merge, and a clean one really does not', () => {
    const GUARD = {
      services: [{ name: '整体60', dur: 60 }, { name: '骨盤90', dur: 90 }, { name: 'ストレッチ30', dur: 30 }],
      newClientSessionMin: 90, protectedLabel: '新規', gapFillMinMin: 30, leadTimeMin: 0,
      mode: 'standard' as const,
    }
    const run = (from: number, until: number) =>
      gapLayerFor(
        [lane({ key: 'p-06', group: 'staff', window: { from, until }, untilLabel: '' }), lane({ key: 'bed-01', group: 'beds' })],
        {
          gridMin: 60, sessionMin: 60, gapFillMin: 30, gapFillDiscountPct: 10, nowMinute: null,
          locked: [], frame: { hi: 7260, lo: 6600, hqMin: 6600, hqMax: 7260 }, depth: 9, guard: GUARD,
        },
      ).packed.filter((c) => c.group === 'staff').map((c) => [c.s, c.e])

    // 15:05 → 17:12, the run the two new bookings leave: TWO 60-minute boxes,
    // both crossing an hour line. This is the box Liam remembers from canon.
    expect(run(905, 1032)).toEqual([[905, 965], [965, 1025]])
    // The same lane BEFORE the change — 15:30 → 19:00 — merged NOTHING: the
    // grid fits three hours and packing fits three, so GRID MODE won and all
    // that came back was the 30-minute end an exact menu fills. That single
    // short bordered box is the whole 詰め込み layer the old fixture could show.
    expect(run(930, 1140)).toEqual([[930, 960]])
  })
})

/** WO-2e ITEM 3 — ⚖ Liam flags 19/20, the drag proxy. The card he grabbed
 *  travels with the cursor; the dashed outline stays as the snapped landing
 *  preview; the origin dims. The overlay is a real node whose transform is
 *  written straight to it, so the lifecycle is driven here on a real jsdom node
 *  through the same three transitions the screen puts it through. */
describe('the drag proxy: mounted on the gesture, moved by transform, gone on every ending', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
  const CSS = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/today.css'), 'utf8')

  it('hangs off the exact point the card was grabbed by — attached, not trailing', () => {
    // Card at (100, 40), grabbed 30px in and 8px down: the proxy's top-left is
    // always 30/8 behind the cursor, wherever the cursor goes.
    const grab = { dx: 30, dy: 8 }
    expect(proxyTransform(130, 48, grab)).toBe('translate3d(100px, 40px, 0)')
    expect(proxyTransform(430, 148, grab)).toBe('translate3d(400px, 140px, 0)')
    // Sub-pixel pointer positions are rounded — a fractional transform makes
    // the card's own text shimmer while it travels.
    expect(proxyTransform(130.4, 48.6, grab)).toBe('translate3d(100px, 41px, 0)')
  })

  it('one node, one style property, across a whole gesture', () => {
    const board = document.createElement('div')
    const proxy = document.createElement('div')
    proxy.className = 'event confirmed drag-proxy'
    const grab = { dx: 12, dy: 6 }
    // start
    board.appendChild(proxy)
    proxy.style.transform = proxyTransform(200, 100, grab)
    expect(board.querySelectorAll('.drag-proxy')).toHaveLength(1)
    expect(proxy.style.transform).toBe('translate3d(188px, 94px, 0)')
    // …tracks
    proxy.style.transform = proxyTransform(260, 220, grab)
    expect(proxy.style.transform).toBe('translate3d(248px, 214px, 0)')
    expect(board.querySelectorAll('.drag-proxy')).toHaveLength(1) // never a second one
    // …and goes on the release
    proxy.remove()
    expect(board.querySelectorAll('.drag-proxy')).toHaveLength(0)
  })

  it('the screen mounts it once, never re-parents the real card, and drops it on all four endings', () => {
    // Content set once, behind the move threshold; only the transform repeats.
    expect(SRC).toContain("setProxy({ kind: 'card', item: ctx.item")
    expect(SRC).toContain('moveProxy(clientX, clientY, ctx.grab)')
    expect(SRC).toContain('proxyAt.current = proxyTransform(clientX, clientY, grab)')
    // WO-2c's architecture is intact: the DRAWN board during a drag is the
    // committed one, so the real node is never moved between lanes.
    // (⚖ flag 26: a block drag holds the same freeze, for the same reason.)
    expect(SRC).toContain('const drawnLanes = live || blockLive ? committedLanes : boardLanes')
    // WO-2d's is intact too: the window layers still read committedLanes.
    expect(SRC).toContain('sellLayerFor(committedLanes')
    expect(SRC).toContain('gapLayerFor(committedLanes')
    // Release / cancel / blur and the board self-heal → clearDrag.
    // Shelf up / cancel and the shelf self-heal → clearChipDrag.
    for (const fn of ['function clearDrag()', 'function clearChipDrag()']) {
      const body = SRC.slice(SRC.indexOf(fn), SRC.indexOf(fn) + 800)
      expect(body).toContain('setProxy(null)')
    }
    // The dashed outline is now drawn for EVERY live drag, not only a lane
    // change — with the card in hand it is the board's only landing statement.
    // (⚖ flag 26 put the block's landing in front of the booking's in the same
    // ternary — the booking arm is unchanged and still refuses over the shelf.)
    expect(SRC).toContain([
      '    : live && !live.overShelf',
      '      ? { laneKey: live.targetLane, x: live.x, w: live.w }',
      '      : null',
    ].join('\n'))
    expect(SRC).toContain('const landing = blockLive')
    // …and the origin dims rather than travelling.
    expect(CSS).toContain('.biz .event.dragging { opacity: .32;')
    expect(CSS).toContain('.biz .event.drag-proxy,')
  })
})

/** WO-2e ITEM 4 — ⚖ Liam flag 21, 次回予約を作成 carried from canon (:6903 →
 *  :6826 armPlacing → :6820 track click → :6005 createAtCell). The button arms
 *  the board rather than opening the create dialog; the slot click makes the
 *  booking with the ご来店中 customer already filled in; `prefilled` means the
 *  hold bar, not the modal. */
describe('次回予約を作成 arms the board, and the slot click makes the booking', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')

  it('a placement needs a room as well as a person, and says so when there is none', () => {
    const beds = [
      lane({ key: 'bed-01', group: 'beds', items: [booking({ key: 'b1', caseId: 'apt-1' }, 900, 960)] }),
      lane({ key: 'bed-02', group: 'beds', items: [booking({ key: 'b2', caseId: 'apt-2' }, 890, 1000)] }),
    ]
    const staff = [lane({ key: 'p-01', group: 'staff' })]
    // 15:00–16:00: both beds are busy → canon refuses the placement outright.
    expect(freePartnerLane([...staff, ...beds], 'staff', 900, 960)).toBeNull()
    // 16:00–17:00: bed-02 is still busy until 16:40, bed-01 is free → first wins.
    expect(freePartnerLane([...staff, ...beds], 'staff', 960, 1020)?.key).toBe('bed-01')
    // Touching ends do not overlap: a bed free FROM 16:00 can take 16:00.
    expect(freePartnerLane([lane({ key: 'bed-09', group: 'beds', items: [booking({ key: 'b3', caseId: 'apt-3' }, 840, 900)] })], 'staff', 900, 960)?.key).toBe('bed-09')
  })

  it('carries canon’s own words and canon’s own transitions', () => {
    // The button no longer opens the create dialog.
    expect(SRC).toContain('<button className="btn text" type="button" onClick={armNextVisit}>次回予約を作成</button>')
    // canon's label, hint and × (:6908, :1866).
    expect(SRC).toContain('様の次回予約（${props.guard.standardSessionMin}分・単発）— お客様情報は自動入力')
    expect(SRC).toContain('<span>置きたい日へ移動して、空き枠をクリック</span>')
    expect(SRC).toContain('aria-label="配置モードをやめる"')
    // canon's toast, which itself promises the day-navigation allowance.
    expect(SRC).toContain('配置モード: 置きたい空き枠をクリック（日付を移動してもそのまま）')
    // canon's two refusals, verbatim (:6829, :6817, :6023).
    expect(SRC).toContain('仮押さえ中の変更を確定するか、元に戻してから操作してください')
    expect(SRC).toContain('この時間帯に空いているベッドがいません')
    expect(SRC).toContain('シフトロック中: このスタッフには新しい予約を置けません')
    // An armed board treats the empty slot as a landing, not as a form.
    expect(SRC).toContain('if (placing) { placeNextVisit(lane, start); return }')
    // `prefilled` → the hold bar, never the create modal (:6076–6083).
    const body = SRC.slice(SRC.indexOf('function placeNextVisit'), SRC.indexOf('function placeFromShelf'))
    expect(body).toContain('setPending({ id, origin:')
    expect(body).not.toContain('createRef.current?.showModal()')
    // The customer rides along; the length and category are canon's literals.
    expect(body).toContain('title: p.name')
    expect(body).toContain("ticketCat: '単発'")
    expect(body).toContain('props.guard.standardSessionMin')
    // Escape puts it down (:6942).
    expect(SRC).toContain("if (e.key === 'Escape' && !document.querySelector('dialog[open]')) setPlacing(null)")
  })
})

/** WO-2e ITEM 5 — ⚖ Liam flag 22, the cross-day park flow. The chip survives a
 *  date change and can be placed on ANY viewed day. The mechanism is one field:
 *  a card this session put on a board carries the day it was put on, and the
 *  origin day keeps hiding the booking through `parked` — so the booking is on
 *  exactly one board, the one it was placed on. */
describe('a parked chip crosses days, lands on the day being viewed, and the × brings it home', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
  const origin = [
    lane({ key: 'p-01', group: 'staff', items: [booking({ key: 'a', caseId: 'apt-1' }, 720, 780)] }),
    lane({ key: 'p-04', group: 'staff' }),
  ]
  const carried: BoardItem = booking({ key: 'a', caseId: 'apt-1' }, 900, 960)

  it('parked: the origin day loses the card, and the chip keeps the origin date in its 元: line', () => {
    const parkedDay = applyMoves(origin, {}, ['apt-1'], [], HOURS)
    expect(parkedDay[0].items.filter((i) => i.caseId === 'apt-1')).toHaveLength(0)
    const chip = parkChipText(booking({ key: 'a', caseId: 'apt-1' }, 720, 780), HOURS, '2026年8月20日(木)')
    expect(chip.title).toBe('見本 はなこ様（仮押さえ・未配置）')
    expect(chip.line2).toBe('元: 2026年8月20日(木) 12:00〜13:00 — 置きたい日の枠へドラッグ')
  })

  it('placed on ANOTHER day: it is on that board, and on no other', () => {
    // The other day's board knows nothing of apt-1 — which is exactly why a
    // `moves` entry alone could never draw it there.
    const otherDayLanes = [lane({ key: 'p-01', group: 'staff' }), lane({ key: 'p-04', group: 'staff' })]
    const placedRow = { dayOffset: 2, laneKey: 'p-04', item: carried }
    const dayShown = (offset: number, lanes: BoardLane[]) =>
      applyMoves(lanes, { 'apt-1': { laneKey: 'p-04', x: carried.x, w: carried.w } }, ['apt-1'],
        [placedRow].filter((a) => a.dayOffset === offset), HOURS)

    const onTarget = dayShown(2, otherDayLanes)
    expect(onTarget.find((l) => l.key === 'p-04')!.items.map((i) => i.caseId)).toEqual(['apt-1'])
    expect(onTarget.find((l) => l.key === 'p-01')!.items).toHaveLength(0)

    // Back on the origin day the booking is still hidden — one board, not two.
    const onOrigin = dayShown(0, origin)
    expect(onOrigin.flatMap((l) => l.items).filter((i) => i.caseId === 'apt-1')).toHaveLength(0)

    // …and a third day, which was never involved, shows nothing at all.
    expect(dayShown(-1, otherDayLanes).flatMap((l) => l.items)).toHaveLength(0)
  })

  it('the × restores the booking to its origin day and slot', () => {
    // unpark drops the id from `parked` and any placed row, and points `moves`
    // back at the span it was taken from.
    const home = { laneKey: 'p-01', x: origin[0].items[0].x, w: origin[0].items[0].w }
    const restored = applyMoves(origin, { 'apt-1': home }, [], [], HOURS)
    const card = restored.find((l) => l.key === 'p-01')!.items.find((i) => i.caseId === 'apt-1')!
    expect([card.startMin, card.endMin]).toEqual([720, 780])
    expect(restored.find((l) => l.key === 'p-04')!.items).toHaveLength(0)
  })

  it('the screen scopes every added row to a day, and both undo paths clear it', () => {
    expect(SRC).toContain('const addedHere = useMemo(')
    // RENEGOTIATED (⚖ 46 forerunner, Greptile #737 P1): the scope is the BOARD —
    // the day AND the store — behind one predicate, so a row cannot be scoped to
    // one and not the other. The day half is still pinned, in `onShownBoard`.
    expect(SRC).toContain('added.filter((a) => onShownBoard(a, board))')
    // All three boards read the board-scoped list — a card placed on 8/22 cannot
    // leak into 8/20's derivation, let alone its price layer.
    // (⚖ flag 26: `placedLanes` is props.lanes + this session's block moves —
    // the day-scoped `addedHere` argument is what this test is pinning.)
    expect(SRC).toContain('applyMoves(placedLanes, liveMoves, parked, addedHere, hours)')
    expect(SRC).toContain('applyMoves(placedLanes, moves, parked, addedHere, hours)')
    // The shelf lands through `added`, stamped with the BOARD on screen —
    // RENEGOTIATED (⚖ 46 forerunner): the day and the store together, from the
    // one `board` const, so a landing cannot record half of where it landed.
    const body = SRC.slice(SRC.indexOf('function placeFromShelf'), SRC.indexOf('function placeFromShelf') + 3600)
    expect(body).toContain('{ ...board, laneKey: staff.key, fromChip: chip,')
    expect(SRC).toContain('const board = useMemo(')
    expect(SRC).toContain('() => ({ dayOffset: props.dayOffset, store: props.storeParam }),')
    expect(body).toContain('setParkChips((was) => was.filter((c) => c.id !== chip.id))')
    // The card's accessible name leads with its span, so the landing rewrites it
    // — a card drawn at 15:00 that still announces 14:05 is the one thing on the
    // board that is not true. (Caught by the browser run, not by a review.)
    // The landing can change time, staff AND bed at once, so the accessible
    // name is rebuilt in today-board's grammar rather than patched — a card
    // drawn at 15:00 on ベッド1 that still announces 14:05 / ベッド3 is the one
    // thing on the board that is not true. (Caught by the browser run.)
    expect(body).toContain('label: `${hhmm(start)}–${hhmm(end)} ${chip.item.title}様 /')
    // …and the landing proves a room, exactly as 次回予約 does. A card labelled
    // 【ベッド3】 over an empty ベッド3 lane is the impossible state ⚖ 8/9 forbids.
    // The drop names one lane; which group it belongs to decides what was said
    // (canon :5629/:5666), the parked card's own bed is tried first, and a
    // landing with no free room is refused in canon's words rather than drawn.
    expect(body).toContain("const staff = dropped?.group === 'beds' ? boardLanes.find((l) => l.key === chip.home.laneKey) : dropped")
    expect(body).toContain("const bed = dropped?.group === 'beds' ? dropped : free(home) ? home : freePartnerLane(boardLanes, 'staff', start, end)")
    expect(body).toContain('この時間帯に空いているベッドがいません')
    expect(body).toContain('laneKey: bed.key')
    // The × and the hold bar's 元に戻す both take the placed row back off.
    expect(SRC).toContain('setAdded((was) => was.filter((a) => a.item.caseId !== id))')
    expect(SRC).toContain('const placed = added.find((a) => a.item.caseId === id)')
    // The shelf's hint already advertises 日付またぎ — canon's own copy.
    expect(SRC).toContain('ドラッグでここへ（日付またぎ・置くと仮押さえ）')
  })
})

/** ⚖ Liam flag 30 (2026-08-21). The bug, proven on the DEPLOYED app: the parked
 *  chip did NOT survive day navigation. `?day=±N` is a real Link (today/page.tsx
 *  :22-24), so TodayPage re-executes and TodayScreen REMOUNTS — and the whole
 *  session-edit family sat in TodayScreen's own useState.
 *
 *  THIS HARNESS IS WHERE THAT HID, and it still cannot see it: these tests drive
 *  the screen's functions and never the router, so nothing here proves SURVIVAL.
 *  What is provable here is that the state is no longer anywhere a remount can
 *  reach, and that the × is answered by a RECORDED day rather than by whichever
 *  board is on screen. The survival itself is a deployed-preview acceptance. */
describe('the session’s edits outlive the day flip, and the × knows which day it restores to', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
  const LAYOUT = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/layout.tsx'), 'utf8')
  const PROVIDER = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/BusinessSessionEdits.tsx'), 'utf8')
  const FAMILY = ['added', 'moves', 'parked', 'parkChips', 'pending', 'placing']

  it('the screen holds none of the family in its own useState — it reads them from the layout', () => {
    for (const name of FAMILY) expect(SRC).not.toMatch(new RegExp(`const \\[${name}, set`))
    expect(SRC).toContain('} = useSessionEdits()')
    // The specifier itself is pinned by foundation.test.ts's import INVENTORY —
    // spelling a relative `from '…'` inside a test file makes the isolation
    // scanner resolve it against THIS folder and report a phantom offender.
    expect(SRC).toContain('import { useSessionEdits, type ParkChip } from')
    // What stays local is what dies WITH the gesture — the in-flight drag.
    expect(SRC).toContain('const [live, setLive] = useState<LiveDrag | null>(null)')
  })

  it('the provider is mounted in the layout, which a ?day= navigation does not remount', () => {
    expect(LAYOUT).toContain('import { BusinessSessionEdits } from')
    expect(LAYOUT).toContain('<BusinessSessionEdits>{children}</BusinessSessionEdits>')
    // All six really are state, in one place — a partial move would let a chip
    // survive the flip while the booking it was placed as did not.
    for (const name of FAMILY) expect(PROVIDER).toContain(`const [${name}, set`)
    // Context, not a portal: react-dom is off territory's import allowlist and
    // the topbar's ActionSlot (BusinessTopbar.tsx:23-26) says so out loud.
    expect(PROVIDER).toContain("from 'react'")
    expect(PROVIDER).not.toContain("'react-dom'")
  })

  it('park records the origin day as DATA, not only as the 元: sentence', () => {
    const body = SRC.slice(SRC.indexOf('function park('), SRC.indexOf('function unpark('))
    // canon's snapshot carries `day` per element (:5567-5570); ours carries it
    // on the record, because our chip outlives the DOM it was taken from.
    // RENEGOTIATED (⚖ 46 forerunner, Greptile #737 P1): the four stamp fields
    // are spelled ONCE, in `boardStamp`, so no site can record the day and
    // forget the store. The pin follows them there.
    expect(body).toContain('home: { ...from, ...boardStamp }')
    expect(SRC).toContain('const boardStamp = { ...board, dayLabel: props.dayLabel, storeLabel: props.lensLabel }')
    // …and the printed line is still the printed line.
    expect(body).toContain('const text = parkChipText(item, hours, props.dayLabel)')
  })

  it('the × is answered by the recorded day, never by the board on screen', () => {
    // RENEGOTIATED (⚖ 46 forerunner): a board is a day AND a store, so both
    // sides of the comparison are now boards. Same four day cases, one store.
    const A = (dayOffset: number) => ({ dayOffset, store: 'store-a' })
    // Origin day on screen and the booking on it: straight home, canon's toast.
    expect(unparkOutcome(A(0), A(0), true)).toBe('here')
    // Origin day elsewhere: the restore is still right — the booking lives on
    // exactly one day — so it happens, and the caller names the day it went to.
    // What is on THIS board is irrelevant, which is the whole point.
    expect(unparkOutcome(A(-2), A(3), true)).toBe('elsewhere')
    expect(unparkOutcome(A(-2), A(3), false)).toBe('elsewhere')
    // Origin day on screen and the booking is NOT on it — the fixture world
    // re-based under the shelf (a board left open across JST midnight).
    expect(unparkOutcome(A(4), A(4), false)).toBe('gone')
  })

  it('the soft failure keeps the chip: nothing is removed before the outcome is known', () => {
    const body = SRC.slice(SRC.indexOf('function unpark('), SRC.indexOf('function onChipPointerDown'))
    // RENEGOTIATED (⚖ 46 forerunner): `board` is the day AND the store on screen.
    expect(body).toContain('const outcome = unparkOutcome(chip.home, board, originHere)')
    expect(body).toContain('仮置きエリアに残しています')
    // The ORDERING is the guarantee: the refusal returns ahead of every removal,
    // so a chip that cannot be restored is still a chip that can be placed.
    expect(body.indexOf("if (outcome === 'gone')")).toBeLessThan(body.indexOf('setParkChips((was) => was.filter'))
    expect(body.indexOf("if (outcome === 'gone')")).toBeLessThan(body.indexOf('setParked((was) => was.filter'))
    // A chip that is not there at all is a no-op, never a throw and never a
    // toast claiming a booking went home.
    expect(body).toContain('if (!chip) return')
    // The restore takes its span from the RECORD, and the off-day toast says
    // which board it went back to — the hold bar's day-pin habit.
    expect(body).toContain('setMoves((was) => ({ ...was, [id]: { laneKey: chip.home.laneKey, x: chip.home.x, w: chip.home.w } }))')
    // RENEGOTIATED (⚖ 46 forerunner): the off-board toast names the store too
    // when that is what differs — a bare day label would read as this store's.
    expect(body).toContain('`${name}を${backTo}の元の枠に戻しました`')
    expect(body).toContain('`${chip.home.storeLabel} ${chip.home.dayLabel}`')
  })
})

/** ⚖ 46 FORERUNNER — GREPTILE #737 P1: A BOARD IS A DAY *AND* A STORE.
 *
 *  The provider lives in the layout, and `?store=` is a Link exactly like
 *  `?day=` — so the session-edit family survived a store switch and was being
 *  rendered on, and evaluated against, the other store's board. The sharpest
 *  case is a staff member who works at BOTH stores: the two boards then share
 *  that person's lane key, and a card added on one painted onto the other.
 *
 *  FORWARD SUPERSESSION: slice F (batch 7, feat/business-transplant-today) ships
 *  the fuller ⚖ 46 design — storeParam + storeLabel on ParkHome/PlacingIntent and
 *  a named `foreignStoreRefusal`. On replay the LATER slice wins this whole
 *  family; every "⚖ 46 forerunner" here is the thing being replaced.
 *
 *  ⚖ 46 SHAPE, held to here: parked chips stay VISIBLE on every board (the shelf
 *  is the operator's hand, not the board's content), a placement on a foreign
 *  board is REFUSED rather than silently dropped or silently landed, the refusal
 *  destroys NOTHING, and the × restores from anywhere. */
describe('a session edit belongs to ONE board — the day and the store it was made on', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
  const PLACE_NEXT = SRC.slice(SRC.indexOf('function placeNextVisit('), SRC.indexOf('function placeFromShelf('))
  const PLACE_SHELF = SRC.slice(SRC.indexOf('function placeFromShelf('), SRC.indexOf('const monthCells ='))
  const STORE_A = 'store-a'
  const STORE_B = 'store-b'
  /** The shared staff member. Both stores draw her lane under the SAME key,
   *  which is exactly why day-only scoping leaked. */
  const SHARED = 'p-01'
  const boardA = { dayOffset: 0, store: STORE_A }
  const boardB = { dayOffset: 0, store: STORE_B }

  it('“same store” is identity, and the all-stores lens is its own board', () => {
    expect(sameStore(STORE_A, STORE_A)).toBe(true)
    expect(sameStore(STORE_A, STORE_B)).toBe(false)
    // null is the {viewAll:true} lens (defaultStoreId returns it only when the
    // actor has no store at all). It is a THIRD board, never a wildcard: a
    // wildcard here would paint one store's staged cards onto the merge.
    expect(sameStore(null, STORE_A)).toBe(false)
    expect(sameStore(STORE_A, null)).toBe(false)
    expect(sameStore(null, null)).toBe(true)
  })

  it('an edit is on the shown board only when BOTH the day and the store match', () => {
    expect(onShownBoard({ dayOffset: 0, store: STORE_A }, boardA)).toBe(true)
    // Right store, wrong day — ⚖ 22's half of the rule.
    expect(onShownBoard({ dayOffset: 1, store: STORE_A }, boardA)).toBe(false)
    // Right day, wrong store — the half this fix adds, and the one that was
    // silently absent: the day matched, so everything went on computing.
    expect(onShownBoard({ dayOffset: 0, store: STORE_B }, boardA)).toBe(false)
    expect(onShownBoard({ dayOffset: 1, store: STORE_B }, boardA)).toBe(false)
  })

  it('a booking added on store A does not paint on store B’s board — even on the SHARED staff lane', () => {
    // Both stores render the shared staff member's lane under the same key.
    const lanesB = [lane({ key: SHARED, group: 'staff' }), lane({ key: 'bed-01', group: 'beds' })]
    const card = booking({ key: 'nextvisit-store-a-0-1-staff', caseId: 'nextvisit-store-a-0-1' }, 780, 840)
    const added = [{ ...boardA, laneKey: SHARED, item: card }]

    // Store A's board, same day: the card is there — the scoping must not have
    // simply broken the feature it is guarding.
    const onA = applyMoves(lanesB, {}, [], added.filter((a) => onShownBoard(a, boardA)), HOURS)
    expect(onA[0].items.map((i) => i.caseId)).toEqual(['nextvisit-store-a-0-1'])

    // Store B's board, same day, same lane key: nothing.
    const onB = applyMoves(lanesB, {}, [], added.filter((a) => onShownBoard(a, boardB)), HOURS)
    expect(onB.every((l) => l.items.length === 0)).toBe(true)
  })

  it('a move staged on store A cannot reach store B’s board', () => {
    // `moves` carries no store stamp, and this is the evidence for why: it is
    // keyed by caseId, and `applyMoves` can only act on a key the board on
    // screen already has. Store B has no such booking, so the move finds no
    // home to carry and no item to redraw — the arrivals pass drops it.
    const lanesB = [
      lane({ key: SHARED, group: 'staff', items: [booking({ key: 'b-staff', caseId: 'apt-b' }, 660, 720)] }),
      lane({ key: 'p-09', group: 'staff' }),
    ]
    const stagedOnA: Moves = { 'apt-a': { laneKey: SHARED, x: 0, w: 100 / 9 } }
    const out = applyMoves(lanesB, stagedOnA, [], [], HOURS)
    expect(out.flatMap((l) => l.items.map((i) => i.caseId))).toEqual(['apt-b'])
    // …and store B's own card is untouched by the foreign move.
    expect(out[0].items[0].startMin).toBe(660)
  })

  it('the created id carries its board, so two boards’ first placements cannot collide', () => {
    // `createSeq` is a ref inside the screen and the screen remounts on every
    // navigation, so the counter alone made EVERY board's first placement
    // `nextvisit-1` — colliding in `moves` and in revertPending's caseId lookup.
    expect(PLACE_NEXT).toContain('const id = `nextvisit-${props.storeParam ?? \'all\'}-${props.dayOffset}-${createSeq.current}`')
  })

  it('placing a chip on a foreign store is REFUSED, and the refusal destroys nothing', () => {
    expect(PLACE_SHELF).toContain('if (!sameStore(chip.home.store, props.storeParam)) {')
    // The toast names the chip's OWN store — ⚖ 46's wording rule.
    expect(PLACE_SHELF).toContain('${chip.home.storeLabel}の予約です')
    // ORDERING IS THE GUARANTEE (the unpark habit): the refusal returns ahead of
    // every setter, so nothing is placed, the chip stays on the shelf, and the ×
    // still works. A guard placed after `setParkChips` would read as a refusal
    // and behave as a deletion.
    const refusal = PLACE_SHELF.indexOf('if (!sameStore(chip.home.store, props.storeParam)) {')
    for (const setter of ['setParkChips(', 'setAdded(', 'setMoves(', 'setPending(']) {
      expect(PLACE_SHELF.indexOf(setter)).toBeGreaterThan(refusal)
    }
  })

  it('配置モード armed on store A is refused on store B, and stays in hand', () => {
    expect(PLACE_NEXT).toContain('if (!sameStore(p.store, props.storeParam)) {')
    expect(PLACE_NEXT).toContain('${p.storeLabel}で始めた配置です')
    // Ahead of `setPlacing(null)` — a refusal that disarmed the intent would
    // make the operator re-arm it, which is the state destruction ⚖ 46 forbids.
    expect(PLACE_NEXT.indexOf('setPlacing(null)')).toBeGreaterThan(PLACE_NEXT.indexOf('if (!sameStore(p.store, props.storeParam)) {'))
  })

  it('the × restores from a FOREIGN store — it is never the `gone` refusal', () => {
    const homeA = { dayOffset: 0, store: STORE_A }
    // Standing on store B, same day. The booking is not on the board in front of
    // the operator and never can be, so asking "is it here?" can only answer no
    // — which without the store check meant `gone`, i.e. every cross-store ×
    // refused. The origin store answers first, and the restore happens.
    expect(unparkOutcome(homeA, boardB, false)).toBe('elsewhere')
    expect(unparkOutcome(homeA, boardB, true)).toBe('elsewhere')
    // Another store AND another day is still just "elsewhere".
    expect(unparkOutcome(homeA, { dayOffset: 3, store: STORE_B }, false)).toBe('elsewhere')
    // `gone` survives for the one case it was written for: the SAME board.
    expect(unparkOutcome(homeA, boardA, false)).toBe('gone')
  })

  it('the 仮押さえ bar stops answering off-board, and its way back carries the right store', () => {
    // One predicate for the day case and the store case, so they cannot drift.
    expect(SRC).toContain('const pendingOffBoard = pending != null && !onShownBoard(pending, board)')
    expect(SRC).not.toContain('pendingOffDay')
    // The pin's link takes the pending's OWN store; this store's `?store=` would
    // land the operator on the right day of the wrong board.
    expect(SRC).toContain('dayHref(pending.dayOffset, pending.store)')
    expect(SRC).toContain('function dayHref(offset: number, store: string | null = props.storeParam)')
  })
})

/** WO-2e COMPLETENESS PASS — ⚖ Liam 2026-08-20, verbatim: "If you read the code
 *  properly and understood the functions and the code and everything, things
 *  shouldn't be missing." So the shelf / park / 配置モード family was enumerated
 *  against canon's own handlers (`parkBooking` :5556, `bindChipDrag` :5589,
 *  `placeFromShelf` :5653, `armPlacing` :6826, `createAtCell` :6005,
 *  `syncPendingUI` :3673) rather than only the itemised flags, and every row
 *  that came back missing is closed here. The table lives in the evidence doc.
 *
 *  The first row is the one Liam felt: he reported the 仮置きエリア as a
 *  COMPLETELY DEAD drop zone on preview 4173d5d1. The handlers were fine — a
 *  real pointer drag parks a card on that exact tip — but canon puts the shelf
 *  ABOVE the board (:1863) and ours had it below, so on a real laptop it sits
 *  under the fold and the only way to reach it is to drag off the screen. */
describe('the shelf family, enumerated against canon rather than against the flags', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
  const CSS = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/today.css'), 'utf8')

  it('the 仮置きエリア is ABOVE the board, where a card can be dragged to without leaving the screen', () => {
    expect(SRC.indexOf('className={`park-shelf')).toBeLessThan(SRC.indexOf('className="timeline-scroll"'))
    // …and it is still the first thing inside the board column, as in canon.
    expect(SRC.indexOf('<div className="board-main">')).toBeLessThan(SRC.indexOf('className={`park-shelf'))
  })

  it('a press on the chip’s × is a press on the ×, not the start of a drag', () => {
    expect(SRC).toContain("(e.target as Element).closest('.park-x')")
  })

  it('a chip can be dropped on a bed lane, and that names the room', () => {
    expect(SRC).toContain("laneKeyAtY(boardRef.current, 'staff', e.clientY) ?? laneKeyAtY(boardRef.current, 'beds', e.clientY)")
    expect(SRC).toContain("const staff = dropped?.group === 'beds' ? boardLanes.find((l) => l.key === chip.home.laneKey) : dropped")
  })

  it('the released chip cannot become a second booking', () => {
    // canon's last line of defence (:5640, :6811) — pointer capture is an
    // assist, and a drop that turns into a create is not undoable by hand.
    expect(SRC).toContain('suppressClickUntil.current = e.timeStamp + 400')
    expect(SRC).toContain('e.timeStamp < suppressClickUntil.current')
  })

  it('a 仮押さえ staged on another day says so, and cannot be confirmed from here', () => {
    // canon carries every day in one DOM, so its bar is always answering about a
    // card it can see. Ours renders one day, so the bar has to know its own.
    // RENEGOTIATED (⚖ 46 forerunner, Greptile #737 P1): "another day" became
    // "another BOARD" — a foreign store was the same situation and silently
    // worse, because the day matched and the bar went on answering.
    expect(SRC).toContain('const pendingOffBoard = pending != null && !onShownBoard(pending, board)')
    expect(SRC).toContain("? { enabled: false, label: 'この内容で確定' }")
    expect(SRC).toContain('if (pendingOffBoard || !at ||')
    expect(SRC).toContain('確定待ち: {sameStore(pending.store, props.storeParam) ? pending.dayLabel :')
    expect(SRC).toContain('{pending.dayLabel}へ戻る')
    expect(CSS).toContain('.biz .hold-daypin {')
  })

  it('the chip’s free-bed test is the same one 次回予約 uses — one rule, one home', () => {
    const beds = [
      lane({ key: 'bed-01', group: 'beds', items: [booking({ key: 'b1', caseId: 'x' }, 900, 960)] }),
      lane({ key: 'bed-02', group: 'beds' }),
    ]
    expect(freePartnerLane([lane({ key: 'p-01', group: 'staff' }), ...beds], 'staff', 900, 960)?.key).toBe('bed-02')
    // A parked card holds no ground, so its own bed reads free and comes back.
    expect(freePartnerLane([lane({ key: 'p-01', group: 'staff' }), lane({ key: 'bed-01', group: 'beds' })], 'staff', 900, 960)?.key).toBe('bed-01')
  })
})

/** ═══ WO-2f — Liam's BATCH-2 flags 24 · 25 · 26 · 27 ═══════════════════════ */

/** ⚖ FLAG 24 — the staff-name column resizes. Canon's divider drags `--label`
 *  between 90 and 240px (:5961–5986); the reveal is the grid track widening and
 *  the label's own `text-overflow: ellipsis` letting go, so there is no second
 *  rendering path and no stored width to get out of step. */
describe('the staff-name column takes a width from the divider', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
  const CSS = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/today.css'), 'utf8')

  it('the clamp is canon’s 90–240, both ends, in both directions', () => {
    expect(clampLabelWidth(112, 0)).toBe(112)
    expect(clampLabelWidth(112, 60)).toBe(172)
    expect(clampLabelWidth(112, -60)).toBe(52 < LABEL_MIN ? LABEL_MIN : 52)
    // A drag past either end STOPS there — it does not wrap, invert or unclamp.
    expect(clampLabelWidth(112, -9000)).toBe(LABEL_MIN)
    expect(clampLabelWidth(112, 9000)).toBe(LABEL_MAX)
    expect(clampLabelWidth(LABEL_MAX, 1)).toBe(LABEL_MAX)
    expect(clampLabelWidth(LABEL_MIN, -1)).toBe(LABEL_MIN)
  })

  it('the start width is read live, and a board that has not painted falls back', () => {
    const board = document.createElement('div')
    document.body.appendChild(board)
    // jsdom resolves an unset custom property to '' — the case that would snap
    // the column to zero on the first pixel if it were parsed as a number.
    expect(labelWidthOf(board, 112)).toBe(112)
    board.style.setProperty('--label', '186px')
    expect(labelWidthOf(board, 112)).toBe(186)
    expect(labelWidthOf(null, 112)).toBe(112)
    board.remove()
  })

  it('the handle is wired to the board root, and paints only when it is being used', () => {
    expect(SRC).toContain('className="label-resize"')
    expect(SRC).toContain('onPointerDown={onLabelResizeDown}')
    // The width is one CSS custom property on the board root — no state, no
    // re-render, and the same var the lanes and the guard rails already read.
    expect(SRC).toContain("board.style.setProperty('--label', `${clampLabelWidth(startW, ev.clientX - startX)}px`)")
    // It never starts on top of a live card or block drag (canon's own guard).
    expect(SRC).toContain('if (e.button !== 0 || dragRef.current || blockDragRef.current) return')
    expect(CSS).toContain('.biz .label-resize { position: absolute;')
    expect(CSS).toContain('cursor: col-resize')
    expect(CSS).toContain('.biz .label-resize:hover::after, .biz .label-resize.dragging::after { background: var(--select-line); }')
    // Both group headers share the column, because both are the same grid.
    expect(CSS).toContain('.biz .time-head, .biz .lane { display: grid; grid-template-columns: var(--label) minmax(0, 1fr); }')
    expect(CSS).toContain('.biz .guard-placement-rail { display: grid; grid-template-columns: var(--label)')
  })
})

/** ⚖ FLAG 25 — 画面の説明. The property Liam cares about is the REGISTRY: a
 *  section declares itself and the tour finds it, so a section can never ship
 *  unexplained and a hidden one drops out of the count by itself. */
describe('the guided tour builds itself out of what is on screen', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
  const CSS = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/today.css'), 'utf8')
  const SIDEBAR = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/BusinessSidebar.tsx'), 'utf8')

  function declared(html: string) {
    const host = document.createElement('div')
    host.innerHTML = html
    document.body.appendChild(host)
    return host
  }

  it('the registry is the DOM: declare a pair and the section joins, in visual order', () => {
    const host = declared(`
      <section data-guide-title="A" data-guide="a"></section>
      <section data-guide-title="B" data-guide="b"><span data-guide-title="B-in" data-guide="bi"></span></section>
      <section>no pair</section>`)
    const boxes = host.querySelectorAll<HTMLElement>('[data-guide]')
    boxes.forEach((el) => rect(el, { left: 0, top: 0, width: 100, height: 40 }))
    const found = spotTargets(host)
    expect(found.map((e) => e.dataset.guideTitle)).toEqual(['A', 'B', 'B-in'])
    host.remove()
  })

  it('…and a section that is not on screen leaves the tour, and the count with it', () => {
    const host = declared(`
      <section data-guide-title="A" data-guide="a"></section>
      <section data-guide-title="Hidden" data-guide="h"></section>`)
    const [a, hidden] = Array.from(host.querySelectorAll<HTMLElement>('[data-guide]'))
    rect(a, { left: 0, top: 0, width: 100, height: 40 })
    rect(hidden, { left: 0, top: 0, width: 0, height: 0 })
    expect(spotTargets(host)).toHaveLength(1)
    expect(spotTargets(host)[0].dataset.guideTitle).toBe('A')
    host.remove()
  })

  it('click-to-jump resolves the SMALLEST region, so a board never eats its headings', () => {
    const board = { left: 0, top: 0, width: 900, height: 500 }
    const heading = { left: 10, top: 20, width: 200, height: 25 }
    expect(spotHitIndex(50, 30, [board, heading])).toBe(1)
    expect(spotHitIndex(50, 30, [heading, board])).toBe(0)
    // Outside every region: canon closes the tour rather than jumping anywhere.
    expect(spotHitIndex(950, 30, [board, heading])).toBe(-1)
  })

  it('the card takes the widest free side and never covers the region it explains', () => {
    const view = { width: 1440, height: 900 }
    const card = { width: 300, height: 160 }
    // Room below → below.
    expect(spotCardAt({ left: 40, top: 100, width: 400, height: 60 }, card, view).top).toBe(172)
    // No room below, room above → above.
    expect(spotCardAt({ left: 40, top: 700, width: 400, height: 60 }, card, view).top).toBe(700 - 160 - 12)
    // Squeezed level with a full-height region → beside it, never over it.
    const beside = spotCardAt({ left: 40, top: 10, width: 400, height: 880 }, card, view)
    expect(beside.left).toBe(40 + 400 + 12)
    expect(beside.top).toBeGreaterThanOrEqual(10)
  })

  it('the walk is a ring, and an empty registry is not a tour', () => {
    expect(wrapStep(3, 4)).toBe(3)
    expect(wrapStep(4, 4)).toBe(0)
    expect(wrapStep(-1, 4)).toBe(3)
    expect(wrapStep(1, 0)).toBe(-1)
  })

  it('the ? popover carries canon’s hints, ours, and the button that starts the tour', () => {
    expect(SRC).toContain('<strong>操作ヒント</strong>')
    expect(SRC).toContain('・時間外は非表示')
    expect(SRC).toContain('カードはドラッグで移動・両端で時間変更')
    expect(SRC).toContain('キーボード: Shift＋←/→で開始、Alt＋←/→で終了を30分ずつ変更')
    expect(SRC).toContain('仮置きエリア（ボード上の点線バー）')
    // ⚖ flag 26's gesture and ⚖ flag 25's emphasis — the two behaviours with no
    // region of their own — register in THIS layer rather than as tour steps
    // pointing at nothing.
    expect(SRC).toContain('休憩・清掃などの予定ブロック: ドラッグで移動・両端で時間変更')
    expect(SRC).toContain('ドラッグ中は、いま持っているカードと同じ長さの販売可能枠だけが濃く表示されます')
    expect(SRC).toContain('画面の説明を表示')
    expect(SRC).toContain("onClick={() => { setPop(''); setTourIdx(0) }}")
  })

  it('canon’s own sections carry canon’s own words, to the character', () => {
    for (const [title, body] of [
      ['本日の店舗状態', '金額と未処理の集計。レジ当番・金額権限のある人にだけ表示されます。'],
      ['自分の1日', 'ログイン中のスタッフ専用。次のお客様と自分の未処理だけを表示します。'],
      ['オンライン販売中', 'いまReserveで販売中の枠数。押すと枠の一覧（時間・担当・価格）が開き、行を押すとボード上の場所を示します。'],
      ['ご来店中', 'いま店内にいるお客様。ここから次回予約をその場で作成できます。'],
      ['日付の移動', '日付を押すと月カレンダーで空き状況を確認できます。'],
      ['表示設定', 'カード・販売可能枠・配置ガイドの見え方と、ボードの密度を調整します。'],
      ['表示の切替', 'スタッフだけ・設備だけ・両方の表示を切り替えます。'],
      ['仮置きエリア', '日付をまたぐ変更の一時置き場。ドラッグで置くと仮押さえになります。'],
      ['今日のボード', '空き枠をクリックで新規予約。カードはドラッグで移動、端をつかんで時間変更。'],
      ['本日の運営影響', 'いま起きている問題と、対応がどこまで進んだかを示します。'],
      ['次に決めること', '根拠と期限のある判断だけが並びます。上の件数セルを押すと該当カードがボード上で光ります。'],
      ['店舗全体の指標', '本日の予約件数・売上・稼働率。予約件数は本日の全予約、売上は売上・レジの取引データ、稼働率はスタッフ・シフトの勤務時間から算出しています。'],
    ]) {
      expect(SRC).toContain(`data-guide-title="${title}"`)
      expect(SRC).toContain(`data-guide="${body}"`)
    }
  })

  it('OUR sections register too — the lane rule, machine-checked', () => {
    // The store lens is the shell's, and the registry is document-wide, so it
    // joins the same walk from another file with no wiring between them.
    expect(SIDEBAR).toContain('data-guide-title="店舗の切替"')
    expect(SIDEBAR).toContain('data-guide="いま見ている店舗。押すと店舗を切り替えられ、ボードも数字もその店舗のものに変わります。"')
    // The guard band explains the legend AND the 60分配置 strips under each lane.
    expect(SRC).toContain('data-guide-title="スキマガード"')
    expect(SRC).toContain('60分配置')
    // The tour reads the live document — nothing here is a hand-kept list.
    expect(SRC).toContain('spotTargets(document)')
    expect(SRC).not.toMatch(/const TOUR_STEPS\b/)
  })

  it('the overlay is canon’s four layers, and every exit is wired', () => {
    expect(SRC).toContain('className="spot-catch"')
    expect(SRC).toContain('className="spot-hover"')
    expect(SRC).toContain('className="spot-hole"')
    expect(SRC).toContain('className="spot-card"')
    expect(SRC).toContain('気になる場所をクリックすると、その説明にジャンプします')
    expect(SRC).toContain('>前へ<')
    expect(SRC).toContain("'最初へ' : '次へ'")
    expect(SRC).toContain('終了 ✕')
    expect(SRC).toContain('{tourStep ? `${tourStep.idx + 1} / ${tourStep.total}` : \'\'}')
    // Escape and the arrows, canon (:3441–3446).
    expect(SRC).toContain("if (e.key === 'Escape') setTourIdx(-1)")
    expect(SRC).toContain("if (e.key === 'ArrowRight')")
    expect(SRC).toContain("if (e.key === 'ArrowLeft')")
    expect(CSS).toContain('.biz .spot-hole {')
    expect(CSS).toContain('box-shadow: 0 0 0 2px #fff, 0 0 0 9999px rgba(24, 24, 27, .42);')
    expect(CSS).toContain('.biz .spot-catch { position: fixed; inset: 0;')
  })
})

/** ⚖ FLAG 26 — blocks drag and stretch on their own 5-minute lattice. */
describe('予定ブロック move, resize and open — canon’s second pipeline', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
  const CSS = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/today.css'), 'utf8')
  const BLOCK_STEP = blockStepPct(9, 5)

  function block(key: string, start: number, end: number, over: Partial<BoardItem> = {}): BoardItem {
    return {
      key, kind: 'break', state: null, category: null, ...place(start, end, HOURS),
      title: '休憩', tag: '', time: '', ticketCat: null, ticketCore: null,
      held: false, micro: false, caseId: null, label: '', ...over,
    }
  }

  it('the block lattice is 5 minutes where the booking lattice is 30', () => {
    expect(blockStepPct(9, 5)).toBeCloseTo(stepPct(9) / 6, 10)
    // The store's dial is the source; a config that does not carry one is 5.
    expect(blockStepPct(9, 15)).toBeCloseTo(stepPct(9) / 2, 10)
    expect(blockStepPct(9, undefined)).toBeCloseTo(blockStepPct(9, 5), 10)
  })

  it('a 休憩 dragged out to 35 minutes is legal — a booking’s lattice could not say it', () => {
    const item = block('br-1', 780, 810) // 13:00–13:30
    const track = document.createElement('div')
    rect(track, { left: 0, top: 0, width: 540, height: 40 })
    const origin = dragOrigin(item.x, item.w, 'resize', BLOCK_STEP)
    // +5 minutes of track: one block step, a sixth of a booking step.
    const dxFor = (min: number) => (min / (HOURS.close - HOURS.open)) * 540
    expect(minuteOf(nextSpan(origin, track, dxFor(5), BLOCK_STEP).w + item.x, HOURS) - 600).toBeCloseTo(
      minuteOf(item.x, HOURS) - 600 + 35, 6,
    )
    // …and the same gesture on the booking lattice cannot reach 35 at all.
    const bookingOrigin = dragOrigin(item.x, item.w, 'resize', STEP)
    const bookingSpan = nextSpan(bookingOrigin, track, dxFor(5), STEP)
    expect(minuteOf(bookingSpan.x + bookingSpan.w, HOURS)).toBe(810)
  })

  it('every lane is a landing for a block — including across staff and equipment', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div class="lane" data-lane="p-01" data-group="staff"></div><div class="lane" data-lane="bed-01" data-group="beds"></div>'
    document.body.appendChild(root)
    const [staff, bed] = Array.from(root.querySelectorAll('.lane'))
    rect(staff, { left: 0, top: 0, width: 600, height: 47 })
    rect(bed, { left: 0, top: 47, width: 600, height: 47 })
    // A BOOKING is leashed to its own group — a person's booking has a bed
    // partner, and a bed lane is not somewhere it can go.
    expect(laneKeyAtY(root, 'staff', 60)).toBeNull()
    // A BLOCK is not: canon lets 清掃 travel to a person, because staff clean.
    expect(laneKeyAtY(root, null, 60)).toBe('bed-01')
    expect(laneKeyAtY(root, null, 20)).toBe('p-01')
    root.remove()
  })

  it('the grab zone scales with the box, so a micro can still be stretched', () => {
    const wide = document.createElement('button')
    rect(wide, { left: 100, top: 0, width: 120, height: 30 })
    expect(blockEdgeZones(120)).toEqual({ inner: 10, overhang: 0 })
    expect(blockDragModeAt(wide, 105)).toBe('resizeL')
    expect(blockDragModeAt(wide, 160)).toBe('move')
    expect(blockDragModeAt(wide, 215)).toBe('resize')
    // An 18px micro: a flat 10px each side would leave NO move zone at all.
    const micro = document.createElement('button')
    rect(micro, { left: 100, top: 0, width: 18, height: 30 })
    expect(blockEdgeZones(18).inner).toBe(4.5)
    expect(blockEdgeZones(18).overhang).toBe(7.5)
    expect(blockDragModeAt(micro, 109)).toBe('move')
    expect(blockDragModeAt(micro, 101)).toBe('resizeL')
    expect(blockDragModeAt(micro, 117)).toBe('resize')
    // …and the overhang reaches OUTSIDE the box, which is the whole point.
    expect(blockDragModeAt(micro, 95)).toBe('resizeL')
    expect(blockDragModeAt(micro, 124)).toBe('resize')
  })

  it('a landing that overlaps anything real is refused; free minutes are not', () => {
    const target = lane({
      key: 'p-01', group: 'staff',
      items: [block('br-1', 780, 810), booking({ key: 'a', caseId: 'apt-1' }, 900, 960)],
    })
    // Onto the booking → clash.
    expect(blockClash(target, 'br-1', place(915, 945, HOURS))).toBe(true)
    // Into free minutes → fine.
    expect(blockClash(target, 'br-1', place(840, 870, HOURS))).toBe(false)
    // Onto ITSELF → not a clash; a block that cannot be nudged is not resizable.
    expect(blockClash(target, 'br-1', place(785, 815, HOURS))).toBe(false)
    expect(blockClash(undefined, 'br-1', place(840, 870, HOURS))).toBe(false)
  })

  it('a moved block leaves its old lane, arrives on the new one, and carries its clock', () => {
    const lanes = [
      lane({ key: 'p-01', group: 'staff', items: [block('br-1', 780, 810)] }),
      lane({ key: 'bed-01', group: 'beds', items: [] }),
    ]
    const moved = applyBlockMoves(lanes, { 'br-1': { laneKey: 'bed-01', ...place(840, 875, HOURS) } }, HOURS)
    expect(moved.find((l) => l.key === 'p-01')!.items).toHaveLength(0)
    const landed = moved.find((l) => l.key === 'bed-01')!.items
    expect(landed).toHaveLength(1)
    expect(landed[0].startMin).toBe(840)
    expect(landed[0].endMin).toBe(875)
    // The visible label follows — a 35-minute 休憩 says 14:00〜14:35, not the
    // span the server rendered.
    expect(landed[0].time).toBe('14:00〜14:35')
    // No moves = the same array, untouched.
    expect(applyBlockMoves(lanes, {}, HOURS)).toBe(lanes)
  })

  it('a block resized in place stays put and keeps its lane', () => {
    const lanes = [lane({ key: 'p-01', group: 'staff', items: [block('br-1', 780, 810)] })]
    const out = applyBlockMoves(lanes, { 'br-1': { laneKey: 'p-01', ...place(780, 815, HOURS) } }, HOURS)
    expect(out[0].items).toHaveLength(1)
    expect(out[0].items[0].endMin).toBe(815)
  })

  it('a booking never travels on the block map, and a block never on the booking map', () => {
    const lanes = [lane({ key: 'p-01', group: 'staff', items: [booking({ key: 'a', caseId: 'apt-1' }, 900, 960)] })]
    // A block move addressed to a booking's key does nothing: bookings are not
    // in the home map, so there is nothing to evict and nothing to arrive.
    expect(applyBlockMoves(lanes, { 'zzz': { laneKey: 'p-01', x: 0, w: 5 } }, HOURS)[0].items).toHaveLength(1)
    // And applyMoves keys on caseId, which a block does not have.
    const withBlock = [lane({ key: 'p-01', group: 'staff', items: [block('br-1', 780, 810)] })]
    expect(applyMoves(withBlock, { 'br-1': { laneKey: 'p-99', x: 0, w: 5 } }, [], [], HOURS)[0].items).toHaveLength(1)
  })

  it('the screen binds drag AND click to the same box, and keeps the two lattices apart', () => {
    expect(SRC).toContain('onPointerDown={(e) => onBlockPointerDown(e, item, lane)}')
    expect(SRC).toContain('onPointerMove={onBlockPointerMove}')
    // Canon's own bug: a box that moves but cannot be opened. The click survives.
    expect(SRC).toContain('blockRef.current?.showModal()')
    expect(SRC).toContain('if (e.timeStamp < suppressClickUntil.current) return')
    // Two constants, never one: the block lattice is the store's blockStepMin.
    expect(SRC).toContain('const BLOCK_STEP = blockStepPct(hours.count, props.guard.config.blockStepMin)')
    expect(SRC).toContain('nextSpan(ctx.origin, ctx.track, dx, BLOCK_STEP)')
    // A locked lane refuses a block, exactly as it refuses a booking.
    expect(SRC).toContain('if (laneKey && !locked.includes(laneKey)) ctx.targetLane = laneKey')
    // The refusal toast is canon's sentence.
    expect(SRC).toContain('他の予定と重なるため元の位置に戻しました')
    // The block travels under the cursor like everything else on this board…
    expect(SRC).toContain("setProxy({ kind: 'block', item: ctx.item, state: cls, w: ctx.grab.w, h: ctx.grab.h })")
    // …and the pointer stream lives on the window, so no re-render can break it.
    const begin = SRC.slice(SRC.indexOf('function beginBlockDrag'), SRC.indexOf('function applyBlockFrame'))
    for (const ev of ['pointermove', 'pointerup', 'pointercancel', 'blur']) {
      expect(begin).toContain(`window.addEventListener('${ev}'`)
      expect(begin).toContain(`window.removeEventListener('${ev}'`)
    }
    expect(begin).toContain('if (e.buttons === 0) { cancelBlockDrag(); return }')
    expect(CSS).toContain('.biz .event.block, .biz .event.cleanup { overflow: visible; touch-action: none; }')
    expect(CSS).toContain('width: var(--grip, 0px);')
  })

  it('a block drag lifts the window layer but never emphasises it — it is not a session', () => {
    // canon's bindBlockDrag puts `.dragging` on the block, so canon's own reveal
    // gate fires for a block drag. Ours fires on the same event…
    // (⚖ flag 29 added `live` to the same gate: an edge drag reveals too.)
    expect(SRC).toContain("dragLen != null || live || blockLive ? 'dragging-live' : ''")
    // …and `dragLen` — the ONLY input to the length emphasis — is never set by
    // the block pipeline, so no window can claim to fit a 休憩.
    const blockPipe = SRC.slice(SRC.indexOf('function beginBlockDrag'), SRC.indexOf('function clearBlockDrag'))
    expect(blockPipe).not.toContain('setDragLen(')
    expect(SRC).toContain("`cell-price${fitsDrag(60, dragLen) ? ' fits' : ''}`")
  })
})

/** ⚖ FLAG 27 — the density auto-degrade is dead for display. A DELIBERATE
 *  overturn of canon's E9c, not a port gap: the engine keeps computing the
 *  verdict, the board stops obeying it. */
describe('販売可能枠の表示 means what it says, at any band count', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
  const CSS = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/today.css'), 'utf8')

  it('the engine still computes it — this is an overturn at the consumer, not a deletion', () => {
    // A 13-band day is exactly the case canon degraded. The layer still SAYS so.
    const cells: SellCell[] = Array.from({ length: DENSITY_CEILING + 1 }, (_, i) => ({
      laneKey: `p-${i}`, resourceKey: `bed-${i}`, group: 'staff' as const,
      staff: `s${i}`, bed: `bed-${i}`, h: 600 + i * 60, price: 6600 + i * 10, tier: 2 as const,
    }))
    const layer = buildSellLayer(cells, true)
    expect(layer.staffBands.length).toBeGreaterThan(DENSITY_CEILING)
    expect(layer.degraded).toBe(true)
  })

  it('…and no display decision reads it any more', () => {
    // The class is gone from the board root — that one ternary was the valve.
    // (Asserted on code shapes, not bare words: the comment above the deletion
    // NAMES the overturn on purpose, and a naked substring ban would forbid
    // recording why it happened.)
    expect(SRC).not.toMatch(/'density-degraded'/)
    expect(SRC).not.toMatch(/sell\.degraded\s*(\?|&&)/)
    // The caption that explained the override went with it.
    expect(SRC).not.toContain('本日は販売枠が細かく分かれているため、価格はドラッグ中のみ表示しています')
    // The rules the class drove are gone too — a dead selector is a trap for
    // whoever tries to bring the valve back by accident.
    expect(CSS).not.toContain('.timeline.sell-tint.density-degraded')
    // What survives is the guard's OWN 'degraded' verdict (橙 △) — a different
    // word, a different feature, and untouched by this ruling.
    expect(CSS).toContain('.biz .guard-rail-cell.degraded {')
    // The three modes stay literal: tint always, drag on the gesture, off hidden.
    expect(CSS).toContain('.biz .timeline.sell-drag .cell-price { opacity: 0; }')
    expect(CSS).toContain('.biz .timeline.sell-off .cell-price { display: none; }')
    expect(SRC).toContain("[['tint', '淡色表示'], ['drag', 'ドラッグ時のみ'], ['off', '非表示']]")
  })
})
