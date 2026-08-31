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
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { opsConfig, resources } from '@/business/lib/fixtures-today'
import { computeChecks, confirmCaption } from '@/business/lib/canon-logic/drag-rules'
import {
  applyBlockMoves,
  applyMoves,
  blockChrome,
  blockClash,
  blockDragModeAt,
  blockNode,
  blockEdgeZones,
  blockStepPct,
  cardNodes,
  chipProxySize,
  clampLabelWidth,
  labelWidthOf,
  liveTimeLabel,
  stretchOrCarry,
  LABEL_MAX,
  LABEL_MIN,
  clickClosesPopover,
  dragModeAt,
  deltaPctIn,
  fieldsPopAnchor,
  fitsDrag,
  fractionIn,
  allocateBed,
  bedFeasibility,
  gapLayerFor,
  guardRailsFor,
  guardVerdictAt,
  isCrumbOffer,
  isOverShelf,
  laneKeyAtY,
  landingVerdict,
  laneSpans,
  offerableCell,
  overrideCaption,
  VERDICT_WORD,
  nextSpan,
  pairLanesOf,
  parkChipText,
  proxyTransform,
  reasonLine,
  roomFitsClass,
  sellLayerFor,
  seedSpanIn,
  sidesAt,
  slotStartAt,
  onShownBoard,
  sameStore,
  sharesStore,
  unparkOutcome,
  foreignStoreRefusal,
  anchorOnScreen,
  guardCheckRow,
  guardCheckRowBesideOffer,
  holdPopAnchor,
  holdSummary,
  bedClassCell,
  nearestFreeStarts,
  needsPrivateRoom,
  overrideLevelFor,
  pinInViewport,
  type GuardRail,
  type LandingVerdict,
  type Moves,
  type RailCell,
} from '@/app/[locale]/(business)/business/today/today-interactions'
// ⚖ Liam 8/23 — the tour engine these tests drive now lives in the family's one
// shared home (`@/business/lib/guide`); the board imports it from there too.
// Same functions, carried verbatim, so every assertion below is unchanged.
import { spotCardAt, spotHitIndex, spotTargets, wrapStep } from '@/business/lib/guide'
import { dragOrigin, stepPct } from '@/business/lib/canon-logic/drag-rules'
import { buildSellLayer, type SellCell } from '@/business/lib/canon-logic/availability'
import { DENSITY_CEILING, packedPrice } from '@/business/lib/canon-logic/pricing'
import { minuteOf, place, type BoardItem, type BoardLane } from '@/business/lib/today-board'
// ⚖ R3 one world — the guard's door lives on the screen (it needs both the book
// and the board's own types, and the book imports today-interactions). Exported
// for the reason everything on this board's answer path is: an answer the
// operator acts on has to be provable without a renderer.
import { bedDoor, bedViewsFor } from '@/app/[locale]/(business)/business/today/TodayScreen'

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
/** ⚠SETTINGS-BATCH — the store's shipped room policy (opsConfig.roomPolicy).
 *  The tests that care about the dials set their own. */
const POLICY = { vipStaysPrivate: true, privateIsLastResort: true }

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
    // ⚖ flag 51 — a person has no room class; a room defaults to the
    // interchangeable 施術室 unless the case under test says otherwise.
    roomClass: over.group === 'staff' ? null : 'standard',
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

  it('⚖ 62 — the whole half hour floors to its own start, canon-style', () => {
    const track = document.createElement('div')
    // 900px over 9 hours: one hour is 100px, one 30-minute step is 50px.
    rect(track, { left: 0, top: 0, width: 900, height: 40 })
    // 11:00 is 100px; the RIGHT half of that half hour used to round FORWARD to
    // 11:30 and seed a session that ran into the neighbour (Liam's 「the left
    // half works, the right half fires 時間帯が重複」). Canon floors.
    expect(slotStartAt(track, 100, HOURS)).toBe(660) // 11:00
    expect(slotStartAt(track, 125, HOURS)).toBe(660) // 11:15 — still 11:00
    expect(slotStartAt(track, 149, HOURS)).toBe(660) // 11:29 — still 11:00
    expect(slotStartAt(track, 150, HOURS)).toBe(690) // 11:30 — the next step
    expect(slotStartAt(track, 175, HOURS)).toBe(690) // 11:45 — still 11:30
  })

  it('⚖ 62 — the seed is clamped into the pocket under the click, shortened not overflowed', () => {
    // A staff lane free 10:00–19:00 except a booking at 12:00–13:00, so the
    // pocket under an 11:xx click is 10:00–12:00.
    const staff = lane({ key: 'p-01', group: 'staff', items: [booking({ key: 'a', caseId: 'apt-1' }, 720, 780)] })
    // 11:30 + 60 would run to 12:30, into the booking → slides back to 11:00.
    expect(seedSpanIn(staff, 690, 60, HOURS, null)).toEqual({ start: 660, end: 720 })
    // 11:00 + 60 fits exactly; nothing moves.
    expect(seedSpanIn(staff, 660, 60, HOURS, null)).toEqual({ start: 660, end: 720 })
    // A pocket SHORTER than the session shortens rather than overflows: the
    // 13:00–13:45 pocket below cannot hold 60.
    const tight = lane({
      key: 'p-02',
      group: 'staff',
      items: [booking({ key: 'b', caseId: 'apt-2' }, 600, 780), booking({ key: 'c', caseId: 'apt-3' }, 825, 900)],
    })
    expect(seedSpanIn(tight, 780, 60, HOURS, null)).toEqual({ start: 780, end: 825 })
    // A click that lands on top of an existing booking is left alone — the
    // guard owns that refusal and must keep hearing the honest ask.
    expect(seedSpanIn(staff, 720, 60, HOURS, null)).toEqual({ start: 720, end: 780 })
    // A lane with no shift window has no pockets; today's behaviour, unchanged.
    expect(seedSpanIn(lane({ key: 'bed-01', group: 'beds' }), 660, 60, HOURS, null)).toEqual({ start: 660, end: 720 })
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

  /** ⚖ BATCH-6 flag 45 (2026-08-21) — THE COUNTERPART OF THE TEST ABOVE, in the
   *  other direction. A booking is drawn twice and canon binds the drag to BOTH
   *  drawings (`document.querySelectorAll(".event[data-book]").forEach(bindDrag)`,
   *  :3887), so a bed-row drag is a first-class gesture and says WHICH ROOM. It
   *  used to be unrepresentable: one `laneKey` meant a bed key in the staff
   *  record, which evicted the person's card from every staff lane with no path
   *  back — and the revert wrote the same key again. */
  const bed2 = lane({ key: 'bed-02', group: 'beds' })
  const pairLanes = [staffA, staffB, bed, bed2]

  it('a BED-side move retargets the room and leaves the person alone, re-spanned', () => {
    // The staff record still names the staff lane; the bed record names the room.
    const moves: Moves = { 'apt-1': { laneKey: 'p-01', x: 0, w: 100 / 9 } }
    const bedMoves: Moves = { 'apt-1': { laneKey: 'bed-02', x: 0, w: 100 / 9 } }
    const out = applyMoves(pairLanes, moves, [], [], HOURS, bedMoves)
    // 担当 UNCHANGED — the card is exactly where it was, at the new time.
    expect(out[0].items.map((i) => i.caseId)).toEqual(['apt-1'])
    expect(out[0].items[0].startMin).toBe(600)
    expect(out[0].items[0].endMin).toBe(660)
    expect(out[1].items).toHaveLength(0)
    // …and the ROOM moved, carrying the same span, so the pair share one clock.
    expect(out[2].items).toHaveLength(0)
    expect(out[3].items.map((i) => i.caseId)).toEqual(['apt-1'])
    expect(out[3].items[0].key).toBe('a-bed')
    expect(out[3].items[0].time).toBe('10:00〜11:00')
  })

  it('with no bed record at all, the bed row behaves exactly as it always did', () => {
    // The default argument IS the old behaviour: the room keeps the lane the
    // server drew it on and takes only the span.
    const moves: Moves = { 'apt-1': { laneKey: 'p-04', x: 0, w: 100 / 9 } }
    expect(applyMoves(pairLanes, moves, [], [], HOURS).map((l) => l.items.map((i) => i.caseId)))
      .toEqual(applyMoves(pairLanes, moves, [], [], HOURS, {}).map((l) => l.items.map((i) => i.caseId)))
    expect(applyMoves(pairLanes, moves, [], [], HOURS)[2].items.map((i) => i.caseId)).toEqual(['apt-1'])
  })

  it('a bed record cannot drag the person: the two memberships are independent', () => {
    // Both sides moved at once — the staff-side drag's own case, where the room
    // record is only carrying the span. Neither key leaks into the other lane.
    const out = applyMoves(
      pairLanes,
      { 'apt-1': { laneKey: 'p-04', x: 0, w: 100 / 9 } },
      [],
      [],
      HOURS,
      { 'apt-1': { laneKey: 'bed-02', x: 0, w: 100 / 9 } },
    )
    expect(out.map((l) => l.items.map((i) => i.caseId))).toEqual([[], ['apt-1'], [], ['apt-1']])
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
    // RENEGOTIATED (batch-9, ⚖ 50): the proxy carries the parked booking's `id`
    // as well, because the render pass has to know WHAT is in hand to judge a
    // landing for it (the × marks). Shape only — the size claims are untouched.
    expect(SRC).toContain("setProxy({ kind: 'chip', id: chip.id, title: chip.title, line1: chip.line1, category: chip.category, w: size.w, h: size.h })")
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

  it('⚖ 62 — a pocket that cannot hold the session AT THIS START still offers its own starts', () => {
    // 10:00–14:00 free. A 60 starting at 13:30 runs past the shift end, so no
    // pocket "fits" it — but the pocket the operator clicked into plainly has
    // room earlier. It used to answer with alternatives: [], which is what made
    // 「この区間に、より損の少ない開始はありません」 a lie.
    const l = lane({ key: 'p-01', group: 'staff', window: { from: 600, until: 840 }, untilLabel: '14:00' })
    const cell = at(guardRailsFor([l], railInput())[0], 810)
    expect(cell.state).toBe('blocked')
    expect(cell.sentence).toBe('この開始には60分の連続した空きがありません')
    expect(cell.alternativeKind).toBe('safe')
    expect(cell.alternatives.length).toBeGreaterThan(0)
    // Every offer is inside the pocket it came from and holds the whole session.
    for (const s of cell.alternatives) {
      expect(s).toBeGreaterThanOrEqual(600)
      expect(s + 60).toBeLessThanOrEqual(840)
    }
    // A start with no pocket under it at all keeps the honest empty answer —
    // there is nothing in this section to offer.
    const outside = at(guardRailsFor([l], railInput())[0], 900)
    expect(outside.alternatives).toEqual([])
    expect(outside.alternativeKind).toBeNull()
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
    // ⚖ BATCH-6 flag 45 (2026-08-21) — RENEGOTIATED: the committed board now
    // takes the BED side's committed memberships too, and the same rule binds
    // them — `bedMoves`, never `liveBedMoves`. The pin is what stops a future
    // round from quietly feeding the priced layers the pointer's position.
    const memo = /const committedLanes = useMemo\(\s*\(\) => applyMoves\(placedLanes, moves, parked, addedHere, hours, bedMoves\)/
    expect(memo.test(src)).toBe(true)
    // ⚖ flag 64 — the delete ledger joined that SAME pass, deliberately: the
    // board, the sell layer, blockClash and the guard's occupancy all read the
    // lanes it returns, so they cannot disagree about a deleted block.
    expect(src).toContain('applyBlockMoves(props.lanes, blockMoves, hours, blockDeleted)')
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

/* ────────────────────────────────────────────────────────────────────────────
 * ⚖ LIAM flag 76 (2026-08-23) — THE 60分配置 RAIL IS BED-AWARE.
 *
 * His scene: the strip painted ✓14:30 and the drop at 14:30 refused 満室 — all
 * three rooms busy (さくら / 清掃 / なぎ+清掃). Flag 54 had already fixed the
 * MID-DRAG face by composing the cell with `landingVerdict`; at rest there is
 * nothing in hand, the cell's own state paints, and the guard had never been
 * told the rooms exist. Canon does tell it: `ctxFor(day, lane).placementFeasible`
 * (fable-store-today.html :7278-7285) and the rail runs the same evaluator
 * (`railAimFor` = `evaluateExactAim`, :7365).
 *
 * Every pin below drives the REAL `bedFeasibility` + `guardRailsFor` on a real
 * board. The order canon states is pinned too: staff pocket first, rooms second.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('⚖ flag 76 — the 60分配置 rail hears about the rooms', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
  const GUARD = {
    services: [{ name: '整体60', dur: 60 }, { name: '骨盤90', dur: 90 }],
    newClientSessionMin: 90, protectedLabel: '新規', gapFillMinMin: 30, leadTimeMin: 0,
    mode: 'standard' as const,
  }
  /** The rail exactly as the screen asks it, with the rooms plugged in — or not,
   *  which is the pre-fix board and the way every other suite still calls it. */
  const railIn = (lanes: BoardLane[] | null, over: Partial<Parameters<typeof guardRailsFor>[1]> = {}) => ({
    open: HOURS.open, close: HOURS.close, stepMin: 30, dur: 60, protectedDur: 90,
    nowMinute: null, locked: [], guard: GUARD, ...over,
    placementFeasible: lanes ? bedFeasibility(lanes, over.excludeId ?? null, POLICY) : undefined,
  })
  /** ⚖ FIX-4 (blind round, 2026-08-25) — EVERY SCENE BELOW RUNS BOTH DOORS.
   *
   *  These are flag 76's own unit contracts and they predate the capacity book,
   *  so the legacy `bedFeasibility` leg stays the ORACLE — it is what the board
   *  did, and what P1–P5 were written against. The book leg is what R3 ships,
   *  and the helper refuses to answer unless the two agree.
   *
   *  Written into the helper rather than repeated in five scenes for the reason
   *  the round keeps finding: a scene added later cannot forget to do it. */
  const bookFrame = { openMin: HOURS.open, closeMin: HOURS.close, nowMin: HOURS.open }
  const cellAt = (lanes: BoardLane[], minute: number, over: Partial<Parameters<typeof guardRailsFor>[1]> = {}) => {
    const at = (input: Parameters<typeof guardRailsFor>[1]) =>
      guardRailsFor(lanes, input)[0].cells.find((c) => c.start === minute)!
    const legacy = at(railIn(lanes, over))
    const askerId = over.excludeId ?? null
    const book = at({
      ...railIn(lanes, over),
      placementFeasible: bedDoor(bedViewsFor(lanes, POLICY, bookFrame, askerId), lanes, askerId),
    })
    expect([minute, book]).toEqual([minute, legacy])
    return legacy
  }
  const cellAtBlind = (lanes: BoardLane[], minute: number, over: Partial<Parameters<typeof guardRailsFor>[1]> = {}) =>
    guardRailsFor(lanes, railIn(null, over))[0].cells.find((c) => c.start === minute)!
  /** 見本 あずさ, 10:00–12:30 free — a pocket a 60 fits without costing a 新規 90,
   *  so the guard alone is honestly ✓ at 10:00. That ✓ is the lie under test. */
  const staff = (over: Partial<BoardLane> = {}) =>
    lane({ key: 'p-01', group: 'staff', label: '見本 あずさ', stores: ['store-a'], window: { from: 600, until: 750 }, untilLabel: '12:30', ...over })
  const bed = (key: string, items: BoardItem[] = [], over: Partial<BoardLane> = {}) =>
    lane({ key, group: 'beds', label: key, items, ...over })

  // ── P1 ───────────────────────────────────────────────────────────────────
  it('P1 — staff free, EVERY room busy over the span: the cell is —, not ✓', () => {
    const rooms = [
      bed('bed-01', [booking({ key: 'b1', caseId: 'x1', title: '見本 さくら' }, 600, 660)]),
      bed('bed-02', [booking({ key: 'b2', caseId: 'x2', title: '見本 なぎ' }, 600, 660)]),
    ]
    const board = [staff(), ...rooms]
    // The board he saw: the guard, asked without the rooms, says ✓10:00.
    expect(cellAtBlind(board, 600).state).toBe('safe')
    expect(cellAtBlind(board, 600).label).toBe('✓10:00')
    // The board canon draws.
    const c = cellAt(board, 600)
    expect(c.state).toBe('blocked')
    expect(c.label).toBe('—')
    expect(c.sentence).toBe('この開始ではベッドを60分確保できません')
    // canon :7330-7334 — a hard resource block is NEVER an override.
    expect(c.ackAllowed).toBe(false)
  })

  // ── P2 ───────────────────────────────────────────────────────────────────
  it('P2 — one room frees and the ✓ comes back', () => {
    const board = [
      staff(),
      bed('bed-01', [booking({ key: 'b1', caseId: 'x1' }, 600, 660)]),
      bed('bed-02'),
    ]
    const c = cellAt(board, 600)
    expect(c.state).toBe('safe')
    expect(c.label).toBe('✓10:00')
  })

  // ── P3 ───────────────────────────────────────────────────────────────────
  it('P3 — a room busy only in the TAIL of the span still blocks it', () => {
    // 10:30–11:00 busy: free at the start instant, not free for the 60 minutes.
    const board = [
      staff(),
      bed('bed-01', [booking({ key: 'b1', caseId: 'x1' }, 630, 660)]),
      bed('bed-02', [booking({ key: 'b2', caseId: 'x2' }, 630, 660)]),
    ]
    expect(cellAtBlind(board, 600).state).toBe('safe')
    expect(cellAt(board, 600).state).toBe('blocked')
    expect(cellAt(board, 600).sentence).toBe('この開始ではベッドを60分確保できません')
    // Whole-span freeness, read the same way `trackFree` reads it: a span that
    // ENDS where the booking begins never overlapped it, and one that clears the
    // busy tail is feasible again. (Both starts are outside the shift, so the
    // predicate is asked directly — the guard has its own answer for those.)
    const feasible = bedFeasibility(board, null, POLICY)!
    expect(feasible(board[0], 600, 60)).toBe(false)
    expect(feasible(board[0], 570, 60)).toBe(true)
    expect(feasible(board[0], 660, 60)).toBe(true)
  })

  // ── P4 ───────────────────────────────────────────────────────────────────
  it('P4 — a store with no rooms configured is unchanged, cell for cell', () => {
    // canon's own `SCENARIO.needsBed === false` switch (:7261). A store that has
    // configured no resources is not a store that cannot sell.
    const board = [staff()]
    expect(bedFeasibility(board, null, POLICY)).toBeUndefined()
    expect(guardRailsFor(board, railIn(board))).toEqual(guardRailsFor(board, railIn(null)))
  })

  // ── P5 ───────────────────────────────────────────────────────────────────
  it('P5 — the card in hand and its OWN 清掃 travel with it; another booking’s does not', () => {
    // The pocket is exactly the span, so the guard alone is ✓ either way and the
    // only thing that can change the answer is the room.
    const held = staff({ window: { from: 630, until: 690 }, untilLabel: '11:30' })
    const own = [
      held,
      bed('bed-01', [
        booking({ key: 'apt-1-bed', caseId: 'apt-1' }, 570, 630),
        // `${id}-cleanup` — the linkage `today-board.cleanupBlocks` (:103) mints
        // and `withTrailingCleanup` re-derives; it carries caseId: null (:554),
        // so the KEY is the only thread back to its booking.
        { ...booking({ key: 'apt-1-cleanup', caseId: null }, 630, 645), kind: 'cleanup' as const, title: '清掃' },
      ]),
    ]
    expect(cellAtBlind(own, 630, { excludeId: 'apt-1' }).state).toBe('safe')
    expect(cellAt(own, 630, { excludeId: 'apt-1' }).state).toBe('safe')
    // The SAME turnaround belonging to someone else is a real blocker.
    const foreign = [
      held,
      bed('bed-01', [
        booking({ key: 'apt-1-bed', caseId: 'apt-1' }, 570, 630),
        { ...booking({ key: 'x9-cleanup', caseId: null }, 630, 645), kind: 'cleanup' as const, title: '清掃' },
      ]),
    ]
    const c = cellAt(foreign, 630, { excludeId: 'apt-1' })
    expect(c.state).toBe('blocked')
    expect(c.sentence).toBe('この開始ではベッドを60分確保できません')
  })

  // ── P6 ───────────────────────────────────────────────────────────────────
  it('P6 — every alternative the rail offers is one a room can actually take', () => {
    // (a) the no-pocket-at-this-start branch (⚖ 62): the offers come from
    // `safeStarts`, which canon hands the SAME ctx (:7296-7301).
    const long = staff({ window: { from: 600, until: 840 }, untilLabel: '14:00' })
    const busyUntilNoon = [
      long,
      bed('bed-01', [booking({ key: 'b1', caseId: 'x1' }, 600, 720)]),
      bed('bed-02', [booking({ key: 'b2', caseId: 'x2' }, 600, 720)]),
    ]
    const blind = cellAtBlind(busyUntilNoon, 810)
    expect(blind.alternatives.some((s) => s < 720)).toBe(true)
    const offered = cellAt(busyUntilNoon, 810)
    expect(offered.sentence).toBe('この開始には60分の連続した空きがありません')
    expect(offered.alternatives.length).toBeGreaterThan(0)
    expect(offered.alternatives.every((s) => s >= 720)).toBe(true)
    // (b) the R-UNAVAILABLE branch: the engine's own pool, already narrowed.
    const rooms = [
      staff(),
      bed('bed-01', [booking({ key: 'b1', caseId: 'x1' }, 600, 660)]),
      bed('bed-02', [booking({ key: 'b2', caseId: 'x2' }, 600, 660)]),
    ]
    const feasible = bedFeasibility(rooms, null, POLICY)!
    const c = cellAt(rooms, 600)
    expect(c.alternatives.length).toBeGreaterThan(0)
    for (const s of c.alternatives) expect(feasible(rooms[0], s, 60)).toBe(true)
  })

  // ── P7 ───────────────────────────────────────────────────────────────────
  it('P7 — a room in ANOTHER store never makes a start feasible (⚖ 46 isolation)', () => {
    const otherStore = [
      staff(),
      bed('bed-01', [booking({ key: 'b1', caseId: 'x1' }, 600, 660)]),
      bed('bed-b1', [], { stores: ['store-b'] }),
    ]
    expect(cellAt(otherStore, 600).state).toBe('blocked')
    expect(cellAt(otherStore, 600).sentence).toBe('この開始ではベッドを60分確保できません')
    // The identical board with that room in the person's OWN store: ✓.
    const sameStoreBoard = [
      staff(),
      bed('bed-01', [booking({ key: 'b1', caseId: 'x1' }, 600, 660)]),
      bed('bed-b1', [], { stores: ['store-a'] }),
    ]
    expect(cellAt(sameStoreBoard, 600).state).toBe('safe')
  })

  // ── the ORDER canon states, and the screen's own wiring ───────────────────
  it('the staff pocket is asked FIRST — a start with no pocket keeps its own sentence', () => {
    // canon `evaluateExactAim` :7322-7326 then :7332. Beds are busy too, and the
    // operator is still told the thing that is actually in the way.
    const noPocket = [
      staff({ window: { from: 600, until: 640 } }),
      bed('bed-01', [booking({ key: 'b1', caseId: 'x1' }, 600, 660)]),
    ]
    expect(cellAt(noPocket, 600).sentence).toBe('この開始には60分の連続した空きがありません')
  })

  /** ⚖ flag 76 (bed-aware rail) + ⚖ R3 one-world (2026-08-25): exclusion is the
   *  live gesture's privilege; a staged booking is real for every reader.
   *
   *  The pin MOVED with the code it pins. It used to hold the three
   *  `bedFeasibility` literals; the rail now reads the capacity book, so it
   *  holds the book's. Flag 76's half is unchanged and still pinned — BOTH guard
   *  doors are handed the rooms — and R3's half is the new one: the id that may
   *  be lifted out of the world is `live?.id`, full stop. `?? pending?.id` was
   *  the excluded world, and it may not come back anywhere in this file. */
  it('the screen hands the rooms to BOTH guard doors, out of the ONE book', () => {
    expect(SRC).toContain('const handId = live?.id ?? null')
    // ⚖ FIX-4(a) — the ENGINE's exclusion moved with the door's. Pinning only
    // `placementFeasible` would let a round put `pending` back into the pocket
    // walk while the beds stayed honest: half a world, which is worse than
    // either whole one.
    expect(SRC).toContain('excludeId: handId,')
    expect(SRC).toContain('placementFeasible: bedDoorFor(handId),')
    expect(SRC).toContain('placementFeasible: bedDoorFor(excludeId, lanes),')
    // The book is built ONCE per frame, in a memo — never inside a predicate,
    // a pointer frame or a drag handler.
    expect(SRC).toContain('() => bedViewsFor(boardLanes, props.rooms, ledgerFrame, handId),')
    // ⚖ FIX-4(f) — and on THESE inputs. A dep dropped here is a book answering
    // about last frame's board, which is the one failure a memo can have.
    expect(SRC).toContain('[boardLanes, props.rooms, ledgerFrame, handId],')
    // ⚖ FIX-4(c) — ⚖ 39's escape hatch, whole. A caller handing in a board it
    // has already taken something out of gets its OWN book; every hot caller
    // passes nothing and reads the frame's. Pinned as one expression, because
    // the identity check and the fallback are one decision.
    expect(SRC).toContain('bedDoor(lanes === boardLanes ? ledger : bedViewsFor(lanes, props.rooms, ledgerFrame, handId), lanes, askerId),')
    // …and the excluded world is unreachable from anywhere else on the screen.
    expect(SRC).not.toContain('?? pending?.id')
    expect(SRC).not.toContain('bedFeasibility(')
  })

  /** ⚖ FIX-4(e) — THE ONE-DOOR INVARIANT, IN R3's SHAPE.
   *
   *  R2 pinned "exactly one `bedTruthViews(` in the screen, inside the shadow
   *  function". The flag it was behind is gone; the invariant it protected is
   *  not — a second reader of the book is a third world for the asking, which is
   *  the disease this whole rebuild exists to remove. In R3's shape the book is
   *  reached through `bedViewsFor`, so that is what gets counted. */
  it('the screen has exactly one door to the book, and two ways in through it', () => {
    // `bedTruthViews` is called in exactly ONE place, and it is inside the wrapper.
    expect(SRC.split('bedTruthViews(').length - 1).toBe(1)
    const wrapper = SRC.indexOf('export function bedViewsFor(')
    expect(wrapper).toBeGreaterThan(-1)
    expect(SRC.indexOf('bedTruthViews(', wrapper)).toBeGreaterThan(wrapper)
    // …and the wrapper is CALLED exactly three times: the frame's book, ⚖ 39's
    // own book for a caller that handed in a different board, and — ⚖ PIN
    // MIGRATED at E3a, WITH the decision — the COMMITTED world's book.
    //
    // R3's invariant is unchanged and this is not a loophole in it: what it
    // forbids is a reader helping itself to a world nobody named. SPEC-SELLING-
    // ENGINE §2 names this one. It requires ONE mask builder over TWO world
    // instances — the sales door prices the COMMITTED board (the measured WO-2d
    // ruling, pinned two describes above) and the staff door's verdicts read the
    // BOARD world — so a mask for the sales door cannot be answered out of the
    // frame's book without handing the priced layers the pointer's position,
    // which is the very thing this file's tripwire exists to stop.
    //
    // It is also GATED: the call sits behind `SELLING_ENGINE_LAW`, so until E3b
    // flips it there is no third book at runtime at all. Both halves asserted —
    // the count, and that the new site is the gated one. (+1 for the definition.)
    expect(SRC.split('bedViewsFor(').length - 1).toBe(4)
    expect(SRC).toContain('SELLING_ENGINE_LAW ? bedViewsFor(committedLanes, props.rooms, ledgerFrame, null).world : null')
  })
})

/** ────────────────────────────────────────────────────────────────────────────
 * ⚖ R3 ONE WORLD (Liam, 2026-08-25) — A STAGED 仮押さえ IS REAL FOR EVERY READER
 *
 * His refusal shots: a card staged but not confirmed, and the 60分配置 strip
 * beside it still offering the minutes and the ROOM that card was standing in.
 * The cause was one expression — the guard's door bound `live ?? pending`, so
 * an unconfirmed move was deleted from the rail's reality — and the drop then
 * refused 満室 on a start the board had just advertised.
 *
 * EVERY SCENE BELOW IS A PAIR. The BEFORE leg drives the door this round
 * deleted (`bedFeasibility(lanes, stagedId, POLICY)` + `excludeId: stagedId`),
 * which is the red-run: it is what the board did, asserted so a regression that
 * brought it back could not pass quietly. The AFTER leg drives the shipped one
 * (`bedDoor` out of `bedViewsFor`, `excludeId: handId`).
 *
 * The one thing that did NOT change is the live gesture: a card actually in the
 * operator's hand is still lifted out of the world, and still answered as
 * ITSELF — its room, its VIP-ness. That is the last scene, and it is a
 * zero-delta pin on purpose.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('⚖ R3 one world — a staged 仮押さえ holds its room and its lane for everybody', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
  const GUARD = {
    services: [{ name: '整体60', dur: 60 }, { name: '骨盤90', dur: 90 }],
    newClientSessionMin: 90, protectedLabel: '新規', gapFillMinMin: 30, leadTimeMin: 0,
    mode: 'standard' as const,
  }
  const FRAME = { openMin: HOURS.open, closeMin: HOURS.close, nowMin: HOURS.open }
  const staff = (key: string, over: Partial<BoardLane> = {}) =>
    lane({ key, group: 'staff', label: key, stores: ['store-a'], window: { from: HOURS.open, until: HOURS.close }, untilLabel: '19:00', ...over })
  const bed = (key: string, items: BoardItem[] = [], over: Partial<BoardLane> = {}) =>
    lane({ key, group: 'beds', label: key, items, ...over })

  /** The rail exactly as the screen builds it, with either door plugged in. */
  const railsWith = (
    lanes: BoardLane[],
    excludeId: string | null,
    door: ((l: BoardLane, s: number, d: number) => boolean) | undefined,
    nowMinute: number | null = null,
  ) =>
    guardRailsFor(lanes, {
      open: HOURS.open, close: HOURS.close, stepMin: 30, dur: 60, protectedDur: 90,
      nowMinute, locked: [], guard: GUARD, excludeId, placementFeasible: door,
    })
  /** THE DOOR THIS ROUND DELETED — the red-run leg. */
  const before = (lanes: BoardLane[], stagedId: string, nowMinute: number | null = null) =>
    railsWith(lanes, stagedId, bedFeasibility(lanes, stagedId, POLICY), nowMinute)
  /** THE DOOR THIS ROUND SHIPS. `handId` is null at rest — that is the round. */
  const after = (lanes: BoardLane[], handId: string | null = null, nowMinute: number | null = null) =>
    railsWith(lanes, handId, bedDoor(bedViewsFor(lanes, POLICY, { ...FRAME, nowMin: nowMinute ?? HOURS.open }, handId), lanes, handId), nowMinute)
  const cell = (rails: ReturnType<typeof railsWith>, laneKey: string, start: number) =>
    rails.find((r) => r.laneKey === laneKey)!.cells.find((c) => c.start === start)!

  // ── SCENE 0.03.58 — the rail BESIDE the staged card ───────────────────────
  /** Two rooms, both taken over 10:00–11:00 once the staged card is counted:
   *  bed-01 by a stranger, bed-02 by the operator's own unconfirmed move. The
   *  other staff lane is free, so the guard alone is happy — the ROOM is the
   *  whole question, which is what makes this flag 76's disease with a new
   *  cause. */
  const shotBoard = () => [
    staff('p-01'),
    staff('p-02', { items: [booking({ key: 'staged-staff', caseId: 'staged', title: '見本 いつき' }, 600, 660)] }),
    bed('bed-01', [booking({ key: 'b1', caseId: 'other', title: '見本 さくら' }, 600, 660)]),
    bed('bed-02', [booking({ key: 'staged-bed', caseId: 'staged', title: '見本 いつき' }, 600, 660)]),
  ]

  it('0.03.58 — the strip beside a staged card stops inviting onto its room', () => {
    const board = shotBoard()
    // THE RED-RUN: the deleted door lifted the staged card out of everybody's
    // world, so bed-02 read free and the strip said ✓10:00 on the neighbour's
    // lane. This is his screenshot.
    const was = cell(before(board, 'staged'), 'p-01', 600)
    expect(was.state).toBe('degraded')
    expect(was.label).toBe('△10:00')
    // ONE WORLD: the room is taken, and the strip says so in the engine's own
    // resource sentence (⚖ 76's wording, unchanged).
    const now = cell(after(board), 'p-01', 600)
    expect(now.state).toBe('blocked')
    expect(now.label).toBe('—')
    expect(now.sentence).toBe('この開始ではベッドを60分確保できません')
    // canon :7330-7334 — a hard resource block is never an override.
    expect(now.ackAllowed).toBe(false)
  })

  // ── SCENE 0.04.10 — the rail UNDER the staged card ────────────────────────
  it('0.04.10 — the strip under a staged card stops offering the minutes it stands in', () => {
    const board = shotBoard()
    // THE RED-RUN: excluded from its own lane's occupancy, the staged card left
    // a pocket behind it and the strip offered the very start it occupies.
    expect(cell(before(board, 'staged'), 'p-02', 600).state).toBe('degraded')
    // ONE WORLD: the lane is busy, so there is no pocket to answer about.
    const now = cell(after(board), 'p-02', 600)
    expect(now.state).toBe('blocked')
    expect(now.sentence).toBe('この開始には60分の連続した空きがありません')
  })

  it('…and the minutes the staged card does NOT occupy are unchanged', () => {
    // The change is not "the lane went quiet": 11:30 is past the staged span and
    // both rooms are free there, so both doors say the same thing. A round that
    // blanked the strip would pass the two scenes above and fail here.
    const board = shotBoard()
    expect(cell(before(board, 'staged'), 'p-01', 690).state).toBe(cell(after(board), 'p-01', 690).state)
    expect(cell(after(board), 'p-01', 690).state).toBe('degraded')
    expect(cell(after(board), 'p-01', 690).label).toBe('△11:30')
  })

  // ── the VIP axis: ⚖ 51's 個室 floor is what the two askers disagree about ──
  it('a staged VIP: the strip stops answering as the VIP and answers as a new client', () => {
    // 個室 bed-02 is busy 10:00–11:00 with somebody else; the staged VIP sits in
    // it later, at 11:40. The standard room is free the whole time.
    const board = [
      staff('p-01'),
      staff('p-02', { items: [booking({ key: 'v-staff', caseId: 'staged', category: 'vip', title: 'テスト えいた' }, 700, 760)] }),
      bed('bed-01'),
      bed('bed-02', [
        booking({ key: 'o1', caseId: 'other', title: '見本 さくら', category: 'vip' }, 600, 660),
        booking({ key: 'v-bed', caseId: 'staged', category: 'vip', title: 'テスト えいた' }, 700, 760),
      ], { roomClass: 'private', sub: '個室' }),
    ]
    // THE RED-RUN: bound to the staged VIP, the 個室 floor narrowed the候補 to
    // bed-02 alone — busy at 10:00 — so the strip refused a start at which a
    // NEW client could perfectly well have started, in the free 施術室.
    const was = cell(before(board, 'staged'), 'p-01', 600)
    expect(was.state).toBe('blocked')
    expect(was.sentence).toBe('この開始ではベッドを60分確保できません')
    // ONE WORLD: the strip asks its own question — 「could a new placement start
    // here」 — and bed-01 answers it.
    expect(cell(after(board), 'p-01', 600).state).toBe('degraded')
    expect(cell(after(board), 'p-01', 600).label).toBe('△10:00')
    // The floor itself is untouched: asked ABOUT that VIP, the answer is still no.
    const asVip = bedDoor(bedViewsFor(board, POLICY, FRAME, 'staged'), board, 'staged')!
    expect(asVip(board[0], 600, 60)).toBe(false)
  })

  // ── NOW-TRUNCATED (guard-round requirement): an off-lattice clock ──────────
  it('an off-lattice now (804) does not hide the change — the fixture board’s own clock', () => {
    // Fixture nows sit on the lattice and hide shift bugs (migration F8). 804 is
    // 13:24: not a multiple of five, not a rail start, and the pocket walk clips
    // to it. The staged span is moved into the afternoon so the scene lives on
    // the far side of that clock.
    const board = [
      staff('p-01'),
      staff('p-02', { items: [booking({ key: 'staged-staff', caseId: 'staged', title: '見本 いつき' }, 840, 900)] }),
      bed('bed-01', [booking({ key: 'b1', caseId: 'other', title: '見本 さくら' }, 840, 900)]),
      bed('bed-02', [booking({ key: 'staged-bed', caseId: 'staged', title: '見本 いつき' }, 840, 900)]),
    ]
    // THE RED-RUN, and it is the sharper half of the shot: the excluded world
    // refused this start for a JUDGEMENT (the protected 新規 window), which the
    // store's own override policy lets a manager walk past — 「注意して配置」 on a
    // start whose room the operator's own staged card was standing in.
    const was = cell(before(board, 'staged', 804), 'p-01', 840)
    expect(was.sentence).toBe('ここに置くと新規（90分）が入らなくなります')
    expect(was.ackAllowed).toBe(true)
    // ONE WORLD: the same start is a FACT now, and ⚖ 73's floor takes the
    // override away with it — a full room is not a thing a manager can approve.
    const now = cell(after(board, null, 804), 'p-01', 840)
    expect(now.state).toBe('blocked')
    expect(now.sentence).toBe('この開始ではベッドを60分確保できません')
    expect(now.ackAllowed).toBe(false)
  })

  // ── the live gesture keeps its privilege ──────────────────────────────────
  it('a card IN HAND is still lifted out, and still answered as itself', () => {
    const board = shotBoard()
    // Its own room is its first candidate and its own card is not an obstacle to
    // itself, so the hand's own start stays feasible — byte for byte the answer
    // the deleted door gave, which is the zero-delta half of the binding table.
    for (const start of [600, 630, 660, 690, 720]) {
      expect([start, cell(after(board, 'staged'), 'p-02', start).state])
        .toEqual([start, cell(before(board, 'staged'), 'p-02', start).state])
    }
    // …and the neighbour's lane too: the lift is the SAME world the old
    // `excludeId` produced.
    for (const start of [600, 630, 660]) {
      expect([start, cell(after(board, 'staged'), 'p-01', start).sentence])
        .toEqual([start, cell(before(board, 'staged'), 'p-01', start).sentence])
    }
  })

  // ── the door's own contract (the mutation targets) ────────────────────────
  it('bedDoor picks its world by WHO is asking, never by who is standing there', () => {
    const board = shotBoard()
    const views = bedViewsFor(board, POLICY, FRAME, 'staged')
    // A hand exists, so the second world exists — and only then.
    expect(views.worldMinusHand).not.toBeNull()
    expect(bedViewsFor(board, POLICY, FRAME, null).worldMinusHand).toBeNull()
    // The HAND is answered out of the lifted world: its own room is free to it.
    expect(bedDoor(views, board, 'staged')!(board[0], 600, 60)).toBe(true)
    // A hypothetical is answered out of the ONE world: both rooms are taken.
    expect(bedDoor(views, board, null)!(board[0], 600, 60)).toBe(false)
    // A NON-hand booking is answered out of the ONE world as a SUBJECT — it does
    // not count as its own obstacle, and it does not vanish for anybody else.
    // (Asking the lifted world about it would lift a second card; the book
    // refuses that, and this is the wiring that never asks.)
    const atRest = bedViewsFor(board, POLICY, FRAME, null)
    expect(bedDoor(atRest, board, 'staged')!(board[0], 600, 60)).toBe(true)
    expect(bedDoor(atRest, board, 'other')!(board[0], 600, 60)).toBe(true)
    expect(bedDoor(atRest, board, null)!(board[0], 600, 60)).toBe(false)
  })

  /** ⚖ R3-DEBT (d), ANSWERED — AND THE ANSWER IS NOT THE ONE R2 EXPECTED.
   *
   *  R2 pinned `worldMinusHand` as a WHOLE-ANSWER NO-OP for a Subject and wrote
   *  down that R3's rewire would make the lift load-bearing on the live-drag
   *  path. It did not, and this is the measurement rather than the guess: a
   *  mutant that answers the hand out of the UNLIFTED world (`const truth =
   *  views.world`) survives the whole battery, because `allocateBed` already
   *  performs both of the lift's exclusions itself — the card's own drawing and
   *  its own trailing `-cleanup` — for any question carrying that id.
   *
   *  So the lift is kept for what it makes UNSAYABLE, not for what it changes.
   *  `worldMinusHand` is the only door to a world with a card taken out of it,
   *  it exists only while a hand is holding one, and the book refuses to answer
   *  a Subject question about anybody else out of it. That is the structural
   *  guarantee this round is built on, and this pin is where the equivalence is
   *  stated out loud instead of being an unpinned survivor in a mutation run. */
  it('the lift is a whole-answer no-op for the hand — kept for what it forbids, not what it changes', () => {
    const board = shotBoard()
    const views = bedViewsFor(board, POLICY, FRAME, 'staged')
    const lifted = bedDoor(views, board, 'staged')!
    const unlifted = bedDoor({ ...views, worldMinusHand: null }, board, 'staged')!
    let asked = 0
    for (const l of board.filter((x) => x.group === 'staff')) {
      for (let start = HOURS.open; start + 60 <= HOURS.close; start += 5) {
        asked += 1
        expect([l.key, start, lifted(l, start, 60)]).toEqual([l.key, start, unlifted(l, start, 60)])
      }
    }
    expect(asked).toBe(2 * ((HOURS.close - HOURS.open - 60) / 5 + 1))
    // …and the world it CANNOT be talked into: asked about anybody but the hand,
    // the lifted book refuses rather than lifting a second card.
    expect(() => views.worldMinusHand!.bedFor(600, 660, { id: 'other', currentBed: null, vip: false, stores: ['store-a'] }))
      .toThrow(/would lift a second card/)
  })

  it('an empty id is NOBODY, and a store with no rooms has no door at all', () => {
    const board = shotBoard()
    const views = bedViewsFor(board, POLICY, FRAME, null)
    // `bedFeasibility` read `excludeId` for truthiness; '' meant "exclude
    // nobody" there and it means the same here, or the two are not the same
    // question.
    expect(bedDoor(views, board, '')!(board[0], 600, 60)).toBe(bedDoor(views, board, null)!(board[0], 600, 60))
    // canon's own `SCENARIO.needsBed === false` switch: absent, not false.
    const noRooms = board.filter((l) => l.group !== 'beds')
    expect(bedDoor(bedViewsFor(noRooms, POLICY, FRAME, null), noRooms, null)).toBeUndefined()
    // ⚖ FIX-5 (blind round) — AND THE SEAM AGREES ON BOTH SIDES. The book throws
    // on an empty hand id (rightly: a hand with no id is a bug in the caller,
    // not an empty world), so `bedViewsFor` normalises it to "no hand" before
    // that throw can reach a render — the same truthiness `bedDoor` reads.
    expect(() => bedViewsFor(board, POLICY, FRAME, '')).not.toThrow()
    expect(bedViewsFor(board, POLICY, FRAME, '').worldMinusHand).toBeNull()
    expect(bedViewsFor(board, POLICY, FRAME, '').handId).toBeNull()
  })

  it('the hypothetical door answers PER LENGTH, not once for the first one asked', () => {
    // The mask is memoised per (lane, length). Keyed by the lane alone it would
    // hand a 90's answer back for a 30 — the cache-key defect the book's own
    // battery exists to catch, one layer up.
    const board = [
      staff('p-01'),
      bed('bed-01', [booking({ key: 'b1', caseId: 'other' }, 630, 660)]),
    ]
    const door = bedDoor(bedViewsFor(board, POLICY, FRAME, null), board, null)!
    expect(door(board[0], 600, 60)).toBe(false) // 10:00–11:00 straddles the booking
    expect(door(board[0], 600, 30)).toBe(true) // 10:00–10:30 clears it
    expect(door(board[0], 600, 60)).toBe(false) // …and the first answer is still right
  })

  it('the SUBJECT door answers per LENGTH too — its own map is keyed by the whole question', () => {
    // ⚖ FIX-4(d) — the hypothetical path is memoised by (lane, length) and the
    // Subject path by (lane, start, length). Both keys are complete, and either
    // one dropping the length would hand a 60's answer back for a 30.
    const board = [
      staff('p-01'),
      staff('p-02', { items: [booking({ key: 's', caseId: 'staged' }, 900, 960)] }),
      bed('bed-01', [booking({ key: 'b1', caseId: 'other' }, 630, 660)]),
    ]
    const door = bedDoor(bedViewsFor(board, POLICY, FRAME, 'staged'), board, 'staged')!
    expect(door(board[0], 600, 60)).toBe(false) // 10:00–11:00 straddles the booking
    expect(door(board[0], 600, 30)).toBe(true) // 10:00–10:30 clears it
    expect(door(board[0], 600, 60)).toBe(false) // …and the first answer is still right
  })

  it('StrictMode: two books built from the same inputs answer identically, cell for cell', () => {
    // React may invoke a memo factory twice. The book is a value, not an effect,
    // so the second one has to be the first one — including the two-world split.
    const board = shotBoard()
    const runs = [null, 'staged'].map((handId) =>
      [bedViewsFor(board, POLICY, FRAME, handId), bedViewsFor(board, POLICY, FRAME, handId)].map((views) =>
        railsWith(board, handId, bedDoor(views, board, handId)).map((r) => r.cells.map((c) => `${c.state}|${c.label}|${c.sentence}`)),
      ),
    )
    for (const [a, b] of runs) expect(a).toEqual(b)
    // …and it actually asked something: a vacuous comparison is not a pin.
    expect(runs[0][0].flat().length).toBe(2 * ((HOURS.close - HOURS.open) / 30))
  })

  // ── the 満室 sentence names the operator's own move (product U3) ───────────
  describe('満室 says WHOSE — the operator’s own unconfirmed move is named, never hidden', () => {
    const board = shotBoard()
    const ask = (stagedId: string | null) =>
      landingVerdict(board, {
        staffLane: 'p-01', bedLane: null, solveRoom: true, id: null, vip: false,
        start: 600, end: 660, span: place(600, 660, HOURS), foreignRefusal: null,
        locked: [], rooms: POLICY, minutesOf: (x) => minuteOf(x, HOURS), stagedId,
      }, null)

    it('the staged card is named as the operator’s own, and the room is still 満室', () => {
      const v = ask('staged')
      expect(v.kind).toBe('blocked')
      // ⚖ 73 — a full house is a FACT, so it stays `hard-room` and offers no
      // 「注意して配置」. Naming the occupant does not soften the floor.
      expect(v.floor).toBe('hard-room')
      expect(v.reason).toBe('10:00〜11:00はベッドに空きがありません。bed-01が使用中（見本 さくら様）、bed-02が使用中（仮押さえ中：見本 いつき様）')
    })

    it('…and every other blocker keeps flags 44 + 51 wording exactly', () => {
      // Nothing staged: the sentence is byte-identical to the one this board
      // shipped before R3.
      expect(ask(null).reason).toBe('10:00〜11:00はベッドに空きがありません。bed-01が使用中（見本 さくら様）、bed-02が使用中（見本 いつき様）')
      // A staged id that is not on this board changes nothing either.
      expect(ask('somebody-else').reason).toBe(ask(null).reason)
    })

    /** ⚖ F1 (line audit, 2026-08-25) — AND THE OTHER LEG THAT SAYS IT OUT LOUD.
     *
     *  `landingVerdict` is not the only path to this sentence. `solveBed`
     *  (TodayScreen) calls `allocateBed` itself and hands the refusal straight
     *  to `refuse(...)`, which is four more surfaces: the bed-row drop, the
     *  次回予約 chip's landing, the stage-time re-solve and the gap partner. It
     *  shipped without `stagedId`, so while a move was staged every one of them
     *  could name the operator's own card like a stranger's — item 2's defect,
     *  alive on a sibling path.
     *
     *  Pinned in two halves, because the wiring is component-internal and
     *  territory has no renderer for TodayScreen: the ANSWER here (the allocator
     *  asked exactly as `solveBed` asks it — a 次回予約, so `id: null`, no room
     *  carried in), and the WIRING as a source pin inside `solveBed`'s own body
     *  below. */
    it('solveBed’s leg says it too — a 次回予約 into a full house names the staged move', () => {
      const staffLane = board.find((l) => l.key === 'p-01')!
      const solved = allocateBed(board, {
        id: null, currentBed: null, stores: staffLane.stores, vip: false,
        start: 600, end: 660, policy: POLICY, stagedId: 'staged',
      })
      expect(solved.laneKey).toBeNull()
      expect(solved.refusal).toBe('10:00〜11:00はベッドに空きがありません。bed-01が使用中（見本 さくら様）、bed-02が使用中（仮押さえ中：見本 いつき様）')
      // …and nothing staged is byte-identical to what this leg shipped before.
      expect(allocateBed(board, {
        id: null, currentBed: null, stores: staffLane.stores, vip: false,
        start: 600, end: 660, policy: POLICY,
      }).refusal).toBe('10:00〜11:00はベッドに空きがありません。bed-01が使用中（見本 さくら様）、bed-02が使用中（見本 いつき様）')
    })

    /** ⚖ FIX-3 (blind round) — THE ORPHANING WRITE IS GATED, AND THE ASK IS NOT.
     *
     *  `placeNextVisit` ends in `setPending`, and `armNextVisit` guards only the
     *  ARMING: 配置モード can be armed with nothing staged, a card dragged and
     *  staged after it, and the still-armed mode then clicked — silently
     *  overwriting the operator's 仮押さえ. A staged change that disappears
     *  because the board took a second one is data loss, and ⚖ 47's law is that
     *  a refusal changes NOTHING.
     *
     *  Source-order pins, because the path is component-internal and territory
     *  has no renderer: the gate must sit INSIDE this function and BEFORE its
     *  write, and the ask must sit outside it. */
    it('a staged 仮押さえ cannot be orphaned — placeNextVisit refuses before it writes', () => {
      const body = SRC.slice(SRC.indexOf('function placeNextVisit('), SRC.indexOf('function placeFromShelf('))
      expect(body).toContain("if (pending) {\n      refuse('仮押さえ中の予約を確定するか、元に戻してから操作してください')")
      // …and it refuses BEFORE the write it exists to protect.
      expect(body.indexOf('if (pending) {')).toBeGreaterThan(-1)
      expect(body.indexOf('if (pending) {')).toBeLessThan(body.indexOf('setPending({'))
      // The gate is on the WRITE, not on the click: the empty-track handler
      // still asks the guard, and `placeNextVisit` is still its callback — so
      // the consult popup, the rail's marks and the 満室 sentence that names the
      // staged card all keep answering.
      expect(SRC).toContain('(s, override) => placeNextVisit(lane, s, override),')
      const askBody = SRC.slice(SRC.indexOf('askGuard(\n              { staffLane: lane.key'))
      expect(askBody.slice(0, 400)).not.toContain('if (pending)')
    })

    it('…and the shelf’s twin needs no gate of its own — it is closed upstream', () => {
      // `placeFromShelf` writes `pending` too, but it is reachable only through
      // `onChipPointerDown`, which already refuses on a staged change. Pinned so
      // a future round that loosens THAT gate discovers this dependency here
      // rather than in an orphaned 仮押さえ.
      const chipDown = SRC.slice(SRC.indexOf('function onChipPointerDown('), SRC.indexOf('function onChipPointerMove('))
      expect(chipDown).toContain("refuse('仮押さえ中の予約を確定するか、元に戻してから操作してください')")
      const shelf = SRC.slice(SRC.indexOf('function placeFromShelf('))
      expect(shelf.slice(0, shelf.indexOf('setPending({'))).toContain('solveBed(')
    })

      /** ⚖ FIX-6 (blind round) — ONE VERDICT, TWO SURFACES, AND ONLY ONE OF THEM
     *  ALREADY ANSWERS "THEN WHERE?".
     *
     *  The hold popover has no offer line, so GAP-6's second clause is the only
     *  answer it carries and it belongs there whole. The consult popover puts
     *  the engine's alternative starts underneath the facts, and when there are
     *  none that line reads 「この区間に、より損の少ない開始はありません」 — with
     *  clause two stacked above it the box prints two true sentences that read
     *  as the board contradicting itself. */
    it('the hold row keeps both clauses; the row beside an offer line keeps one', () => {
      const degraded: RailCell = {
        start: 990, state: 'degraded', label: '△16:30',
        sentence: '新規90分の空き2→1（1枠減・損を減らす）。15:45はこの区間で損が最少の開始です',
        reason: null,
        alternatives: [945], alternativeKind: 'least-loss', ackAllowed: true,
      }
      expect(guardCheckRow(degraded)).toEqual({
        label: '新規90分の空き2→1（1枠減）。15:45はこの区間で損が最少の開始です', tone: 'warn',
      })
      expect(guardCheckRowBesideOffer(degraded)).toEqual({
        label: '新規90分の空き2→1（1枠減）', tone: 'warn',
      })
      // A one-clause sentence is the SAME row on both surfaces — the split is
      // about the second clause and nothing else.
      const blocked: RailCell = { ...degraded, state: 'blocked', label: '—', sentence: 'この開始ではベッドを60分確保できません' }
      expect(guardCheckRowBesideOffer(blocked)).toEqual(guardCheckRow(blocked))
      // ⚖ flag 52 rides along untouched on both: warn, never ×, never blocking.
      expect(guardCheckRowBesideOffer(degraded)!.tone).toBe('warn')
      expect(guardCheckRowBesideOffer(null)).toBeNull()
      expect(guardCheckRowBesideOffer({ ...degraded, state: 'safe' })).toBeNull()
    })

  /** ⚖ FIX-4(b) — the ASK path's own threading, scoped the same way. The literal
   *  appears twice in the file now, so an unscoped pin could be satisfied by
   *  `solveBed` alone and this leg could go dark. */
  it('…and verdictFor threads it too — the wiring, in its own body', () => {
    const fn = SRC.indexOf('const verdictFor = useCallback(')
    expect(fn).toBeGreaterThan(-1)
    const body = SRC.slice(fn, SRC.indexOf('\n  )', fn))
    expect(body).toContain('stagedId: pending?.id ?? null,')
    expect(body).toContain('landingVerdict(')
  })

  it('…and solveBed actually threads it — the wiring, in its own body', () => {
      // Scoped to `solveBed`'s body: the same literal also appears in
      // `verdictFor`, and a pin that could be satisfied by the OTHER call site
      // would not catch this leg dropping it.
      const fn = SRC.indexOf('function solveBed(')
      expect(fn).toBeGreaterThan(-1)
      const body = SRC.slice(fn, SRC.indexOf('\n  }', fn))
      expect(body).toContain('stagedId: pending?.id ?? null,')
      expect(body).toContain('refuse(solved.refusal)')
    })

    it('the fact is never suppressed — the staged room is still counted as taken', () => {
      // The alternative design (hide the operator's own card from the sentence)
      // would have to hide it from the COUNT as well, and then a full house would
      // read as a free room. Both rooms are named, and the verdict is 置けない.
      expect(ask('staged').reason).toContain('bed-02が使用中')
      expect(ask('staged').bedLane).toBeNull()
    })
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

/** ⚖ Liam flag 39 / BATCH-5 R4 (2026-08-21) — THE BLOCK-PLACEMENT ADVISOR.
 *
 *  A 記録/準備/レジ had no placement intelligence: the only landing constraint
 *  was overlapping something real, so a block dropped into the middle of a free
 *  run could destroy the day's last 新規90分 and the board said nothing. Canon
 *  has no block guard either — this is a SURPASS.
 *
 *  v1 is ADVISE, NEVER REFUSE (Liam's ruling): the block lands, and the board
 *  offers the better position as one click. The engine is consulted through its
 *  exported surface only, with the board taken apart the way a booking's own
 *  `excludeId` takes it apart. */
describe('a block that damages the day says so, and offers the better position', () => {
  const GUARD = {
    services: [{ name: '整体60', dur: 60 }, { name: '骨盤90', dur: 90 }],
    newClientSessionMin: 90, protectedLabel: '新規', gapFillMinMin: 30, leadTimeMin: 0,
    mode: 'standard' as const,
  }
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
  const CSS = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/today.css'), 'utf8')
  // 10:00–12:30 — 150 free minutes, which hold exactly one 新規90分 window.
  const pocket = lane({ key: 'p-01', group: 'staff', window: { from: 600, until: 750 }, untilLabel: '12:30' })
  const askAbout30At = (start: number) =>
    guardVerdictAt([pocket], 'p-01', start, {
      open: HOURS.open, close: HOURS.close, stepMin: 30, dur: 30, protectedDur: 90,
      nowMinute: null, locked: [], guard: GUARD,
    })!

  it('the engine answers about a BLOCK exactly as it answers about a booking', () => {
    // 30 minutes at either END: the run stays whole behind it, the 新規90分
    // survives, and the board has nothing to say.
    expect(askAbout30At(600).state).toBe('safe')
    expect(askAbout30At(690).state).toBe('safe')
    // The same 30 minutes at 11:00 cuts the run into 60 + 60. The 新規90分 is
    // gone and neither half can host one — said in the vocabulary the board
    // already speaks everywhere else.
    const mid = askAbout30At(660)
    expect(mid.state).not.toBe('safe')
    expect(mid.sentence).toBe('ここに置くと新規（90分）が入らなくなります')
    // …it knows where the block should have gone…
    expect(mid.alternatives[0]).toBe(600)
    expect(mid.alternativeKind).toBe('safe')
    // …which is also the test for whether the advisor has anything to say.
    expect(askAbout30At(600).alternatives).toEqual([])
    // …and it does not forbid it. ADVISE, NEVER REFUSE: canon's own ackAllowed
    // is what makes そのまま置く an honest button rather than a bypass.
    expect(mid.ackAllowed).toBe(true)
    // A start that costs a plain 60分 menu slot rather than the protected
    // window is the same shape, in that reason's own words.
    expect(askAbout30At(630).sentence).toBe('ここに置くと整体60が入らなくなります')
  })

  it('the screen asks that question on the DROP, about the board without the block', () => {
    const finish = SRC.slice(SRC.indexOf('function finishBlockDrag'), SRC.indexOf('function takeBlockSuggestion'))
    // After the move commits — the block lands, then the board advises.
    expect(finish.indexOf('setBlockMoves((was)')).toBeLessThan(finish.indexOf('const cell = verdictAt('))
    // A block is not an obstacle to itself. It has no caseId, so the board is
    // handed in without it rather than through `excludeId`.
    expect(finish).toContain('boardLanes.map((l) => ({ ...l, items: l.items.filter((i) => i.key !== ctx.key) })),')
    // A SAFE landing is silent — and so is one the engine has nothing better
    // for. MEASURED, not argued (browser, 2026-08-21): a block already sitting
    // at the least-loss start of its pocket comes back `degraded` with 0枠減
    // and no alternatives, and a block dropped behind the day's own clock has
    // no pocket at all. Both are normal operations; neither is a mistake.
    expect(finish).toContain("if (!cell || cell.state === 'safe' || cell.alternatives.length === 0) return")
    // The whole consult is one function of the DROP, never of a pointermove:
    // the per-frame path stays a transform, exactly as WO-2d left it.
    const perFrame = SRC.slice(SRC.indexOf('function beginBlockDrag'), SRC.indexOf('function finishBlockDrag'))
    expect(perFrame).not.toContain('setBlockAdvice(')
    expect(perFrame).not.toContain('verdictAt(')
  })

  it('all three buttons do the thing they are named, and none of them refuses', () => {
    // 提案位置に置く MOVES the block, at its own length, on the lane it landed on.
    const take = SRC.slice(SRC.indexOf('function takeBlockSuggestion'), SRC.indexOf('function undoBlockDrop'))
    expect(take).toContain('const at = place(a.suggest, a.suggest + a.dur, hours)')
    expect(take).toContain('setBlockMoves((was) => ({ ...was, [a.key]: { laneKey: a.laneKey, ...at } }))')
    // やめる is the drop undone — back to the span it stood on before, which for
    // an untouched block is no entry at all.
    const undo = SRC.slice(SRC.indexOf('function undoBlockDrop'), SRC.indexOf('function undoBlockDrop') + 700)
    expect(undo).toContain('if (a.home) next[a.key] = a.home')
    expect(undo).toContain('else delete next[a.key]')
    // そのまま置く only closes it: the block is already where it was dropped.
    expect(SRC).toContain('<button className="gp-cancel" type="button" onClick={() => setBlockAdvice(null)}>そのまま置く</button>')
    // …and 提案位置に置く is the default answer, and always acts: the surface
    // does not open without an alternative to move to.
    expect(SRC).toContain('              autoFocus')
    // RENEGOTIATED (batch-10, ⚖ 58 RIDER + ⚖ 31c): the suggestion is still the
    // engine's own first alternative, but only after it has been snapped onto
    // the store's BLOCK lattice and put through the block's own landing gate —
    // an engine start is not yet an offer.
    expect(SRC).toContain('      suggest: better.alternatives[0],')
    expect(SRC).toContain('const better = offerableCell(cell, props.guard.config.blockStepMin ?? BLOCK_STEP_MIN_DEFAULT, from, (s) =>')
    // NEVER a refusal: the only thing that turns a block back is still an
    // overlap with something real.
    expect(SRC.slice(SRC.indexOf('function finishBlockDrag'), SRC.indexOf('function takeBlockSuggestion')))
      .toContain('他の予定と重なるため元の位置に戻しました')
  })

  it('it obeys the same modality contract as every other transient surface', () => {
    // Singleton: one new gesture on the board puts it down (flag 33's own hook).
    const close = SRC.slice(SRC.indexOf('function closeAdvice'), SRC.indexOf('function closeAdvice') + 400)
    expect(close).toContain('if (blockAdvice) setBlockAdvice(null)')
    expect(SRC).toContain('onPointerDownCapture={closeAdvice}')
    // Outside click, behind canon's own 80ms arrival window.
    expect(SRC).toContain('if (e.timeStamp - blockAdviceOpenedAt.current < 80) return')
    expect(SRC).toContain('if (clickClosesPopover(blockAdvicePopRef.current, e.target)) setBlockAdvice(null)')
    // Escape, innermost first — before the consult, which is older on screen.
    const esc = SRC.slice(SRC.indexOf("if (e.key !== 'Escape'"), SRC.indexOf('document.addEventListener(\'keydown\', onKey)'))
    expect(esc.indexOf('setBlockAdvice(null)')).toBeLessThan(esc.indexOf('setAdvice(null)'))
    // Under the block, NEVER over it, viewport-clamped — the confirm popover's
    // own two helpers, not a second copy of the rule.
    expect(SRC).toContain('const box = blockNode(boardRef.current, blockAdvice.key)?.getBoundingClientRect()')
    expect(SRC).toContain('const at = box && anchorOnScreen(box, viewport) ? holdPopAnchor(box, self.width, self.height, viewport) : null')
    expect(SRC).toContain('        setBlockAdvicePinned(true)')
    // The block can be found at all: it has no caseId, so it carries its key.
    expect(SRC).toContain('data-block={item.key}')
    expect(CSS).toContain('.biz .guard-pop.pinned { left: 50%; bottom: 18px; top: auto; transform: translateX(-50%); }')
    expect(CSS).toContain('.biz .guard-pop.block-advice { width: min(92vw, 380px); min-width: 0; max-width: none; }')
  })

  it('blockNode finds the box by its own key, and nothing else', () => {
    const board = document.createElement('div')
    for (const [cls, key] of [['event block', 'br-1'], ['event cleanup', 'cl-1']]) {
      const el = document.createElement('button')
      el.className = cls
      el.dataset.block = key
      board.appendChild(el)
    }
    const card = document.createElement('button')
    card.className = 'event'
    card.dataset.book = 'apt-1'
    board.appendChild(card)
    expect(blockNode(board, 'br-1')?.className).toBe('event block')
    expect(blockNode(board, 'cl-1')?.className).toBe('event cleanup')
    expect(blockNode(board, 'apt-1')).toBeNull()
    expect(blockNode(null, 'br-1')).toBeNull()
  })
})

/** ⚖ Liam flag 38 / BATCH-5 R1 · R2 · R3 · R6 (2026-08-21).
 *
 *  A leftover run the store's menu can only fill in several pieces used to draw
 *  a box PER PIECE — ¥3,860（30分）beside ¥2,690（20分）over 50 minutes nobody
 *  can book twice. Liam's ruling: the crumbs of one residue combine into ONE
 *  offer at the union length, priced by ONE call over the union; full 60/90
 *  sessions keep their own boxes because they are the actual product; and
 *  nothing shorter than the store's minimum sellable length is advertised at
 *  all. The colour then reports which of the two a box is. */
describe('the crumbs of one leftover combine into one offer', () => {
  // The fixture store's own menu shape: a 50-minute run has no single coin.
  const MENU = {
    services: [{ name: '20', dur: 20 }, { name: '30', dur: 30 }, { name: '60', dur: 60 }],
    newClientSessionMin: 90, protectedLabel: '新規', gapFillMinMin: 30, leadTimeMin: 0,
    mode: 'standard' as const,
  }
  const FRAME = { hi: 6600, lo: 4620, hqMin: 6600, hqMax: 7260 }
  const DEPTH = 9
  const run = (from: number, until: number, over: { minSellableMin?: number } = {}) =>
    gapLayerFor(
      [lane({ key: 'p-01', group: 'staff', window: { from, until }, untilLabel: '' }), lane({ key: 'bed-01', group: 'beds' })],
      {
        gridMin: 60, sessionMin: 60, gapFillMin: 30, gapFillDiscountPct: 10, nowMinute: null,
        locked: [], frame: FRAME, depth: DEPTH, guard: MENU, ...over,
      },
    )
  const staff = (o: ReturnType<typeof run>, k: 'packed' | 'scraps') => o[k].filter((c) => c.group === 'staff')
  const spans = (o: ReturnType<typeof run>, k: 'packed' | 'scraps') => staff(o, k).map((c) => [c.s, c.e])

  it('a 50-minute leftover is ONE 50分 offer, not 30分 beside 20分', () => {
    // 10:20–11:10. The greedy breaks 50 into 30 + 20; the board shows one box.
    const out = run(620, 670)
    expect(spans(out, 'packed')).toEqual([[620, 670]])
    expect(spans(out, 'scraps')).toEqual([])
    // Both rows — a staff row and a bed row — combined, or the bed layer would
    // still be advertising the pieces.
    expect(out.packed.map((c) => [c.group, c.s, c.e])).toEqual([['staff', 620, 670], ['beds', 620, 670]])
  })

  it('…priced by ONE call over the union, never by adding the rounded pieces up', () => {
    // Each piece is rounded to ¥10 on its own, so the sum charges the rounding
    // remainder twice. Here that is a real ¥10 the customer would be overcharged
    // for a run the shop is trying to salvage.
    const union = packedPrice(7000, 620, 670, FRAME, DEPTH)
    const sumOfPieces = packedPrice(7000, 620, 650, FRAME, DEPTH) + packedPrice(7000, 650, 670, FRAME, DEPTH)
    expect(union).toBe(5330)
    expect(sumOfPieces).toBe(5340)
    expect(staff(run(620, 670), 'packed')[0].price).toBe(union)
  })

  it('full sessions are the product and keep their own boxes', () => {
    // 15:50 + 120: packing fits two hours where the grid fits one, so two
    // 60-minute sessions land back to back. Adjacent, and NOT combined.
    expect(spans(run(950, 1070), 'packed')).toEqual([[950, 1010], [1010, 1070]])
  })

  it('a leftover under the minimum sellable length is not advertised at all', () => {
    // 20 minutes: a real full-price offer by the menu, and still not stock.
    expect(spans(run(720, 740), 'packed')).toEqual([[720, 740]])
    expect(spans(run(720, 740, { minSellableMin: 30 }), 'packed')).toEqual([])
    // …and the floor is applied AFTER the crumbs combine: run it before and the
    // 30-minute piece would survive alone while its 20-minute other half died.
    expect(spans(run(620, 670, { minSellableMin: 30 }), 'packed')).toEqual([[620, 670]])
    expect(spans(run(620, 670, { minSellableMin: 60 }), 'packed')).toEqual([])
  })

  it('R5: a first-class leftover the greedy jams on renders instead of crashing', () => {
    // 40 = 20 + 20 by the DP, null by the largest-first greedy. This is the
    // exact pair that threw inside deriveGapPackingCells and took the board
    // down on twelve legal landings, Liam's own 見本きり → p-05 16:00 included.
    expect(() => run(720, 760)).not.toThrow()
    expect(spans(run(720, 760), 'packed')).toEqual([[720, 760]])
    // Full price over the whole 40 — one union call, not the discounted layer.
    expect(staff(run(720, 760), 'packed')[0].price).toBe(packedPrice(7000, 720, 760, FRAME, DEPTH))
    expect(spans(run(720, 760), 'scraps')).toEqual([])
  })

  it('the screen paints the meaning: orange for a leftover, blue for a session', () => {
    const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
    const CSS = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/today.css'), 'utf8')
    // One answer drives both the combining and the colour.
    expect(isCrumbOffer({ s: 620, e: 670 }, 60)).toBe(true)
    expect(isCrumbOffer({ s: 950, e: 1010 }, 60)).toBe(false)
    expect(SRC).toContain("const crumbHere = packedHere && isCrumbOffer(c, props.guard.standardSessionMin)")
    expect(SRC).toContain("${crumbHere ? ' crumb' : ''}")
    expect(SRC).toContain('minSellableMin: props.guard.minSellableMin')
    // ⚖ R6 — NOTHING on this layer wears a border at rest. The ring is the
    // drag's own signal and dies with it, which is the whole point: batch-4
    // proved the resting ring and the emphasis were the same picture.
    expect(CSS).not.toMatch(/\.biz \.cell-packed \{[^}]*border:/)
    expect(CSS).toContain('.biz .cell-packed.crumb { background: rgba(232, 130, 60, .13); }')
    expect(CSS).toContain('.biz .cell-packed.crumb i { color: var(--orange-line); opacity: .95; }')
    expect(CSS).toContain('.biz .timeline.dragging-live .cell-packed.fits { box-shadow: inset 0 0 0 1.5px rgba(63, 91, 232, .55); }')
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
    // ⚖ BATCH-6 flag 43 — RENEGOTIATED to the open paren: `clearChipDrag` now
    // takes the ending event, because canon opens the click window on the same
    // three endings (:5640) and a teardown that cannot see the timestamp would
    // have to read a clock instead.
    for (const fn of ['function clearDrag()', 'function clearChipDrag(']) {
      const body = SRC.slice(SRC.indexOf(fn), SRC.indexOf(fn) + 800)
      expect(body).toContain('setDragLen(null)')
    }
    // …including the two lost-pointer self-heals, which route into those two.
    // ⚖ BATCH-6 flag 43 — RENEGOTIATED: both self-heals now hand the event on,
    // so the ending they are healing opens the click window like every other.
    expect(SRC).toContain('if (e.buttons === 0) { cancelDrag(e); return }')
    expect(SRC).toContain('if (e.buttons === 0) { clearChipDrag(e); return }')
  })

  it('the stylesheet emphasises only .fits, and calms a 詰め込み box that does not', () => {
    expect(CSS).toContain('.biz .timeline.dragging-live .cell-price.fits {')
    expect(CSS).toContain('.biz .timeline.dragging-live .cell-packed:not(.fits) { background: rgba(130, 151, 233, .07); }')
    // The old uniform-deepen selectors are gone: no window rule is gated on a
    // card being on the board any more (comments about them are not rules).
    expect(CSS.split('\n').filter((l) => !l.trimStart().startsWith('`') && /:has\(/.test(l) && /cell-(price|packed)/.test(l))).toEqual([])
    // ⚖ Liam flag 39 / BATCH-5 R6 (2026-08-21) SUPERSEDES the line that used to
    // stand here ("at rest 詰め込み keeps canon's border"). Batch-4 measured why:
    // canon's resting ring and this emphasis are the same hue, weight and 1.5px,
    // so a drop that freed a pocket grew boxes that read as emphasis stuck on
    // the board. The ring now belongs to the drag alone — nothing on the window
    // layer has a border at rest, and the emphasis is the box's own inset ring.
    expect(CSS).not.toMatch(/\.biz \.cell-packed \{[^}]*border:/)
    expect(CSS).toContain('.biz .timeline.dragging-live .cell-packed.fits { box-shadow: inset 0 0 0 1.5px rgba(63, 91, 232, .55); }')
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
    // ⚖ flag 57 — RENEGOTIATED: a third case joined, and only as a PAINT. The
    // pending-override ghost is `attemptLanes`, folded in here and nowhere
    // else; `moves` is untouched, so every judge of the board still sees the
    // board the operator has not changed.
    expect(SRC).toContain('const drawnLanes = live || blockLive ? committedLanes : (attemptLanes ?? boardLanes)')
    // WO-2d's is intact too: the window layers still read committedLanes.
    expect(SRC).toContain('sellLayerFor(committedLanes')
    expect(SRC).toContain('gapLayerFor(committedLanes')
    // Release / cancel / blur and the board self-heal → clearDrag.
    // Shelf up / cancel and the shelf self-heal → clearChipDrag.
    // (⚖ BATCH-6 flag 43 — RENEGOTIATED to the open paren; see the emphasis
    // teardown suite for why `clearChipDrag` gained its event.)
    for (const fn of ['function clearDrag()', 'function clearChipDrag(']) {
      const body = SRC.slice(SRC.indexOf(fn), SRC.indexOf(fn) + 800)
      expect(body).toContain('setProxy(null)')
    }
    // The dashed outline is now drawn for EVERY live drag, not only a lane
    // change — with the card in hand it is the board's only landing statement.
    // (⚖ flag 26 put the block's landing in front of the booking's in the same
    // ternary — the booking arm is unchanged and still refuses over the shelf.)
    // RENEGOTIATED (batch-10, ⚖ 61): …and it is NOT drawn when the pointer is
    // over no row at all — a dashed preview there was the board promising a
    // landing the release refuses.
    expect(SRC).toContain([
      '    : live && !live.overShelf && !live.offLane',
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

  // ⚖ BATCH-8 flag 51 — RENEGOTIATED: `freePartnerLane` is gone and this
  // placement asks `allocateBed`, the one bed search. The claims are the same
  // three (both busy refuses · first free wins · touching ends do not overlap);
  // the refusal now NAMES the busy rooms, which is the flag-44/51 grammar.
  it('a placement needs a room as well as a person, and says so when there is none', () => {
    const beds = [
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: [booking({ key: 'b1', caseId: 'apt-1', title: '見本 かえる' }, 900, 960)] }),
      lane({ key: 'bed-02', group: 'beds', label: 'ベッド2', items: [booking({ key: 'b2', caseId: 'apt-2', title: '見本 あかり' }, 890, 1000)] }),
    ]
    const staff = [lane({ key: 'p-01', group: 'staff' })]
    const solve = (start: number, end: number, lanes = [...staff, ...beds]) =>
      allocateBed(lanes, { id: null, currentBed: null, stores: null, vip: false, start, end, policy: POLICY })
    // 15:00–16:00: both beds are busy → the placement is refused outright, and
    // the sentence names the window and both rooms with who is in them.
    expect(solve(900, 960)).toEqual({
      laneKey: null,
      refusal: '15:00〜16:00はベッドに空きがありません。ベッド1が使用中（見本 かえる様）、ベッド2が使用中（見本 あかり様）',
      blockers: solve(900, 960).blockers,
    })
    // ⚖ 44 — and the occupants the sentence just named, handed out as values.
    expect(solve(900, 960).blockers.map((i) => i.title)).toEqual(['見本 かえる', '見本 あかり'])
    // 16:00–17:00: bed-02 is still busy until 16:40, bed-01 is free → first wins.
    expect(solve(960, 1020).laneKey).toBe('bed-01')
    // Touching ends do not overlap: a bed free FROM 16:00 can take 16:00.
    expect(solve(900, 960, [lane({ key: 'bed-09', group: 'beds', items: [booking({ key: 'b3', caseId: 'apt-3' }, 840, 900)] })]).laneKey).toBe('bed-09')
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
    // ⚖ BATCH-8 flag 51 — RENEGOTIATED: canon's 「この時間帯に空いているベッドが
    // いません」 named nothing the operator could act on. The no-room refusal is
    // now the allocator's 満室 sentence, one home for every landing path, pinned
    // above and in the BATCH-8 describe rather than as a source string here.
    expect(SRC).toContain('仮押さえ中の予約を確定するか、元に戻してから操作してください')
    expect(SRC).toContain('シフトロック中: このスタッフには新しい予約を置けません')
    // An armed board treats the empty slot as a landing, not as a form.
    // ⚖ BATCH-4 flag 31c: the landing now goes through `askGuard`, which places
    // it outright when the guard has nothing to say and consults first when it
    // does. Still a landing, never a form — that is what this line protects.
    // RENEGOTIATED (batch-9, ⚖ 50): `askGuard` takes the WHOLE landing now — the
    // one verdict's own question — rather than a lane and a start.
    expect(SRC).toContain('(s, override) => placeNextVisit(lane, s, override),')
    // `prefilled` → the hold bar, never the create modal (:6076–6083).
    const body = SRC.slice(SRC.indexOf('function placeNextVisit'), SRC.indexOf('function placeFromShelf'))
    expect(body).toContain('setPending({ id, origin:')
    expect(body).not.toContain('createRef.current?.showModal()')
    // The customer rides along; the length and category are canon's literals.
    expect(body).toContain('title: p.name')
    expect(body).toContain("ticketCat: '単発'")
    expect(body).toContain('props.guard.standardSessionMin')
    // Escape puts it down (:6942).
    // ⚖ BATCH-4 flag 34: Escape is a CHAIN now (canon :6941-6947) — the mode is
    // still one of its branches, and still refuses to fire under a dialog.
    expect(SRC).toContain("if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return")
    expect(SRC).toContain('if (placing) { setPlacing(null); return }')
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
    // ⚖ BATCH-6 flag 45 — RENEGOTIATED: both boards now carry the bed side's
    // memberships alongside the staff side's, and the live/committed split is
    // mirrored exactly (`liveBedMoves` beside `liveMoves`).
    expect(SRC).toContain('applyMoves(placedLanes, liveMoves, parked, addedHere, hours, liveBedMoves)')
    expect(SRC).toContain('applyMoves(placedLanes, moves, parked, addedHere, hours, bedMoves)')
    // The shelf lands through `added`, stamped with the BOARD on screen —
    // RENEGOTIATED (⚖ 46 forerunner): the day and the store together, from the
    // one `board` const, so a landing cannot record half of where it landed.
    // RENEGOTIATED AGAIN (cycle 7): batch-6's `dayOffset: props.dayOffset` pin
    // was the forerunner-era spelling of THIS assertion and no longer matches —
    // the stamp is `{ ...board, … }`. The day half is still pinned, inside
    // `board`, on the line below.
    //
    // The window is the FUNCTION, not a character count. Three slices in this
    // file read placeFromShelf; the other two already end at `const monthCells`
    // (the next declaration), and this one's magic 3200/3600 silently stopped
    // reaching the stamp as batches 6, 7 and 8 each grew the body — a pin that
    // passes because the window moved off the line is worse than no pin.
    const body = SRC.slice(SRC.indexOf('function placeFromShelf'), SRC.indexOf('const monthCells ='))
    expect(body).toContain('{ ...board, laneKey: staff.key, fromChip: chip,')
    expect(SRC).toContain('const board = useMemo(')
    expect(SRC).toContain('() => ({ dayOffset: props.dayOffset, store: props.store }),')
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
    // ⚖ BATCH-8 flag 51 — RENEGOTIATED: the three-way expression this pinned
    // (own bed → any free bed → refuse) IS the allocator's rule, so the chip
    // landing asks `solveBed` instead of keeping a second copy of it. The claim
    // is unchanged and sharper: a drop on a BED row is still the operator's
    // explicit room choice, and a staff-row drop still proves a room.
    expect(body).toContain("const staff = dropped?.group === 'beds' ? boardLanes.find((l) => l.key === chip.home.laneKey) : dropped")
    expect(body).toContain("dropped?.group === 'beds'\n        ? dropped")
    // RENEGOTIATED (Greptile #725 P1-A): `solveBed` leads with the STAFF lane it
    // is allocating for, so the allocator can refuse another store's rooms.
    // RENEGOTIATED (batch-9, ⚖ 50(d)): the solve carries whether this landing was
    // placed THROUGH a 置けない — an override has to reach the room too, or the
    // escalation is refused a second time behind a decision already made.
    expect(body).toContain("const key = solveBed(staff?.key ?? null, chip.id, home?.key ?? null, chip.item.category === 'vip', span)")
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
    // The board's provider wraps `children`. スタッフ・シフト added a second
    // provider INSIDE it (same reason, its own state), so the pin names the
    // whole chain instead of one line of JSX — and names it EXACTLY. A loose
    // `<BusinessSessionEdits>…{children}…</BusinessSessionEdits>` match is not
    // this claim: it passes with a remounting boundary (a Suspense, a keyed
    // wrapper, a `?day=`-dependent element) sitting between the provider and
    // the children, which is precisely the bug the provider exists to stop.
    // Whitespace is collapsed so re-indenting the file is not a failure.
    const OPEN = '<BusinessSessionEdits>'
    const CLOSE = '</BusinessSessionEdits>'
    const chain = LAYOUT.slice(LAYOUT.indexOf(OPEN), LAYOUT.lastIndexOf(CLOSE) + CLOSE.length)
    expect(chain.replace(/\s+/g, '')).toBe(
      `${OPEN}<ShiftsSessionEdits>{children}</ShiftsSessionEdits>${CLOSE}`,
    )
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
    expect(body).toContain('dayOffset: props.dayOffset,')
    expect(body).toContain('dayLabel: props.dayLabel,')
    // ⚖ flag 46 — and the STORE, on the same record for the same reason.
    expect(body).toContain('store: props.store,')
    expect(body).toContain('storeLabel: props.lensLabel,')
    // …and the printed line is still the printed line.
    expect(body).toContain('const text = parkChipText(item, hours, props.dayLabel)')
  })

  it('the × is answered by the recorded day, never by the board on screen', () => {
    const A = 'store-a'
    // Origin day on screen and the booking on it: straight home, canon's toast.
    expect(unparkOutcome({ dayOffset: 0, store: A }, 0, A, true)).toBe('here')
    // Origin day elsewhere: the restore is still right — the booking lives on
    // exactly one day — so it happens, and the caller names the day it went to.
    // What is on THIS board is irrelevant, which is the whole point.
    expect(unparkOutcome({ dayOffset: -2, store: A }, 3, A, true)).toBe('elsewhere')
    expect(unparkOutcome({ dayOffset: -2, store: A }, 3, A, false)).toBe('elsewhere')
    // Origin day on screen and the booking is NOT on it — the fixture world
    // re-based under the shelf (a board left open across JST midnight).
    expect(unparkOutcome({ dayOffset: 4, store: A }, 4, A, false)).toBe('gone')
    // ⚖ flag 46 — A FOREIGN STORE IS `elsewhere`, NEVER `gone`. The origin can
    // never be on this board, so the honest reading of a missing origin is "it
    // is on the other store's board", not "it has been lost". Same day, same
    // offset, different store: the × still restores and the toast names where.
    expect(unparkOutcome({ dayOffset: 0, store: A }, 0, 'store-b', false)).toBe('elsewhere')
    expect(unparkOutcome({ dayOffset: 0, store: A }, 0, 'store-b', true)).toBe('elsewhere')
    // …and the day rule still bites inside the chip's own store.
    expect(unparkOutcome({ dayOffset: 1, store: A }, 0, A, true)).toBe('elsewhere')
  })

  it('the soft failure keeps the chip: nothing is removed before the outcome is known', () => {
    const body = SRC.slice(SRC.indexOf('function unpark('), SRC.indexOf('function onChipPointerDown'))
    expect(body).toContain('const outcome = unparkOutcome(chip.home, props.dayOffset, props.store, originHere)')
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
    // ⚖ flag 46 — the off-board toast now has two shapes, and both are built
    // from the RECORD: the day alone inside the chip's own store, the store AND
    // the day when the operator is standing somewhere else entirely.
    expect(body).toContain('`${name}を${away}の元の枠に戻しました`')
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
 *  FORWARD SUPERSESSION — SETTLED AT CYCLE 7 (2026-08-22). Batch 7 landed and
 *  won the part of this family it actually rebuilt: `store` + `storeLabel`
 *  on ParkHome/PlacingIntent, the named `foreignStoreRefusal`, the one-door
 *  `refuse()`, and its own 4-argument `unparkOutcome`. The three tests that
 *  pinned the forerunner spelling of exactly those things (the chip refusal, the
 *  配置モード refusal, and the × from a foreign store) are GONE from this block —
 *  batch 7's own tests above pin the replacements.
 *
 *  WHAT DID NOT GET SUPERSEDED, and is therefore still pinned below: batch 7's
 *  ⚖ 46 never reached the `added` / `pending` family — its AddedRow and its
 *  PendingChange carry no store at all, and its `pendingOffDay` is day-only. So
 *  `sameStore` / `onShownBoard` remain the one predicate for those two, and the
 *  Greptile #737 P1 bug they fix (a staged edit evaluated against another
 *  store's board whenever the day happened to match) stays fixed. Same story for
 *  the board-stamped nextvisit id: batch 7 still builds `nextvisit-${seq}`, which
 *  is the collision slice C root-caused, so main's id is the one that survives.
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
    expect(PLACE_NEXT).toContain('const id = `nextvisit-${props.store ?? \'all\'}-${props.dayOffset}-${createSeq.current}`')
  })

  it('the 仮押さえ bar stops answering off-board, and its way back carries the right store', () => {
    // One predicate for the day case and the store case, so they cannot drift.
    expect(SRC).toContain('const pendingOffBoard = pending != null && !onShownBoard(pending, board)')
    expect(SRC).not.toContain('pendingOffDay')
    // The pin's link takes the pending's OWN store; this store's `?store=` would
    // land the operator on the right day of the wrong board.
    expect(SRC).toContain('dayHref(pending.dayOffset, pending.store)')
    expect(SRC).toContain('function dayHref(offset: number, store: string | null = props.store)')
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
    // ⚖ BATCH-6 flag 43 — RENEGOTIATED. The chip's own `suppressClickUntil
    // .current = e.timeStamp + 400` used to sit BELOW the `!ctx.laneKey` guard
    // in `onChipPointerUp`, so a chip carried across the board and released over
    // nothing opened no window at all. Canon's condition is MOVED, not landed
    // (:5640), and the write now lives in the one teardown all three of the
    // gesture's endings go through.
    const clearChip = SRC.slice(SRC.indexOf('function clearChipDrag('), SRC.indexOf('function onChipPointerMove('))
    expect(clearChip).toContain('if (e && ctx?.moved) openClickWindow(e.timeStamp,')
    const chipUp = SRC.slice(SRC.indexOf('function onChipPointerUp('), SRC.indexOf('// ── 配置モード'))
    expect(chipUp).toContain('clearChipDrag(e)')
    expect(chipUp).not.toContain('suppressClickUntil')
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
    expect(SRC).toContain('確定待ち: {sameStore(pending.store, props.store) ? pending.dayLabel :')
    expect(SRC).toContain('{pending.dayLabel}へ戻る')
    expect(CSS).toContain('.biz .hold-daypin {')
  })

  // ⚖ BATCH-8 flag 51 — RENEGOTIATED: same claim, one home further along. The
  // chip landing and 次回予約 now call the SAME function rather than the same
  // helper from two expressions.
  it('the chip’s free-bed test is the same one 次回予約 uses — one rule, one home', () => {
    const beds = [
      lane({ key: 'bed-01', group: 'beds', items: [booking({ key: 'b1', caseId: 'x' }, 900, 960)] }),
      lane({ key: 'bed-02', group: 'beds' }),
    ]
    const solve = (lanes: BoardLane[], currentBed: string | null = null) =>
      allocateBed(lanes, { id: null, currentBed, stores: null, vip: false, start: 900, end: 960, policy: POLICY })
    expect(solve([lane({ key: 'p-01', group: 'staff' }), ...beds]).laneKey).toBe('bed-02')
    // A parked card holds no ground, so its own bed reads free and comes back.
    expect(solve([lane({ key: 'p-01', group: 'staff' }), lane({ key: 'bed-01', group: 'beds' })], 'bed-01').laneKey).toBe('bed-01')
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
      // ⚖ PIN MIGRATED at E3b, WITH the decision — RULED BY LIAM 8/30
      // (SPEC-SELLING-ENGINE §13 Q3, 「one number」): the counter counts
      // everything purchasable online, not the 販売可能枠 layer alone, so the
      // sentence that teaches it had to move with the definition. Canon's own
      // `chipLabel` is untouched; what changed is which layers the board's own
      // counter composes (`onlineOffers`).
      ['オンライン販売中', 'いまReserveで販売中の枠数。販売可能枠・詰め込み・スキマ枠・新規用に確保をまとめた数です。押すと種類ごとの一覧（時間・担当・価格）が開き、行を押すとボード上の場所を示します。'],
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
    // The guard band explains the legend AND the placement strips under each
    // lane. ⚖ FIX-10 — pinned as what the strip actually RENDERS: the bare
    // literal used to pass off a comment, and every rendered spelling of the
    // name now carries `railDur`.
    // ⚖ LABELS RULING (Liam 8/30, 案C) — the band is unconditional now, because
    // the layer legend inside it is not about the guard, so its title follows the
    // store's dial: スキマガード where there is a guard to name, 価格箱 where the
    // band is carrying the three words alone.
    expect(SRC).toContain("data-guide-title={guardOn ? 'スキマガード' : '価格箱'}")
    expect(SRC).toContain('<span className="guard-rail-label">{railDur}分配置</span>')
    expect(SRC).toContain("'data-guide-title': `${railDur}分配置`,")
    expect(SRC).toContain('aria-label={`${rail.laneLabel}の${railDur}分配置ガイド`}')
    expect(SRC).toContain('`下の「${railDur}分配置」で、ドラッグ前に全開始を確認できます。`')
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

  it('⚖ 64 — a deleted block leaves the board, and the SAME pass frees its minutes', () => {
    const lanes = [lane({ key: 'p-01', group: 'staff', items: [block('br-1', 780, 810), block('br-2', 900, 930)] })]
    const out = applyBlockMoves(lanes, {}, HOURS, ['br-1'])
    expect(out[0].items.map((i) => i.key)).toEqual(['br-2'])
    // Everything that judges the board reads THESE lanes, so the freed minutes
    // are sellable and clash-free in the same frame — no second pass to forget.
    expect(laneSpans(out[0])).toEqual([{ start: 900, end: 930, isBreak: true }])
    expect(blockClash(out[0], 'br-9', place(780, 810, HOURS))).toBe(false)
    expect(blockClash(lanes[0], 'br-9', place(780, 810, HOURS))).toBe(true)
    // Undo is the ledger shrinking: nothing else has to be put back.
    expect(applyBlockMoves(lanes, {}, HOURS, [])).toBe(lanes)
    expect(applyBlockMoves(lanes, {}, HOURS)).toBe(lanes)
  })

  it('⚖ 64 — a delete and a move land in one pass, and a key nobody has is a no-op', () => {
    const lanes = [
      lane({ key: 'p-01', group: 'staff', items: [block('br-1', 780, 810), block('br-2', 900, 930)] }),
      lane({ key: 'bed-01', group: 'beds', items: [] }),
    ]
    const out = applyBlockMoves(lanes, { 'br-2': { laneKey: 'bed-01', ...place(840, 870, HOURS) } }, HOURS, ['br-1'])
    expect(out.find((l) => l.key === 'p-01')!.items).toHaveLength(0)
    expect(out.find((l) => l.key === 'bed-01')!.items.map((i) => i.key)).toEqual(['br-2'])
    // A stale key deletes nothing and clones nothing.
    expect(applyBlockMoves(lanes, {}, HOURS, ['nope'])[0].items).toHaveLength(2)
  })

  it('⚖ Q6 — a 清掃 opens and reads, but carries no 削除, and says why', () => {
    // The rule lives where the paint and the openability already do, so it is
    // provable without a renderer — the point of blockChrome having a header.
    const cleanup = blockChrome('cleanup')
    expect(cleanup.opens).toBe(true)
    expect(cleanup.notDeletable).toContain('直前の予約')
    // Every ordinary block IS deletable…
    for (const k of ['break', 'admin', 'closing'] as Array<BoardItem['kind']>) {
      expect(blockChrome(k).notDeletable).toBeNull()
      expect(blockChrome(k).opens).toBe(true)
    }
    // …and 勤務不可 never opened in the first place, so the question never
    // reaches it: its refusal is one level up, unchanged.
    expect(blockChrome('absence').opens).toBe(false)
    expect(blockChrome('absence').locked).toContain('シフト管理')
  })

  it('⚖ 64 + sweep rider (i) — ブロック情報 is honest: one live 削除, no dead 保存', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
    const dialog = src.slice(src.indexOf('ref={blockRef}'), src.indexOf('ref={closingRef}'))
    // The dead stub is gone from this footer entirely — the dialog has no
    // editable field, so 保存 could never have done anything.
    expect(dialog).not.toMatch(/<button[^>]*>保存</)
    expect(dialog).not.toContain('disabled title={HINT}')
    // 削除 is wired to the confirm strip, and the strip commits through deleteBlock.
    expect(dialog).toContain('onClick={() => setBlockDeleteAsk(true)}')
    expect(dialog).toContain('onClick={() => deleteBlock(blockInfo)}')
    // canon's light gate, not the 仮押さえ/確定 bar (:4245-4246 — a block is a
    // placeholder, not a booking).
    expect(dialog).toContain('この予定ブロックを削除します')
    expect(dialog).toContain('やめる')
    // …and the dialog holds a HANDLE on the block, which is what it never had.
    expect(src).toContain('setBlockInfo({ key: item.key, laneKey: lane.key, itemKind: item.kind')
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
    // ⚖ BATCH-6 flag 43 — RENEGOTIATED: the self-heal hands the event on, so the
    // ending it is healing can open canon's click window off the same clock.
    expect(begin).toContain('if (e.buttons === 0) { cancelBlockDrag(e); return }')
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

/** ═══ BATCH-4 — Liam's flags 31 · 32 · 33 · 34 · 35 (8/21) ═════════════════
 *
 *  One sentence for the whole round: the board asked the operator several
 *  questions at once, and the one it asked loudest was about a move it should
 *  never have interrupted. The consult goes back to NEW placements, where its
 *  buttons can do what they say; the move's own assessment becomes a row on the
 *  confirm surface; and that confirm surface comes to the card instead of
 *  waiting at the bottom of the page. */
describe('the confirm comes to the card, and the consult goes back to the placements', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
  const CSS = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/today.css'), 'utf8')
  const CUSTOMERS_CSS = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/customers/customers.css'), 'utf8')
  const finishDrag = SRC.slice(SRC.indexOf('function finishDrag('), SRC.indexOf('function cancelDrag('))

  // ── flag 31a ─────────────────────────────────────────────────────────────
  it('a MOVE never opens the consult — canon fires it from a teaching card only', () => {
    expect(finishDrag).not.toContain('askGuard(')
    // …and the drop still stages, which is the part canon's real drop DOES do.
    // ⚖ BATCH-6 flag 45 — RENEGOTIATED: the landing is now the PAIR's, resolved
    // by `sidesAt`, and a pending change's origin is carried on both sides.
    // ⚖ BATCH-8 flag 51 — RENEGOTIATED AGAIN: the pair is resolved into a named
    // `sides` first, because a STAFF-side landing re-solves the room before it
    // stages. Both halves are pinned: the sides still come from `sidesAt`, and
    // the origin is still the first gesture's on both sides.
    expect(finishDrag).toContain('const sides = sidesAt(ctx.home, ctx.group, targetLane)')
    // ⚖ BATCH-9 flag 50 — RENEGOTIATED AGAIN: the staging moved into `land`,
    // which is the ONE thing both a clean release and a 「注意して配置」
    // escalation run, and it carries the override sentence. `askGuard` is still
    // absent from this function (pinned above) — a MOVE still never consults.
    expect(finishDrag).toContain('stage(\n        ctx.id,\n        on,\n        at,\n        pending?.id === ctx.id ? { staff: pending.origin, bed: pending.bedOrigin ?? null } : from,\n        override,\n      )')
  })

  // ── flag 33's root cause, found in the browser ────────────────────────────
  it('the release opens canon’s click window BEFORE any branch, so a drop is never a create', () => {
    // canon :4563. Without it the release lands on empty TRACK — the card is
    // still drawn at its origin — and the synthetic click reached the track's
    // own handler: the drop opened 新規予約を作成 on top of everything else.
    // ⚖ BATCH-6 flag 43 — RENEGOTIATED: the write goes through the one helper
    // now, because the window is only half of canon's defence — the interceptor
    // at :4633-4645 needs `suppressClickSource`, and one call sets both.
    expect(finishDrag).toContain('openClickWindow(upAt, ctx.nodes[0] ?? null)')
    // Above every branch: the two refusals and the park return early.
    expect(finishDrag.indexOf('openClickWindow(upAt, ctx.nodes[0] ?? null)'))
      .toBeLessThan(finishDrag.indexOf('isOverShelf(shelfRef.current, clientY)'))
    expect(SRC).toContain('finishDrag(e.clientX, e.clientY, e.timeStamp)')
  })

  // ── flag 31b ─────────────────────────────────────────────────────────────
  it('the guard’s move-assessment becomes a CHECK ROW, and never a gate', () => {
    expect(SRC).toContain('const pendingGuardRow = useMemo(')
    expect(SRC).toContain('guardCheckRow(verdictAt(at.laneKey, start, minuteOf(at.x + at.w, hours) - start, pending.id))')
    expect(SRC).toContain('{holdPop.guardRow && <span className={`ck ${holdPop.guardRow.tone}`}>{holdPop.guardRow.label}</span>}')
    // The gate is still `computeChecks` alone — the guard row is not in it.
    // RENEGOTIATED (batch-9, ⚖ 50(d)): `overrideCaption` IS `confirmCaption` over
    // the rows still blocking, so this claim is unchanged for every landing that
    // was not explicitly escalated (`override` null → the same call, same array).
    expect(SRC).toContain(': overrideCaption(pendingChecks, pending?.override ?? null)')
    const confirm = SRC.slice(SRC.indexOf('function confirmPending()'), SRC.indexOf('// ── card drag'))
    expect(confirm).not.toContain('guardRow')
    expect(confirm).not.toContain('verdictAt')
    // canon's △ for the row, beside the ✓ and × of the same one decision.
    expect(CSS).toContain('.biz .holdbar-checks .ck.warn::before { content: "△";')
  })

  // ⚖ BATCH-8 flag 52 — RENEGOTIATED: the row that used to come back `bad` for a
  // refused verdict comes back `warn`. It is the same row saying the same
  // sentence; only the MARK changed, and it changed because × means "this line
  // blocks" and this line cannot (31b, pinned in the test above: the gate is
  // `computeChecks` alone). Liam's screenshot — a red × above a live 確定 — is
  // the case this kills.
  it('guardCheckRow: safe says nothing, and an advisory is ALWAYS △, never ×', () => {
    const cell = (over: Partial<RailCell>): RailCell => ({
      start: 990, state: 'safe', label: '', sentence: '', reason: null, alternatives: [], alternativeKind: null, ackAllowed: true, ...over,
    })
    expect(guardCheckRow(null)).toBeNull()
    expect(guardCheckRow(cell({ state: 'safe', sentence: '新規90分の空きを守れます' }))).toBeNull()
    // ⚖ GAP-6 (R3, 2026-08-25) — THE SECOND CLAUSE COMES BACK. This used to
    // assert the truncated row (`sentence.split('。')[0]`), which threw away the
    // engine's own answer to "then where?" — the operator was shown a cost and
    // no way out of it, on the surface they confirm from. The 「・損を減らす」
    // aside still comes off: it is a CHIP LABEL glued inside the loss figure's
    // parentheses, and the clause that follows says it in words.
    expect(guardCheckRow(cell({
      state: 'degraded',
      sentence: '新規90分の空き2→1（1枠減・損を減らす）。15:45はこの区間で損が最少の開始です',
    }))).toEqual({ label: '新規90分の空き2→1（1枠減）。15:45はこの区間で損が最少の開始です', tone: 'warn' })
    // …and a one-clause sentence is unchanged — every blocked sentence is one.
    expect(guardCheckRow(cell({ state: 'blocked', sentence: 'この開始ではベッドを60分確保できません' })))
      .toEqual({ label: 'この開始ではベッドを60分確保できません', tone: 'warn' })
    // Liam's exact ×-over-an-enabled-確定 line, now wearing △.
    expect(guardCheckRow(cell({ state: 'blocked', sentence: 'ここに置くと新規（90分）が入らなくなります' })))
      .toEqual({ label: 'ここに置くと新規（90分）が入らなくなります', tone: 'warn' })
    // Neither state can produce the blocking mark, whatever the engine thought.
    for (const state of ['degraded', 'blocked'] as const) {
      expect(guardCheckRow(cell({ state, sentence: 'なにか。あと' }))).toEqual({ label: 'なにか。あと', tone: 'warn' })
    }
  })

  // ── flag 31c ─────────────────────────────────────────────────────────────
  it('the consult fires from the three NEW-placement flows, and its buttons perform the placement', () => {
    // One function asks AND places, so no caller can carry half the pair.
    // RENEGOTIATED (batch-9, ⚖ 50): it asks the ONE verdict rather than the guard
    // alone — the seam that let the strip advertise a start the drop then refused
    // (flag 54) — and 'clean' is what places outright.
    expect(SRC).toContain('const v = verdictAtLanding(ask)')
    expect(SRC).toContain("if (v.kind === 'clean') {")
    expect(SRC).toContain('      run(start, null)')
    // 1 · empty track → the create dialog, seeded at the start the popup names
    expect(SRC).toContain('(s) => openCreateAt({ staffId: lane.key, start: s }),')
    // 2 · 配置モード (次回予約)
    expect(SRC).toContain('(s, override) => placeNextVisit(lane, s, override),')
    // 3 · the shelf chip
    expect(SRC).toContain('      chipAsk(chip, laneKey, span),')
    // この開始に配置 PERFORMS it — it used to be a button that only closed itself.
    expect(SRC).toContain('                  setAdvice(null)\n                  advice.place(advice.start)')
    expect(SRC).toContain('                    setAdvice(null)\n                    advice.place(start)')
    // やめる just closes: nothing has been placed yet on this path.
    expect(SRC).toContain('<button className="btn" type="button" onClick={() => setAdvice(null)}>やめる</button>')
  })

  // ── flag 32 ──────────────────────────────────────────────────────────────
  it('every native dialog centres again — the preflight reset took the UA’s margin', () => {
    // Tailwind's preflight sets `margin: 0` on EVERY element, <dialog> included,
    // which overrides the UA's `dialog:modal { margin: auto }`, so every
    // stylesheet that dresses a dialog in this territory has to put it back.
    //
    // DISCOVERED, not listed. This pin used to name the two stylesheets it knew
    // about; 予約一覧 then shipped a third with the same selector and no margin,
    // and the pin had nothing to say (Greptile P2 on #727). Walking the screens
    // means the next one cannot ship un-centred either.
    //
    // ponytail: this proves the PROPERTY is there, not that the dialog lands in
    // the middle of the viewport — jsdom does no layout and the fence keeps a
    // renderer out of this folder, so actual centring is a browser-visual check.
    // What CSS text can honestly pin is pinned: the declaration, inside the
    // dialog rule, in every stylesheet that dresses one.
    const screens = join(process.cwd(), 'src/app/[locale]/(business)/business')
    const sheets = readdirSync(screens, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) =>
        readdirSync(join(screens, d.name))
          .filter((f) => f.endsWith('.css'))
          .map((f) => [`${d.name}/${f}`, readFileSync(join(screens, d.name, f), 'utf8')] as const),
      )
    // The scan is only worth anything if it is actually finding the screens.
    expect(sheets.length).toBeGreaterThanOrEqual(3)

    // ⚖ flag 69 — the page scope may sit between `.biz` and `dialog` now
    // (`.biz .page-customers dialog`). The pin still DISCOVERS its dressers by
    // walking; it just knows the scoped spelling.
    const DRESSER = /^\.biz(?:[ -])(?:\.page-[\w-]+ )?dialog\s*\{/m
    const dressers = sheets.filter(([, css]) => DRESSER.test(css))
    expect(dressers.map(([f]) => f).sort()).toEqual([
      'customers/customers.css',
      'reservations/reservations.css',
      'today/today.css',
    ])
    for (const [file, raw] of dressers) {
      // The margin must be inside the dialog rule itself, not merely somewhere
      // in the file — `.pill { margin-left: auto }` must not answer for it.
      // Comments are stripped FIRST: all three of these rules explain the fix by
      // quoting `dialog:modal { margin: auto }`, and that brace would both end
      // the slice early and let the prose stand in for the property.
      const css = raw.replace(/\/\*[\s\S]*?\*\//g, '')
      const body = css.slice(css.search(DRESSER))
      expect(`${file}: ${body.slice(0, body.indexOf('}'))}`).toContain('margin: auto;')
    }
  })

  // ── flag 33 ──────────────────────────────────────────────────────────────
  it('at most ONE transient surface is alive — canon’s dismissal contract, all three parts', () => {
    // outside click, behind canon's 80ms window (:7082-7084)
    expect(SRC).toContain('if (e.timeStamp - adviceOpenedAt.current < 80) return')
    expect(SRC).toContain('if (clickClosesPopover(advicePopRef.current, e.target)) setAdvice(null)')
    // singleton: a new board gesture, and the shelf chip's own press
    expect(SRC).toContain('onPointerDownCapture={closeAdvice}')
    const chipDown = SRC.slice(SRC.indexOf('function onChipPointerDown('), SRC.indexOf('function clearChipDrag('))
    expect(chipDown).toContain('closeAdvice()')
    // the native <dialog> renders in the TOP LAYER, so it is opened through one
    // function that puts the popup down first
    expect(SRC).toContain('const openCreateAt = useCallback((at: { staffId: string; start: number } | null) => {\n    setAdvice(null)')
    expect(SRC).not.toMatch(/setSeed\(\{ staffId: lane\.key/)
  })

  it('Escape puts down ONE surface per press, innermost first, and reverts last', () => {
    const esc = SRC.slice(SRC.indexOf('const onKey = (e: KeyboardEvent) => {'), SRC.indexOf("document.addEventListener('keydown', onKey)"))
    expect(esc).toContain("if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return")
    expect(esc.indexOf('setAdvice(null)')).toBeLessThan(esc.indexOf("setPop('')"))
    expect(esc.indexOf("setPop('')")).toBeLessThan(esc.indexOf('setPlacing(null)'))
    // canon R11-6 (:6946): last branch, and never during a drag.
    expect(esc).toContain('if (pending && !dragRef.current) revertPending()')
  })

  // ── flag 34 ──────────────────────────────────────────────────────────────
  it('the full-width hold bar is gone, and the confirm hangs under the card', () => {
    expect(SRC).not.toContain('className="holdbar"')
    expect(CSS).not.toContain('.biz .holdbar {')
    expect(CSS).not.toContain('.biz .holdbar-actions')
    // The check strip keeps its name: the create dialog's ticket renders the
    // same marks through `.holdbar-checks.cc-ticket-checks`.
    expect(CSS).toContain('.biz .holdbar-checks {')
    expect(SRC).toContain('className={`hold-pop${holdPinned ? \' pinned\' : \'\'}`}')
    expect(SRC).toContain('aria-label="仮押さえの確認"')
    // ⚖ flag 48 — same call, same laws, plus the rail chip it prefers to clear.
    expect(SRC).toContain('const at = box && anchorOnScreen(box, viewport) ? holdPopAnchor(box, self.width, self.height, viewport, 8, 8, railBox) : null')
    // …and the fallback pill, which is what actually retires the scrolling bar
    expect(SRC).toContain('      if (!at) {\n        setHoldPinned(true)')
    expect(CSS).toContain('.biz .hold-pop.pinned { left: 50%; bottom: 18px; top: auto; transform: translateX(-50%); }')
    // ONE width in both states: the surface never resizes as it moves.
    // ⚖ flag 40 widened it — see the typography test below for why.
    expect(CSS).toContain('  width: min(92vw, 380px);')
    // Re-anchoring is COARSE — never per frame (WO-2d's law).
    expect(SRC).toContain('const coarse = () => { clearTimeout(t); t = setTimeout(pin, 120) }')
    expect(SRC).toContain("window.addEventListener('scroll', coarse, true)")
    // The effect keys on the ID, not the object it is rebuilt in every render.
    // RENEGOTIATED (Greptile #738 P1, re-renegotiated cycle 7): the dep array
    // carries BOTH the two gates that can unmount the anchor card and batch-7's
    // `holdRailSel` (⚖ 48 reads it inside `pin`). Neither half supersedes the
    // other — see the collapse test below.
    // RENEGOTIATED AGAIN (batch-10b, ⚖ 71 follow-up): `holdPopMounted` joins in
    // front. Same intent, one member wider — the ID cannot speak for an arm
    // whose anchor is `null` by design. Proof in the ⚖ 71 describe.
    expect(SRC).toContain('}, [holdPopMounted, holdAnchorId, holdPinned, collapsed, view, holdRailSel, moves, props.dayOffset])')
    // A standing 仮押さえ this session did not stage is ALWAYS the pill: anchored,
    // it sat on the board indefinitely and swallowed the pointerdown of a card in
    // the lane below (measured, 2026-08-21).
    expect(SRC).toContain('          // The day\'s own standing 仮押さえ (the incident\'s) — the pill, always.\n          anchorId: null,')
  })

  /** Greptile #738 P1 — COLLAPSING THE GROUP UNMOUNTS THE ANCHOR.
   *
   *  `renderLane` returns null for a collapsed group, so the staged
   *  card's node leaves the DOM while the 仮押さえ is still live. The positioning
   *  effect's anchor-missing branch already answers this correctly — but it
   *  never ran, because neither gate that can unmount a card was in its dep
   *  array. The popover stayed at the coordinates of a card that no longer
   *  existed, anchored to nothing.
   *
   *  The fence forbids a DOM renderer in this folder, so the TRIGGER is pinned
   *  by source (as all wiring in this suite is) and the ROAD it takes is driven
   *  on real jsdom nodes below. */
  it('an anchor that leaves the DOM — collapse included — falls back to the pill', () => {
    // BOTH gates `renderLane` returns null on, so a view switch cannot silently
    // reintroduce the same bug the collapse did.
    // RENEGOTIATED (cycle 7): batch-7 adds `holdRailSel` to this array for ⚖ 48's
    // avoid-rect. The two unmount gates this test exists for are still both here.
    // RENEGOTIATED (batch-10b): `holdPopMounted` leads. Both gates still here.
    expect(SRC).toContain('}, [holdPopMounted, holdAnchorId, holdPinned, collapsed, view, holdRailSel, moves, props.dayOffset])')
    // ⚖ PIN MIGRATED at the FIX ROUND, WITH the decision (F9, blind-final
    // L2#10): `renderLane`'s two early gates are ONE named predicate now, because
    // the 確保 chip's tour registration has to ask the same question the renderer
    // does — picked out of the mask, it could name a lane `view` or `collapsed`
    // had filtered out, and the 8/23 law's entry then existed on no DOM node.
    // Both gates are still exactly here, still greppable, still enumerable for
    // the dep array above.
    expect(SRC).toContain("(view === 'both' || view === lane.group) && !collapsed.includes(lane.group)")
    expect(SRC).toContain('if (!laneRendered(lane)) return null')
    // The rule is about the NODE, not about any one reason it went away.
    expect(SRC).toContain('const card = anchorId ? cardNodes(boardRef.current, anchorId)[0] : null')
    expect(SRC).toContain('      if (!at) {\n        setHoldPinned(true)')

    // …and the road really is reachable: a collapsed group takes its whole lane
    // out, so the anchor lookup the effect performs comes back empty.
    const board = document.createElement('div')
    board.innerHTML =
      '<div class="lane" data-group="staff"><div class="event" data-book="bk-1"></div></div>'
    expect(cardNodes(board, 'bk-1')).toHaveLength(1)
    const anchored = cardNodes(board, 'bk-1')[0]
    rect(anchored, { left: 400, top: 300, width: 110, height: 67 })
    const vp = { width: 1440, height: 1100 }
    expect(anchorOnScreen(anchored.getBoundingClientRect(), vp)).toBe(true)
    expect(holdPopAnchor(anchored.getBoundingClientRect(), 340, 120, vp)).not.toBeNull()

    // collapse: the lane is gone, and with it the only node the popover can hang on
    board.querySelector('.lane[data-group="staff"]')!.remove()
    expect(cardNodes(board, 'bk-1')).toHaveLength(0)
    // `card` null → `box` undefined → `at` null → the pill. Same branch an
    // off-screen or cross-store anchor takes.
    expect(cardNodes(board, 'bk-1')[0]?.getBoundingClientRect()).toBeUndefined()
  })

  // ── flag 40 — nothing in a popup is allowed to be unreadable ─────────────
  it('the confirm surface reads whole: the chip on one line, the sentence wrapped', () => {
    // 仮押さえ was breaking as 仮押さ / え. Fixed at the chip, not at this one
    // surface: every 状態 chip on the screen is a glance-label and none of them
    // survives a break.
    expect(CSS).toContain('font-size: 12px; font-weight: 700; white-space: nowrap; }')
    // The head WRAPS. The ellipsis was eating the bed name off the end of the
    // sentence the surface exists to show.
    expect(CSS).not.toContain('.biz .hp-head strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }')
    expect(CSS).toContain('.biz .hp-head strong { min-width: 0; line-height: 1.5; overflow-wrap: anywhere; }')
    expect(CSS).toContain('.biz .hp-head { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; }')
    // And the width that holds the fixture's longest line in two of them — the
    // SAME width anchored and pinned, which is the no-resize half of the law.
    expect(CSS).toContain('  width: min(92vw, 380px);')
    expect(CSS).toContain('.biz .hold-pop.pinned { left: 50%; bottom: 18px; top: auto; transform: translateX(-50%); }')
    expect(CSS.match(/\.biz \.hold-pop(\.pinned)? \{[^}]*width:/g) ?? []).toHaveLength(1)
  })

  // ── flag 41 — a confirm surface exists only while its decision is open ────
  it('an answered 仮押さえ is gone for the session, and a day flip cannot revive it', () => {
    // The surface used to hang off the PROP being there, so 確定 turned it
    // 確定済み and left it standing on every board change.
    expect(SRC).toContain('    : props.hold && holdAnswer === null')
    // The screen-local flag is gone entirely — it would have died on every day
    // flip, and a surface that reopens on a flip is the bug wearing a hat.
    expect(SRC).not.toContain('setHoldConfirmed')
    expect(SRC).not.toContain('useState(false)\n  const [holdConfirmed')
    // Both answers close it, and WHICH one is what the card's colour reads.
    expect(SRC).toContain("              setHoldAnswer('confirmed')")
    expect(SRC).toContain("revert: { enabled: true, run: () => { setHoldAnswer('reverted'); show('仮押さえのままにしました') } },")
    expect(SRC).toContain("const holdConfirmed = holdAnswer === 'confirmed'")
    expect(SRC).toContain('        : holdConfirmed && item.state === \'hold\'')
    // Confirming a STAGED change answers the incident's hold too — otherwise
    // the standing surface steps straight into the space this one just left,
    // which is exactly what Liam saw.
    const confirm = SRC.slice(SRC.indexOf('function confirmPending'), SRC.indexOf('function confirmPending') + 1200)
    expect(confirm).toContain('setPending(null)')
    expect(confirm).toContain("setHoldAnswer('confirmed')")
    // RENEGOTIATED BY ⚖ LIAM FLAG 56 (2026-08-22). This used to read "reverting
    // a staged change does NOT answer it: that decision is still open, so its
    // surface is allowed back" — and "allowed back" turned out to mean IN THE
    // SAME BEAT: 元に戻す cleared `pending`, the ternary fell through to the
    // day's standing 仮押さえ, and a second 「この内容で確定」 appeared unasked.
    // His report, verbatim: 「sometimes it asks me この内容で確定 box pops up
    // like twice in a row」. ⚖ 41's rule applied symmetrically is the fix: an
    // answered surface is a dismissed surface, whichever answer it was, and
    // 'reverted' is the same value the day-hold's own 元に戻す writes. Nothing
    // is agreed to — the incident card is untouched on this path.
    const revert = SRC.slice(SRC.indexOf('function revertPending'), SRC.indexOf('function confirmPending'))
    expect(revert).toContain('setPending(null)')
    expect(revert).toContain("setHoldAnswer('reverted')")
    expect(revert).not.toContain("setHoldAnswer('confirmed')")
    expect(revert).not.toContain('setResolved(')
    // The flag lives in the session provider, above the screen's remount.
    const PROVIDER = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/BusinessSessionEdits.tsx'), 'utf8')
    expect(PROVIDER).toContain("export type HoldAnswer = 'confirmed' | 'reverted' | null")
    expect(PROVIDER).toContain('const [holdAnswer, setHoldAnswer] = useState<HoldAnswer>(null)')
    expect(PROVIDER).toContain('        holdAnswer, setHoldAnswer,')
  })

  it('anchorOnScreen: a card half in view is still a card the operator can see', () => {
    const vp = { width: 1440, height: 1100 }
    const at = (top: number, left = 400) => ({ top, bottom: top + 67, left, right: left + 110 })
    expect(anchorOnScreen(at(500), vp)).toBe(true)
    expect(anchorOnScreen(at(-40), vp)).toBe(true) // half above the fold
    expect(anchorOnScreen(at(-67), vp)).toBe(false) // exactly gone
    expect(anchorOnScreen(at(1100), vp)).toBe(false) // exactly below
    expect(anchorOnScreen(at(1090), vp)).toBe(true)
    expect(anchorOnScreen(at(500, 1440), vp)).toBe(false) // scrolled off to the right
    expect(anchorOnScreen(at(500, -110), vp)).toBe(false)
  })

  it('holdPopAnchor: under the card, above it when it must be, and NEVER over it', () => {
    const vp = { width: 1440, height: 900 }
    const overlaps = (a: { left: number; top: number }, w: number, h: number, c: { top: number; bottom: number; left: number; right: number }) =>
      a.top < c.bottom && a.top + h > c.top && a.left < c.right && a.left + w > c.left
    // Room below → under it, centred on the card.
    const card = { top: 400, bottom: 467, left: 600, right: 710 }
    expect(holdPopAnchor(card, 340, 200, vp)).toEqual({ left: 485, top: 475 })
    // No room below → above it, and still clear of the card.
    const low = { top: 700, bottom: 767, left: 600, right: 710 }
    expect(holdPopAnchor(low, 340, 200, vp)).toEqual({ left: 485, top: 492 })
    expect(overlaps(holdPopAnchor(low, 340, 200, vp)!, 340, 200, low)).toBe(false)
    // Last column: the horizontal clamp keeps it on screen; that axis slides
    // along the card, it cannot hide it.
    const right = { top: 400, bottom: 467, left: 1380, right: 1430 }
    expect(holdPopAnchor(right, 340, 200, vp)).toEqual({ left: 1092, top: 475 })
    // ⚖ Liam 8/21 — neither side can hold it whole → NO position. A vertical
    // clamp here would slide the surface back over its own anchor, and the
    // operator has to be able to see what they moved. `null` = the pill.
    const tall = { top: 300, bottom: 700, left: 600, right: 710 }
    expect(holdPopAnchor(tall, 340, 400, vp)).toBeNull()
    expect(holdPopAnchor({ top: 40, bottom: 800, left: 600, right: 710 }, 340, 200, vp)).toBeNull()
  })

  // ── flag 35 ──────────────────────────────────────────────────────────────
  it('pinInViewport is THE clamp, on all four edges, and both surfaces use it', () => {
    const vp = { width: 1440, height: 900 }
    const size = { width: 340, height: 200 }
    expect(pinInViewport({ left: 500, top: 300 }, size, vp)).toEqual({ left: 500, top: 300 })
    expect(pinInViewport({ left: 1430, top: 300 }, size, vp)).toEqual({ left: 1092, top: 300 }) // right
    expect(pinInViewport({ left: -50, top: 300 }, size, vp)).toEqual({ left: 8, top: 300 }) // left
    expect(pinInViewport({ left: 500, top: 890 }, size, vp)).toEqual({ left: 500, top: 692 }) // bottom
    expect(pinInViewport({ left: 500, top: -20 }, size, vp)).toEqual({ left: 500, top: 8 }) // top
    // FLOOR, not round: a fractional width rounded up lands a hair past the margin.
    expect(pinInViewport({ left: 9999, top: 0 }, { width: 297.33, height: 124 }, vp).left).toBe(1134)
    // A surface wider than the viewport still gets its top-left corner on screen.
    expect(pinInViewport({ left: 400, top: 300 }, { width: 2000, height: 200 }, vp)).toEqual({ left: 8, top: 300 })
    // Both fixed surfaces go through it — the consult directly, the confirm
    // through holdPopAnchor — and the hard-coded 1600 is gone.
    expect(SRC).toContain('const at = pinInViewport(\n        { left: advice.anchor.x, top: advice.anchor.y },')
    expect(SRC).not.toContain('Math.min(advice.x, 1600)')
    // Measured from the RECT: offsetWidth is integer-rounded, and a surface
    // measured 0.33px narrow lands that far past the margin when it is pinned.
    expect(SRC).toContain('const size = el.getBoundingClientRect()')
  })

  // ── flag 37 ──────────────────────────────────────────────────────────────
  it('every teardown path clears the emphasis — nothing stays lit after a release', () => {
    // The length-matched emphasis answers "where does THIS card fit while it is
    // in my hand". A board still lit after the hand is empty is answering a
    // question nobody asked (Liam, 8/21). One teardown per pipeline, and every
    // exit goes through it — release, refusal, cancel, blur and both lost-pointer
    // self-heals.
    const clearDrag = SRC.slice(SRC.indexOf('function clearDrag()'), SRC.indexOf('// The listeners outlive a render'))
    for (const line of ['setLive(null)', 'setDragLen(null)', 'setProxy(null)']) expect(clearDrag).toContain(line)
    // (⚖ BATCH-6 flag 43 — RENEGOTIATED to the open paren, same reason as above.)
    const clearChip = SRC.slice(SRC.indexOf('function clearChipDrag('), SRC.indexOf('function onChipPointerMove('))
    for (const line of ['setChipTarget(null)', 'setDragLen(null)', 'setProxy(null)']) expect(clearChip).toContain(line)
    // Every exit from a card drag reaches `clearDrag()`: the press that never
    // travelled, the shelf drop, the release outside every lane, and the one
    // above the landing branch that covers both the no-op and the staged move.
    expect(finishDrag.match(/clearDrag\(\)/g)?.length).toBe(4)
    expect(SRC).toContain('const onCancel = (e: PointerEvent) => {')
    expect(SRC).toContain("window.addEventListener('blur', cancelDrag)")
    // (⚖ BATCH-6 flag 43 — RENEGOTIATED: both self-heals hand their event on.)
    expect(SRC).toContain('if (e.buttons === 0) { cancelDrag(e); return }')
    expect(SRC).toContain('if (e.buttons === 0) { clearChipDrag(e); return }')
    // …and the reveal itself is the same one gate it was.
    expect(SRC).toContain("dragLen != null || live || blockLive ? 'dragging-live' : ''")
  })

  // ── flag 36 — the layer already answers a staged move; this pins it ───────
  it('a staged 仮押さえ is real occupancy: the window layer re-derives from `moves`', () => {
    // canon's own words at :4792 — 「仮押さえも実配置と同じ occupancy — レイヤーは
    // 同じ再計算で応答する（置けばそのセルは消え、戻せば戻る）」 — and it calls
    // renderPublicLayer() from renderHoldBar (:4789), from 確定 (:5515) and from
    // 元に戻す (:5527). Ours reads the staged `moves`, so the same is true.
    // (⚖ BATCH-6 flag 45 — RENEGOTIATED: the bed side's committed memberships
    // ride the same board, and the same "committed, never live" rule.)
    expect(SRC).toContain('const committedLanes = useMemo(\n    () => applyMoves(placedLanes, moves, parked, addedHere, hours, bedMoves),')
    // What is frozen for the length of a GESTURE is `liveMoves`, and only that.
    // ⚖ flag 57 — RENEGOTIATED: a third case joined, and only as a PAINT. The
    // pending-override ghost is `attemptLanes`, folded in here and nowhere
    // else; `moves` is untouched, so every judge of the board still sees the
    // board the operator has not changed.
    expect(SRC).toContain('const drawnLanes = live || blockLive ? committedLanes : (attemptLanes ?? boardLanes)')
    // ⚖ R4 (2026-08-25) — THE SLICE TURNED ROUND, AND THE CLAIM DID NOT. The gap
    // layer now computes FIRST so its finished cells can be the promises the
    // sell layer reconciles against (one advertised offer per bed), so `sell`
    // is the tail of the file from its own memo rather than the span between
    // the two. Both halves of the original assertion are unchanged and both
    // still bind: the sell memo reads `committedLanes`, and nothing in it
    // reaches for `boardLanes`. `gap` is pinned the same way, which it was not
    // before — the reversal is what made its board worth stating out loud.
    const gapMemo = SRC.slice(SRC.indexOf('const gap = useMemo('), SRC.indexOf('const gapClaims = useMemo('))
    expect(gapMemo).toContain('gapLayerFor(committedLanes, {')
    expect(gapMemo).not.toContain('boardLanes')
    // ⚖ flag 44 — the memo hands back the layer AND ⚖ 75(i)'s dropped offers.
    // Both halves this pin exists for are untouched: the ORDER, and the board
    // the sell layer reads (`committedLanes`, never `boardLanes`).
    expect(SRC.indexOf('const gap = useMemo(')).toBeLessThan(SRC.indexOf('const { sell, sellDrops } = useMemo('))
    const sell = SRC.slice(SRC.indexOf('const { sell, sellDrops } = useMemo('), SRC.indexOf('const guardOn ='))
    expect(sell).toContain('sellLayerFor(committedLanes, hours, {')
    expect(sell).not.toContain('boardLanes')
    // …and the promises it reconciles against are the gap layer's own cells,
    // never a second derivation of them.
    expect(sell).toContain('claims: gapClaims,')
    expect(sell).toContain('rooms: props.rooms,')
    expect(sell).toContain('cleanupMinutesByBed: props.bedCleanupMinutes,')
    expect(SRC).toContain('const gapClaims = useMemo(() => [...gap.packed, ...gap.scraps], [gap])')
    // Proven arithmetically here too: the span a staged move VACATES is free for
    // the layer that prices it.
    const hours = { open: 600, close: 1140, count: 9, labels: [] }
    const lanes = [
      lane({ key: 'p-01', group: 'staff', window: { from: 600, until: 1140 }, items: [booking({ key: 'k', caseId: 'apt-9' }, 840, 900)] }),
      lane({ key: 'bed-01', group: 'beds', items: [] }),
    ]
    const staged = applyMoves(lanes, { 'apt-9': { laneKey: 'p-01', ...place(1020, 1080, hours) } }, [], [], hours)
    expect(staged[0].items.map((i) => [i.startMin, i.endMin])).toEqual([[1020, 1080]])
  })
})

/** ═══ BATCH-6 — Liam's flags 45 · 43 · 42 (8/21) ══════════════════════════
 *
 *  45: a booking is a person AND a room, and the board had one word for both.
 *  43: the click window opened on the tidy endings only, so the untidy ones —
 *      pointercancel, a lost pointerup, a window blur, a chip released over
 *      nothing — still turned their release into 新規予約を作成.
 *  42: no fix. The pin below records what was CONFIRMED correct, so nobody
 *      re-opens it. */
describe('the pair keeps both its lanes, and no ending turns a release into a booking', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
  const EDITS = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/BusinessSessionEdits.tsx'), 'utf8')
  const staffA = lane({ key: 'p-01', group: 'staff', items: [booking({ key: 'a-staff', caseId: 'apt-1' }, 660, 720)] })
  const staffB = lane({ key: 'p-04', group: 'staff' })
  const bed1 = lane({ key: 'bed-01', group: 'beds', items: [booking({ key: 'a-bed', caseId: 'apt-1' }, 660, 720)] })
  const bed2 = lane({ key: 'bed-02', group: 'beds' })
  const lanes = [staffA, staffB, bed1, bed2]
  const SPAN = { x: 0, w: 100 / 9 }

  // ── flag 45 — the snapshot, and the rule that reads it ───────────────────
  it('the snapshot knows BOTH lanes the pair stands on, at the span it stands at', () => {
    expect(pairLanesOf(lanes, 'apt-1', SPAN)).toEqual({
      staff: { laneKey: 'p-01', ...SPAN },
      bed: { laneKey: 'bed-01', ...SPAN },
    })
    // A booking with no drawing in a group answers null for that side rather
    // than inventing a lane — a creation before its bed row exists, say.
    expect(pairLanesOf([staffA, staffB], 'apt-1', SPAN).bed).toBeNull()
    expect(pairLanesOf(lanes, 'nobody', SPAN)).toEqual({ staff: null, bed: null })
  })

  it('the side the operator has hold of retargets; the other only re-times', () => {
    const now = pairLanesOf(lanes, 'apt-1', SPAN)
    // canon `stageChange` :4665 — one element is re-parented, both are re-spanned.
    expect(sidesAt(now, 'staff', 'p-04')).toEqual({ staffLane: 'p-04', bedLane: 'bed-01' })
    expect(sidesAt(now, 'beds', 'bed-02')).toEqual({ staffLane: 'p-01', bedLane: 'bed-02' })
    // A bed-side drag on a booking that has no staff row cannot invent one.
    expect(sidesAt({ staff: null, bed: now.bed }, 'beds', 'bed-02').staffLane).toBeNull()
  })

  it('a two-sided revert puts BOTH drawings back, whichever twin was dragged', () => {
    const origin = pairLanesOf(lanes, 'apt-1', SPAN)
    // Bed-side move: room to bed-02, person re-timed only.
    const movedSides = sidesAt(origin, 'beds', 'bed-02')
    const staged = applyMoves(
      lanes,
      { 'apt-1': { laneKey: movedSides.staffLane!, ...place(900, 960, HOURS) } },
      [], [], HOURS,
      { 'apt-1': { laneKey: movedSides.bedLane!, ...place(900, 960, HOURS) } },
    )
    expect(staged.map((l) => l.items.map((i) => i.caseId))).toEqual([['apt-1'], [], [], ['apt-1']])
    expect(staged[0].items[0].startMin).toBe(900)
    // 元に戻す writes the snapshot back on both records — and the board is the
    // server's again, both lanes, both spans.
    const reverted = applyMoves(lanes, { 'apt-1': origin.staff! }, [], [], HOURS, { 'apt-1': origin.bed! })
    expect(reverted.map((l) => l.items.map((i) => i.caseId))).toEqual([['apt-1'], [], ['apt-1'], []])
    expect(reverted[0].items[0].startMin).toBe(600)
    expect(reverted[2].items[0].startMin).toBe(600)
  })

  it('the screen stages, reverts and cancels through the two-sided pair, never one lane', () => {
    // The staging rule and the snapshot are one call each, at every landing.
    expect(SRC).toContain('home: pairLanesOf(boardLanes, item.caseId, { x: item.x, w: item.w })')
    expect(SRC).toContain('...sidesAt(ctx.home, ctx.group, ctx.targetLane),')
    // ⚖ BATCH-8 flag 51 — RENEGOTIATED (both landings): the answer is bound to a
    // name so the room can be re-solved on top of it before it stages. Same
    // call, same arguments, same two landings.
    expect(SRC).toContain('const sides = sidesAt(ctx.home, ctx.group, targetLane)')
    // The keyboard nudge is the same landing and takes the same answer.
    expect(SRC).toContain('const sides = sidesAt(from, lane.group, lane.key)')
    // Every abandoned landing restores BOTH sides — and `from` is the pair.
    expect(SRC).toContain('const from = ctx.home')
    // ⚖ M2, found by the mutation round: the restore is TWO writes, and dropping
    // either one is the half-undo the two-sided snapshot exists to stop — a
    // person put back into a room the booking has already left, or the reverse.
    const restore = SRC.slice(SRC.indexOf('function restoreSides('), SRC.indexOf('function revertPending()'))
    expect(restore).toContain('if (home.staff) setMoves((was) => ({ ...was, [id]: home.staff! }))')
    expect(restore).toContain('if (home.bed) return { ...was, [id]: home.bed }')
    const finish = SRC.slice(SRC.indexOf('function finishDrag('), SRC.indexOf('function cancelDrag('))
    // ⚖ BATCH-8 flag 51 — RENEGOTIATED: 3 → 4. The 満室 refusal is a fourth
    // abandoned landing and restores the pair for the same reason the other
    // three do (⚖ 47: a refusal changes NOTHING).
    // ⚖ flag 57 (batch-10b) — RENEGOTIATED BACK: 4 → 3. The blocked branch's
    // restore is GONE, and it strengthens ⚖47 rather than weakening it. A drag
    // writes `live`, never `moves`, so that call wrote the pointerdown snapshot
    // back over the identical values — except on an UNTOUCHED card, where it
    // ADDED a no-op `moves` entry that then survived a day flip. A refusal now
    // writes nothing at all. The card is still drawn at its origin the moment
    // the advice clears, because `moves` is where it is drawn from.
    expect(finish.match(/restoreSides\(ctx\.id, from\)/g)).toHaveLength(3)
    expect(finish).not.toContain('setMoves(')
    expect(finish).not.toContain('setBedMoves(')
    const cancel = SRC.slice(SRC.indexOf('function cancelDrag('), SRC.indexOf('function clearDrag()'))
    expect(cancel).toContain('restoreSides(ctx.id, ctx.home)')
    // …and 元に戻す answers for the room as well as the person.
    const revert = SRC.slice(SRC.indexOf('function revertPending()'), SRC.indexOf('function confirmPending()'))
    expect(revert).toContain('if (bedOrigin) next[id] = bedOrigin')
    // The bed record survives a day flip exactly as `moves` does — same family,
    // same provider, above the screen's `?day=` remount.
    expect(EDITS).toContain('const [bedMoves, setBedMoves] = useState<Moves>({})')
    expect(EDITS).toContain('bedMoves, setBedMoves,')
    expect(EDITS).toContain('bedOrigin?: Move')
    // …and `blockMoves` is still deliberately NOT in the family.
    expect(EDITS).not.toContain('const [blockMoves')
  })

  it('the confirm surface names 担当 and the room after a bed-side move', () => {
    // `holdSummary` reads the lanes the pair is ON, so the fix reaches it for
    // free — but only because the staff record still holds a staff lane. This
    // is the pin that fails if a bed key ever gets written there again.
    const movedSides = sidesAt(pairLanesOf(lanes, 'apt-1', SPAN), 'beds', 'bed-02')
    const board = applyMoves(
      lanes,
      { 'apt-1': { laneKey: movedSides.staffLane!, ...SPAN } },
      [], [], HOURS,
      { 'apt-1': { laneKey: movedSides.bedLane!, ...SPAN } },
    )
    expect(board.find((l) => l.key === 'p-01')!.items.map((i) => i.caseId)).toEqual(['apt-1'])
    expect(board.find((l) => l.key === 'bed-02')!.items.map((i) => i.caseId)).toEqual(['apt-1'])
    // The one thing the old code produced instead: 担当 —, on no lane at all.
    const collapsed = applyMoves(lanes, { 'apt-1': { laneKey: 'bed-02', ...SPAN } }, [], [], HOURS)
    expect(collapsed.find((l) => l.key === 'p-01')!.items).toHaveLength(0)
  })

  /** ⚖ STORE ISOLATION ON THE EXPLICIT ROOM CHOICE — GREPTILE #725 (final P1).
   *
   *  `allocateBed` scopes the room SEARCH to the booking's own store, but a
   *  bed-row gesture never asks it: that is the operator naming the room out
   *  loud, and batch-6 deliberately lets that path stage. Under the all-stores
   *  lens a person and a room in two different stores could therefore be
   *  committed with nothing said. Closed the same way an occupied room is —
   *  stage, 確定 dead, reason named — never a silent drop. */
  it('a bed retarget onto ANOTHER STORE’s room stages, and 確定 goes dead with the reason named', () => {
    const INT = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/today-interactions.ts'), 'utf8')
    const staffA = lane({ key: 'p-a1', group: 'staff', label: '見本 しろう', stores: ['store-a'],
      items: [booking({ key: 'a-staff', caseId: 'apt-1' }, 600, 660)] })
    const bedA = lane({ key: 'bed-a1', group: 'beds', label: 'A・ベッド1', stores: ['store-a'],
      items: [booking({ key: 'a-bed', caseId: 'apt-1' }, 600, 660)] })
    const bedB = lane({ key: 'bed-b1', group: 'beds', label: 'B・ベッド1', stores: ['store-b'] })

    // The gesture STAGES — parity with the occupied-room case above. The card is
    // genuinely on store-b's lane, which is what makes the check row reachable.
    const board = applyMoves([staffA, bedA, bedB], { 'apt-1': { laneKey: 'p-a1', ...SPAN } }, [], [], HOURS,
      { 'apt-1': { laneKey: 'bed-b1', ...SPAN } })
    expect(board.find((l) => l.key === 'bed-b1')!.items.map((i) => i.caseId)).toContain('apt-1')
    expect(board.find((l) => l.key === 'bed-a1')!.items).toHaveLength(0)

    // …and the pair now fails the one store rule, which is what `checksFor` asks.
    const staffOn = board.find((l) => l.group === 'staff' && l.items.some((i) => i.caseId === 'apt-1'))!
    const bedOn = board.find((l) => l.group === 'beds' && l.items.some((i) => i.caseId === 'apt-1'))!
    expect(sharesStore(staffOn.stores, bedOn.stores)).toBe(false)

    // THE ROW IS `ok: false`, pinned on the pushed literal itself. Asserting it
    // through a row this test builds would prove `confirmCaption`, not the code
    // — and an `ok: true` row is the bug in costume: the reason would be printed
    // ABOVE A LIVE 確定, which is the red-× screenshot Liam already rejected.
    expect(SRC).toContain("checks.push({ ok: false, label: `担当と店舗が異なります: ${staffLane.label} / ${bedLane.label}` })")
    // …and canon's every-row-ok rule is what turns that into a dead button, so
    // the operator READS the reason instead of losing the gesture to a silent
    // refusal. (`confirmCaption` is canon's, exercised here for real.)
    expect(confirmCaption([{ ok: true, label: '時間帯の重複なし' }]).enabled).toBe(true)
    expect(confirmCaption([
      { ok: true, label: '時間帯の重複なし' },
      { ok: false, label: `担当と店舗が異なります: ${staffOn.label} / ${bedOn.label}` },
    ]).enabled).toBe(false)
    // The sentence names BOTH sides of the mismatch — the check-row voice.
    expect(staffOn.label).toBe('見本 しろう')
    expect(bedOn.label).toBe('B・ベッド1')

    // SAME-STORE retarget is untouched: still stages, still passes the rule.
    const bedA2 = lane({ key: 'bed-a2', group: 'beds', label: 'A・ベッド2', stores: ['store-a'] })
    const ownBoard = applyMoves([staffA, bedA, bedA2], { 'apt-1': { laneKey: 'p-a1', ...SPAN } }, [], [], HOURS,
      { 'apt-1': { laneKey: 'bed-a2', ...SPAN } })
    const ownBed = ownBoard.find((l) => l.group === 'beds' && l.items.some((i) => i.caseId === 'apt-1'))!
    expect(ownBed.key).toBe('bed-a2')
    expect(sharesStore(staffA.stores, ownBed.stores)).toBe(true)

    // ONE rule, ONE home — the confirm asks the same predicate the allocator
    // filters with, so the two cannot drift into different answers.
    expect(SRC).toContain('!sharesStore(staffLane.stores, bedLane.stores)')
    expect(SRC).toContain('担当と店舗が異なります: ${staffLane.label} / ${bedLane.label}')
    expect(INT).toContain("lanes.filter((l) => l.group === 'beds' && sharesStore(opts.stores, l.stores))")
    // Appended to `checksFor`, which is the ONE place both gestures are judged:
    // the pointer drop and the keyboard nudge both stage into `moves`/`bedMoves`,
    // and `confirmPending` re-runs these at the moment of confirm.
    expect(SRC).toContain('const bedLane = boardLanes.find((l) => l.group === \'beds\' && l.items.some((i) => i.caseId === id))')
    // RENEGOTIATED (batch-9, ⚖ 50(d)): canon's R11-7 re-check runs through the
    // same door, with the overridden row — and only that row — lifted out of it.
    expect(SRC).toContain('if (pendingOffBoard || !at || !overrideCaption(checksFor(pending.id, at), pending.override ?? null).enabled) {')
  })

  it('sharesStore: floating pairs with anything, otherwise the two must share a store', () => {
    // canon `canPair`'s rule (availability.ts:51), on whole arrays.
    expect(sharesStore(['store-a'], ['store-a'])).toBe(true)
    expect(sharesStore(['store-a'], ['store-b'])).toBe(false)
    // Either side floating = every store.
    expect(sharesStore(null, ['store-b'])).toBe(true)
    expect(sharesStore(['store-a'], null)).toBe(true)
    expect(sharesStore(null, null)).toBe(true)
    // A lane in BOTH stores is reachable from either — the array is compared
    // whole, so this does not inherit A-5's `stores?.[0]` collapse.
    expect(sharesStore(['store-a'], ['store-b', 'store-a'])).toBe(true)
    expect(sharesStore(['store-b', 'store-a'], ['store-a'])).toBe(true)
    // Empty list belongs to no store and pairs with nobody — fail-closed.
    expect(sharesStore([], ['store-a'])).toBe(false)
  })

  it('a bed retarget onto an occupied room is judged by the SAME checks a staff move is', () => {
    // ⚖ BATCH-6 note: the staff path does not refuse a clash at the drop — it
    // stages, and `computeChecks` turns 確定 off with the conflict named. The bed
    // side is held to that same bar (see the build report's deviation §), and
    // this is the proof it actually sees the clash: the target room's other
    // booking joins the pool, because the card is genuinely on that lane now.
    const busy = lane({ key: 'bed-02', group: 'beds', items: [booking({ key: 'other', caseId: 'apt-2' }, 600, 660)] })
    const board = applyMoves(
      [staffA, staffB, bed1, busy],
      { 'apt-1': { laneKey: 'p-01', ...SPAN } },
      [], [], HOURS,
      { 'apt-1': { laneKey: 'bed-02', ...SPAN } },
    )
    const room = board.find((l) => l.key === 'bed-02')!
    expect(room.items.map((i) => i.caseId).sort()).toEqual(['apt-1', 'apt-2'])
    // Both spans are 10:00–11:00, so the overlap the confirm surface reads is
    // there to be read.
    expect(room.items.every((i) => i.startMin === 600 && i.endMin === 660)).toBe(true)
  })

  // ── flag 43 — every ending opens the window, and the second net ──────────
  it('canon’s click window opens on EVERY ending a gesture can have, not only the tidy ones', () => {
    // One writer, so `suppressClickSource` cannot be forgotten at half of them.
    expect(SRC).toContain('function openClickWindow(at: number, source: Element | null) {')
    expect(SRC).toContain('suppressClickUntil.current = at + 400')
    expect(SRC).toContain('suppressClickSource.current = source')
    // canon `finishNormalBookingDrag` :4563 — still above every branch.
    expect(SRC).toContain('openClickWindow(upAt, ctx.nodes[0] ?? null)')
    // canon `forceDragCancel` :4535-4546 — pointercancel, self-heal and blur.
    const cancel = SRC.slice(SRC.indexOf('function cancelDrag('), SRC.indexOf('function clearDrag()'))
    expect(cancel).toContain('openClickWindow(e.timeStamp, ctx.nodes[0] ?? null)')
    // canon `forceBlockCancel` :4015-4028 — 「Liam bug #4」 in its own words.
    const blockCancel = SRC.slice(SRC.indexOf('function cancelBlockDrag('), SRC.indexOf('function clearBlockDrag()'))
    expect(blockCancel).toContain('openClickWindow(e.timeStamp, ctx.node)')
    // …and NOT in `clearBlockDrag`, which is also the unmoved press's teardown:
    // a block's plain click is what opens ブロック情報 (canon's `blockDrop`
    // returns on `!ctx.moved` before its own write, :4137-4140).
    const clearBlock = SRC.slice(SRC.indexOf('function clearBlockDrag()'), SRC.indexOf('useEffect(() => () => { blockDragRef.current?.detach() }, [])'))
    expect(clearBlock).not.toContain('openClickWindow')
    // canon's chip release :5640 — MOVED, not landed, and never on a plain
    // press, whose click is the chip's own ×.
    const clearChip = SRC.slice(SRC.indexOf('function clearChipDrag('), SRC.indexOf('function onChipPointerMove('))
    expect(clearChip).toContain('if (e && ctx?.moved) openClickWindow(e.timeStamp,')
    // Every ending routes into one of those four.
    for (const line of [
      'if (e.buttons === 0) { cancelDrag(e); return }',
      'if (e.buttons === 0) { cancelBlockDrag(e); return }',
      'if (e.buttons === 0) { clearChipDrag(e); return }',
      "window.addEventListener('blur', cancelDrag)",
      "window.addEventListener('blur', cancelBlockDrag)",
    ]) expect(SRC).toContain(line)
  })

  it('the capture-phase interceptor is the second net, and swallows only its own click', () => {
    // canon :4633-4645. It runs BEFORE any element's own handler, which is the
    // whole point: a release that lands off the captured element used to have
    // the window consumed before the slot handler ever read it.
    expect(SRC).toContain("document.addEventListener('click', onClickCapture, true)")
    expect(SRC).toContain("document.removeEventListener('click', onClickCapture, true)")
    expect(SRC).toContain('const fromDragged = source != null && e.target instanceof Node && source.contains(e.target)')
    expect(SRC).toContain('if (within && fromDragged) {')
    expect(SRC).toContain('e.stopPropagation()')
    // Behaviour, driven: a click inside the gesture's own subtree inside the
    // window is swallowed; the same click outside it is left to the track's own
    // gate, which is the half canon keeps for exactly that case.
    const source = document.createElement('div')
    const inside = document.createElement('button')
    source.appendChild(inside)
    expect(source.contains(inside)).toBe(true)
    expect(source.contains(document.createElement('button'))).toBe(false)
  })

  it('an empty-track click refuses while a gesture is still in hand', () => {
    // canon :6811's first clause — `if (dragCtx || blockDragCtx || …) return`.
    expect(SRC).toContain('if (e.target !== e.currentTarget || dragRef.current || blockDragRef.current) return')
    expect(SRC).toContain('if (e.timeStamp < suppressClickUntil.current) return')
  })

  // ── flag 42 — NO FIX. This pin records what was confirmed correct ────────
  it('a free person over a busy room advertises NOTHING — flag 42, confirmed, not a bug', () => {
    // canon :4895-4914: a window is a person AND a room, so a slot with no free
    // bed emits no cell however free the staff lane is. Reported as a missing
    // 販売可能枠; it is the pairing cap doing its job, and selling the hour would
    // put the board's own advertisement over a room that cannot hold it.
    const opts = { gridMin: 60, nowMinute: null, locked: [], showPrice: true, hi: 7260, hqMin: 6600, depth: 9 }
    const oneBedTaken = [
      lane({ key: 'p-01', group: 'staff' }),
      lane({ key: 'bed-01', group: 'beds', items: [booking({ key: 'z', caseId: 'apt-8' }, 720, 780)] }),
    ]
    const out = sellLayerFor(oneBedTaken, HOURS, opts)
    // 12:00 is the busy hour: the person is free, the only room is not.
    expect(out.cells.some((c) => c.group === 'staff' && c.h === 720)).toBe(false)
    // Every other hour still sells, so this is the pairing rule and not a
    // silenced layer.
    expect(out.cells.filter((c) => c.group === 'staff')).toHaveLength(8)
    // Give the store a second room and the hour comes back — one line of proof
    // that the cap is what suppressed it.
    const twoBeds = [...oneBedTaken, lane({ key: 'bed-02', group: 'beds' })]
    expect(sellLayerFor(twoBeds, HOURS, opts).cells.some((c) => c.group === 'staff' && c.h === 720)).toBe(true)
  })
})

/** ══ BATCH-7 ══ flags 46 · 47 · 48.
 *
 *  ⚖ THE LANE INVARIANT (Liam, flag 47, 2026-08-21): *a refusal changes
 *  NOTHING.* Whatever the reason — a foreign store (⚖ 46), no free room, a
 *  locked shift, a release over nothing, a 仮押さえ still open — the chip stays
 *  in the shelf, 配置モード stays armed, the board stays as it was, and the
 *  message NAMES the reason and stays up long enough to be read. His own repro
 *  is the bar: 「it flashed too fast to read」 and the chip vanished.
 *
 *  These are ordering and shape proofs read off the source, in this file's own
 *  established style: territory's import fence forbids a DOM renderer here, and
 *  the ordering of a `return` against a state writer is exactly what a rendered
 *  test could not see anyway. The behaviour itself is proven in a real browser
 *  in the round's evidence folder. */
describe('BATCH-7 ⚖ 46/47 — a refusal changes NOTHING, and says why', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
  const CHIP_HOME = { store: 'store-test-ginza', storeLabel: 'テスト銀座店' }

  it('⚖ 46 — the chip may be CARRIED to another store, and refused there by name', () => {
    // Its own board: nothing to say, place it.
    expect(foreignStoreRefusal(CHIP_HOME, 'store-test-ginza')).toBeNull()
    // A foreign board: refused, and the sentence names the chip's OWN store —
    // the operator is looking at 代官山 and has to be told where to go.
    const msg = foreignStoreRefusal(CHIP_HOME, 'store-test-daikanyama')
    expect(msg).toContain('テスト銀座店')
    expect(msg).not.toContain('代官山')
    // …and it names the way out, because the × still works from anywhere.
    expect(msg).toContain('×')
    // A board with no ?store= at all is still a different board. Deny by
    // default: the one thing that must never happen is a silent placement onto
    // whatever lanes happen to be drawn.
    expect(foreignStoreRefusal(CHIP_HOME, null)).not.toBeNull()
    expect(foreignStoreRefusal({ store: null, storeLabel: '全店舗' }, 'store-test-ginza')).not.toBeNull()
    expect(foreignStoreRefusal({ store: null, storeLabel: '全店舗' }, null)).toBeNull()
  })

  it('⚖ 46 — the shelf drop refuses BEFORE the guard is consulted, and before any write', () => {
    const body = SRC.slice(SRC.indexOf('function onChipPointerUp('), SRC.indexOf('// ── 配置モード'))
    expect(body).toContain('const foreign = foreignStoreRefusal(chip.home, props.store)')
    // Ordering IS the invariant. The refusal returns ahead of the guard consult
    // — offering 「より良い開始」 on a board the booking may not be placed on is
    // advice about an impossible placement — and ahead of every writer.
    const at = (needle: string) => {
      const i = body.indexOf(needle)
      expect(i).toBeGreaterThan(-1)
      return i
    }
    expect(at('refuse(foreign)')).toBeLessThan(at('askGuard('))
    expect(at('refuse(foreign)')).toBeLessThan(at('placeFromShelf('))
  })

  it('⚖ 46 — 配置モード carries its store too, and is refused by the same rule', () => {
    const armed = SRC.slice(SRC.indexOf('function armNextVisit('), SRC.indexOf('function placeNextVisit('))
    expect(armed).toContain('store: props.store,')
    expect(armed).toContain('storeLabel: props.lensLabel,')
    const place_ = SRC.slice(SRC.indexOf('function placeNextVisit('), SRC.indexOf('⚖ Liam 2026-08-20 (flag 22)'))
    // Checked at the placement as well as at the click, so the consult popup's
    // 「この開始に配置」 cannot walk around the click-side check.
    expect(place_).toContain('const foreign = foreignStoreRefusal(p, props.store)')
    expect(place_.indexOf('refuse(foreign)')).toBeLessThan(place_.indexOf('setPlacing(null)'))
    expect(place_.indexOf('refuse(foreign)')).toBeLessThan(place_.indexOf('setAdded('))
  })

  it('⚖ 47 — every refusal in the placement family returns ahead of every write', () => {
    const place_ = SRC.slice(SRC.indexOf('function placeNextVisit('), SRC.indexOf('⚖ Liam 2026-08-20 (flag 22)'))
    // No free room: 配置モード SURVIVES, so the operator can try another slot
    // instead of walking back to 次回予約 to re-arm it.
    expect(place_.indexOf("refuse('この時間帯に空いているベッドがいません')")).toBeLessThan(place_.indexOf('setPlacing(null)'))
    const shelf = SRC.slice(SRC.indexOf('function placeFromShelf('), SRC.indexOf('const monthCells'))
    // Same for the chip: the shelf entry is removed only after the room is found.
    expect(shelf.indexOf("refuse('この時間帯に空いているベッドがいません')")).toBeLessThan(shelf.indexOf('setParkChips('))
  })

  it('⚖ 47 — the silent refusals now speak: a bed row, and a release over nothing', () => {
    // A person lands in a STAFF row; the room is chosen for them. While 配置モード
    // is armed a bare `return` on a bed row reads as a dead board.
    expect(SRC).toContain("if (placing) refuse('次回予約は担当スタッフの行に置いてください（ベッドは自動で選ばれます）')")
    // A chip carried across the board and let go over the shelf/header/gap: the
    // card drag has said this since flag 19, the shelf gesture says it now too,
    // in the same words — one sentence for one situation.
    const up = SRC.slice(SRC.indexOf('function onChipPointerUp('), SRC.indexOf('// ── 配置モード'))
    expect(up).toContain("if (chip) refuse('予約を置く行の中で離してください')")
    // …and it is still a refusal. The handler holds no writer of its own at all
    // — every landing it accepts is delegated to `placeFromShelf` through the
    // guard — so a refusal branch here cannot mutate anything by construction.
    for (const writer of ['setParkChips(', 'setAdded(', 'setMoves(', 'setPending(', 'setPlacing(']) {
      expect(up).not.toContain(writer)
    }
  })

  it('⚖ 47 — a refusal outlives the glance that missed it, and re-arms when repeated', () => {
    // Liam's words: it flashed too fast to read. A confirmation may be brief —
    // the operator can see the result — a refusal is the ONLY record that a
    // thing did not happen.
    expect(SRC).toContain('const TOAST_MS = 3200')
    expect(SRC).toContain('const REFUSAL_MS = 7000')
    expect(SRC).toContain('function refuse(message: string) {\n    show(message, REFUSAL_MS)\n  }')
    // The dwell comes off the message, not off a constant baked into the timer.
    expect(SRC).toContain('const t = setTimeout(() => setToast(EMPTY_TOAST), toast.ms)')
    // `n` re-arms the timer for an identical refusal earned twice: pressing the
    // same illegal slot again used to change no state and so say nothing.
    // ⚖ flag 64 — the door grew an optional undo (canon's delete toast carries
    // one). `n` is untouched, and a REFUSAL never carries one: `refuse` passes
    // no third argument, so there is nothing to take back on a refusal by
    // construction, not by convention.
    // ⚖ E5 (SPEC-SELLING-ENGINE §1 / ruling Q5) — the slot is NAMED now, because
    // it has a second caller whose action is a commit rather than a way back.
    // Still ONE optional action, still the same door, and `refuse` still passes
    // no third argument.
    expect(SRC).toContain('setToast((was) => ({ text: message, ms, n: was.n + 1, action }))')
    expect(SRC).toContain('function show(message: string, ms = TOAST_MS, action: { label: string; run: () => void } | null = null) {')
    // The label travels WITH the action, so the button cannot say 元に戻す over
    // a release — the one thing a shared slot could get wrong.
    // ⚖ PIN MIGRATED at the FIX ROUND, WITH the decision (F9, blind-final L2#9):
    // the action carries `aria-live="off"`. The toast is a live region, which is
    // right for the sentence and wrong for a control — a button announced as
    // part of a status update is one a screen-reader user hears about rather
    // than reaches, and since E5 this slot can carry a COMMIT. The label still
    // travels with the action; nothing else about the slot moved.
    expect(SRC).toContain('<button className="toast-undo" type="button" aria-live="off" onClick={toast.action.run}>{toast.action.label}</button>')
    // ONE door for refusals — every one of them, greppable by name. If a future
    // round adds a refusal through `show(` it will not carry the dwell, so the
    // known refusal sentences are pinned to the door here.
    // ⚖ BATCH-8 flag 51 — RENEGOTIATED: 「この時間帯に空いているベッドがいません」
    // is retired. The no-room refusal is now COMPOSED (it names the busy rooms),
    // so it cannot be pinned as a literal — the door is pinned instead, at the
    // one place that says it, and the sentence itself is pinned in the BATCH-8
    // describe against the real allocator.
    for (const sentence of [
      'シフトロック中: このスタッフには新しい予約を置けません',
      '予約を置く行の中で離してください',
      '予定を置く行の中で離してください',
      '他の予定と重なるため元の位置に戻しました',
      '仮押さえ中の予約を確定するか、元に戻してから操作してください',
      '状況が変わったため、この内容では確定できません',
      'これ以上は時間を変更できません',
    ]) {
      expect(SRC).toContain(`refuse('${sentence}')`)
      expect(SRC).not.toContain(`show('${sentence}')`)
    }
    // The composed refusals go through the same door — the allocator's 満室
    // sentence and the chip landing's missing-person one.
    expect(SRC).toContain('if (solved.refusal) {\n      refuse(solved.refusal)')
    expect(SRC).toContain('refuse(`${chip.item.title}様の担当がこのボードにいません')
  })

  /** ⚖ 47's class, SECOND MEMBER (batch-10b, measured in a real browser
   *  2026-08-22): at 3.2s the block-delete undo expired mid-reach and the click
   *  landed on the empty track underneath, opening 新規予約を作成. A destructive
   *  act whose way back must be FOUND inside 3.2s is the same complaint that
   *  bought refusals their 7s. Only an ACTION-carrying toast joins the class.
   *
   *  ⚖ 47's class, THIRD MEMBER (E5, SPEC-SELLING-ENGINE §1 / ruling Q5): the
   *  manager's 確保 release. Same measured reason, arrived at from the other
   *  side — the toast is the only place the action exists, so it has to be
   *  REACHED rather than glanced at. The class grew WITH a ruling; it did not
   *  grow quietly, which is what the count below exists to catch. */
  it('⚖ 47 — the toast that carries an ACTION lives as long as a refusal', () => {
    expect(SRC).toContain('show(`${info.title}を削除しました`, REFUSAL_MS, {')
    expect(SRC).toContain('show(law, REFUSAL_MS, {')
    // The value has ONE home — neither caller mints a dwell of its own.
    expect(SRC).not.toMatch(/show\([^\n]*,\s*7000/)
    // …and ORDINARY toasts are untouched: the restore confirmation that follows
    // the undo takes the default, and so does the release's own confirmation.
    expect(SRC).toContain('show(`${info.title}を元に戻しました`)')
    expect(SRC).toContain("show('確保を解除しました。再読み込みすると戻ります')")
    // Exactly THREE callers ask for the long dwell: the refusal door, the delete
    // undo and the release action. A fourth would mean the class grew quietly.
    expect(SRC.match(/, REFUSAL_MS/g)).toHaveLength(3)
    // ⚖ E5 — and the staff branch is NOT in the class: no action, no long dwell,
    // which is E3b's shipped behaviour byte for byte.
    expect(SRC).toContain('if (!props.canReleaseHeld) {\n      show(law)\n      return\n    }')
  })

  it('⚖ 47 — cross-day placement is what canon promises, and nothing gates on the day', () => {
    // 配置モード's own toast says 「日付を移動してもそのまま」 and canon says
    // 「置きたい日へ移動して、空き枠をクリック」. The landing therefore writes the
    // VIEWED day and asks no question about which day that is.
    const place_ = SRC.slice(SRC.indexOf('function placeNextVisit('), SRC.indexOf('⚖ Liam 2026-08-20 (flag 22)'))
    // RENEGOTIATED (cycle 7): the viewed day still goes on the record, but it is
    // spelled `{ ...board, … }` — main's ⚖ 46 forerunner stamps the day and the
    // store from one const, and batch-7's ⚖ 46 never reached AddedRow. The claim
    // this test makes is unchanged and the two `not` assertions below are what
    // actually guard it: nothing gates on WHICH day.
    expect(place_).toContain('{ ...board, laneKey: lane.key')
    expect(SRC).toContain('() => ({ dayOffset: props.dayOffset, store: props.store }),')
    expect(place_).not.toContain('props.isToday')
    expect(place_).not.toMatch(/dayOffset\s*[!=]==?\s*0/)
    expect(SRC).toContain('置きたい日へ移動して、空き枠をクリック')
  })
})

describe('BATCH-7 ⚖ 48 — the confirm prefers to leave the landing’s rail chip visible', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
  const CARD = { left: 400, right: 600, top: 300, bottom: 340 }
  const VIEW = { width: 1440, height: 1100 }
  const POP = { w: 380, h: 120 }

  it('with nothing to avoid, the ruled position is unchanged', () => {
    expect(holdPopAnchor(CARD, POP.w, POP.h, VIEW)).toEqual({ left: 310, top: 348 })
  })

  it('the rail chip under the card pushes the confirm ABOVE — when above is legal', () => {
    // The strip sits in the 18px under the lane, which is exactly where "below
    // the card" lands. Liam: the purple ✓ for the landing was 「kind of covered
    // up… you can slightly see it pointing out above the box」.
    const rail = { left: 470, right: 510, top: 344, bottom: 362 }
    const at = holdPopAnchor(CARD, POP.w, POP.h, VIEW, 8, 8, rail)
    expect(at).toEqual({ left: 310, top: 172 })
    // …and above is still ABOVE: the anchor card is never covered.
    expect(at!.top + POP.h).toBeLessThanOrEqual(CARD.top)
  })

  it('a rail chip the confirm was never going to touch changes nothing', () => {
    // Another lane's strip, far down the board.
    const far = { left: 470, right: 510, top: 900, bottom: 918 }
    expect(holdPopAnchor(CARD, POP.w, POP.h, VIEW, 8, 8, far)).toEqual({ left: 310, top: 348 })
    // Same row, but horizontally clear of the popover (a wide board, an early
    // start): an overlap test that ignored x would flip for nothing.
    const beside = { left: 1200, right: 1240, top: 344, bottom: 362 }
    expect(holdPopAnchor(CARD, POP.w, POP.h, VIEW, 8, 8, beside)).toEqual({ left: 310, top: 348 })
  })

  it('PREFERENCE, NEVER A LAW — when no allowed side clears it, the law’s answer stands', () => {
    // A card near the top: above cannot hold the surface, so below is the only
    // legal position. The preference has no say and does not invent a third.
    const highCard = { left: 400, right: 600, top: 20, bottom: 60 }
    const rail = { left: 470, right: 510, top: 64, bottom: 82 }
    expect(holdPopAnchor(highCard, POP.w, POP.h, VIEW, 8, 8, rail)).toEqual({ left: 310, top: 68 })
    // A card with no room on EITHER side is still the pill (`null`) — the
    // never-cover-the-anchor law, untouched by the new argument.
    const tight = { width: 1440, height: 200 }
    expect(holdPopAnchor({ left: 400, right: 600, top: 60, bottom: 140 }, POP.w, POP.h, tight, 8, 8, rail)).toBeNull()
  })

  it('the chip it avoids is the LANDING’s own, on the lane the card landed in', () => {
    // 30-minute lattice: an off-lattice landing (canon's dual lattice can put a
    // card on 14:05) belongs to the cell it starts inside, so the start is
    // floored — never rounded, which would name the next chip along.
    expect(SRC).toContain('const start = Math.floor(minuteOf(at.x, hours) / 30) * 30')
    expect(SRC).toContain('`.guard-placement-rail[data-lane="${at.laneKey}"] .guard-rail-cell[data-start="${start}"]`')
    // Measured in the same frame as the popover's own box, never cached.
    expect(SRC).toContain('boardRef.current?.querySelector(holdRailSel)?.getBoundingClientRect() ?? null')
    // Absent (strip hidden by 表示設定, lane collapsed, jsdom) → the laws decide
    // alone. `null`, not a zero rect that would overlap everything at the origin.
    expect(SRC).toContain('const railBox = holdRailSel')
  })
})

describe('BATCH-7 — FLAGS 25c backlog: the three unregistered surfaces join the tour', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
  // The lane rule (⚖ Liam, flag 25c): every new section registers a
  // data-guide + data-guide-title pair. Batches 4/5/6 added three and none of
  // them did, which is how the count sat at 14 for three rounds.
  it('the confirm popover, the block advisor and the 60分配置 strip all declare themselves', () => {
    // The two popovers declare themselves as plain JSX attributes…
    for (const [title, body] of [
      ['仮押さえの確認', '動かした予約はまず仮押さえになります。ここで内容を確認して確定するか、元に戻せます。再読み込みでも元に戻ります。'],
      ['予定の位置の提案', '休憩や清掃を置いた位置が新規のお客様の枠を分けてしまうとき、より良い位置を提案します。そのまま置くこともできます。'],
    ]) {
      expect(SRC).toContain(`data-guide-title="${title}"`)
      expect(SRC).toContain(`data-guide="${body}"`)
    }
    // …and the strip through a conditional spread, because it renders per lane
    // and only the first one may carry the pair (next test).
    // ⚖ FIX-10 — the title names the strip and the strip renders `{railDur}分配置`,
    // so a literal 60 made the tour's own heading disagree with what it points at.
    expect(SRC).toContain("'data-guide-title': `${railDur}分配置`,")
    // ⚖ R3 one world + ⚖ FIX-9 — the strip's own sentence moved with its
    // semantics and then stopped saying untrue things. The LENGTH is
    // interpolated (`${railDur}`), never a hardcoded 60: the strip's own label
    // renders that number and ⚖ flag 50 makes it follow the gesture, so a
    // literal would lie at every store whose standard session is not 60 and at
    // every mid-drag moment. A template literal, so this pin holds the shape.
    expect(SRC).toContain('このスタッフの行で、30分ごとの開始時刻から${railDur}分の予約を新しく入れられるかを表示します。')
    expect(SRC).toContain('仮押さえ中の予約も、ほかの予約と同じように枠をふさぎます。')
    // …and the ✓/△/— key is NOT restated here: the legend band is its one home.
    expect(SRC).not.toContain('✓は空きを減らさない、△は減らすが置ける、—は置けません。')
  })

  it('the strip registers ONCE, not once per staff member', () => {
    // The registry is a document walk (`spotTargets`), so a pair on every strip
    // would put the same step on the tour once per lane. The first strip in DOM
    // order carries it; the sentence is true of all of them.
    expect(SRC).toContain('rails[0]?.laneKey === rail.laneKey')
    const host = document.createElement('div')
    host.innerHTML = `
      <div class="guard-placement-rail" data-guide-title="60分配置" data-guide="x"></div>
      <div class="guard-placement-rail"></div>
      <div class="guard-placement-rail"></div>`
    for (const el of Array.from(host.querySelectorAll('[data-guide]'))) rect(el, { left: 0, top: 0, width: 200, height: 18 })
    expect(spotTargets(host)).toHaveLength(1)
  })

  it('a popover explains itself exactly while it is open — the registry drops what has no box', () => {
    const host = document.createElement('div')
    host.innerHTML = `<div class="hold-pop" data-guide-title="仮押さえの確認" data-guide="y"></div>`
    const pop = host.querySelector('[data-guide]')!
    rect(pop, { left: 0, top: 0, width: 0, height: 0 })
    expect(spotTargets(host)).toHaveLength(0)
    rect(pop, { left: 0, top: 0, width: 380, height: 120 })
    expect(spotTargets(host)).toHaveLength(1)
  })
})

/** ═══ BATCH-8 — Liam's flags 51 · 52 · 53 + study-50 (c) ═══════════════════
 *
 *  51 ⚖ LOCKED (Liam 8/21): "people are chosen, rooms are solved". A staff-lane
 *     time-move carried its bed UNCHANGED and validated THAT bed at the new
 *     time, so テストなぎ (ベッド3, taken at 16:00) refused with
 *     「時間帯が重複: 見本 あかり」 while its staff member あずさ was plainly free.
 *     The bed is now an ALLOCATION re-solved at every landing.
 *  52  × is for blocking lines only (see the renegotiated guardCheckRow test).
 *  53  the 「ドラッグ中のみ」 guide mode was a dead lever.
 *  50(c) the aimed rail chip — study 50's one true parity gap. */
describe('BATCH-8 ⚖ 51 — the room is solved at the landing, and the refusal names it', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
  const INT = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/today-interactions.ts'), 'utf8')
  const CSS = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/today.css'), 'utf8')

  /** Liam's exact scene, as lanes: 見本 あずさ free at 16:00; あかり holds ベッド3
   *  (the 個室) 16:00–17:00; ベッド1 and ベッド2 are 施術室A and free. */
  const scene = (over: { bed1?: BoardItem[]; bed2?: BoardItem[]; bed3?: BoardItem[] } = {}) => [
    lane({ key: 'p-06', group: 'staff', label: '見本 あずさ' }),
    lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', roomClass: 'standard', items: over.bed1 ?? [] }),
    lane({ key: 'bed-02', group: 'beds', label: 'ベッド2', roomClass: 'standard', items: over.bed2 ?? [] }),
    lane({
      key: 'bed-03', group: 'beds', label: 'ベッド3', roomClass: 'private',
      items: over.bed3 ?? [booking({ key: 'akari-bed', caseId: 'apt-akari', title: '見本 あかり' }, 960, 1020)],
    }),
  ]
  const solve = (lanes: BoardLane[], over: Partial<Parameters<typeof allocateBed>[1]> = {}) =>
    allocateBed(lanes, { id: 'apt-nagi', currentBed: 'bed-03', stores: null, vip: false, start: 960, end: 1020, policy: POLICY, ...over })

  it('keeps the booking’s own room when it is free at the landing time', () => {
    // 見本 かえる's case: carries ベッド2, and ベッド2 is free at 16:00 → nothing
    // moves. The room the operator can see on the card is the room they get.
    expect(solve(scene(), { currentBed: 'bed-02' })).toEqual({ laneKey: 'bed-02', refusal: null, blockers: [] })
  })

  it('retargets to a free compatible room when its own is taken — Liam’s なぎ case', () => {
    // The whole flag: ベッド3 is held by あかり at 16:00, あずさ is free, so the
    // landing succeeds in another room instead of refusing about a person.
    expect(solve(scene())).toEqual({ laneKey: 'bed-01', refusal: null, blockers: [] })
  })

  it('refuses ONLY at true 満室 — and the sentence names the window and the rooms', () => {
    const full = scene({
      bed1: [booking({ key: 'k1', caseId: 'apt-kaeru', title: '見本 かえる' }, 960, 1020)],
      bed2: [{ ...booking({ key: 'apt-x-cleanup', caseId: null }, 960, 990), kind: 'cleanup', title: '清掃' }],
    })
    expect(solve(full)).toEqual({
      laneKey: null,
      refusal: '16:00〜17:00はベッドに空きがありません。ベッド1が使用中（見本 かえる様）、ベッド2が使用中（清掃）、ベッド3が使用中（見本 あかり様）',
      blockers: solve(full).blockers,
    })
    // ⚖ 44 — the walk the sentence was composed from, handed out beside it: the
    // same occupants, in the same room order, so a display classifying them can
    // never disagree with the line printed next to it.
    expect(solve(full).blockers.map((i) => [i.title, i.kind])).toEqual([
      ['見本 かえる', 'booking'], ['清掃', 'cleanup'], ['見本 あかり', 'booking'],
    ])
  })

  it('a VIP never silently leaves the 個室 — a busy 個室 IS 満室 for it', () => {
    // 施術室A is wide open, and that is not an answer for a VIP: the policy says
    // the room is part of what was sold.
    expect(solve(scene(), { vip: true, currentBed: 'bed-03' })).toEqual({
      laneKey: null,
      refusal: '16:00〜17:00は個室に空きがありません。ベッド3が使用中（見本 あかり様）',
      blockers: solve(scene(), { vip: true, currentBed: 'bed-03' }).blockers,
    })
    expect(solve(scene(), { vip: true, currentBed: 'bed-03' }).blockers.map((i) => i.title)).toEqual(['見本 あかり'])
    // …and with the 個室 free it goes there, never into a 施術室.
    expect(solve(scene({ bed3: [] }), { vip: true, currentBed: null }).laneKey).toBe('bed-03')
    // A store with no 個室 at all says that instead of naming rooms it has not.
    expect(solve([lane({ key: 'bed-01', group: 'beds', label: 'ベッド1' })], { vip: true, currentBed: null })).toEqual({
      laneKey: null,
      refusal: '16:00〜17:00に使える個室がありません',
      blockers: [],
    })
  })

  it('a regular booking takes the 個室 only when no 施術室 is free', () => {
    const bothStandardBusy = scene({
      bed1: [booking({ key: 'k1', caseId: 'apt-a', title: 'A' }, 960, 1020)],
      bed2: [booking({ key: 'k2', caseId: 'apt-b', title: 'B' }, 960, 1020)],
      bed3: [],
    })
    expect(solve(bothStandardBusy, { currentBed: null }).laneKey).toBe('bed-03')
    // With a 施術室 free the 個室 is left alone even though it is free too — and
    // even though it comes FIRST in lane order here.
    const privateFirst = [
      lane({ key: 'bed-03', group: 'beds', label: 'ベッド3', roomClass: 'private' }),
      lane({ key: 'bed-02', group: 'beds', label: 'ベッド2', roomClass: 'standard' }),
    ]
    expect(solve(privateFirst, { currentBed: null }).laneKey).toBe('bed-02')
  })

  it('both dials are the STORE’s, and both actually steer the solve', () => {
    // ⚠SETTINGS-BATCH: overturnable defaults, so the code must read them rather
    // than know them. Flip each one and the answer changes.
    expect(solve(scene(), { vip: true, policy: { vipStaysPrivate: false, privateIsLastResort: true } }).laneKey).toBe('bed-01')
    const privateFirst = [
      lane({ key: 'bed-03', group: 'beds', label: 'ベッド3', roomClass: 'private' }),
      lane({ key: 'bed-02', group: 'beds', label: 'ベッド2', roomClass: 'standard' }),
    ]
    expect(solve(privateFirst, { currentBed: null, policy: { vipStaysPrivate: true, privateIsLastResort: false } }).laneKey).toBe('bed-03')
  })

  it('the booking and its OWN 清掃 travel with it; anyone else’s 清掃 is busy room', () => {
    // A card moving 30 minutes later on its own bed must not be thrown out of
    // the room by its own turnaround — the 清掃 is derived FROM the booking
    // (today-board.cleanupBlocks keys it `${id}-cleanup`) and follows it.
    const own = [
      lane({
        key: 'bed-02', group: 'beds', label: 'ベッド2',
        items: [
          booking({ key: 'nagi-bed', caseId: 'apt-nagi' }, 900, 960),
          { ...booking({ key: 'apt-nagi-cleanup', caseId: null }, 960, 990), kind: 'cleanup' as const, title: '清掃' },
        ],
      }),
    ]
    expect(allocateBed(own, { id: 'apt-nagi', currentBed: 'bed-02', stores: null, vip: false, start: 960, end: 1020, policy: POLICY }))
      .toEqual({ laneKey: 'bed-02', refusal: null, blockers: [] })
    // Somebody else's turnaround is the room being unavailable, exactly as the
    // board's own 「清掃を予約不可時間として表示」 says.
    const theirs = [
      lane({
        key: 'bed-02', group: 'beds', label: 'ベッド2',
        items: [{ ...booking({ key: 'apt-other-cleanup', caseId: null }, 960, 990), kind: 'cleanup' as const, title: '清掃' }],
      }),
    ]
    expect(allocateBed(theirs, { id: 'apt-nagi', currentBed: 'bed-02', stores: null, vip: false, start: 960, end: 1020, policy: POLICY }).laneKey)
      .toBeNull()
  })

  /** ⚖ STORE ISOLATION — GREPTILE #725 P1-A. The allocator searched every bed
   *  lane it was handed and compared only "is it free?". Under the all-stores
   *  lens `lanes` carries every store's rooms, so a staff-side landing whose own
   *  room was taken could be retargeted into ANOTHER STORE's bed — the board
   *  drawing a person in a building they are not in. Dormant in the UI today
   *  (すべての店舗 was removed); the law is system-wide, so the allocator is
   *  correct by construction rather than by unreachability. */
  it('the allocator never crosses a store: a foreign free bed is 満室, not a landing', () => {
    // A viewAll board: store-a's only room is busy for this span, store-b's is
    // free. The booking's own staff works at store-a.
    const viewAll = [
      lane({ key: 'bed-a1', group: 'beds', label: 'A・ベッド1', stores: ['store-a'],
        items: [booking({ key: 'other', caseId: 'apt-other' }, 960, 1020)] }),
      lane({ key: 'bed-b1', group: 'beds', label: 'B・ベッド1', stores: ['store-b'] }),
    ]
    const solved = allocateBed(viewAll, {
      id: 'apt-nagi', currentBed: null, stores: ['store-a'],
      vip: false, start: 960, end: 1020, policy: POLICY,
    })
    // 満室 — and the refusal names store-a's room, never offers store-b's.
    expect(solved.laneKey).toBeNull()
    expect(solved.refusal).not.toBeNull()
    expect(solved.refusal).not.toContain('B・ベッド1')

    // The store rule is a FILTER, not a freeze: a free room in the booking's own
    // store is still retargeted to, on the same board.
    const withOwnFree = [...viewAll, lane({ key: 'bed-a2', group: 'beds', label: 'A・ベッド2', stores: ['store-a'] })]
    expect(allocateBed(withOwnFree, {
      id: 'apt-nagi', currentBed: null, stores: ['store-a'],
      vip: false, start: 960, end: 1020, policy: POLICY,
    }).laneKey).toBe('bed-a2')

    // A floating staff member (`stores: null`) pairs with any room, and a
    // floating ROOM takes anyone — canon `canPair`'s two null cases, both ways.
    expect(allocateBed(viewAll, {
      id: 'apt-nagi', currentBed: null, stores: null,
      vip: false, start: 960, end: 1020, policy: POLICY,
    }).laneKey).toBe('bed-b1')
    const floatingRoom = [lane({ key: 'bed-any', group: 'beds', label: 'どこでも', stores: null })]
    expect(allocateBed(floatingRoom, {
      id: 'apt-nagi', currentBed: null, stores: ['store-a'],
      vip: false, start: 960, end: 1020, policy: POLICY,
    }).laneKey).toBe('bed-any')

    // A room shared by two stores is reachable from either — the array is
    // compared whole, so this does NOT inherit the A-5 `stores?.[0]` collapse.
    const shared = [lane({ key: 'bed-sh', group: 'beds', label: '共用', stores: ['store-b', 'store-a'] })]
    expect(allocateBed(shared, {
      id: 'apt-nagi', currentBed: null, stores: ['store-a'],
      vip: false, start: 960, end: 1020, policy: POLICY,
    }).laneKey).toBe('bed-sh')
  })

  /** ⚖ 51 second-order — GREPTILE #725 P1-B. A 清掃 carries `caseId: null`, so
   *  `applyMoves`' membership pass could not see it: the booking moved and its
   *  turnaround stayed on the original bed at the original span. Stale 清掃 where
   *  nothing happens, and none where the session now ends. */
  it('a booking’s trailing 清掃 follows it — in time, across beds, and back on revert', () => {
    const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    const cleanup = (key: string, s: number, e: number) => ({
      ...booking({ key, caseId: null }, s, e), kind: 'cleanup' as const, title: '清掃',
      label: `ベッド1、${hh(s)}から${hh(e)}、清掃・予約不可`,
    })
    const board = () => [
      lane({ key: 'p-01', group: 'staff', label: '見本 しろう',
        items: [booking({ key: 'nagi-staff', caseId: 'apt-nagi' }, 900, 960)] }),
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1',
        items: [booking({ key: 'nagi-bed', caseId: 'apt-nagi' }, 900, 960), cleanup('apt-nagi-cleanup', 960, 990)] }),
      lane({ key: 'bed-02', group: 'beds', label: 'ベッド2' }),
    ]
    const cleanOn = (out: BoardLane[], key: string) =>
      out.find((l) => l.key === key)!.items.find((i) => i.kind === 'cleanup') ?? null

    // 1. A STAGED TIME MOVE: the turnaround starts where the session now ends.
    const moved = applyMoves(board(), { 'apt-nagi': { laneKey: 'p-01', ...place(1020, 1080, HOURS) } }, [], [], HOURS,
      { 'apt-nagi': { laneKey: 'bed-01', ...place(1020, 1080, HOURS) } })
    expect([cleanOn(moved, 'bed-01')!.startMin, cleanOn(moved, 'bed-01')!.endMin]).toEqual([1080, 1110])
    expect(cleanOn(moved, 'bed-02')).toBeNull()

    // 2. A BED RETARGET: it lands on the NEW room, and the old one is left clean.
    const retargeted = applyMoves(board(), { 'apt-nagi': { laneKey: 'p-01', ...place(900, 960, HOURS) } }, [], [], HOURS,
      { 'apt-nagi': { laneKey: 'bed-02', ...place(900, 960, HOURS) } })
    expect(cleanOn(retargeted, 'bed-01')).toBeNull()
    expect([cleanOn(retargeted, 'bed-02')!.startMin, cleanOn(retargeted, 'bed-02')!.endMin]).toEqual([960, 990])
    // …and it SAYS the room it is in — a turnaround still announcing ベッド1 over
    // ベッド2 is the impossible state ⚖ 8/9 forbids.
    expect(cleanOn(retargeted, 'bed-02')!.label).toContain('ベッド2')

    // 3. REVERT — an empty ledger reproduces the server's own rows exactly.
    const reverted = applyMoves(board(), {}, [], [], HOURS, {})
    expect([cleanOn(reverted, 'bed-01')!.startMin, cleanOn(reverted, 'bed-01')!.endMin]).toEqual([960, 990])
    expect(cleanOn(reverted, 'bed-02')).toBeNull()
    expect(cleanOn(reverted, 'bed-01')!.label).toBe(cleanup('x', 960, 990).label)

    // The clamp is `cleanupBlocks`' own: never into the next booking on the bed.
    const tight = board()
    tight[1].items.push(booking({ key: 'next-bed', caseId: 'apt-next' }, 1100, 1160))
    const clamped = applyMoves(tight, { 'apt-nagi': { laneKey: 'p-01', ...place(1020, 1080, HOURS) } }, [], [], HOURS,
      { 'apt-nagi': { laneKey: 'bed-01', ...place(1020, 1080, HOURS) } })
    expect([cleanOn(clamped, 'bed-01')!.startMin, cleanOn(clamped, 'bed-01')!.endMin]).toEqual([1080, 1100])
  })

  it('the popover NAMES the final room, and shows the change when there was one', () => {
    // A silent switch the staff cannot see is a defect (Liam's own words).
    const landed = [
      lane({ key: 'p-06', group: 'staff', label: '見本 あずさ', items: [booking({ key: 's', caseId: 'apt-nagi', title: 'テスト なぎ' }, 960, 1020)] }),
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: [booking({ key: 'b', caseId: 'apt-nagi', title: 'テスト なぎ' }, 960, 1020)] }),
      lane({ key: 'bed-03', group: 'beds', label: 'ベッド3', roomClass: 'private' }),
    ]
    const at = { laneKey: 'p-06', ...place(960, 1020, HOURS) }
    expect(holdSummary(landed, 'apt-nagi', at, HOURS, 'bed-03'))
      .toBe('テスト なぎ様 → 16:00〜17:00 / 担当 見本 あずさ / ベッド3 → ベッド1')
    // A room that did not change says nothing — the line is not a diff report.
    expect(holdSummary(landed, 'apt-nagi', at, HOURS, 'bed-01'))
      .toBe('テスト なぎ様 → 16:00〜17:00 / 担当 見本 あずさ / ベッド1')
    expect(holdSummary(landed, 'apt-nagi', at, HOURS)).not.toContain('→ ベッド1')
    // …and the screen hands it the PAIR SNAPSHOT's bed, not a live lane.
    expect(SRC).toContain('holdSummary(boardLanes, pending.id, moves[pending.id], hours, pending.bedOrigin?.laneKey ?? null)')
  })

  it('a retargeted card no longer wears the room it left', () => {
    // Every card wears its PARTNER's name. A staff card still reading 【ベッド3】
    // over a booking now standing on ベッド2 is the impossible state ⚖ 8/9
    // forbids — and it is the first thing the operator reads.
    const lanes = [
      lane({ key: 'p-06', group: 'staff', label: '見本 あずさ', items: [booking({ key: 's', caseId: 'apt-nagi', tag: '【ベッド3】' }, 900, 960)] }),
      lane({ key: 'bed-02', group: 'beds', label: 'ベッド2' }),
      lane({ key: 'bed-03', group: 'beds', label: 'ベッド3', roomClass: 'private', items: [booking({ key: 'b', caseId: 'apt-nagi', tag: '【見本 あずさ】' }, 900, 960)] }),
    ]
    const span = place(960, 1020, HOURS)
    const staged = applyMoves(
      lanes,
      { 'apt-nagi': { laneKey: 'p-06', ...span } },
      [], [], HOURS,
      { 'apt-nagi': { laneKey: 'bed-02', ...span } },
    )
    expect(staged[0].items[0].tag).toBe('【ベッド2】')
    // …and the room's own drawing keeps naming the person, having landed there.
    expect(staged[1].items[0].tag).toBe('【見本 あずさ】')
    expect(staged[2].items).toHaveLength(0)
  })

  it('an EXPLICIT bed-row drag is never auto-solved — batch-6’s choice path stands', () => {
    const finish = SRC.slice(SRC.indexOf('function finishDrag('), SRC.indexOf('function cancelDrag('))
    // RENEGOTIATED (batch-9, ⚖ 50): the solve moved inside `land`, which both the
    // clean release and the 「注意して配置」 escalation run. The EXEMPTION itself
    // is untouched and still spelled by the same guard on the grabbed group.
    // RENEGOTIATED AGAIN (batch-10, ⚖ flag 59): the pin used to carry the whole
    // line, `&& on.bedLane != null` included — and that conjunct was the flag-59
    // bug, so the pin was ENSHRINING it. The exemption this test exists for is
    // the group test and nothing else; a booking that arrives with no room is
    // exactly the case that must reach the allocator.
    expect(finish).toContain("if (ctx.group !== 'beds') {")
    expect(finish).not.toContain("!== 'beds' && on.bedLane")
    // A 満室 landing changes NOTHING (⚖ 47) — RENEGOTIATED (batch-9, ⚖ 50(d)):
    // the refusal is now spoken by the ONE VERDICT before the solve runs, so the
    // pair goes back and the explanation opens from `explainBlocked` rather than
    // from a second `solveBed` null-check. Same invariant, one door earlier.
    // ⚖ flag 57 — RENEGOTIATED AGAIN: the restore is gone (it was a no-op write
    // that ⚖47 is better off without) and the branch explains straight away,
    // carrying the attempted landing so the card can SIT there while it asks.
    // The invariant that matters is unchanged and pinned here: this branch does
    // not stage, and `land(` is not reachable from it.
    const blockedBranch = finish.slice(finish.indexOf("if (v.kind === 'blocked') {"), finish.indexOf('land(null, span)'))
    expect(blockedBranch).toContain('explainBlocked(')
    expect(blockedBranch).not.toContain('restoreSides(')
    expect(blockedBranch).not.toContain('stage(')
    // Every landing that carries a room goes through the ONE solver.
    expect(SRC.match(/solveBed\(/g)).toHaveLength(5)
    for (const call of [
      // RENEGOTIATED (Greptile #725 P1-A): every landing now names the staff lane
      // it is allocating for — the first argument — so the allocator can scope
      // the room search to that person's own store.
      // RENEGOTIATED AGAIN (batch-9, ⚖ 50(d)): and whether this landing was
      // placed THROUGH a 置けない, because an override has to reach the room too.
      // RENEGOTIATED ONCE MORE (⚖ flag 87, 2026-08-30): the two BOOKING landings
      // seed the carried room through `seedBed`, because `sidesAt` reads the
      // board as it stands and that board is the STAGED one once a change is
      // open. The other two are first landings and are byte-untouched.
      "solveBed(on.staffLane, ctx.id, seedBed(pending, ctx.id, on.bedLane), item.category === 'vip', at)",
      "solveBed(on.staffLane, id, seedBed(pending, id, on.bedLane), item.category === 'vip', next)",
      'solveBed(lane.key, null, null, false, place(start, end, hours))',
      "solveBed(staff?.key ?? null, chip.id, home?.key ?? null, chip.item.category === 'vip', span)",
    ]) {
      expect(SRC).toContain(call)
    }
    // The policy is DATA, read from the store, never a literal in the solve.
    expect(SRC).toContain('policy: props.rooms')
    expect(INT).not.toContain("'個室 / VIP対応'")
    expect(INT).not.toContain('施術室')
  })

  it('the SHIPPED store states its room classes and its policy as data', () => {
    // The allocator is only as honest as the config it reads: if 個室 is not
    // stated private, every rule above is right about the wrong board.
    expect(resources.filter((r) => r.room_class === 'private').map((r) => r.name)).toEqual(['ベッド3'])
    expect(resources.find((r) => r.id === 'bed-03')?.note).toContain('個室')
    expect(resources.filter((r) => r.room_class === 'standard').map((r) => r.id)).toEqual(['bed-01', 'bed-02', 'bed-04'])
    expect(opsConfig.roomPolicy).toEqual({ vipStaysPrivate: true, privateIsLastResort: true })
    // (the lane's own carry of it is pinned in today-board.test.ts, against the
    // REAL buildLanes rather than against this file's lane fixture)
  })

  it('⚖ 53 — 「ドラッグ中のみ」 is no longer a dead lever', () => {
    // The CSS gate has always been there; nothing ever set the class.
    expect(CSS).toContain('.biz .timeline.guard-guide-mode-drag:not(.guard-guide-aiming) .guard-placement-rail')
    expect(SRC).toContain("dragLen != null || live || blockLive ? 'guard-guide-aiming' : ''")
  })

  it('⚖ 50(c) — the aimed rail chip is in sync with the landing preview', () => {
    // canon :7599-7606 + the `.aimed` half of its :667 rule, which the
    // transplant dropped.
    expect(CSS).toContain('.biz .guard-rail-cell.aimed { outline: 0;')
    expect(SRC).toContain("aimed?.laneKey === rail.laneKey && aimed.start === c.start ? ' aimed' : ''")
    // Floored to the rail's own 30-minute lattice, never rounded: an off-lattice
    // landing belongs to the cell it starts INSIDE (flag 48's rule).
    expect(SRC).toContain('start: Math.floor(minuteOf(landing.x, hours) / 30) * 30')
    expect(SRC).not.toContain('start: Math.round(minuteOf(landing.x, hours) / 30) * 30')
  })
})

/* ────────────────────────────────────────────────────────────────────────────
 * ⚖ LIAM flag 50 (2026-08-22) — THE LIVE MID-DRAG VERDICT, AND ITS ONE HOME.
 *
 * The correctness property this whole batch exists for: the word at the cursor,
 * the × on the 60分配置 strip and what the release actually DOES are one
 * function, so the label can never promise something the release refuses. That
 * disagreement has a name in this lane — flag 54, where the strip advertised
 * ✓16:00 and the drop was refused by the bed allocator the strip never asked.
 *
 * Every case below drives the REAL `landingVerdict` on a real board.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('BATCH-9 ⚖ 50 — one verdict: 置けない / 要確認 / silence', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
  const CSS = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/today.css'), 'utf8')
  const INT = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/today-interactions.ts'), 'utf8')
  const GUARD = {
    services: [{ name: '整体60', dur: 60 }, { name: '骨盤90', dur: 90 }],
    newClientSessionMin: 90, protectedLabel: '新規', gapFillMinMin: 30, leadTimeMin: 0,
    mode: 'standard' as const,
  }
  const railIn = (over: Partial<Parameters<typeof guardVerdictAt>[3]> = {}) => ({
    open: HOURS.open, close: HOURS.close, stepMin: 30, dur: 60, protectedDur: 90,
    nowMinute: null, locked: [], guard: GUARD, ...over,
  })

  /** 見本 あずさ free all day · ベッド1 free · ベッド3 is the 個室. */
  const board = (over: { staff?: Partial<BoardLane>; beds?: BoardLane[] } = {}): BoardLane[] => [
    lane({ key: 'p-01', group: 'staff', label: '見本 あずさ', stores: ['store-a'], ...over.staff }),
    ...(over.beds ?? [
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1' }),
      lane({ key: 'bed-03', group: 'beds', label: 'ベッド3', roomClass: 'private' }),
    ]),
  ]

  /** One landing, asked the way the screen asks it. */
  const ask = (over: Partial<Parameters<typeof landingVerdict>[1]> = {}) => ({
    staffLane: 'p-01',
    bedLane: 'bed-01',
    solveRoom: true,
    id: 'apt-1',
    vip: false,
    start: 960,
    end: 1020,
    span: place(960, 1020, HOURS),
    foreignRefusal: null,
    locked: [] as string[],
    rooms: POLICY,
    minutesOf: (x: number) => minuteOf(x, HOURS),
    ...over,
  })
  const verdict = (lanes: BoardLane[], over = {}, cell: RailCell | null = null) =>
    landingVerdict(lanes, ask(over), cell)

  const cellOf = (state: RailCell['state'], sentence: string): RailCell => ({
    start: 960, state, label: '', sentence, reason: state === 'blocked' ? 'guard' : null,
    alternatives: [], alternativeKind: null, ackAllowed: state !== 'blocked',
  })

  // ── the three classes, and the word each one wears ───────────────────────
  it('a clean landing is SILENT — ⚖ Liam’s own reading of his demo', () => {
    const v = verdict(board(), {}, cellOf('safe', '新規90分の空きを守れます'))
    expect(v.kind).toBe('clean')
    // Canon's demo prints 「置ける」 here (updateGhost :7645). Liam's reading is
    // silence: the dashed landing preview already says where it goes, and a word
    // that is always true over open space is the noise ⚖ 44 rules against.
    expect(v.label).toBe('')
    expect(v.reason).toBeNull()
    expect(VERDICT_WORD.clean).toBe('')
  })

  it('a costly-but-legal landing is 要確認, and carries the engine’s own sentence', () => {
    const v = verdict(board(), {}, cellOf('degraded', '新規90分の空き2→1（1枠減・損を減らす）'))
    expect(v.kind).toBe('caution')
    expect(v.label).toBe('要確認')
    expect(v.reason).toBe('新規90分の空き2→1（1枠減・損を減らす）')
  })

  // RENEGOTIATED (batch-10, ⚖ flag 58 ROOT A). This used to read 「a
  // guard-refused landing is 置けない」 and it was wrong about which refusals:
  // the engine marks a standard-mode refusal `ackAllowed: true` — 「there is a
  // better start in this pocket」, not 「this is illegal」 — and only
  // R-UNAVAILABLE (and the no-pocket branch) is a real floor. The cell's own
  // flag is now the predicate, so the sentence alone no longer decides.
  it('an ACK-ALLOWED guard refusal is 要確認 — the engine says it may be placed', () => {
    const v = verdict(board(), {}, { ...cellOf('blocked', 'ここに置くと新規（90分）が入らなくなります'), ackAllowed: true })
    expect(v.kind).toBe('caution')
    expect(v.label).toBe('要確認')
    expect(v.reason).toBe('ここに置くと新規（90分）が入らなくなります')
  })

  it('a guard refusal the engine will NOT let through is 置けない, in its own words', () => {
    const v = verdict(board(), {}, cellOf('blocked', 'この開始には既存90分を配置できません'))
    expect(v.kind).toBe('blocked')
    expect(v.label).toBe('置けない')
    expect(v.reason).toBe('この開始には既存90分を配置できません')
  })

  // ── every OTHER way a landing is inert, each in the board's own vocabulary ─
  it('a double-booked PERSON is 置けない, and the sentence names who', () => {
    const busy = board({ staff: { items: [booking({ key: 'a', caseId: 'apt-other', title: '見本 あかり' }, 960, 1020)] } })
    const v = verdict(busy, {}, cellOf('safe', ''))
    expect(v.kind).toBe('blocked')
    // computeChecks' OWN sentence — the confirm surface and the cursor speak one
    // vocabulary, which is what makes the label and the gate provably the same.
    expect(v.reason).toBe('時間帯が重複: 見本 あかり')
  })

  it('a 満室 board is 置けない, and the sentence names every busy room', () => {
    const full = board({
      beds: [
        lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: [booking({ key: 'b1', caseId: 'x1', title: '見本 かえる' }, 960, 1020)] }),
        lane({ key: 'bed-03', group: 'beds', label: 'ベッド3', roomClass: 'private', items: [booking({ key: 'b3', caseId: 'x3', title: '見本 さくら' }, 960, 1020)] }),
      ],
    })
    const v = verdict(full, {}, cellOf('safe', ''))
    expect(v.kind).toBe('blocked')
    expect(v.reason).toContain('16:00〜17:00はベッドに空きがありません')
    expect(v.reason).toContain('ベッド1が使用中（見本 かえる様）')
  })

  it('a landing past the shift end is 置けない, in computeChecks’ own words', () => {
    const short = board({ staff: { untilLabel: '16:30', window: { from: 600, until: 990 } } })
    const v = verdict(short, {}, cellOf('safe', ''))
    expect(v.kind).toBe('blocked')
    expect(v.reason).toBe('見本 あずさは16:30以降勤務不可')
  })

  it('a shift-locked lane is 置けない', () => {
    const v = verdict(board(), { locked: ['p-01'] }, cellOf('safe', ''))
    expect(v.kind).toBe('blocked')
    expect(v.reason).toBe('見本 あずさはシフトロック中（新規配置不可）')
  })

  it('⚖ 46 — a chip from another store is 置けない before anything else is asked', () => {
    const v = verdict(board(), { foreignRefusal: 'テスト銀座店の予約です。…' }, cellOf('blocked', 'なにか'))
    expect(v.kind).toBe('blocked')
    // FIRST, ahead of every other reason: the operator is on the wrong board, and
    // telling them about a room on a board that may not take the booking at all
    // is advice about an impossible placement.
    expect(v.reason).toBe('テスト銀座店の予約です。…')
  })

  it('a release that found no lane is 置けない, not a silent no-op (⚖ 47)', () => {
    const v = verdict(board(), { staffLane: null })
    expect(v.kind).toBe('blocked')
    expect(v.reason).toBe('予約を置く行の中で離してください')
  })

  it('⚖ 51 exemption — an EXPLICIT bed-row choice in another store is 置けない', () => {
    const cross = [
      lane({ key: 'p-01', group: 'staff', label: '見本 あずさ', stores: ['store-a'] }),
      lane({ key: 'bed-09', group: 'beds', label: 'ベッド9', stores: ['store-b'] }),
    ]
    const v = landingVerdict(cross, ask({ solveRoom: false, bedLane: 'bed-09' }), cellOf('safe', ''))
    expect(v.kind).toBe('blocked')
    expect(v.reason).toBe('担当と店舗が異なります: 見本 あずさ / ベッド9')
    // …and the allocator is NOT consulted on that path — the operator named the
    // room out loud (⚖ 51's exemption, unchanged).
    expect(INT).toContain('const solved = q.solveRoom')
  })

  it('⚖ 51 on the EXPLICIT bed row — a VIP hand-placed onto a standard bed is 置けない', () => {
    // Greptile #744 P1. The exemption says the operator's own room choice is not
    // re-solved; it never said the floors stop applying. The allocator refuses to
    // put a 個室クラス booking anywhere but a 個室, and until now the bed-row drag
    // walked straight past that — same store, so `sharesStore` waved it through,
    // and nothing else on that path asked.
    const v = verdict(board(), { solveRoom: false, bedLane: 'bed-01', vip: true }, cellOf('safe', ''))
    expect(v.kind).toBe('blocked')
    expect(v.label).toBe('置けない')
    // The explanation names the POLICY, in the check rows' own voice — 「配置でき
    // ません」 with no reason is the unreadable error of flag 54.
    expect(v.reason).toBe('VIP・個室クラスのご予約です: ベッド1は個室ではありません')
    // …and the 個室 itself is still a clean landing for the same booking, so the
    // sentence is a floor and not a ban on bed-row drags.
    expect(verdict(board(), { solveRoom: false, bedLane: 'bed-03', vip: true }, cellOf('safe', '')).kind).toBe('clean')
  })

  it('⚖ 51 — the floor is the policy’s, not the board’s: OFF, and a non-VIP, are silent', () => {
    // The dial is store DATA (⚠SETTINGS-BATCH). A store that does not run its
    // 個室 that way gets no verdict at all…
    const off = { solveRoom: false, bedLane: 'bed-01', vip: true, rooms: { vipStaysPrivate: false, privateIsLastResort: true } }
    expect(verdict(board(), off, cellOf('safe', '')).kind).toBe('clean')
    // …and a regular booking on a standard bed never sees the sentence.
    expect(verdict(board(), { solveRoom: false, bedLane: 'bed-01', vip: false }, cellOf('safe', '')).kind).toBe('clean')
  })

  it('⚖ 51 — ONE spelling of the rule: the allocator FILTERS with it, the bed row TESTS with it', () => {
    const standard = lane({ key: 'bed-01', group: 'beds', label: 'ベッド1' })
    const priv = lane({ key: 'bed-03', group: 'beds', label: 'ベッド3', roomClass: 'private' })
    expect(roomFitsClass(standard, true, POLICY)).toBe(false)
    expect(roomFitsClass(priv, true, POLICY)).toBe(true)
    expect(roomFitsClass(standard, false, POLICY)).toBe(true)
    expect(roomFitsClass(standard, true, { vipStaysPrivate: false, privateIsLastResort: true })).toBe(true)
    // The auto path is UNCHANGED and still routes through the same predicate —
    // a VIP is solved into the 個室 and never into the free standard bed.
    expect(allocateBed(board(), { id: null, currentBed: null, stores: ['store-a'], vip: true, start: 960, end: 1020, policy: POLICY }).laneKey).toBe('bed-03')
    // Structurally one home: the allocator's filter IS this function, so the two
    // paths cannot drift into two answers (the defect this test exists for).
    expect(INT).toContain('const compatible = (l: BoardLane) => roomFitsClass(l, opts.vip, policy)')
    expect(INT).toContain('if (!q.solveRoom && bed && !roomFitsClass(bed, q.vip, q.rooms)) {')
    // Exactly two readings of `roomClass` survive in the whole file: this
    // predicate, and the 個室-last ORDERING (a different rule about spending the
    // room, not about needing it). A third is the rule re-spelled somewhere.
    expect(INT.match(/roomClass === 'private'/g)).toHaveLength(2)
  })

  it('⚖ 50(d) — the VIP floor is a red like any other, so it carries the gated override', () => {
    // Nothing special was built for it: it is `blocked`, and every blocked
    // landing on every gesture ending goes to `explainBlocked`, whose 「注意して
    // 配置」 exists only where the store's overridePolicy put it.
    // RENEGOTIATED (batch-10, ⚖ 61): a release over NO ROW has nothing to
    // escalate onto, so `explainBlocked` now takes a nullable escalation and the
    // store gate is joined by "is there something to place". Same gate, one
    // extra floor.
    expect(SRC).toContain("override: props.canOverride && escalate && v.floor === 'policy' ? () => { setAdvice(null); escalate() } : null,")
    // On a BED-ROW gesture the override places on the room the operator named —
    // `land` re-solves the bed only for the staff-side paths, so the escalation
    // is the manager putting the VIP in that exact bed, stamped with the reason
    // it walked past (`land(v.reason, span)` → `stage(..., override)`).
    // (batch-10, ⚖ flag 59 — the group test is the whole exemption; the
    // `on.bedLane != null` conjunct this pin used to carry was the bug.)
    expect(SRC).toContain("if (ctx.group !== 'beds') {")
    expect(SRC).toContain('override: () => land(v.reason, span),')
  })

  // ── the ORDER is the answer the operator can act on ──────────────────────
  it('the person’s own clash outranks 満室 — one is about who, the other about where', () => {
    const both = [
      lane({ key: 'p-01', group: 'staff', label: '見本 あずさ', stores: ['store-a'], items: [booking({ key: 'a', caseId: 'apt-other', title: '見本 あかり' }, 960, 1020)] }),
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: [booking({ key: 'b1', caseId: 'x1', title: '見本 かえる' }, 960, 1020)] }),
    ]
    expect(verdict(both, {}, cellOf('safe', '')).reason).toBe('時間帯が重複: 見本 あかり')
  })

  it('満室 outranks the guard — a room that does not exist is not a pricing question', () => {
    const full = board({
      beds: [lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: [booking({ key: 'b1', caseId: 'x1', title: '見本 かえる' }, 960, 1020)] })],
    })
    expect(verdict(full, {}, cellOf('blocked', 'ここに置くと新規（90分）が入らなくなります')).reason).toContain('に空きがありません')
  })

  // ── ⚖ FLAG 54, THE REPRO ─────────────────────────────────────────────────
  it('⚖ FLAG 54 — a ✓-advertised start whose ROOM is full now reads 置けない, not ✓', () => {
    // Liam's scene, 8/22 03:51: テスト くらら dragged onto a ✓16:00 and refused
    // with an error he could not identify. The chip and the checker disagreed
    // because the strip asked the GUARD and the drop also asked the ALLOCATOR.
    const roomsFull = board({
      // A 16:00–17:00 shift: the booking fills the pocket exactly, so there is
      // no protected 90 to lose and the guard is honestly SAFE at 16:00.
      staff: { window: { from: 960, until: 1020 }, untilLabel: '17:00' },
      beds: [
        lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: [booking({ key: 'b1', caseId: 'x1', title: '見本 かえる' }, 960, 1020)] }),
        lane({ key: 'bed-03', group: 'beds', label: 'ベッド3', roomClass: 'private', items: [booking({ key: 'b3', caseId: 'x3', title: '見本 さくら' }, 960, 1020)] }),
      ],
    })
    // The guard alone still says the start is safe — that is the ✓ he saw.
    const guardSaysSafe = guardVerdictAt(roomsFull, 'p-01', 960, railIn({ excludeId: 'apt-1' }))!
    expect(guardSaysSafe.state).toBe('safe')
    expect(guardSaysSafe.label).toBe('✓16:00')
    // The ONE verdict — the same one the strip's mark and the release both read
    // — says 置けない, and says WHY in a sentence he can act on.
    const v = verdict(roomsFull, {}, guardSaysSafe)
    expect(v.kind).toBe('blocked')
    expect(v.reason).toContain('に空きがありません')
    // …and the strip's face comes from THAT, never from the guard cell alone.
    expect(SRC).toContain('const v = inHand ? verdictFor({ ...inHand, staffLane: rail.laneKey, span: place(c.start, c.start + railDur, hours) }, c) : null')
    expect(SRC).toContain("const state = v ? (v.kind === 'blocked' ? 'blocked' : v.kind === 'caution' ? 'degraded' : 'safe') : c.state")
  })

  it('⚖ FLAG 54, the other half — the strip answers for the CARD’S length, not canon’s 60', () => {
    // A 150-minute pocket takes a 60 and refuses a 180, so a strip frozen at 60
    // would advertise ✓ to an operator carrying a 3-hour booking.
    const l = [lane({ key: 'p-01', group: 'staff', label: '見本 あずさ', stores: ['store-a'], window: { from: 600, until: 750 }, untilLabel: '12:30' })]
    expect(guardVerdictAt(l, 'p-01', 600, railIn({ dur: 60 }))!.state).toBe('safe')
    expect(guardVerdictAt(l, 'p-01', 600, railIn({ dur: 180 }))!.state).toBe('blocked')
    expect(SRC).toContain('const railDur = aimDur ?? props.guard.standardSessionMin')
    expect(SRC).toContain('dur: railDur,')
    // …and the strip SAYS which length it is answering for, so a ✓ is never read
    // as a promise about a different booking.
    expect(SRC).toContain('<span className="guard-rail-label">{railDur}分配置</span>')
  })

  // ── item 4b — the × on the spot itself ───────────────────────────────────
  it('⚖ item 4b — the × marks the inert spots, only mid-drag, only where release is inert', () => {
    expect(SRC).toContain("? (v.kind === 'blocked' ? '×' : v.kind === 'caution' ? `△${hhmm(c.start)}` : `✓${hhmm(c.start)}`)")
    // `inHand` is null with nothing in flight → the strip keeps canon's resting
    // face (✓/△/—) and no × exists anywhere on the board (⚖ 37, no leak).
    expect(SRC).toContain('const inHand = useMemo<LandingAsk | null>(() => {')
    expect(SRC).toContain('    return null\n  }, [live, proxy, parkChips, boardLanes, props.store])')
    // ⚖ 52 — the mark that means "this stops you" appears exactly where release
    // is inert, and its class comes off the blocked verdict alone.
    expect(SRC).toContain("${v?.kind === 'blocked' ? ' inert' : ''}")
    expect(CSS).toContain('.biz .guard-rail-cell.inert {')
    // A block drag carries no booking, so it marks nothing (canon has no guard
    // for 休憩 either) — and neither does a bed-row drag, which can never land
    // on the staff strips these marks live on.
    expect(SRC).toContain("if (live.group === 'beds' || live.overShelf || live.mode !== 'move') return null")
  })

  // ── (b) the cursor label, and the perf bar ───────────────────────────────
  it('(b) the word rides the proxy, is written outside React, and is memoised per START', () => {
    expect(SRC).toContain('<i className="proxy-verdict" ref={(el) => { proxyVerdictRef.current = el }} />')
    // Written to the node, never through state — the board is not re-rendered
    // for a word (the perf bar).
    expect(SRC).toContain('node.dataset.verdict = kind')
    expect(SRC).not.toContain('setProxyVerdict')
    // …and the engine is not run per pixel: an unchanged (lane, span) re-uses
    // the answer.
    // RENEGOTIATED (batch-10, ⚖ 61): the memo key carries the OFF-LANE answer
    // too, so the word repaints when the pointer leaves every row without the
    // span having changed.
    expect(SRC).toContain("const key = `${ctx.offLane ? '' : ctx.targetLane}|${span.x}|${span.w}`\n    if (key === ctx.aimKey) return")
    expect(SRC).toContain('const key = `${ctx.laneKey}|${span.x}`\n    if (key === ctx.aimKey) return')
    // The frame reads the CURRENT board through a ref: its listeners were bound
    // at pointerdown and hold that render's closure.
    expect(SRC).toContain('const verdictRef = useRef(verdictAtLanding)\n  verdictRef.current = verdictAtLanding')
    // canon's two treatments: red dashed for refused, the guard family dotted
    // for costly, and the BOX goes red with the word (his own complaint).
    expect(CSS).toContain('.biz .proxy-verdict[data-verdict="blocked"] { border: 1px dashed var(--red);')
    expect(CSS).toContain('.biz .proxy-verdict[data-verdict="caution"] { border: 1px dotted var(--guard-dark);')
    expect(CSS).toContain('.biz .drag-proxy[data-verdict="blocked"] {')
    // Nothing is painted on a clean landing.
    expect(CSS).toContain('.biz .proxy-verdict {\n  position: absolute;')
    expect(CSS).toContain('  display: none;')
  })

  // ── (a) the candidate lane ───────────────────────────────────────────────
  it('(a) the candidate lane is outlined while the drag is over it, own lane included', () => {
    // canon-production lights a lane only on a CHANGE (:4515-4517); canon's demo
    // — the design Liam approved — lights whatever lane the pointer is over
    // (:7817-7818). The flip is scoped to drag state by construction: every
    // branch is gated on something being in flight.
    expect(SRC).toContain('const dropTarget = blockLive\n    ? { laneKey: blockLive.targetLane, x: blockLive.x, w: blockLive.w }\n    : live && !live.overShelf && !live.offLane')
    expect(SRC).not.toContain('live.targetLane !== live.homeLane')
    expect(SRC).not.toContain('blockLive.targetLane !== blockLive.homeLane')
    // Border, not colour — ⚖ 38's law, and the CSS rule is untouched.
    expect(CSS).toContain('.biz .track.drop-target {')
  })

  // ── (d) the sweep: EVERY gesture ending is inert over red ────────────────
  it('(d) every gesture ending asks the ONE verdict and is inert over 置けない', () => {
    for (const [name, from, to] of [
      ['card drop / resize end', 'function finishDrag(', 'function explainBlocked('],
      ['keyboard commit', 'function onCardKeyDown(', 'function park('],
      ['chip place + 次回予約 + create', 'function askGuard(', 'function closeAdvice('],
    ] as const) {
      const body = SRC.slice(SRC.indexOf(from), SRC.indexOf(to))
      // RENEGOTIATED (batch-10, ⚖ 63 §4): the card release asks through
      // `verdictRef` — the same escape hatch the hover has always used — so it
      // judges the board as it stands rather than the pointerdown closure's.
      expect([name, body.includes('const v = verdictAtLanding(ask)') || body.includes('const v = verdictRef.current(ask)')]).toEqual([name, true])
      // The EXACT gating line, not a substring: `kind === 'blocked'` also appears
      // inside the alternative-start re-check, so a weaker pin survives a mutant
      // that opens the gate (M10 of the batch-9 red-runs found this test, not
      // the code — a mutant that lives is a test that is not doing its job).
      expect([name, body.includes("if (v.kind === 'blocked') {")]).toEqual([name, true])
      expect([name, body.includes('explainBlocked(')]).toEqual([name, true])
    }
    // The release path explains and does NOT stage (⚖ 47: a refusal changes
    // nothing). ⚖ flag 57 — RENEGOTIATED: it no longer writes the pair back
    // either, because that write was the card's snap-back and was redundant
    // besides; the branch explains, and it hands over the attempted landing so
    // the card stays visible at the spot the question is about.
    const finish = SRC.slice(SRC.indexOf('function finishDrag('), SRC.indexOf('function explainBlocked('))
    expect(finish).toContain("if (v.kind === 'blocked') {")
    expect(finish.indexOf("if (v.kind === 'blocked') {")).toBeLessThan(finish.indexOf('land(null, span)'))
    expect(finish).toContain('}, { id: ctx.id, staffLane: sides.staffLane, bedLane: sides.bedLane, span })')
  })

  // ── (d) the explanation surface and its authority gate ───────────────────
  it('(d) the explanation is a POPOVER, not a toast, and the override is store-gated', () => {
    // ⚖ 50(d): 「a clear description on why you shouldn't place it there」. A
    // 7-second toast is the flag-47 complaint in a different costume.
    expect(SRC).toContain("kind: 'blocked',")
    expect(SRC).toContain('reason: v.reason ?? \'配置できません\',')
    expect(SRC).toContain('{advice.kind === \'blocked\' && <div className="gp-verdict">置けない</div>}')
    expect(SRC).toContain('<div className="gp-reason">{advice.reason}</div>')
    // The action exists ONLY where the store's own policy put it, and it is not
    // the primary button — the surface advises against it.
    // RENEGOTIATED (batch-10, ⚖ 61): a release over NO ROW has nothing to
    // escalate onto, so `explainBlocked` now takes a nullable escalation and the
    // store gate is joined by "is there something to place". Same gate, one
    // extra floor.
    expect(SRC).toContain("override: props.canOverride && escalate && v.floor === 'policy' ? () => { setAdvice(null); escalate() } : null,")
    expect(SRC).toContain('<button className="btn caution" type="button" onClick={advice.override}>注意して配置</button>')
    expect(CSS).toContain('.biz .guard-pop .btn.caution { border: 1px solid var(--red); background: #fff;')
    // ⚠SETTINGS-BATCH: the authority is DATA, decided on the server from the
    // store's dial and this operator's role — never a literal in the board.
    expect(opsConfig.overridePolicy.roles).toContain('店舗管理者')
    expect(opsConfig.overridePolicy.lockedOut).toEqual([])
    expect(SRC).not.toContain('店舗管理者')
    expect(INT).not.toContain('店舗管理者')
    // ⚖ ruling 91 / spec §7 — the same authority, read through the dial's own
    // three-level consult. (a) is the shipped default, `lockedOut` answers
    // first whatever the role says, and a role the store left out is refused.
    expect(overrideLevelFor(opsConfig.overridePolicy, { role: 'スタッフ', staff_id: 'p-04' })).toBe('allow-warned')
    expect(overrideLevelFor({ roles: ['スタッフ'], lockedOut: ['p-04'] }, { role: 'スタッフ', staff_id: 'p-04' })).toBe('refuse')
    expect(overrideLevelFor({ roles: ['店舗管理者'], lockedOut: [] }, { role: 'スタッフ', staff_id: 'p-04' })).toBe('refuse')
  })

  // ── the override, and exactly what it buys ───────────────────────────────
  it('⚖ 50(d) — an override lifts the ONE row it overrode, and nothing else', () => {
    const overlap = { ok: false, label: '時間帯が重複: 見本 あかり' }
    const locked = { ok: false, label: '見本 あずさはシフトロック中（新規配置不可）' }
    const fine = { ok: true, label: '整体資格 一致' }
    // No override → byte-for-byte `confirmCaption`.
    expect(overrideCaption([overlap, fine], null)).toEqual(confirmCaption([overlap, fine]))
    expect(overrideCaption([fine], null)).toEqual(confirmCaption([fine]))
    // The overridden row stops blocking…
    expect(overrideCaption([overlap, fine], overlap.label).enabled).toBe(true)
    expect(overrideCaption([overlap, fine], overlap.label).label).toBe('この内容で確定')
    // …and a SECOND blocker still stops the confirm (canon's R11-7, kept).
    expect(overrideCaption([overlap, locked, fine], overlap.label).enabled).toBe(false)
    // An override for a reason that is no longer on the board buys nothing.
    expect(overrideCaption([locked, fine], overlap.label).enabled).toBe(false)
    // ⚖ 52 — the row stays visible and wears △, never ×, because it no longer
    // blocks: a × over a live 確定 is the broken check flag 52 killed.
    expect(SRC).toContain("? { label: `注意して配置: ${c.label}`, tone: 'warn' as const }")
    expect(CSS).toContain('.biz .holdbar-checks .ck.warn::before { content: "△";')
  })

  it('⚖ 50(d) — the escalation reaches the ROOM too, and the VIP floor still holds', () => {
    const full = [
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: [booking({ key: 'b1', caseId: 'x1', title: '見本 かえる' }, 960, 1020)] }),
      lane({ key: 'bed-03', group: 'beds', label: 'ベッド3', roomClass: 'private', items: [booking({ key: 'b3', caseId: 'x3', title: '見本 さくら' }, 960, 1020)] }),
    ]
    const opts = { id: null, currentBed: null, stores: ['store-a'], start: 960, end: 1020, policy: POLICY }
    // Without the escalation it is 満室, naming the rooms (⚖ 51, unchanged).
    expect(allocateBed(full, { ...opts, vip: false }).laneKey).toBeNull()
    // With it, the allocator names the room it WOULD have chosen — 個室 last for
    // a regular booking, exactly as when the rooms are free.
    expect(allocateBed(full, { ...opts, vip: false, allowBusy: true }).laneKey).toBe('bed-01')
    expect(allocateBed(full, { ...opts, vip: false, allowBusy: true }).refusal).toBeNull()
    // The VIP floor is a rule about what the treatment NEEDS, not about who is
    // in the way: an escalation still may not walk a VIP out of the 個室.
    expect(allocateBed(full, { ...opts, vip: true, allowBusy: true }).laneKey).toBe('bed-03')
    // A move keeps the room it carries rather than being re-solved onto another.
    expect(allocateBed(full, { ...opts, currentBed: 'bed-03', vip: false, allowBusy: true }).laneKey).toBe('bed-03')
  })

  // ── THE AGREEMENT PROPERTY, walked ───────────────────────────────────────
  it('THE CORE PROPERTY — label, mark and release are ONE function, on every class', () => {
    // Four boards, one per verdict class, each asked ONCE. The cursor writes
    // `v.label`, the strip writes `v.kind`, the release gates on `v.kind` — so
    // agreement is not a coincidence these tests check, it is the shape.
    const cases: Array<[string, BoardLane[], RailCell | null, 'clean' | 'caution' | 'blocked', string]> = [
      ['clean', board(), cellOf('safe', 'ok'), 'clean', ''],
      ['costly', board(), cellOf('degraded', '減ります'), 'caution', '要確認'],
      // RENEGOTIATED (batch-10, ⚖ 58 ROOT A): a guard refusal is TWO classes,
      // and the engine's own `ackAllowed` is which. Both are pinned here so the
      // agreement property is walked on the class that actually changed.
      ['guard-refused (ack-allowed)', board(), { ...cellOf('blocked', '入らなくなります'), ackAllowed: true }, 'caution', '要確認'],
      ['guard-refused (floor)', board(), cellOf('blocked', '既存90分を配置できません'), 'blocked', '置けない'],
      ['person busy', board({ staff: { items: [booking({ key: 'a', caseId: 'apt-other', title: '見本 あかり' }, 960, 1020)] } }), cellOf('safe', 'ok'), 'blocked', '置けない'],
    ]
    for (const [name, lanes, cell, kind, label] of cases) {
      const v = landingVerdict(lanes, ask(), cell)
      expect([name, v.kind, v.label]).toEqual([name, kind, VERDICT_WORD[kind]])
      expect([name, v.label]).toEqual([name, label])
      // Anything that is not silent ALWAYS carries a sentence the surface can
      // print, and silence carries none. (An empty reason on a refusal is
      // exactly the unreadable error of flag 54.)
      expect([name, v.kind === 'clean' ? v.reason === null : typeof v.reason === 'string' && v.reason.length > 0])
        .toEqual([name, true])
    }
    // ONE HOME, structurally: every consumer routes through `verdictFor`, and
    // `verdictFor` is the only caller of `landingVerdict` in the screen.
    expect(SRC.match(/landingVerdict\(/g)).toHaveLength(1)
    expect(SRC).toContain('const verdictAtLanding = useCallback(')
    expect(SRC).toContain('return verdictFor(q, q.staffLane ? verdictAt(q.staffLane, start, dur, q.id) : null)')
  })

  // ── ⚖ FLAG 55 — the silent guard row, answered ───────────────────────────
  it('⚖ FLAG 55 — five ✓ and no guard line is SILENT-BECAUSE-CLEAN, not a missing row', () => {
    // His scene: くらら → 16:00〜17:00 inside what looked like a protected 90.
    // `guardCheckRow` returns null for a SAFE cell by design (⚖ 31b: a check
    // that always passes is noise) — so the row's absence is the guard saying
    // the landing costs nothing, and it is reachable on the real engine.
    expect(guardCheckRow(cellOf('safe', '新規90分の空きを守れます'))).toBeNull()
    // …and the engine really does judge a landing that SPLITS a long run clean:
    // 10:00–13:00 with a 60 placed at 11:00 leaves 60 + 60, no 90 either side,
    // so THAT one is refused — the difference is measurable, not a missing row.
    const long = [lane({ key: 'p-01', group: 'staff', window: { from: 600, until: 750 }, untilLabel: '12:30' })]
    // 150 free minutes hold exactly one 新規90分. A 60 at the START leaves 90
    // whole behind it — capacity 1 → 1, nothing lost, and the row is silent.
    expect(guardVerdictAt(long, 'p-01', 600, railIn())!.state).toBe('safe')
    expect(guardCheckRow(guardVerdictAt(long, 'p-01', 600, railIn()))).toBeNull()
    // The SAME booking half an hour later breaks the run into 30 + 60 and the
    // 90 is gone — refused, and it says so. The absence of a row is a MEASURED
    // difference, not a missing surface.
    expect(guardVerdictAt(long, 'p-01', 630, railIn())!.state).toBe('blocked')
    expect(guardCheckRow(guardVerdictAt(long, 'p-01', 630, railIn()))?.tone).toBe('warn')
    // The batch-4 row is present on the placement path — it is not missing.
    expect(SRC).toContain('guardRow: pendingGuardRow,')
    expect(SRC).toContain('{holdPop.guardRow && <span className={`ck ${holdPop.guardRow.tone}`}>{holdPop.guardRow.label}</span>}')
  })

  // ── ⚖ FLAG 56 — the confirm that fires twice ─────────────────────────────
  it('⚖ FLAG 56 — answering a staged change never hands back a SECOND confirm', () => {
    // ROOT CAUSE, found by reading the surface's own ternary: `holdPop` falls
    // through to the DAY's standing 仮押さえ the moment `pending` clears, and
    // only `confirmPending` was closing that second question (it sets
    // `holdAnswer`). 元に戻す cleared `pending` and left `holdAnswer` null — so
    // the pill reappeared with 「この内容で確定」 in the same beat, which is
    // exactly 「it asks me この内容で確定 box pops up like twice in a row」.
    const revert = SRC.slice(SRC.indexOf('function revertPending()'), SRC.indexOf('function confirmPending()'))
    expect(revert).toContain("setHoldAnswer('reverted')")
    // …and ⚖ 41's own rule is what it obeys: the surface's OTHER answer closes
    // it for the session, exactly as the day-hold's own 元に戻す already did.
    expect(SRC).toContain("revert: { enabled: true, run: () => { setHoldAnswer('reverted'); show('仮押さえのままにしました') } },")
    // The confirm half was already right and stays right.
    const confirm = SRC.slice(SRC.indexOf('function confirmPending()'), SRC.indexOf('// canon (:6941-6947)'))
    expect(confirm).toContain("setHoldAnswer('confirmed')")
    // One question at a time: the surface is a ternary, so the two can never be
    // on screen together — what was wrong was the SECOND one arriving unasked.
    expect(SRC).toContain('const holdPop: HoldPop | null = pending')
    expect(SRC).toContain("props.hold && holdAnswer === null")
  })

  // ── tour registration (FLAGS 25c) ────────────────────────────────────────
  it('FLAGS 25c — the new grammar is explained where the grammar lives', () => {
    // Nothing this round adds a SECTION: the marks and the label are new faces
    // of the 60分配置 strip and of the drag itself, both already registered. So
    // the delta is zero SECTIONS and one SENTENCE — the strip's own entry now
    // teaches the mid-drag reading, which is where an operator meets it.
    // ⚖ R3 one world + ⚖ FIX-9 — the mid-drag half says WHAT the drag changes
    // AND which drag: the lift is a BOARD-CARD drag's privilege, because a shelf
    // chip is not on the board to be lifted out of it. 「ボードのカード」 is the
    // word that stops the old copy claiming otherwise.
    expect(SRC).toContain('ボードのカードをドラッグしている間は、その1枚だけを外した状態で判定し直します。')
    // ⚖ NATIVE PASS — 「離しても配置されません」 was true of a HARD floor and false
    // of a policy one, where 注意して配置 places exactly what the × sat on. The
    // passed clause is true on both.
    expect(SRC).toContain('置けない場所には×が付き、離すと配置されずに理由が表示されます。')
    expect(SRC).not.toContain('離しても配置されません')
    // ⚖ FIX-9 — and the スキマガード band no longer describes the strip in its own
    // stale words: one home, and it points at the strip's entry.
    expect(SRC).toContain('各スタッフの下に細い帯が出ているときは、その帯の説明をご覧ください。')
    expect(SRC).not.toContain('その時間に60分の施術を始めた場合の判定が並びます')
    // ONE entry, still: a pair on every strip would put the same step on the
    // tour once per staff member (batch-7's rule, unchanged).
    expect(SRC).toContain("{...(rails[0]?.laneKey === rail.laneKey")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// BATCH-10 (2026-08-22) — flags 57-68 + the Fable sweep riders.
// PACKET-BATCH10-2026-08-22.md / STUDY-BATCH10-2026-08-22.md.
// ═══════════════════════════════════════════════════════════════════════════

describe('BATCH-10 W1 — the trivial trio: bed solve, proxy paint, block step', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
  const CSS = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/today.css'), 'utf8')
  const PAGE = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/page.tsx'), 'utf8')

  // ── ⚖ flag 59 — 担当 … / — on a staged confirm ────────────────────────────
  it('⚖ 59 — a booking that arrives with NO room reaches the allocator, on both landing paths', () => {
    // ROOT (study §59): `land()` asked for a room only when one already existed
    // — `&& on.bedLane != null` — so `resource_id: null` bookings staged with no
    // bed row and `holdSummary` printed the em-dash. Both landing paths carried
    // the same inverted guard: the pointer release and the keyboard nudge.
    const land = SRC.slice(SRC.indexOf('const land = (override: string | null, at:'), SRC.indexOf('const v = verdictAtLanding(ask)'))
    expect(land).toContain("if (ctx.group !== 'beds') {")
    // The window is the nudge's `land` up to its `stage(` — a fixed character
    // count went stale the moment ⚖ 87 added three comment lines above the
    // guard, which is a pin measuring the wrong thing.
    const nudge = SRC.slice(SRC.indexOf('const land = (override: string | null) => {'))
    // If the `stage(id, on, next,` literal ever drifts, indexOf returns -1 and
    // slice(0, -1) would silently widen the window instead of failing loudly.
    const stageIdx = nudge.indexOf('stage(id, on, next,')
    expect(stageIdx).toBeGreaterThan(0)
    expect(nudge.slice(0, stageIdx)).toContain("if (lane.group !== 'beds') {")
    // …and NEITHER landing still tests the carried room before solving.
    expect(SRC).not.toContain("!== 'beds' && on.bedLane")
  })

  it('⚖ 59 — the allocator is written for the null room, and the verdict already solved it', () => {
    const staff = lane({ key: 'p-06', group: 'staff', label: '見本 あずさ', stores: ['store-a'] })
    const free = lane({ key: 'bed-01', group: 'beds', label: 'ベッド1' })
    const lanes = [staff, free]
    // `currentBed: null` is the contract — it is how `placeNextVisit` calls it.
    const solved = allocateBed(lanes, {
      id: 'apt-akari', currentBed: null, stores: ['store-a'], vip: false,
      start: 780, end: 840, policy: POLICY,
    })
    expect(solved.refusal).toBeNull()
    expect(solved.laneKey).toBe('bed-01')
    // The em-dash is `holdSummary` reading a board with no bed drawing at all —
    // which is exactly what the skipped solve produced.
    const at = { laneKey: 'p-06', ...place(780, 840, HOURS) }
    const noBed = holdSummary(
      [{ ...staff, items: [booking({ key: 's', caseId: 'apt-akari' }, 780, 840)] }, free],
      'apt-akari', at, HOURS,
    )
    expect(noBed).toContain('/ —')
    // …and with the room drawn, the confirm names it (⚖ 51's own law).
    const withBed = holdSummary(
      [
        { ...staff, items: [booking({ key: 's', caseId: 'apt-akari' }, 780, 840)] },
        { ...free, items: [booking({ key: 'b', caseId: 'apt-akari' }, 780, 840)] },
      ],
      'apt-akari', at, HOURS,
    )
    expect(withBed).toContain('ベッド1')
    expect(withBed).not.toContain('/ —')
  })

  // ── ⚖ flag 60 — the proxy's paint ────────────────────────────────────────
  it('⚖ 60 — the card in hand is opaque, and its verdict badge is off the card’s own words', () => {
    const proxy = CSS.slice(CSS.indexOf('.biz .event.drag-proxy,'), CSS.indexOf('.biz .event.drag-proxy { box-sizing'))
    // The 4% was the whole leak: every fill underneath is opaque hex, so the
    // cell price read straight through the card AND through the 置けない badge.
    expect(proxy).toContain('opacity: 1;')
    expect(proxy).not.toContain('opacity: .96')
    const badge = CSS.slice(CSS.indexOf('.biz .proxy-verdict {'), CSS.indexOf('.biz .proxy-verdict[data-verdict="blocked"],'))
    // Dead centre put 置けない squarely on <strong>/<small>; the trailing edge
    // is the one region a board card never writes into at either density.
    expect(badge).not.toContain('translate(-50%, -50%)')
    expect(badge).toContain('right: 3px;')
    expect(badge).toContain('bottom: 3px;')
    // It still paints only for the two refusal classes — silence over open
    // space is ⚖ Liam's own reading of the demo, untouched.
    expect(CSS).toContain('.biz .proxy-verdict[data-verdict="blocked"],\n.biz .proxy-verdict[data-verdict="caution"] { display: block; }')
  })

  // ── ⚖ flag 65 — the store's block step, and the dead booking dial ────────
  it('⚖ 65 — the store’s block lattice is 15 minutes, at the one seam that owns it', () => {
    expect(opsConfig.blockStepMin).toBe(15)
    // The seam was already threaded end to end — this is a config edit, not a
    // code change: page → guard.config → BLOCK_STEP → nextSpan.
    expect(SRC).toContain('const BLOCK_STEP = blockStepPct(hours.count, props.guard.config.blockStepMin)')
    expect(PAGE).toContain('blockStepMin: planes.opsConfig.blockStepMin,')
    expect(blockStepPct(9, opsConfig.blockStepMin)).toBeCloseTo(stepPct(9, 15), 12)
    // The on-screen hint prints the same value, so the copy cannot drift.
    expect(SRC).toContain('（{props.guard.config.blockStepMin ?? 5}分きざみ）')
  })

  it('⚖ 65 — the create dialog’s lengths are a plain list, no longer hostage to the step', () => {
    // Derived as [1,2,3,6,12] × step × 2, flipping the dial to 15 produced
    // [30,60,90,180,360]: no sub-30 block and a six-hour 休憩.
    expect(PAGE).toContain('blockLengths: [15, 30, 45, 60, 90, 120],')
    expect(PAGE).not.toContain('[1, 2, 3, 6, 12].map')
    // …and every offered length is still a whole number of block steps, so the
    // board can move whatever this dialog creates (canon :4218-4231's lesson).
    for (const n of [15, 30, 45, 60, 90, 120]) expect(n % opsConfig.blockStepMin).toBe(0)
  })

  it('⚖ 65 — bookingStepMin stops being a dead lever: the board reads the store’s own dial', () => {
    // Study §65: `bookingStepMin` appeared in exactly two places — its own
    // definition and a doc comment. NOTHING read it; `stepPct`'s default 30 was
    // the real lattice. That is flag 53's disease inside the store config.
    expect(SRC).toContain('const STEP = stepPct(hours.count, props.guard.bookingStepMin)')
    expect(SRC).not.toContain('const STEP = stepPct(hours.count)\n')
    expect(PAGE).toContain('bookingStepMin: planes.opsConfig.bookingStepMin,')
    // Same value today, so the wiring is provably a no-op on behaviour…
    expect(opsConfig.bookingStepMin).toBe(30)
    expect(stepPct(9, opsConfig.bookingStepMin)).toBeCloseTo(stepPct(9), 12)
    // …and it lives on the BOARD's prop, not inside the frozen engine's
    // GuardConfig, which has no opinion about how a card snaps.
    expect(SRC).toContain('bookingStepMin: number')
  })

  it('⚖ 65 — an off-grid fixture block keeps its own phase, which is canon, not a regression', () => {
    // blk-03 レジ締め stands 17:30〜17:50 — a 20-minute box whose end is off any
    // 15-minute grid. canon's dual lattice moves it in 15-minute jumps while
    // PRESERVING that phase; silently rounding it would make 「現在値をプリセット」
    // a lie (canon :4218-4231). Proven here so the :50 is not read as a bug.
    const track = document.createElement('div')
    rect(track, { left: 0, top: 0, width: 900, height: 40 })
    const step15 = stepPct(9, 15)
    const start = place(1050, 1070, HOURS) // 17:30〜17:50
    const origin = dragOrigin(start.x, start.w, 'move', step15)
    const moved = nextSpan(origin, track, 25, step15) // one 15-minute step right
    expect(minuteOf(moved.x, HOURS)).toBeCloseTo(1065, 6)
    expect(minuteOf(moved.x + moved.w, HOURS)).toBeCloseTo(1085, 6) // still :05 phase, still 20 long
  })
})

describe('BATCH-10 W2 — ⚖ flag 68: the block advisor stops lying', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')

  it('⚖ 31c — 提案位置に置く is judged by the SAME gate the drop is, and a refusal changes nothing', () => {
    // ROOT (study §68): `takeBlockSuggestion` wrote `blockMoves` outright —
    // `blockClash` had exactly one call site in the whole tree (the drop), so
    // the advisor could lay a block over a real booking and say nothing, while
    // both booking-side alternative buttons re-verify on purpose.
    const take = SRC.slice(SRC.indexOf('function takeBlockSuggestion('), SRC.indexOf('function blockSuggestionIsOrigin('))
    expect(take).toContain("if (locked.includes(a.laneKey)) {")
    expect(take).toContain("if (blockClash(placedLanes.find((l) => l.key === a.laneKey), a.key, at)) {")
    // Both refusals speak through the ONE door and return before any write.
    expect(take.indexOf('refuse(')).toBeLessThan(take.indexOf('setBlockMoves('))
    expect(take.match(/refuse\(/g)).toHaveLength(2)
    // …and `blockClash` now has THREE call sites, all of them landing gates:
    // the drop, the advisor's own suggestion filter (⚖ 58 RIDER) and this
    // button. It had exactly ONE before this round.
    expect(SRC.match(/blockClash\(/g)).toHaveLength(3)
  })

  it('⚖ 31c — the gate is the real predicate, not a copy of it', () => {
    // The same function the drop calls, on real lanes: a suggestion that lands
    // on a booking is a clash; the block never clashes with ITSELF (the drop
    // has already written it, so it is standing on the board when this runs).
    const at = place(705, 765, HOURS) // 11:45〜12:45
    const occupied = lane({
      key: 'c-03', group: 'staff',
      items: [booking({ key: 'other', caseId: 'apt-x' }, 720, 780)],
    })
    expect(blockClash(occupied, 'blk-04', at)).toBe(true)
    const itself = lane({
      key: 'c-03', group: 'staff',
      items: [{ ...booking({ key: 'blk-04', caseId: null }, 780, 840), kind: 'block' }],
    })
    expect(blockClash(itself, 'blk-04', place(780, 840, HOURS))).toBe(false)
  })

  it('⚖ Q8 (a) — when the "proposal" IS the origin, the button is 元に戻す and runs the undo', () => {
    // The engine keeps naming the origin because `nearestBestAlternatives`
    // returns the nearest best start BEFORE the drop first, on a board with the
    // block lifted out — so the spot the operator just left is a candidate and
    // was never compared against.
    expect(SRC).toContain('function blockSuggestionIsOrigin(a: NonNullable<typeof blockAdvice>): boolean {')
    expect(SRC).toContain('return a.suggest === a.originStart && a.laneKey === a.homeLane')
    // Both halves are snapped at the drop, from values already in scope.
    expect(SRC).toContain('originStart: minuteOf(ctx.origin.x, hours),')
    expect(SRC).toContain('homeLane: ctx.homeLane,')
    // ONE path: 元に戻す is `undoBlockDrop`, which is what やめる already runs.
    expect(SRC).toContain('onClick={() => (blockSuggestionIsOrigin(blockAdvice) ? undoBlockDrop(blockAdvice) : takeBlockSuggestion(blockAdvice))}')
    expect(SRC).toContain("? '元の位置に戻す'")
  })

  it('⚖ Q8 (c) — a suggestion on ANOTHER row NAMES that row, on the button and in the offer', () => {
    // `takeBlockSuggestion` commits onto `a.laneKey` — the DROP lane, not the
    // block's home — so 「11:45に置く」 after a cross-row drag reads as "put it
    // back" while it actually lands on a row the block never stood on.
    expect(SRC).toContain('? `${blockAdvice.laneLabel}の${hhmm(blockAdvice.suggest)}に置く`')
    expect(SRC).toContain('? `${blockAdvice.title}は${blockAdvice.laneLabel}の${hhmm(blockAdvice.suggest)}なら空きを分けずに置けます`')
    // The same-row, non-origin case keeps canon's plain wording.
    expect(SRC).toContain("'提案位置に置く'")
  })
})

describe('BATCH-10 W3 — ROOT A: an ack-allowed guard refusal is 要確認', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
  const INT = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/today-interactions.ts'), 'utf8')
  const GUARD = {
    services: [{ name: '整体60', dur: 60 }, { name: '骨盤90', dur: 90 }],
    newClientSessionMin: 90, protectedLabel: '新規', gapFillMinMin: 30, leadTimeMin: 0,
    mode: 'standard' as const,
  }
  const railIn = (over: Record<string, unknown> = {}) => ({
    open: HOURS.open, close: HOURS.close, stepMin: 30, dur: 60, protectedDur: 90,
    nowMinute: null, locked: [] as string[], guard: GUARD, ...over,
  })
  const staff = (items: BoardItem[] = []) => lane({ key: 'p-01', group: 'staff', label: '見本 あずさ', stores: ['store-a'], items })
  const beds = [lane({ key: 'bed-01', group: 'beds', label: 'ベッド1' })]
  const cellOf = (state: RailCell['state'], sentence: string): RailCell => ({
    start: 630, state, label: '', sentence, reason: state === 'blocked' ? 'guard' : null,
    alternatives: [], alternativeKind: null, ackAllowed: state !== 'blocked',
  })
  const askAt = (start: number, dur = 60) => ({
    staffLane: 'p-01', bedLane: null, solveRoom: true, id: null, vip: false,
    start, end: start + dur, span: place(start, start + dur, HOURS),
    foreignRefusal: null, locked: [] as string[], rooms: POLICY,
    minutesOf: (x: number) => minuteOf(x, HOURS),
  })

  /** The REAL engine on a real lane: 10:30 on a free 10:00–19:00 day costs the
   *  protected 90 window, so the engine refuses it — and marks the refusal
   *  ack-allowed, because standard mode lets the operator place anyway. */
  const ackAllowedCell = () => {
    const cell = guardVerdictAt([staff(), ...beds], 'p-01', 630, railIn())
    expect(cell).not.toBeNull()
    return cell!
  }

  it('the engine really does mark this refusal placeable — not a synthetic fixture', () => {
    const cell = ackAllowedCell()
    expect(cell.state).toBe('blocked')
    expect(cell.ackAllowed).toBe(true)
    expect(cell.sentence).toBe('ここに置くと新規（90分）が入らなくなります')
    // …and the physically-impossible one is NOT: a start with no pocket that
    // can hold the span is `ackAllowed: false` and stays a floor.
    const noPocket = guardVerdictAt([staff([booking({ key: 'x', caseId: 'apt-x' }, 660, 720)]), ...beds], 'p-01', 630, railIn())
    expect(noPocket!.state).toBe('blocked')
    expect(noPocket!.ackAllowed).toBe(false)
  })

  it('ROOT A — the SAME sentence Liam photographed now reads 要確認, and the floor still reads 置けない', () => {
    const cell = ackAllowedCell()
    const v = landingVerdict([staff(), ...beds], askAt(630), cell)
    expect(v.kind).toBe('caution')
    expect(v.label).toBe('要確認')
    expect(v.reason).toBe('ここに置くと新規（90分）が入らなくなります')
    // R-UNAVAILABLE and the no-pocket branch are `ackAllowed: false` and keep
    // 置けない — this is not "the guard stopped blocking", it is the guard's own
    // two tiers finally being told apart.
    const floor = { ...cell, ackAllowed: false }
    expect(landingVerdict([staff(), ...beds], askAt(630), floor).kind).toBe('blocked')
    // ONE predicate, in the ONE home.
    expect(INT).toContain("if (cell?.state === 'blocked' && !cell.ackAllowed) return stop(cell.sentence, 'hard')")
    expect(INT).toContain("if (cell && cell.state !== 'safe') return { kind: 'caution', floor: null, label: VERDICT_WORD.caution, reason: cell.sentence, cell, bedLane, checks }")
  })

  it('ROOT A — the cursor word, the rail mark and the release are the same call, on this class too', () => {
    const cell = ackAllowedCell()
    const v = landingVerdict([staff(), ...beds], askAt(630), cell)
    // Cursor: `wearVerdict` writes `v.label` and `v.kind`.
    expect(v.label).toBe(VERDICT_WORD[v.kind])
    // Rail mid-drag: `renderRail` maps the SAME `v.kind` — blocked → ×,
    // caution → △, else ✓ (TodayScreen renderRail).
    const mark = v.kind === 'blocked' ? '×' : v.kind === 'caution' ? '△' : '✓'
    expect(mark).toBe('△')
    // …and its cell class, which is what `.inert` and the grey/amber fills key
    // off, moves with it.
    const state = v.kind === 'blocked' ? 'blocked' : v.kind === 'caution' ? 'degraded' : 'safe'
    expect(state).toBe('degraded')
    expect(SRC).toContain("const state = v ? (v.kind === 'blocked' ? 'blocked' : v.kind === 'caution' ? 'degraded' : 'safe') : c.state")
    expect(SRC).toContain("${v?.kind === 'blocked' ? ' inert' : ''}")
    // Release: only `blocked` is inert, so this landing STAGES — and the
    // explain popover is the blocked branch's, unchanged. (⚖ flag 57: the
    // branch's ⚖47 restore is gone; it was a no-op write and it was the
    // snap-back. Nothing on that branch stages, which is the invariant.)
    const inertBranch = SRC.slice(SRC.indexOf("    if (v.kind === 'blocked') {"), SRC.indexOf('    land(null, span)'))
    expect(inertBranch).toContain('explainBlocked(')
    expect(inertBranch).not.toContain('stage(')
  })

  it('ROOT C fell out — it was not built separately, and it could not have been', () => {
    const cell = ackAllowedCell()
    // The confirm row is ALWAYS △ by type (⚖ 52 written into the signature).
    const row = guardCheckRow(cell)
    expect(row?.tone).toBe('warn')
    // Before ROOT A that △ contradicted a red 置けない on the same cell in the
    // same frame — two laws, one cell, opposite marks. Now the verdict for that
    // same cell IS caution, so the △ is TRUE rather than merely forced…
    expect(landingVerdict([staff(), ...beds], askAt(630), cell).kind).toBe('caution')
    // …and a cell that is genuinely a floor never reaches the confirm surface
    // at all, because the release refused before anything staged.
    expect(landingVerdict([staff(), ...beds], askAt(630), { ...cell, ackAllowed: false }).kind).toBe('blocked')
    // `guardCheckRow` itself is UNTOUCHED — the type still forbids ×.
    expect(INT).toContain("export function guardCheckRow(cell: RailCell | null): { label: string; tone: 'warn' } | null {")
  })

  // ── 58-RIDER — an engine start is not yet an offer ────────────────────────
  it('⚖ 58 RIDER — off-lattice engine starts are snapped onto the board’s own step and re-verified', () => {
    // The engine walks a 5-minute lattice and a pocket starts where the last
    // booking ended, so 11:45 / 13:15 are honest engine answers and unreachable
    // board positions. 780 is the attempt.
    const offer = (alts: number[], attempted: number, ok: (s: number) => boolean = () => true) =>
      offerableCell({ ...cellOf('blocked', 'x'), alternatives: alts }, 30, attempted, ok)!.alternatives
    expect(offer([705, 795], 780)).toEqual([690, 810])
    // The caller's own gate decides: if 11:30 does not survive it, 12:00 does.
    expect(offer([705], 780, (s) => s !== 690)).toEqual([720])
    // A start already ON the lattice is offered as-is, never nudged.
    expect(offer([690, 810], 780)).toEqual([690, 810])
    // An alternative that IS the start the operator already tried is dropped —
    // they are looking at it, and 「780に置く」 beside この開始に配置 is noise.
    expect(offer([780], 780)).toEqual([])
    // …and so is one that only reaches the lattice by landing on it: 795 floors
    // onto the attempt, so the offer becomes the step ABOVE instead.
    expect(offer([795], 780)).toEqual([810])
    // Nothing survivable → nothing offered, rather than an unreachable button.
    expect(offer([705, 795], 780, () => false)).toEqual([])
    // Dedupe: two engine starts that snap onto the same legal start are one offer.
    expect(offer([695, 700], 780)).toEqual([690])
    // The cell is returned WHOLE with only its offers replaced — the sentence,
    // the state and the ack flag are what the surface prints and gates on.
    const filtered = offerableCell({ ...cellOf('blocked', '入らなくなります'), ackAllowed: true, alternatives: [705] }, 30, 780, () => true)!
    expect(filtered.alternatives).toEqual([690])
    expect(filtered.sentence).toBe('入らなくなります')
    expect(filtered.ackAllowed).toBe(true)
    // A cell with nothing to offer is handed back untouched, and so is null.
    const none = cellOf('degraded', 'y')
    expect(offerableCell(none, 30, 780, () => true)).toBe(none)
    expect(offerableCell(null, 30, 780, () => true)).toBeNull()
  })

  it('⚖ 58 RIDER — ONE filter, and BOTH offering surfaces go through it', () => {
    // Booking side: every alternative surface is fed by `explainBlocked` (the
    // release's consult AND askGuard's blocked branch) or by askGuard's caution
    // branch, and both take the filter.
    // RENEGOTIATED (batch-11, ⚖ 73 RIDER): the SOURCE of the candidates is now
    // class-appropriate — a 満室 refusal offers starts whose ROOM is free, not
    // the guard's loss ranking for a lane that was never the problem — and the
    // FILTER is what 58 legislates. So both booking surfaces still go through
    // `offerable`, one of them via the source selector, and there is still
    // exactly one filter on this lattice.
    expect(SRC).toContain('cell: offerable(sourcedCell(v, ask), ask),')
    expect(SRC).toContain('cell: offerable(v.cell, ask),')
    expect(SRC.match(/cell: offerable\(/g)).toHaveLength(2)
    // The selector is a SOURCE, so it hands its starts to the same filter and
    // never filters or re-verifies them itself.
    expect(SRC).toContain('return nearestFreeStarts(start, props.guard.bookingStepMin, hours, dur, (s) =>')
    expect(SRC.match(/nearestFreeStarts\(/g)).toHaveLength(1)
    expect(SRC.match(/bedClassCell\(/g)).toHaveLength(1)
    expect(SRC).toContain('return offerableCell(cell, props.guard.bookingStepMin, start, (s) =>')
    // …gated by the release's OWN verdict, through `verdictRef` so a surface
    // built inside a gesture closure judges against the board as it stands.
    expect(SRC).toContain("verdictRef.current({ ...ask, span: place(s, s + dur, hours) }).kind !== 'blocked'")
    // Block side: the same helper, on the BLOCK lattice, with the block's gate.
    expect(SRC).toContain('const better = offerableCell(cell, props.guard.config.blockStepMin ?? BLOCK_STEP_MIN_DEFAULT, from, (s) =>')
    expect(SRC).toContain('suggest: better.alternatives[0],')
    // Two spellings in the whole board, one per lattice — no third.
    expect(SRC.match(/offerableCell\(/g)).toHaveLength(2)
  })
})

describe('BATCH-10 W4 — ROOT B: drops stop dying silently', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
  const CSS = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/today.css'), 'utf8')

  /** The board as it really renders: lane, its 18px rail, lane, its rail — the
   *  rail is a SIBLING of its lane, which is canon's own structure. */
  const boardWithRails = () => {
    const board = document.createElement('div')
    let top = 0
    for (const key of ['p-01', 'p-04']) {
      const el = document.createElement('div')
      el.className = 'lane'
      el.dataset.lane = key
      el.dataset.group = 'staff'
      rect(el, { left: 0, top, width: 900, height: 72 })
      board.appendChild(el)
      const rail = document.createElement('div')
      rail.className = 'guard-placement-rail'
      rail.dataset.lane = key
      rect(rail, { left: 0, top: top + 72, width: 900, height: 18 })
      board.appendChild(rail)
      top += 90
    }
    const bed = document.createElement('div')
    bed.className = 'lane'
    bed.dataset.lane = 'bed-01'
    bed.dataset.group = 'beds'
    rect(bed, { left: 0, top: 220, width: 900, height: 72 })
    board.appendChild(bed)
    return board
  }

  it('⚖ 61 — the 18px guide rail belongs to the lane ABOVE it (canon :3828-3833)', () => {
    const board = boardWithRails()
    // Inside the row itself, unchanged.
    expect(laneKeyAtY(board, 'staff', 30)).toBe('p-01')
    expect(laneKeyAtY(board, 'staff', 120)).toBe('p-04')
    // …and INSIDE THE STRIP — 20% of every staff row's pitch, which used to be
    // a silent dead drop zone: `予約を置く行の中で離してください` as a bottom
    // toast while the operator's eye was on the cursor.
    expect(laneKeyAtY(board, 'staff', 73)).toBe('p-01')
    expect(laneKeyAtY(board, 'staff', 89)).toBe('p-01')
    expect(laneKeyAtY(board, 'staff', 162)).toBe('p-04')
    // The rail's own CSS box is what made the band 18px tall.
    expect(CSS).toContain('height: 18px;')
    // A genuine gap — between the staff group and the beds group — is still
    // nothing, so the release still has a real refusal to speak.
    expect(laneKeyAtY(board, 'staff', 200)).toBeNull()
    // The adoption is a STAFF rule: a bed row has no rail and adopts nothing.
    expect(laneKeyAtY(board, 'beds', 200)).toBeNull()
    expect(laneKeyAtY(board, 'beds', 250)).toBe('bed-01')
    // …and the block drag (group `null`, canon's cross-group leash) sees the
    // same adoption rather than a second rule.
    expect(laneKeyAtY(board, null, 80)).toBe('p-01')
  })

  it('⚖ 61 / 63(a) — the hover and the release now handle the resolver’s null identically', () => {
    // The hover used to keep the previous lane silently while the release
    // refused, so the board drew a confident dashed landing for a row the
    // cursor had left. `offLane` is that answer, carried into the frame.
    expect(SRC).toContain('ctx.offLane = laneKey == null')
    expect(SRC).toContain('offLane: ctx.offLane,')
    // No dashed landing and no lit row while the pointer is over nothing…
    expect(SRC).toContain(': live && !live.overShelf && !live.offLane')
    expect(SRC.match(/!live\.overShelf && !live\.offLane/g)).toHaveLength(2)
    // …and the cursor wears the release's OWN sentence, from the one verdict,
    // by asking it the same question the release will ask (staffLane null).
    expect(SRC).toContain("staffLane: ctx.offLane ? null : sides.staffLane,")
    // …which `landingVerdict` answers with exactly that sentence.
    const v = landingVerdict([lane({ key: 'p-01', group: 'staff' })], {
      staffLane: null, bedLane: null, solveRoom: true, id: null, vip: false,
      start: 720, end: 780, span: place(720, 780, HOURS), foreignRefusal: null,
      locked: [], rooms: POLICY, minutesOf: (x: number) => minuteOf(x, HOURS),
    }, null)
    expect(v.kind).toBe('blocked')
    expect(v.reason).toBe('予約を置く行の中で離してください')
  })

  it('⚖ 50(d) — a release over no row explains itself AT THE CURSOR, with nothing to escalate', () => {
    const finish = SRC.slice(SRC.indexOf('function finishDrag('), SRC.indexOf('  /** ⚖ LIAM flag 50(d) (2026-08-22) — WHAT A RED LANDING DOES'))
    // The toast is gone from this ending; the popover the rest of the board
    // uses takes its place, at the pointer.
    expect(finish).not.toContain("refuse('予約を置く行の中で離してください')")
    expect(finish).toContain('explainBlocked(verdictRef.current(off), off, ctx.homeLane, span, { x: clientX, y: clientY, t: upAt }, {')
    expect(finish).toContain('override: null,')
    // ⚖ 47 — and it still changes nothing: the pair goes back first.
    expect(finish.indexOf('restoreSides(ctx.id, from)')).toBeLessThan(finish.indexOf('const off: LandingAsk'))
    // The escalation is store-gated AND needs something to place onto.
    expect(SRC).toContain("override: props.canOverride && escalate && v.floor === 'policy' ? () => { setAdvice(null); escalate() } : null,")
  })

  it('⚖ 61 — the lost-pointerup self-heal runs BEFORE the id test, on both pipelines', () => {
    // canon's net is document-level and id-agnostic on purpose: by the time a
    // `buttons === 0` move arrives, pointer capture is already gone and the
    // event can carry any id. Gated behind the id test it never fired, the ref
    // stayed set, and every later pointerdown returned immediately.
    for (const [begin, heal] of [
      ['function beginDrag(', 'cancelDrag(e)'],
      ['function beginBlockDrag(', 'cancelBlockDrag(e)'],
    ] as const) {
      const onMove = SRC.slice(SRC.indexOf(begin), SRC.indexOf('const onUp = (e: PointerEvent) => {', SRC.indexOf(begin)))
      expect([begin, onMove.indexOf('e.buttons === 0') < onMove.indexOf('e.pointerId !== c.pointerId')]).toEqual([begin, true])
      expect(onMove).toContain(heal)
    }
    // …and the press that would be swallowed by a stale ref is the one Liam
    // was hitting, so the guard that reads it is pinned beside its cure.
    expect(SRC).toContain("if (e.button !== 0 || dragRef.current || !item.caseId) return")
  })

  it('⚖ 63 §4 — the release judges the board as it STANDS, not as it stood at pointerdown', () => {
    // `finishDrag` runs inside listeners bound once at pointerdown, so its
    // closure is that render's. `verdictRef` existed for exactly this and the
    // release did not use it; `solveBed` had the identical problem, and a
    // release asking the current board for its verdict and the pointerdown
    // board for its room is two homes for one landing.
    expect(SRC).toContain('const v = verdictRef.current(ask)')
    expect(SRC).toContain('const boardLanesRef = useRef(boardLanes)')
    expect(SRC).toContain('boardLanesRef.current = boardLanes')
    const solve = SRC.slice(SRC.indexOf('function solveBed('), SRC.indexOf('return solved.laneKey'))
    expect(solve).toContain('const board = boardLanesRef.current')
    expect(solve).not.toContain('allocateBed(boardLanes,')
  })

  // ── the applyMoves extra pass (study §61 bonus) ──────────────────────────
  it('⚖ 61 bonus — a row this session CREATED answers to the same moves every other row does', () => {
    const from = lane({ key: 'p-01', group: 'staff' })
    const to = lane({ key: 'p-04', group: 'staff' })
    const made = booking({ key: 'n', caseId: 'apt-new' }, 720, 780)
    const added = [{ laneKey: 'p-01', item: made }]

    // No move: it draws where it was created, as before.
    const rest = applyMoves([from, to], {}, [], added, HOURS)
    expect(rest[0].items.map((i) => i.caseId)).toEqual(['apt-new'])
    expect(rest[1].items).toHaveLength(0)

    // A staged SPAN redraws it — this is the half that was dead: `extra`
    // bypassed the `moved` pass entirely, so the 仮押さえ line reported the new
    // time while the card did not move.
    const moved = applyMoves([from, to], { 'apt-new': { laneKey: 'p-01', ...place(840, 900, HOURS) } }, [], added, HOURS)
    expect(moved[0].items[0].startMin).toBe(840)
    expect(moved[0].items[0].time).toBe('14:00〜15:00')

    // …and a staged LANE moves it, because `extra` was filtered by the lane it
    // was BORN on and could never change rows.
    const crossed = applyMoves([from, to], { 'apt-new': { laneKey: 'p-04', ...place(840, 900, HOURS) } }, [], added, HOURS)
    expect(crossed[0].items).toHaveLength(0)
    expect(crossed[1].items.map((i) => i.caseId)).toEqual(['apt-new'])
    expect(crossed[1].items[0].startMin).toBe(840)
  })

  it('⚖ 22 — …and the cross-day park exemption survives it', () => {
    // A booking placed on ANOTHER day stays in `parked` on purpose: that flag is
    // what keeps the ORIGIN day hiding it. The placed row is the placement, so
    // it is never hidden by the flag that hides its origin.
    const target = [lane({ key: 'p-01', group: 'staff' }), lane({ key: 'p-04', group: 'staff' })]
    const carried = booking({ key: 'a', caseId: 'apt-1' }, 900, 960)
    const shown = applyMoves(target, { 'apt-1': { laneKey: 'p-04', x: carried.x, w: carried.w } }, ['apt-1'], [{ laneKey: 'p-04', item: carried }], HOURS)
    expect(shown[1].items.map((i) => i.caseId)).toEqual(['apt-1'])
    // The day it was parked FROM, with no placed row, still hides it.
    const origin = [lane({ key: 'p-01', group: 'staff', items: [booking({ key: 'a', caseId: 'apt-1' }, 720, 780)] }), lane({ key: 'p-04', group: 'staff' })]
    expect(applyMoves(origin, {}, ['apt-1'], [], HOURS).flatMap((l) => l.items)).toHaveLength(0)
  })

  /** GREPTILE #749 P1 — the other half of that exemption, which was un-hiding
   *  the wrong row. Park a booking and place it back ON THE DAY IT CAME FROM
   *  (canon's own flow: the chip lands wherever the operator drops it, and that
   *  is very often the same board). `parked` still carries the id — that is what
   *  hides the server's original — but `added` now carries the replacement, and
   *  the two rows are indistinguishable by id AND by key, because
   *  `placeFromShelf` mints exactly the key today-board :357 draws. Keyed by
   *  `caseId`, the exemption un-hid both: one booking, two cards, on the staff
   *  row and on the bed row at once. */
  it('GREPTILE #749 — parked and placed back on the SAME day is ONE card, not two', () => {
    const staffKey = 'apt-1-staff'
    const bedKey = 'apt-1-bed'
    // The board the server drew: the booking at 12:00, on both of its rows.
    const lanes = [
      lane({ key: 'p-01', group: 'staff', items: [booking({ key: staffKey, caseId: 'apt-1' }, 720, 780)] }),
      lane({ key: 'bed-01', group: 'beds', items: [booking({ key: bedKey, caseId: 'apt-1' }, 720, 780)] }),
    ]
    // …and what `placeFromShelf` stages when the chip goes back down at 15:00 on
    // this same board: two rows, the SAME keys, plus the staff-side membership.
    const added = [
      { laneKey: 'p-01', item: booking({ key: staffKey, caseId: 'apt-1' }, 900, 960) },
      { laneKey: 'bed-01', item: booking({ key: bedKey, caseId: 'apt-1' }, 900, 960) },
    ]
    const out = applyMoves(lanes, { 'apt-1': { laneKey: 'p-01', ...place(900, 960, HOURS) } }, ['apt-1'], added, HOURS)

    const staff = out[0].items.filter((i) => i.caseId === 'apt-1')
    const bed = out[1].items.filter((i) => i.caseId === 'apt-1')
    expect(staff).toHaveLength(1)
    expect(bed).toHaveLength(1)
    // …and it is the PLACEMENT that survives, at the span the operator dropped
    // it on — not the origin the park was hiding.
    expect([staff[0].startMin, staff[0].endMin]).toEqual([900, 960])
    expect([bed[0].startMin, bed[0].endMin]).toEqual([900, 960])
  })

  it('GREPTILE #749 — …and the same-day place-back onto ANOTHER row empties the origin', () => {
    // The chip can come back down on a different person. The server's original
    // must still go, or the booking is on two lanes at the same minute.
    const lanes = [
      lane({ key: 'p-01', group: 'staff', items: [booking({ key: 'apt-1-staff', caseId: 'apt-1' }, 720, 780)] }),
      lane({ key: 'p-04', group: 'staff' }),
    ]
    const added = [{ laneKey: 'p-04', item: booking({ key: 'apt-1-staff', caseId: 'apt-1' }, 900, 960) }]
    const out = applyMoves(lanes, { 'apt-1': { laneKey: 'p-04', ...place(900, 960, HOURS) } }, ['apt-1'], added, HOURS)
    expect(out[0].items).toHaveLength(0)
    expect(out[1].items.map((i) => i.caseId)).toEqual(['apt-1'])
  })
})

// ── BATCH-10b ⚖ flag 57 — the card stays where it was dropped, in ghost dress ──
// Liam: 「it snaps back the instant the question appears」. Two calls did that,
// in this order, before the popover was built: the drag teardown destroyed the
// travelling proxy, and `restoreSides` wrote the pointerdown pair back. The fix
// is a DISPLAY overlay in place of the second one — flag 68's commit-then-advise
// shape, with a paint where 68 has a write, so ⚖47 still holds literally.
describe('BATCH-10b ⚖ flag 57 — the pending-override ghost', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
  const finish = SRC.slice(SRC.indexOf('function finishDrag('), SRC.indexOf('function cancelDrag('))

  it('the ghost is a PAINT: it reaches drawnLanes and nothing else', () => {
    // `moves` is the source of truth a refusal may not touch. The overlay is
    // built from it, never into it.
    const memo = SRC.slice(SRC.indexOf('const attemptLanes = useMemo('), SRC.indexOf('const drawnLanes ='))
    expect(memo).toContain('const a = advice?.attempt')
    expect(memo).toContain('if (!a) return null')
    expect(memo).not.toContain('setMoves(')
    expect(memo).not.toContain('setBedMoves(')
    expect(SRC).toContain('const drawnLanes = live || blockLive ? committedLanes : (attemptLanes ?? boardLanes)')
    // Every judge of the board still reads the UN-overlaid one. If a future
    // round feeds any of them `drawnLanes`, a refusal starts changing things.
    expect(SRC).toContain('guardRailsFor(boardLanes')
    expect(SRC).toContain('sellLayerFor(committedLanes')
    expect(SRC).toContain('gapLayerFor(committedLanes')
    expect(SRC).not.toContain('sellLayerFor(drawnLanes')
    expect(SRC).not.toContain('guardRailsFor(drawnLanes')
    expect(SRC).not.toContain('checksFor(drawnLanes')
  })

  it('the blocked release explains and leaves the card at the attempted landing', () => {
    // No rewind on the branch, and the attempted landing is handed over.
    const branch = finish.slice(finish.indexOf("if (v.kind === 'blocked') {"), finish.indexOf('land(null, span)'))
    expect(branch).not.toContain('restoreSides(')
    expect(branch).toContain('explainBlocked(')
    expect(branch).toContain('{ id: ctx.id, staffLane: sides.staffLane, bedLane: sides.bedLane, span }')
    // …and the ghost's span IS the span 注意して配置 stages, so the card cannot
    // visibly jump when the operator escalates.
    expect(branch).toContain('override: () => land(v.reason, span)')
  })

  it('the off-lane release grows NO ghost — there is no lane for one to sit on', () => {
    // ⚖ 50(d)'s explanation-only popover: no row was named, so there is nothing
    // to place and nothing to paint. It keeps its own ⚖47 restore.
    const off = finish.slice(finish.indexOf('const off: LandingAsk'), finish.indexOf('targetLane = laneKey'))
    expect(off).toContain('explainBlocked(')
    expect(off).not.toContain('staffLane: sides.staffLane')
    // Its restore runs BEFORE it explains, exactly as it did.
    expect(finish.indexOf('restoreSides(ctx.id, from)')).toBeLessThan(finish.indexOf('const off: LandingAsk'))
    // The default is null, so a caller that says nothing gets no ghost — the
    // create / 次回予約 consult included (no card exists there yet).
    expect(SRC).toContain("attempt: GuardAdvice['attempt'] = null,")
    expect(SRC).toContain('attempt: null,')
  })

  it('every ending clears it, because it lives on the advice — flag 41 for free', () => {
    // やめる, an alternative, 注意して配置, Escape and any new gesture all clear
    // `advice`, and the ghost is a field ON it: there is no second lifetime to
    // get wrong, and no new teardown path was added.
    expect(SRC).toContain('<button className="btn" type="button" onClick={() => setAdvice(null)}>やめる</button>')
    expect(SRC).toContain('place: (s) => { setAdvice(null); run.placeAt(s) },')
    expect(SRC).toContain("override: props.canOverride && escalate && v.floor === 'policy' ? () => { setAdvice(null); escalate() } : null,")
    expect(SRC).toContain('if (advice) { setAdvice(null); return }')
    const close = SRC.slice(SRC.indexOf('function closeAdvice()'), SRC.indexOf('function closeAdvice()') + 400)
    expect(close).toContain('setAdvice(null)')
  })

  it('the ghost wears the proxy\'s blocked dress, not a placed card\'s', () => {
    // With `live` cleared it would otherwise render as an ordinary card. ⚖ Q4
    // default (overturnable): the proxy's own red dashed outline, so it reads
    // as a proposal.
    expect(SRC).toContain("${advice?.attempt?.id === item.caseId ? ' attempting' : ''}")
    const css = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/today.css'), 'utf8')
    expect(css).toContain('.biz .event.attempting { outline: 2px dashed var(--red);')
    // …and it is NOT the 仮押さえ dress, which means something else entirely.
    expect(css).toContain('.biz .event.pending { outline: 2px dashed var(--orange);')
  })

  it('the overlay really does redraw the card at the attempt, arithmetically', () => {
    // The memo's own arithmetic, run directly: `moves` untouched, the overlay
    // map carrying the attempted landing, applyMoves doing the rest.
    const lanes = [
      lane({ key: 'p-01', group: 'staff', items: [booking({ key: 'a', caseId: 'apt-1' }, 660, 720)] }),
      lane({ key: 'p-04', group: 'staff' }),
    ]
    const moves: Moves = {}
    const attempt = { id: 'apt-1', staffLane: 'p-04', span: place(840, 900, HOURS) }
    const overlay = { ...moves, [attempt.id]: { laneKey: attempt.staffLane, x: attempt.span.x, w: attempt.span.w } }
    const ghost = applyMoves(lanes, overlay, [], [], HOURS)
    expect(ghost[0].items).toHaveLength(0)
    expect(ghost[1].items[0].caseId).toBe('apt-1')
    expect(ghost[1].items[0].startMin).toBe(840)
    // …and the board everything else judges is untouched: same lane, same span.
    const real = applyMoves(lanes, moves, [], [], HOURS)
    expect(real[0].items[0].startMin).toBe(660)
    expect(real[1].items).toHaveLength(0)
    expect(moves).toEqual({})
  })
})

// ── BATCH-10b X4 — copy: flag 66(a) + the Fable sweep rider (ii) ──────────────
describe('BATCH-10b X4 — the two copy items', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')

  it('⚖ 66(a) — the 保護ルール row names the room the control ships in', () => {
    // Liam: 「It should already be working or I should be able to change the
    // settings on this page. It shouldn't be 準備中」. The guard IS live on this
    // profile; what is unbuilt is the per-store control, and by the one-home law
    // it belongs in the 設定 room. The badge says so instead of saying nothing.
    expect(SRC).toContain('<span className="chip">変更は「設定」ルームで（準備中）</span>')
    expect(SRC).not.toContain('<span className="chip">店舗設定は準備中</span>')
    // The policy word itself is still the STORE's, read-only, unchanged.
    expect(SRC).toContain('<span>保護ルール: {POLICY_WORD[props.guard.mode]}</span>')
  })

  it('sweep rider (ii) — the two advisory grammars are two engine FACTS, not one in two voices', () => {
    // Investigated before touching either, per the packet. They come from
    // different engine verdicts, and the difference is the whole point:
    //
    //   R-REP   → verdict 'refuse'   — the loss is AVOIDABLE; a strictly better
    //             start exists in this pocket, which is why the surface offers
    //             alternatives at all.
    //   DEGRADED→ verdict 'degraded' — 「Nowhere wins — the loss is unavoidable」
    //             (gap-guard.ts's own words), so the sentence prices the loss
    //             and names the least-loss start instead of pointing elsewhere.
    //
    // Unifying them to the count form would delete the only signal that says
    // "you can avoid this by moving". They stay two sentences, and this pins it.
    const engine = readFileSync(join(process.cwd(), 'src/business/lib/canon-logic/gap-guard.ts'), 'utf8')
    expect(engine).toContain("result.verdict = 'refuse'")
    expect(engine).toContain("result.verdict = 'degraded'")
    expect(engine).toContain('/** Nowhere wins — the loss is unavoidable. Log it, do not refuse. */')

    const guard = { services: [{ name: '整体60', dur: 60 }], newClientSessionMin: 90, protectedLabel: '新規', gapFillMinMin: 30, leadTimeMin: 0, mode: 'standard' as const }
    const railIn = (over = {}) => ({ open: HOURS.open, close: HOURS.close, stepMin: 30, dur: 60, protectedDur: 90, nowMinute: null, locked: [], guard, ...over })
    // 10:00–11:30 holds exactly one 新規90; a 60 anywhere in it costs that one
    // window and NOWHERE in the pocket avoids it → degraded, the count form.
    const unavoidable = guardVerdictAt([lane({ key: 'p-01', group: 'staff', window: { from: 600, until: 690 } })], 'p-01', 600, railIn())!
    expect(unavoidable.state).toBe('degraded')
    expect(unavoidable.sentence).toContain('枠減')
    expect(unavoidable.sentence).not.toContain('入らなくなります')
    // …and the avoidable case keeps its own sentence, pointing away from here.
    expect(reasonLine({ code: 'R-REP', params: { label: '新規（90分）' } }, 90)).toBe('ここに置くと新規（90分）が入らなくなります')
  })
})

// ── BATCH-10b X5 — ⚖ flag 69: the dead blank column ──────────────────────────
// ROOT CAUSE (study-confirmed, then re-verified here): nothing on the today
// screen is measured or cached, and the hours track's right edge is honest. The
// board narrowed because a DIFFERENT ROUTE'S STYLESHEET won the tie on
// `.biz .workspace` once that route had been visited — Next keeps every visited
// segment's CSS in the document, so equal-specificity selectors break on VISIT
// ORDER. Liam's repro (今日の運営 → 予約 → back) is exactly that insertion order.
describe('BATCH-10b ⚖ flag 69 — route stylesheets stop competing', () => {
  const SHEETS = {
    today: 'src/app/[locale]/(business)/business/today/today.css',
    reservations: 'src/app/[locale]/(business)/business/reservations/reservations.css',
    customers: 'src/app/[locale]/(business)/business/customers/customers.css',
  }
  const SCREENS = {
    today: 'src/app/[locale]/(business)/business/today/TodayScreen.tsx',
    reservations: 'src/app/[locale]/(business)/business/reservations/ReservationsScreen.tsx',
    customers: 'src/app/[locale]/(business)/business/customers/CustomersScreen.tsx',
  }
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
  /** Selector heads of every rule, at any depth. @media is transparent. */
  function selectorsOf(css: string): Set<string> {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const found = new Set<string>()
    let head = ''
    for (const ch of clean) {
      if (ch === '{') {
        const text = head.trim()
        head = ''
        if (!text || text.startsWith('@')) continue
        for (const sel of text.split(',')) {
          const one = sel.replace(/\s+/g, ' ').trim()
          if (one) found.add(one)
        }
      } else if (ch === '}' || ch === ';') head = ''
      else head += ch
    }
    return found
  }

  it('every screen roots itself with its own page class', () => {
    // The hook the scoping hangs on. One token per screen, and the CI guard
    // below is what stops the next room from forgetting it.
    expect(read(SCREENS.today)).toContain('<div className="page page-today">')
    expect(read(SCREENS.reservations)).toContain('<div className="page page-reservations">')
    expect(read(SCREENS.customers)).toContain('<div className="page page-customers">')
    // The LoadFailure fallback is a page too — a broken screen that keeps the
    // neighbour's grid is still the bug.
    expect(read(SCREENS.reservations).match(/<div className="page page-reservations">/g)).toHaveLength(2)
  })

  it('no selector is defined in two route stylesheets — the whole family, not just .workspace', () => {
    // ⚖ the root-cause directive: one disease, one cure. Patching `.workspace`
    // alone would leave `.panel` and `.page` already wrong on the same gesture
    // (borders, radii and the top gap all swap after a round-trip) and
    // `.inspector` armed behind them.
    const owners = new Map<string, string[]>()
    for (const [name, path] of Object.entries(SHEETS)) {
      for (const sel of selectorsOf(read(path))) {
        if (!owners.has(sel)) owners.set(sel, [])
        owners.get(sel)!.push(name)
      }
    }
    const clashes = [...owners].filter(([, files]) => files.length > 1)
    expect(clashes.map(([sel, files]) => `${sel} [${files.join('|')}]`)).toEqual([])
  })

  it('the board card is told ONE column on 今日の運営, whichever tab was visited first', () => {
    // The pixel Liam pointed at. today.css keeps canon's single-column answer
    // (canon :1411-1414, its own winning late override), and the sibling grids
    // that used to outrank it can no longer match this page at all.
    const today = read(SHEETS.today)
    expect(today).toContain('.biz .page-today .workspace { display: grid; grid-template-columns: minmax(0, 1fr);')
    for (const [name, path] of Object.entries(SHEETS)) {
      if (name === 'today') continue
      const sheet = read(path)
      // The sibling's two-column grid still exists — scoped to its own page.
      expect(sheet).toMatch(/\.biz \.page-(reservations|customers) \.workspace \{[^}]*grid-template-columns/)
      // …and it can never name today's page.
      expect(sheet).not.toContain('.page-today')
    }
  })

  // The recurrence guard itself (`scripts/audit/check-route-css-collisions.mjs`,
  // its CI step and its npm script) is a SHARED-FILE change, so the isolation
  // gate sends it to its own non-Business PR — and its pins go with it, because
  // a test that reads those three files cannot live on a branch that does not
  // carry them. `chore/route-css-tripwire` owns them now. What stays here is the
  // in-territory truth the guard automates: the collision test directly above,
  // which is the one that would go red if these sheets ever competed again.

  it('nothing about the board is measured or cached — the study\'s other hypothesis, re-checked here', () => {
    // If geometry were cached the remount would have to clear it, and the fix
    // would live in the screen. It does not: the only board geometry written to
    // the DOM is `--label`, during a drag, never persisted.
    const src = read(SCREENS.today)
    expect(src).not.toContain('new ResizeObserver')
    expect(src).toContain("board.style.setProperty('--label'")
    // …and the hours track's right edge is the fixture's own closing time, not
    // a truncation: 10:00–19:00 is nine columns, and the head says so in words.
    const fixtures = read('src/business/lib/fixtures-today.ts')
    expect(fixtures).toContain('export const operatingHours = { open: 10 * 60, close: 19 * 60 }')
    expect(src).toContain('<span>営業時間 {hhmm(hours.open)}–{hhmm(hours.close)}・時間外は非表示</span>')
  })
})

// ── BATCH-10b X6 — ⚖ flag 71: the fixture's hold stops greeting Liam ─────────
// 「the 仮押さえ popover appears on every fresh load. Why? Is it a bug?」 Yes —
// and NOT in the fixture. canon ships the same held booking deliberately
// (fable-store-today.html:1901/:2009, the 担当変更 incident's own candidate) but
// its #holdBar is `hidden` at load and renderHoldBar is called only from
// stageChange and 確定. The standing surface was our transplant's invention.
// ⚖ Fable adjudication 8/22: cure (a) — the surface becomes gesture-born, the
// fixture keeps its booking, and the incident keeps its evidence.
describe('BATCH-10b ⚖ flag 71 — no uninvited confirm', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')

  it('a fresh load shows NO standing 仮押さえ — the prop alone can no longer raise it', () => {
    // THE FIX, in one clause. `holdOpen` is screen-local and starts false, so a
    // fresh load and a day flip both begin with the question unasked.
    expect(SRC).toContain(': props.hold && holdAnswer === null && holdOpen')
    expect(SRC).toContain('const [holdOpen, setHoldOpen] = useState(false)')
    // The surface can be reached ONLY through the open path — no other writer.
    expect(SRC.match(/setHoldOpen\(/g)).toHaveLength(1)
  })

  it('the explicit re-open is the held booking itself, and any other card puts it down', () => {
    // ⚖ 41's re-open clause, wired to the booking the hold is about. Opening a
    // different card closes it, so the surface can never hang over a card it is
    // not about — one expression, no second branch.
    const press = SRC.slice(SRC.indexOf('if (!ctx.moved) {'), SRC.indexOf('openClickWindow(upAt'))
    expect(press).toContain('setSelected(item.caseId)')
    expect(press).toContain('setHoldOpen(props.hold != null && item.caseId === props.hold.bookingId)')
    // The hold's id and a card's id are the same id space, which is what makes
    // that comparison meaningful rather than always-false.
    const board = readFileSync(join(process.cwd(), 'src/business/lib/today-board.ts'), 'utf8')
    expect(board).toContain('caseId: b.id,')
    const page = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/page.tsx'), 'utf8')
    expect(page).toContain('bookingId: heldBooking.id,')
  })

  it('the answers are untouched, so ⚖ 56 and the 担当変更 card still resolve', () => {
    // No new component and no new grammar: the SAME confirm surface, the same
    // two answers, the same writes. `holdAnswer` still closes it for the
    // session and still resolves the incident's decision card.
    expect(SRC).toContain("              setHoldAnswer('confirmed')")
    expect(SRC).toContain("setResolved((was) => toggleOn(was, props.cards.find((c) => c.kind === '担当変更')?.id))")
    expect(SRC).toContain("revert: { enabled: true, run: () => { setHoldAnswer('reverted'); show('仮押さえのままにしました') } },")
    // An ANSWERED hold is gone whether or not the card is opened again: the
    // holdAnswer clause sits IN FRONT of holdOpen, so it decides first.
    const arm = SRC.slice(SRC.indexOf(': props.hold && holdAnswer === null'), SRC.indexOf('anchorId: null,'))
    expect(arm).toContain('holdAnswer === null && holdOpen')
  })

  /** THE FIRST OPEN AFTER A LOAD PUT THE CONFIRM OFF SCREEN (real browser,
   *  2026-08-22): `.hold-pop` with no `.pinned` at `top: 1659px` in a 935px
   *  viewport — `position: fixed` with no `top` of its own, i.e. its static
   *  flow position. Root cause: `holdAnchorId` is `null` both closed and open
   *  for this arm (its `anchorId: null` is a MEASURED 8/21 ruling, not an
   *  oversight), so no dep of the pinning effect moved when the surface
   *  appeared and `setHoldPinned(true)` never fired. X6 created the case; the
   *  cure is to key the effect on the surface's existence, so EVERY path that
   *  mounts it pins it. */
  it('the pinning effect keys on the SURFACE existing, not on an anchor this arm has not got', () => {
    expect(SRC).toContain('const holdPopMounted = holdPop !== null')
    expect(SRC).toContain('}, [holdPopMounted, holdAnchorId, holdPinned, collapsed, view, holdRailSel, moves, props.dayOffset])')
    // The dep is the SAME expression the render gates on, so the two can never
    // disagree about whether the element is in the DOM.
    expect(SRC).toContain('{holdPop && (')
    // The arm that needs it still has no anchor of its own — the fix is not a
    // quiet re-anchoring of the standing hold (⚖ 8/21: anchored, this surface
    // swallows the pointerdown of the card below).
    expect(SRC).toContain('          anchorId: null,')
    // …and what the effect does for an anchorless surface is pin it, which is
    // the branch that was never reached on a first open.
    expect(SRC).toContain('      if (!at) {\n        setHoldPinned(true)')
  })

  it('the fixture keeps its held booking — the incident\'s evidence is not collateral', () => {
    // The packet's letter was to delete the fixture's hold. It is canon-faithful
    // demo data AND it feeds three other surfaces, so cure (a) leaves it alone.
    const fixtures = readFileSync(join(process.cwd(), 'src/business/lib/fixtures.ts'), 'utf8')
    expect(fixtures).toContain("board_state: 'hold'")
    const page = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/page.tsx'), 'utf8')
    // Still lifted, and still feeding the recovery dialog…
    expect(page).toContain("const heldBooking = bookings.find((b) => b.state === 'hold') ?? null")
    expect(page).toContain('新しい仮押さえ')
    // …and the incident's 仮押さえ済 step still reads the prop, not the surface.
    expect(SRC).toContain('(i === 1 && props.hold != null)')
  })
})

// ── BATCH-11 — ⚖ Liam flags 73 + 74 (2026-08-23) ────────────────────────────
//
// 73: a TRUE 満室 loses 「注意して配置」. The escalation belongs to the floors
//     that are a JUDGEMENT and never to the floors that are a FACT.
// 74: ONE BOX. The red box carries the confirm's facts, 注意して配置 stages
//     directly, and nothing pops up behind it — Liam's 「I have to say okay
//     twice」.
describe('BATCH-11 ⚖ flags 73 + 74 — the floor decides the button, and the box asks once', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
  const INT = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/today-interactions.ts'), 'utf8')
  const CSS = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/today.css'), 'utf8')

  const board = (over: { staff?: Partial<BoardLane>; beds?: BoardLane[] } = {}): BoardLane[] => [
    lane({ key: 'p-01', group: 'staff', label: '見本 あずさ', stores: ['store-a'], ...over.staff }),
    ...(over.beds ?? [
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1' }),
      lane({ key: 'bed-03', group: 'beds', label: 'ベッド3', roomClass: 'private' }),
    ]),
  ]
  const ask = (over: Partial<Parameters<typeof landingVerdict>[1]> = {}) => ({
    staffLane: 'p-01', bedLane: 'bed-01', solveRoom: true, id: 'apt-1', vip: false,
    start: 960, end: 1020, span: place(960, 1020, HOURS), foreignRefusal: null,
    locked: [] as string[], rooms: POLICY, minutesOf: (x: number) => minuteOf(x, HOURS),
    ...over,
  })
  const verdict = (lanes: BoardLane[], over = {}, cell: RailCell | null = null) =>
    landingVerdict(lanes, ask(over), cell)
  const cellOf = (state: RailCell['state'], sentence: string): RailCell => ({
    start: 960, state, label: '', sentence, reason: state === 'blocked' ? 'guard' : null,
    alternatives: [], alternativeKind: null, ackAllowed: state !== 'blocked',
  })
  const busyBeds = [
    lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: [booking({ key: 'b1', caseId: 'x1', title: '見本 かえる' }, 960, 1020)] }),
    lane({ key: 'bed-03', group: 'beds', label: 'ベッド3', roomClass: 'private', items: [booking({ key: 'b3', caseId: 'x3', title: '見本 さくら' }, 960, 1020)] }),
  ]

  // ── the classification IS the feature: every `stop` carries its stamp ─────
  it('⚖ 73 — every refusal names WHICH KIND of floor it is, at the one verdict home', () => {
    const cases: Array<[string, LandingVerdict, 'hard' | 'hard-room' | 'policy']> = [
      // FACTS. No authority on this board makes any of these true.
      ['⚖ 46 foreign store', verdict(board(), { foreignRefusal: 'テスト銀座店の予約です。…' }, cellOf('blocked', 'x')), 'hard'],
      ['no lane', verdict(board(), { staffLane: null }), 'hard'],
      ['store-mismatch bed row', landingVerdict(
        [lane({ key: 'p-01', group: 'staff', label: '見本 あずさ', stores: ['store-a'] }), lane({ key: 'bed-09', group: 'beds', label: 'ベッド9', stores: ['store-b'] })],
        ask({ solveRoom: false, bedLane: 'bed-09' }), cellOf('safe', '')), 'hard'],
      ['時間帯が重複', verdict(board({ staff: { items: [booking({ key: 'a', caseId: 'apt-other', title: '見本 あかり' }, 960, 1020)] } }), {}, cellOf('safe', '')), 'hard'],
      ['満室', verdict(board({ beds: busyBeds }), {}, cellOf('safe', '')), 'hard-room'],
      ['R-UNAVAILABLE (engine floor)', verdict(board(), {}, cellOf('blocked', 'この開始には既存90分を配置できません')), 'hard'],
      // JUDGEMENTS. The store decided these, so a manager it trusts may say
      // "it happens anyway" — the mistake-proofing law's manager class.
      ['VIP・個室', verdict(board(), { solveRoom: false, bedLane: 'bed-01', vip: true }, cellOf('safe', '')), 'policy'],
      ['勤務時間外', verdict(board({ staff: { untilLabel: '16:30', window: { from: 600, until: 990 } } }), {}, cellOf('safe', '')), 'policy'],
      ['シフトロック', verdict(board(), { locked: ['p-01'] }, cellOf('safe', '')), 'policy'],
    ]
    for (const [name, v, floor] of cases) {
      expect([name, v.kind, v.floor]).toEqual([name, 'blocked', floor])
    }
    // Nothing refused → no floor. `floor` answers WHICH floor, never "is there
    // one" (`kind` already does), so it may not carry a value on a landing that
    // is legal.
    expect(verdict(board(), {}, cellOf('safe', '')).floor).toBeNull()
    expect(verdict(board(), {}, cellOf('degraded', '減ります')).floor).toBeNull()
    // ⚖ 52 is untouched by the stamp: `hard-room` IS hard, and every one of the
    // nine above is still 置けない with a sentence the surface can print.
    for (const [name, v] of cases) {
      expect([name, v.label]).toEqual([name, '置けない'])
      expect([name, typeof v.reason === 'string' && v.reason.length > 0]).toEqual([name, true])
    }
  })

  it('⚖ 73 — the class of a `computeChecks` refusal is WHICH ROW failed, not that one did', () => {
    // The frozen engine emits one hard row and two judgement rows out of the
    // same array, so the class cannot be read off the fact of a failure.
    const clash = verdict(board({ staff: { items: [booking({ key: 'a', caseId: 'apt-other', title: '見本 あかり' }, 960, 1020)] } }), {}, cellOf('safe', ''))
    expect(clash.reason).toBe('時間帯が重複: 見本 あかり')
    expect(clash.floor).toBe('hard')
    const shift = verdict(board({ staff: { untilLabel: '16:30', window: { from: 600, until: 990 } } }), {}, cellOf('safe', ''))
    expect(shift.reason).toBe('見本 あずさは16:30以降勤務不可')
    expect(shift.floor).toBe('policy')
    // A person already in the room outranks the shift row, and the class travels
    // with the sentence that won — never with the one that also failed.
    const both = verdict(
      board({ staff: { untilLabel: '16:30', window: { from: 600, until: 990 }, items: [booking({ key: 'a', caseId: 'apt-other', title: '見本 あかり' }, 960, 1020)] } }),
      {}, cellOf('safe', ''),
    )
    expect(both.reason).toBe('時間帯が重複: 見本 あかり')
    expect(both.floor).toBe('hard')
    // ONE reading of the row, in the verdict home — never at a surface.
    expect(INT).toContain("if (failed && failed.label.startsWith(CLASH_ROW)) return stop(failed.label, 'hard')")
    expect(INT).toContain("if (failed) return stop(failed.label, 'policy')")
    expect(SRC).not.toContain('時間帯が重複')
  })

  // ── THE PACKET'S STOP CONDITION, walked on the real engine ───────────────
  it('⚖ 73 STOP-CONDITION — a span crossing 終業 gets ONE class, on every path', () => {
    // The worry: 終業 is reachable as a `computeChecks` row (POLICY) and as an
    // engine non-fit (HARD, `ackAllowed: false`), and a board that answered
    // differently depending on which one was consulted would have two laws.
    //
    // It cannot. The two are the SAME ternary on the lane (today-board: `window`
    // and `untilLabel` are both `shift ? … : null`), so they are always both
    // present or both absent — and when they are present the check row is read
    // FIRST and returns, so the engine's own refusal about the same minutes is
    // never the answer. Walked here on the REAL engine rather than a fixture.
    const short = board({ staff: { untilLabel: '16:30', window: { from: 600, until: 990 } } })
    const realCell = guardVerdictAt(short, 'p-01', 960, {
      open: HOURS.open, close: HOURS.close, stepMin: 30, dur: 60, protectedDur: 90,
      nowMinute: null, locked: [], guard: {
        services: [{ name: '整体60', dur: 60 }, { name: '骨盤90', dur: 90 }],
        newClientSessionMin: 90, protectedLabel: '新規', gapFillMinMin: 30, leadTimeMin: 0, mode: 'standard' as const,
      },
      excludeId: null,
    })
    // The engine really does call 16:00–17:00 impossible on a lane that ends at
    // 16:30 — i.e. the HARD route genuinely exists and is not a straw man.
    expect(realCell?.state).toBe('blocked')
    expect(realCell?.ackAllowed).toBe(false)
    // …and the verdict is POLICY anyway, with the row's own sentence, because
    // the row is asked first. One class for one situation.
    const v = landingVerdict(short, ask(), realCell)
    expect(v.floor).toBe('policy')
    expect(v.reason).toBe('見本 あずさは16:30以降勤務不可')
    // The ORDER is what guarantees it, and it is one file, two adjacent lines.
    expect(INT.indexOf('if (failed) return stop(failed.label')).toBeLessThan(
      INT.indexOf("if (cell?.state === 'blocked' && !cell.ackAllowed) return stop(cell.sentence, 'hard')"),
    )
    // The lane pair that makes them inseparable, at its source.
    const boardSrc = readFileSync(join(process.cwd(), 'src/business/lib/today-board.ts'), 'utf8')
    expect(boardSrc).toContain('window: shift ? { from: shift.start, until: shift.end } : null,')
    expect(boardSrc).toContain('untilLabel: shift ? hhmm(shift.end) : null,')
  })

  // ── 73 proper: the button, and what replaces it ──────────────────────────
  it('⚖ 73 — the escalation gate is the STORE and the FLOOR, in one expression', () => {
    // Both halves on one line on purpose: a second gate elsewhere would split
    // the authority across two lines, which is flag 54's disease arriving at the
    // permission layer. There is still exactly ONE consumption of `canOverride`.
    expect(SRC).toContain("override: props.canOverride && escalate && v.floor === 'policy' ? () => { setAdvice(null); escalate() } : null,")
    expect(SRC.match(/props\.canOverride/g)).toHaveLength(1) // ONE consumption, still
    // TWO readings of the class, and BOTH live inside `explainBlocked` — the
    // escalation's existence and (⚖ 74) whether this box carries facts about a
    // landing that can happen. One function, one question, asked where the
    // surface is built; not one gate here and another at a render site.
    expect(SRC.match(/v\.floor === 'policy'/g)).toHaveLength(2)
    const explain = SRC.slice(SRC.indexOf('function explainBlocked('), SRC.indexOf('function cancelDrag('))
    expect(explain.match(/v\.floor === 'policy'/g)).toHaveLength(2)
    // …and the button still inherits the gate rather than testing anything.
    expect(SRC).toContain('{advice.kind === \'blocked\' && advice.override && (')
    // The authority is still DATA, never a literal on the board (⚠SETTINGS-BATCH).
    expect(SRC).not.toContain('店舗管理者')
    expect(INT).not.toContain('店舗管理者')
  })

  it('⚖ 73 (T3) — a policy override may not buy a room: every solve asks the plain question', () => {
    // ⚖ 50(d) threaded `allowBusy` from the escalation, so a manager could place
    // into a full house and the board named a room somebody else was in. 満室 is
    // now a fact, and TEST:4030's law (満室 outranks the guard) generalises: a
    // physics floor outranks any policy override.
    expect(SRC.match(/solveBed\(/g)).toHaveLength(5)
    expect(SRC).not.toContain('override != null)')
    expect(SRC).not.toContain('allowBusy,')
    expect(SRC).not.toContain('allowBusy = false')
    // …and a solve that refuses now STOPS the landing on every path, rather than
    // keeping the carried room and staging anyway.
    expect(SRC.match(/if \(bed == null\) return/g)).toHaveLength(2) // the drop, and the nudge
    const finish = SRC.slice(SRC.indexOf('const land = (override: string | null, at:'), SRC.indexOf('const v = verdictRef.current(ask)'))
    expect(finish).toContain('if (bed == null) return')
    expect(finish).not.toContain('?? on.bedLane')
    // The engine's own branch is UNTOUCHED and still true as a unit fact — 73 is
    // a product ruling Liam may overturn, so the answer is not deleted.
    const full = [
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: [booking({ key: 'b1', caseId: 'x1', title: '見本 かえる' }, 960, 1020)] }),
    ]
    const opts = { id: null, currentBed: null, stores: ['store-a'], start: 960, end: 1020, policy: POLICY, vip: false }
    expect(allocateBed(full, opts).laneKey).toBeNull()
    expect(allocateBed(full, { ...opts, allowBusy: true }).laneKey).toBe('bed-01')
    expect(INT).toContain('allowBusy?: boolean')
  })

  // ── 73's rider: the offer answers the refusal's own question ─────────────
  it('⚖ 73 RIDER — a bed refusal is answered with bed-free starts, in canon’s own offer grammar', () => {
    // `nearestBestAlternatives` (gap-guard :295-317) answers with the nearest
    // better start BEFORE and the nearest AFTER, never a list. A room refusal
    // that answered with six would be a second grammar in the same box.
    const free = new Set([840, 900, 1080])
    expect(nearestFreeStarts(960, 30, HOURS, 60, (s) => free.has(s))).toEqual([900, 1080])
    // Nothing free → nothing offered; the box then says so in the room's words.
    expect(nearestFreeStarts(960, 30, HOURS, 60, () => false)).toEqual([])
    // The attempted start is never offered back — the operator is looking at it.
    expect(nearestFreeStarts(960, 30, HOURS, 60, (s) => s === 960 || s === 1020)).toEqual([1020])
    // Bounded by the day, and by the booking's own length against closing.
    expect(nearestFreeStarts(1080, 30, HOURS, 60, () => true)).toEqual([1050])
    expect(nearestFreeStarts(600, 30, HOURS, 60, () => true)).toEqual([630])
  })

  it('⚖ 73 RIDER (T4) — ONE selector, and only a ROOM refusal changes its source', () => {
    // The rule, not the board's inputs to it. Every other class keeps the
    // engine's own starts untouched — the guard ranked them and this has no
    // better opinion — so a mutant that stops selecting is visible here rather
    // than only in a string.
    const bedFree = () => [900, 1080]
    const roomRefusal = verdict(board({ beds: busyBeds }), {}, cellOf('safe', '新規90分の空きを守れます'))
    expect(roomRefusal.floor).toBe('hard-room')
    const swapped = bedClassCell(roomRefusal, bedFree)
    expect(swapped!.alternatives).toEqual([900, 1080])
    // 「損を減らす」 is a RANKING and this is not one: these are the starts where
    // a room exists, so the button may not wear the guard's word.
    expect(swapped!.alternativeKind).toBeNull()
    // …and the cell is otherwise the one it was given — the sentence, the state
    // and `ackAllowed` are the guard's own answer, unrewritten.
    expect(swapped!.sentence).toBe('新規90分の空きを守れます')
    expect(swapped!.state).toBe('safe')
    // EVERY other class is handed back the identical object — not a copy, so a
    // future edit that "just re-wraps" everything trips this.
    const others: Array<[string, LandingVerdict]> = [
      ['重複 (hard)', verdict(board({ staff: { items: [booking({ key: 'a', caseId: 'apt-other', title: '見本 あかり' }, 960, 1020)] } }), {}, cellOf('safe', 'x'))],
      ['シフトロック (policy)', verdict(board(), { locked: ['p-01'] }, cellOf('safe', 'x'))],
      ['R-UNAVAILABLE (hard)', verdict(board(), {}, cellOf('blocked', 'この開始には既存90分を配置できません'))],
      ['要確認', verdict(board(), {}, cellOf('degraded', '減ります'))],
      ['clean', verdict(board(), {}, cellOf('safe', 'x'))],
    ]
    for (const [name, v] of others) {
      expect([name, bedClassCell(v, bedFree)]).toEqual([name, v.cell])
    }
    // The sweep is not paid for on those eight classes.
    let swept = 0
    for (const [, v] of others) bedClassCell(v, () => { swept += 1; return [] })
    expect(swept).toBe(0)
    // A null cell is the board's word for "nothing to offer" — the keyboard
    // nudge sets it deliberately (⚖ 31c: Shift/Alt cannot change a start), so it
    // may not grow buttons that path cannot perform.
    expect(bedClassCell({ ...roomRefusal, cell: null }, bedFree)).toBeNull()
  })

  it('⚖ 73 RIDER — the wrong-question sentence is unreachable, by construction', () => {
    // THE BILL: `landingVerdict` carries the GUARD's cell through every refusal
    // class, so a 満室 board whose staff lane is guard-SAFE handed the popover a
    // cell with no alternatives — and the box picks its line off
    // `alternatives.length` alone. It read 「この区間に、より損の少ない開始は
    // ありません」 over a full house: the guard's sentence about a lane that was
    // never the problem.
    const v = verdict(board({ beds: busyBeds }), {}, cellOf('safe', '新規90分の空きを守れます'))
    expect(v.floor).toBe('hard-room')
    expect(v.cell?.state).toBe('safe')
    expect(v.cell?.alternatives).toEqual([])
    // The offer line keys off the SAME class that chose the starts, so the two
    // cannot drift — and the guard branch is only reachable below it.
    expect(SRC).toContain("{advice.floor === 'hard-room'")
    expect(SRC).toContain('? `この区間に、${advice.roomWord}の空く開始はありません`')
    expect(SRC).toContain(': `${advice.roomWord}の空く開始を選べます`')
    expect(SRC.indexOf("advice.floor === 'hard-room'")).toBeLessThan(
      SRC.indexOf("'この区間に、より損の少ない開始はありません'"),
    )
    // T5 — the room WORD is the solve's own, one spelling, so the offer line and
    // the 満室 sentence above it can never name different rooms.
    expect(needsPrivateRoom(true, POLICY)).toBe(true)
    expect(needsPrivateRoom(false, POLICY)).toBe(false)
    expect(needsPrivateRoom(true, { vipStaysPrivate: false, privateIsLastResort: true })).toBe(false)
    expect(INT).toContain('const needsPrivate = needsPrivateRoom(opts.vip, policy)')
    expect(SRC).toContain("roomWord: needsPrivateRoom(ask.vip, props.rooms) ? '個室' : 'ベッド',")
    // A VIP hunting a 個室 is told about 個室, not about ベッド.
    expect(verdict(board({ beds: busyBeds }), { vip: true }, cellOf('safe', '')).reason).toContain('個室に空きがありません')
  })

  // ── 74: the one box ──────────────────────────────────────────────────────
  it('⚖ 74 — the verdict hands over the two facts it used to compute and discard', () => {
    // The room was solved at INT:1472 and thrown away, and the rows were read at
    // INT:1496 and thrown away — so a surface that needed them either re-ran the
    // allocator (flag 54's disease: a second reading that can disagree with the
    // first) or said nothing at all.
    const v = verdict(board(), {}, cellOf('safe', ''))
    expect(v.bedLane).toBe('bed-01')
    expect(v.checks.map((c) => c.ok)).not.toContain(false)
    expect(v.checks.some((c) => c.label === '整体資格 一致')).toBe(true)
    // The retarget is visible in the verdict itself, one frame before the stage.
    const taken = verdict(board({ beds: [
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: [booking({ key: 'b1', caseId: 'x1', title: '見本 かえる' }, 960, 1020)] }),
      lane({ key: 'bed-02', group: 'beds', label: 'ベッド2' }),
    ] }), {}, cellOf('safe', ''))
    expect(taken.bedLane).toBe('bed-02')
    // 満室 solved nothing, so it names nothing — never a stale carry.
    expect(verdict(board({ beds: busyBeds }), {}, cellOf('safe', '')).bedLane).toBeNull()
    // A stop that fires BEFORE the walk reaches them honestly reports none.
    const early = verdict(board(), { foreignRefusal: 'テスト銀座店の予約です。…' })
    expect(early.bedLane).toBeNull()
    expect(early.checks).toEqual([])
  })

  it('⚖ 74 — the box describes the ATTEMPTED landing, never the one the card is leaving', () => {
    // `checksFor`/`holdSummary` answer for the lanes the booking is currently
    // ON, which for a landing being asked about is its ORIGIN — the wrong board.
    const lanes = [
      lane({ key: 'p-01', group: 'staff', label: '見本 あずさ', stores: ['store-a'], items: [booking({ key: 'a-staff', caseId: 'apt-1', title: '見本 きり' }, 960, 1020)] }),
      lane({ key: 'p-02', group: 'staff', label: '見本 ごろう', stores: ['store-a'] }),
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: [booking({ key: 'a-bed', caseId: 'apt-1', title: '見本 きり' }, 960, 1020)] }),
      lane({ key: 'bed-02', group: 'beds', label: 'ベッド2' }),
    ]
    const at = { laneKey: 'p-02', ...place(960, 1020, HOURS) }
    // Membership: the origin pair, which is what the confirm asks about.
    expect(holdSummary(lanes, 'apt-1', at, HOURS)).toBe('見本 きり様 → 16:00〜17:00 / 担当 見本 あずさ / ベッド1')
    // PROPOSED: the pair the operator is asking about, same sentence, one home.
    expect(holdSummary(lanes, 'apt-1', at, HOURS, null, { staffLane: 'p-02', bedLane: 'bed-02' }))
      .toBe('見本 きり様 → 16:00〜17:00 / 担当 見本 ごろう / ベッド2')
    // The name comes off the card wherever it actually is — a proposed pair names
    // lanes it is not standing on yet.
    expect(holdSummary(lanes, 'apt-1', at, HOURS, null, { staffLane: 'p-02', bedLane: 'bed-02' })).toContain('見本 きり様')
    // Wired from the verdict's own room, never re-solved at the surface.
    expect(SRC).toContain('bedLane: v.bedLane,')
    expect(SRC).not.toContain('v.bedLane ?? attempt.bedLane')
    expect(SRC).toContain('checks: v.checks,')
    // ⚖ FIX-6 (blind round, 2026-08-25) — this box has an OFFER LINE under it,
    // so it takes the row built for surfaces-with-offers. The hold popover has
    // no offer line and keeps the whole sentence. Same verdict, same cell, one
    // home for the split (`guardCheckRowBesideOffer`, today-interactions).
    expect(SRC).toContain('guardRow: guardCheckRowBesideOffer(v.cell),')
    expect(SRC.match(/checksFor\(/g)).toHaveLength(2) // the two confirm-side readers, and NOT the box
  })

  it('⚖ 74 — the facts belong to a landing that can actually happen', () => {
    // A hard floor has no 注意して配置, so describing its time/person/room would
    // be the details of a placement that is never going to occur — the
    // wrong-question defect in another costume.
    expect(SRC).toContain("const facts =\n      v.floor === 'policy'\n        ? {")
    expect(SRC).toContain('{advice.facts && (')
    expect(SRC).toContain('<div className="gp-facts">')
    // ⚖ 52's glyphs have ONE home, and the box reads it rather than minting a
    // second grammar for × and △.
    expect(SRC).toContain('<div className="holdbar-checks">')
    expect(SRC).toContain('<span className={`ck${c.ok ? \'\' : \' bad\'}`} key={c.label}>{c.label}</span>')
    expect(CSS).toContain('.biz .guard-pop .gp-facts {')
    expect(CSS).toContain('.biz .holdbar-checks .ck.bad::before { content: "×";')
    expect(CSS).toContain('.biz .holdbar-checks .ck.warn::before { content: "△";')
  })

  it('⚖ 74 — 注意して配置 stages directly, and NOTHING pops up behind it', () => {
    // Liam: 「I have to say okay twice」. The red box already asked — with the
    // reason, the time, the person, the room and the rows in it — so the press
    // IS the decision and a confirm arriving in the same beat asks it again.
    expect(SRC).toContain('const [pendingOpen, setPendingOpen] = useState<string | null>(null)')
    expect(SRC).toContain('const pendingAsking = pending != null && (pending.override == null || pendingOpen === pending.id)')
    expect(SRC).toContain('const holdPop: HoldPop | null = pending')
    expect(SRC).toContain('anchorId: pendingAsking ? pending.id : null,')
    // T1 — OVERRIDE-SCOPED. `pending.override == null` is read FIRST, so a clean
    // drop still raises its confirm exactly as canon's stageChange → renderHoldBar
    // does (⚖ 71's kept behaviour). One grammar: every landing asks exactly one
    // question — a clean one asks it in the confirm, a red one asked it in the box.
    expect(SRC.indexOf('pending.override == null')).toBeLessThan(SRC.indexOf('pendingOpen === pending.id'))
    // The way back in: the staged card IS the door (⚖ 71's shape, one line up).
    expect(SRC).toContain('setPendingOpen(pending != null && item.caseId === pending.id ? pending.id : null)')
    // The reset is free because the state is an ID: a fresh landing is a fresh
    // question, and `stage` is the one function every board gesture ends in.
    expect(SRC).toContain('setPendingOpen(null)')
    // ⚖ AMENDMENT 1 (lens-1 F6) — THREE resets, one per writer of `pending`,
    // plus the re-open. `stage` is not the only door: `placeNextVisit` and
    // `placeFromShelf` write `setPending` themselves, so a card opened, parked
    // and placed back through an override kept the stale open id and auto-popped
    // the confirm — the say-okay-twice, returned by the back door.
    expect(SRC.match(/setPendingOpen\(null\)/g)).toHaveLength(3)
    expect(SRC.match(/setPendingOpen\(/g)).toHaveLength(4)
    for (const fn of ['function stage(', 'function placeNextVisit(', 'function placeFromShelf('] as const) {
      const body = SRC.slice(SRC.indexOf(fn), SRC.indexOf('\n  }', SRC.indexOf(fn)))
      expect([fn, body.includes('setPendingOpen(null)')]).toEqual([fn, true])
    }
    // ⚖ 56/41 precedence, said out loud now that the branch above can decline:
    // a CLOSED staged change must not let the day's older question step into the
    // space it is holding.
    expect(SRC).toContain(': props.hold && holdAnswer === null && holdOpen')
    // Escape is untouched — it still reverts a pending, open or closed.
    expect(SRC).toContain('if (pending && !dragRef.current) revertPending()')
  })

  it('⚖ 74 (UNPINNED-4) — the day’s standing hold and a session pending CAN share an id', () => {
    // The study called the collision "very unlikely". It is not: `props.hold`
    // carries a REAL appointment id (page.tsx: `heldBooking.id`, from
    // `bookings.find((b) => b.state === 'hold')`), and that booking is on the
    // board — so dragging it makes `pending.id === props.hold.bookingId`.
    const page = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/page.tsx'), 'utf8')
    expect(page).toContain("const heldBooking = bookings.find((b) => b.state === 'hold') ?? null")
    expect(page).toContain('bookingId: heldBooking.id,')
    // It is harmless, and this is WHY: the two surfaces are branches of one
    // ternary and the pending one takes it, so the same click can arm both flags
    // and only one question is ever on screen (canon's singleton contract).
    expect(SRC).toContain('const pendingAsking = pending != null && (pending.override == null || pendingOpen === pending.id)')
    expect(SRC).toContain('const holdPop: HoldPop | null = pending')
    expect(SRC).toContain('anchorId: pendingAsking ? pending.id : null,')
    expect(SRC).toContain(': props.hold && holdAnswer === null && holdOpen')
    expect(SRC.match(/const holdPop: HoldPop \| null =/g)).toHaveLength(1)
  })

  // ── T2: the escalation is never invisible again ──────────────────────────
  it('⚖ 52 (T2) — an override the engine has no row for still shows its △', () => {
    // THE HOLE: the △ was produced by matching `pending.override` against a
    // check LABEL, and `computeChecks` (FROZEN) emits no row for a room, none
    // for the VIP floor and none for a foreign store. So an escalation over any
    // of those staged four green ticks and no trace at all — Liam's 8/22 shot.
    // 73 makes the ROOM case unreachable; the hole stays open for every other
    // class the engine has no row for, so it is closed rather than hidden.
    expect(SRC).toContain('...(pending.override && !pendingChecks.some((c) => !c.ok && c.label === pending.override)')
    expect(SRC).toContain('? [{ label: `注意して配置: ${pending.override}`, tone: \'warn\' as const }]')
    // …and it is a RECORD, not a gate: `overrideCaption` is untouched, so an
    // appended warn row cannot make a blocked landing confirmable (⚖ 52 — × is
    // what stops you, △ is what you were told).
    const vip = { ok: false, label: 'VIP・個室クラスのご予約です: ベッド1は個室ではありません' }
    const fine = { ok: true, label: '整体資格 一致' }
    const locked = { ok: false, label: '見本 あずさはシフトロック中（新規配置不可）' }
    expect(overrideCaption([fine], vip.label)).toEqual(confirmCaption([fine]))
    expect(overrideCaption([locked, fine], vip.label).enabled).toBe(false)
    expect(INT).toContain('return confirmCaption(override == null ? checks : checks.filter((c) => c.ok || c.label !== override))')
    // The engine genuinely has no row for any of them — this is the fact the
    // label match could never satisfy.
    const rows = computeChecks(place(960, 1020, HOURS), {
      spans: [], bookingId: 'apt-1', staffName: '見本 あずさ', staffUntil: '19:00',
      laneLocked: false, minutesOf: (x: number) => minuteOf(x, HOURS),
    })
    expect(rows.some((c) => c.label.includes('満室'))).toBe(false)
    expect(rows.some((c) => c.label.includes('VIP'))).toBe(false)
    expect(rows.some((c) => c.label.includes('店舗'))).toBe(false)
  })

  // ── D: flag 59's residue, and the em-dash it produced ────────────────────
  it('⚖ 59 RESIDUE (UNPINNED-2) — a room-less booking dragged onto a FREE board stages with a NAMED bed', () => {
    // The half batch-10 did not close. `applyMoves` can only ADMIT a booking to
    // a lane it already has a drawing for, and a booking whose server record
    // carries no `resource_id` has no bed drawing anywhere — so the solved room
    // was written into `bedMoves` and silently dropped, and `holdSummary` read
    // the drawn board and printed 担当 … / —. Class-INDEPENDENT: this is the
    // clean landing, no override anywhere near it.
    const span = place(960, 1020, HOURS)
    const lanes = [
      lane({ key: 'p-01', group: 'staff', label: '見本 あずさ', stores: ['store-a'], items: [booking({ key: 'apt-9-staff', caseId: 'apt-9', title: '見本 きり', tag: '【未定】' }, 960, 1020)] }),
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1' }),
    ]
    // Nothing on the bed row to start with — that is the whole situation.
    expect(lanes[1].items.some((i) => i.caseId === 'apt-9')).toBe(false)
    const moves: Moves = { 'apt-9': { laneKey: 'p-01', ...span } }
    const bedMoves: Moves = { 'apt-9': { laneKey: 'bed-01', ...span } }
    const after = applyMoves(lanes, moves, [], [], HOURS, bedMoves)
    const bed = after.find((l) => l.key === 'bed-01')!
    const drawn = bed.items.find((i) => i.caseId === 'apt-9')
    expect(drawn).toBeDefined()
    // It is the booking's own row wearing the bed key, exactly as the server
    // builds the pair (today-board: one `bookingItem`, two key suffixes)…
    expect(drawn!.key).toBe('apt-9-bed')
    expect(drawn!.title).toBe('見本 きり')
    // …and it wears its PARTNER's name, re-tagged from the staged staff lane.
    expect(drawn!.tag).toBe('【見本 あずさ】')
    // THE EM-DASH IS GONE, which is the sentence Liam actually photographed.
    expect(holdSummary(after, 'apt-9', moves['apt-9'], HOURS)).toBe('見本 きり様 → 16:00〜17:00 / 担当 見本 あずさ / ベッド1')
    expect(holdSummary(after, 'apt-9', moves['apt-9'], HOURS)).not.toContain('/ —')
    // And it is fixed in the ONE pass every writer of `bedMoves` goes through —
    // not minted per gesture, which would also make the row exempt from the park
    // filter (a bed drawing that survives being put on the shelf).
    expect(INT).toContain('for (const id of Object.keys(bedMoves)) {')
    expect(INT).toContain('home.set(`beds|${id}`, { ...staffRow, key: `${id}-bed`, label })')
    // A booking that HAS its own bed drawing is untouched by it.
    const withBed = [
      lanes[0],
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: [booking({ key: 'apt-9-bed', caseId: 'apt-9', title: '見本 きり', tag: '【見本 あずさ】' }, 960, 1020)] }),
    ]
    expect(applyMoves(withBed, moves, [], [], HOURS, bedMoves).find((l) => l.key === 'bed-01')!.items.filter((i) => i.caseId === 'apt-9')).toHaveLength(1)
  })

  // ── ⚖ AMENDMENT 1 (Fable, 8/23) — the four-lens blind round's fix list ────

  it('⚖ A1-1 — a POLICY row over a FULL HOUSE is 満室, not a button that cannot fire', () => {
    // LENS-1 F1. The checks were read before the room and any failing row
    // returned immediately, so 勤務時間外 + 満室 came back `policy`: the box grew
    // a 「注意して配置」, the press reached `solveBed`, the allocator refused a
    // second time and the landing died in a toast with nothing staged. A button
    // that cannot perform what it names — ⚖ 31c, on all four gesture paths.
    const shiftEnds = { staff: { untilLabel: '16:30', window: { from: 600, until: 990 } } }
    const v = verdict(board({ ...shiftEnds, beds: busyBeds }), {}, cellOf('safe', ''))
    // 満室 outranks the judgement (TEST:4030's law), so the box is the ROOM's…
    expect(v.floor).toBe('hard-room')
    expect(v.reason).toContain('に空きがありません')
    // …which means NO escalation, and the bed-free offers apply instead.
    expect(v.kind).toBe('blocked')

    // A HARD row still outranks the room — unchanged, and the reason the two
    // were ordered this way in the first place: saying 満室 to someone whose
    // staff member is double-booked answers the wrong half.
    const clashToo = verdict(
      board({ staff: { items: [booking({ key: 'a', caseId: 'apt-other', title: '見本 あかり' }, 960, 1020)] }, beds: busyBeds }),
      {}, cellOf('safe', ''),
    )
    expect(clashToo.floor).toBe('hard')
    expect(clashToo.reason).toBe('時間帯が重複: 見本 あかり')

    // And with a room actually free, the policy row answers — WITH the solved
    // room in hand, which is what makes its 注意して配置 honest.
    const roomFree = verdict(board(shiftEnds), {}, cellOf('safe', ''))
    expect(roomFree.floor).toBe('policy')
    expect(roomFree.reason).toBe('見本 あずさは16:30以降勤務不可')
    expect(roomFree.bedLane).toBe('bed-01')

    // The ranking, in the one home, in the order the operator is answered.
    const order = ['startsWith(CLASH_ROW)) return stop(failed.label, ', 'if (solved.refusal) return stop(solved.refusal', "if (failed) return stop(failed.label, 'policy')"]
    expect(order.map((x) => INT.indexOf(x))).toEqual([...order.map((x) => INT.indexOf(x))].sort((a, b) => a - b))
    expect(order.every((x) => INT.includes(x))).toBe(true)
  })

  it('⚖ A1-1 rider — the starts a full-house box offers pass the WHOLE gate', () => {
    // The offers are filtered by the caller's own verdict, so a start that is
    // free of the room is also free of the shift row — the box cannot recommend
    // a start the release would refuse (flag 54's disease, at the new source).
    const shiftEnds = { staff: { untilLabel: '16:30', window: { from: 600, until: 990 } } }
    const lanes = board({ ...shiftEnds, beds: busyBeds })
    const gate = (start: number) =>
      landingVerdict(lanes, ask({ start, end: start + 60, span: place(start, start + 60, HOURS) }), cellOf('safe', '')).kind !== 'blocked'
    // 15:00 is room-free (the busy beds end at 17:00… they START at 16:00) and
    // inside the shift; 17:30 is room-free but PAST 16:30, so the gate refuses
    // it and it is never offered.
    expect(gate(900)).toBe(true)
    expect(gate(1050)).toBe(false)
    expect(nearestFreeStarts(960, 30, HOURS, 60, gate)).toEqual([900])
  })

  it('⚖ A1-2 — a closed override-stage still has a pill and a way back to its day', () => {
    // LENS-1 F2. The gate decided whether the WHOLE surface was built, so an
    // unopened override-stage had no pill and no 確定待ち day-pin — while still
    // blocking every other gesture. `pendingOpen` is screen-local (⚖ 71 requires
    // it), so a day flip remounted the screen and stranded the staged change
    // with nothing on screen pointing back at it.
    expect(SRC).toContain('const pendingAsking = pending != null && (pending.override == null || pendingOpen === pending.id)')
    expect(SRC).toContain('const holdPop: HoldPop | null = pending')
    // The gate moved onto the ANCHOR: closed → no anchor → the layout effect
    // takes the same road the day's own standing hold has always taken and pins
    // it as the pill (`anchorId: null` → `box` undefined → `setHoldPinned(true)`).
    expect(SRC).toContain('anchorId: pendingAsking ? pending.id : null,')
    expect(SRC).toContain('const at = box && anchorOnScreen(box, viewport) ? holdPopAnchor(')
    expect(SRC).toContain('      if (!at) {\n        setHoldPinned(true)')
    // The recall half renders unconditionally…
    const surface = SRC.slice(SRC.indexOf('{holdPop && ('), SRC.indexOf('{/* ⚖ Liam 19/20'))
    expect(surface.indexOf('className="hp-head"')).toBeLessThan(surface.indexOf('{holdPop.asking && ('))
    expect(surface.indexOf('hold-daypin')).toBeLessThan(surface.indexOf('{holdPop.asking && ('))
    expect(surface).toContain('{pending && pendingOffBoard && (')
    expect(surface).toContain('へ戻る</Link>')
    // …and the ASK — the rows and 確定/元に戻す — is what the gate withholds.
    expect(surface).toContain('{holdPop.asking && (')
    const asked = surface.slice(surface.indexOf('{holdPop.asking && ('))
    expect(asked).toContain('holdbar-checks')
    expect(asked).toContain('holdPop.confirm.run')
    expect(asked).toContain('元に戻す')
    // The day-hold arm is the question by definition (⚖ 71 opened it).
    expect(SRC).toContain('          asking: true,')
  })

  it('⚖ A1-3 — the box names the room the landing SOLVED, and says when it changed', () => {
    // LENS-1 F3+F10. `?? attempt.bedLane` named the room the booking carries IN
    // — which on a retarget is the bed the allocator has just refused. The box
    // promised a room the landing was never going to use.
    expect(SRC).toContain('bedLane: v.bedLane,')
    expect(SRC).not.toContain('v.bedLane ?? attempt.bedLane')
    // `ask.bedLane` is passed as `bedFrom` instead — its honest job, and what
    // makes a retarget PRINT rather than happen silently (⚖ 51's own law).
    expect(SRC).toContain('hours, ask.bedLane, {')
    const lanes = [
      lane({ key: 'p-01', group: 'staff', label: '見本 あずさ', stores: ['store-a'], items: [booking({ key: 'a-staff', caseId: 'apt-1', title: '見本 きり' }, 960, 1020)] }),
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1' }),
      lane({ key: 'bed-02', group: 'beds', label: 'ベッド2' }),
    ]
    const at = { laneKey: 'p-01', ...place(960, 1020, HOURS) }
    // Carried ベッド1, solved ベッド2 → the arrow, exactly as the confirm prints it.
    expect(holdSummary(lanes, 'apt-1', at, HOURS, 'bed-01', { staffLane: 'p-01', bedLane: 'bed-02' }))
      .toBe('見本 きり様 → 16:00〜17:00 / 担当 見本 あずさ / ベッド1 → ベッド2')
    // A landing that ends where it started says nothing.
    expect(holdSummary(lanes, 'apt-1', at, HOURS, 'bed-01', { staffLane: 'p-01', bedLane: 'bed-01' }))
      .toBe('見本 きり様 → 16:00〜17:00 / 担当 見本 あずさ / ベッド1')
  })

  it('⚖ A1-4 — the facts come from the QUESTION, so every staging path has them', () => {
    // LENS-1 F4. They hung off `attempt`, which exists only where a CARD can sit
    // at the landing (flag 57's paint) — so the keyboard nudge, 配置モード and the
    // shelf all staged with no facts at all. `ask` is what every path has.
    expect(SRC).toContain("const facts =\n      v.floor === 'policy'\n        ? {")
    expect(SRC).toContain('summary: holdSummary(boardLanes, ask.id ?? \'\', { laneKey, ...span }, hours, ask.bedLane, {')
    expect(SRC).toContain('staffLane: ask.staffLane,')
    // …and it is decoupled from the ghost, so flag 57's own contract is untouched.
    const explain = SRC.slice(SRC.indexOf('function explainBlocked('), SRC.indexOf('function cancelDrag('))
    expect(explain).not.toContain('attempt.id')
    expect(explain).not.toContain('attempt.staffLane')
    // A landing whose card is not DRAWN anywhere (a 次回予約 that does not exist
    // yet, a chip still on the shelf) has no name to read, and a bare 「様 →」 is
    // a sentence about nobody — the rest of the facts are the same either way.
    const lanes = [
      lane({ key: 'p-01', group: 'staff', label: '見本 あずさ', stores: ['store-a'] }),
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1' }),
    ]
    const at = { laneKey: 'p-01', ...place(960, 1020, HOURS) }
    expect(holdSummary(lanes, '', at, HOURS, null, { staffLane: 'p-01', bedLane: 'bed-01' }))
      .toBe('16:00〜17:00 / 担当 見本 あずさ / ベッド1')
    expect(holdSummary(lanes, '', at, HOURS, null, { staffLane: 'p-01', bedLane: 'bed-01' })).not.toContain('様')
    // The no-lane release stays bare by construction: it is `hard`, so no facts.
    expect(verdict(board(), { staffLane: null }).floor).toBe('hard')
  })

  it('⚖ A3 — a blocked NEXT-VISIT and a blocked SHELF placement name their customer', () => {
    // GREPTILE 4/5 on `2bed6632`, and the finding stands. The facts read identity
    // off the DRAWN board, and neither of these two landings has anything drawn:
    // a 次回予約 does not exist yet, and a chip is still on the shelf. So both
    // boxes asked 「注意して配置しますか」 about nobody — while the armed 配置モード
    // carried its customer and the chip carried its own title the whole time.
    const lanes = [
      lane({ key: 'p-01', group: 'staff', label: '見本 あずさ', stores: ['store-a'] }),
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1' }),
    ]
    const at = { laneKey: 'p-01', ...place(960, 1020, HOURS) }

    // 配置モード — the armed intent's own `name`, for a landing with NO id.
    expect(holdSummary(lanes, '', at, HOURS, null, { staffLane: 'p-01', bedLane: 'bed-01', title: '見本 きり' }))
      .toBe('見本 きり様 → 16:00〜17:00 / 担当 見本 あずさ / ベッド1')
    // Shelf — the chip's own `item.title`, same seam, same sentence.
    expect(holdSummary(lanes, 'apt-parked', at, HOURS, null, { staffLane: 'p-01', bedLane: 'bed-01', title: '見本 ごろう' }))
      .toBe('見本 ごろう様 → 16:00〜17:00 / 担当 見本 あずさ / ベッド1')

    // THE LAW HOLDS: the board is asked FIRST, so a drawn card can never be
    // overridden by a name from a hand that is holding something else.
    const drawn = [
      lane({ key: 'p-01', group: 'staff', label: '見本 あずさ', stores: ['store-a'], items: [booking({ key: 'a', caseId: 'apt-1', title: '見本 さくら' }, 960, 1020)] }),
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1' }),
    ]
    expect(holdSummary(drawn, 'apt-1', at, HOURS, null, { staffLane: 'p-01', bedLane: 'bed-01', title: '見本 きり' }))
      .toContain('見本 さくら様')
    // …and nothing is invented when nobody knows: a plain 新規予約 stages nothing
    // and has no customer yet by definition, so the line simply omits the name.
    expect(holdSummary(lanes, '', at, HOURS, null, { staffLane: 'p-01', bedLane: 'bed-01' }))
      .toBe('16:00〜17:00 / 担当 見本 あずさ / ベッド1')

    // The hand-along, and the key that makes a leak impossible: a shelf landing
    // is the chip whose id this ask carries, and only an ask with NO id can be
    // the armed 配置モード — a board drag's id is a real drawn booking and
    // matches neither, so an armed 配置モード cannot put its customer's name on
    // another booking's box.
    expect(SRC).toContain("const heldName = parkChips.find((c) => c.id === ask.id)?.item.title ?? (ask.id == null ? placing?.name : undefined)")
    expect(SRC).toContain('title: heldName,')
    // Resolved HERE rather than threaded through `askGuard`, which serves a third
    // caller (plain 新規予約) that has no customer to hand along.
    const guard = SRC.slice(SRC.indexOf('function askGuard('), SRC.indexOf('function closeAdvice('))
    expect(guard).not.toContain('heldName')
    expect(SRC.match(/heldName/g)).toHaveLength(2)
  })

  it('⚖ A1-5 — the bed-row stops carry their rows, and an empty strip never renders', () => {
    // LENS-1 F5. The two explicit-room stops returned before `computeChecks`, so
    // a VIP box printed a row of NOTHING under its sentence — which reads as "no
    // checks were run", the opposite of what the box is for.
    const vip = verdict(board(), { solveRoom: false, bedLane: 'bed-01', vip: true }, cellOf('safe', ''))
    expect(vip.floor).toBe('policy')
    expect(vip.checks.length).toBeGreaterThan(0)
    expect(vip.checks.some((c) => c.label === '整体資格 一致')).toBe(true)
    // The store-mismatch stop too — same block, same reason.
    const cross = landingVerdict(
      [lane({ key: 'p-01', group: 'staff', label: '見本 あずさ', stores: ['store-a'] }), lane({ key: 'bed-09', group: 'beds', label: 'ベッド9', stores: ['store-b'] })],
      ask({ solveRoom: false, bedLane: 'bed-09' }), cellOf('safe', ''),
    )
    expect(cross.checks.length).toBeGreaterThan(0)
    // The stops that fire before there is a staff lane still honestly carry none…
    expect(verdict(board(), { staffLane: null }).checks).toEqual([])
    // …so the render refuses to draw the container for them.
    expect(SRC).toContain('{(advice.facts.checks.length > 0 || advice.facts.guardRow) && (')
    // Reading the rows early did not move the ANSWER: each stop still returns
    // its own sentence, in the same order.
    expect(vip.reason).toBe('VIP・個室クラスのご予約です: ベッド1は個室ではありません')
    expect(cross.reason).toBe('担当と店舗が異なります: 見本 あずさ / ベッド9')
  })

  it('⚖ A1-7 — nearestFreeStarts cannot hang on an operator’s zero step', () => {
    // LENS-1 F8. `bookingStepMin` is a queued operator dial (⚠SETTINGS-BATCH); a
    // zero or negative step walked the loop forever and took the render thread
    // with it. A refusal box is not where a store finds out it typed 0.
    expect(nearestFreeStarts(960, 0, HOURS, 60, () => true)).toEqual([])
    expect(nearestFreeStarts(960, -30, HOURS, 60, () => true)).toEqual([])
    expect(INT).toContain('if (stepMin <= 0) return []')
    // …and a sane dial is untouched.
    expect(nearestFreeStarts(960, 30, HOURS, 60, () => true)).toEqual([930, 990])
  })

  it('⚖ A2-N1/N2 — the SAME guard on both siblings that read the same dial', () => {
    // AMENDMENT 2. The verify lens found F8's class in two more functions on the
    // same `bookingStepMin` dial, so the insurance goes at the shared functions
    // rather than at one caller — the rule this lane keeps reaching for.

    // N1 — `offerableCell`. Not a hang: `s % 0` is NaN, so the off-lattice branch
    // is taken and `Math.floor(s / 0) * 0` is NaN too. Every candidate is
    // garbage, and the caller's gate gets asked about starts that do not exist.
    const cell = { ...cellOf('degraded', 'x'), alternatives: [690, 750], alternativeKind: 'least-loss' as const }
    expect(offerableCell(cell, 0, 780, () => true)!.alternatives).toEqual([])
    expect(offerableCell(cell, -30, 780, () => true)!.alternatives).toEqual([])
    // The cell itself still comes back — only the offers are withheld, so the
    // sentence and the state the surface reads are untouched.
    expect(offerableCell(cell, 0, 780, () => true)!.sentence).toBe('x')
    expect(INT).toContain('if (stepMin <= 0) return { ...cell, alternatives: [] }')
    // A sane dial is untouched (the ⚖ 58 rider's own behaviour).
    expect(offerableCell(cell, 30, 780, () => true)!.alternatives).toEqual([690, 750])

    // N2 — `guardRailsFor`. Here it IS a true hang: the cell walk is
    // `start += input.stepMin`, so a zero step never reaches `close`. Safe today
    // only because both call sites hardcode canon's 30 — which is exactly the
    // kind of safe-by-accident a settings dial stops being.
    const rin = (stepMin: number) => ({
      open: HOURS.open, close: HOURS.close, stepMin, dur: 60, protectedDur: 90,
      nowMinute: null, locked: [] as string[], excludeId: null,
      guard: {
        services: [{ name: '整体60', dur: 60 }, { name: '骨盤90', dur: 90 }],
        newClientSessionMin: 90, protectedLabel: '新規', gapFillMinMin: 30, leadTimeMin: 0, mode: 'standard' as const,
      },
    })
    const lanes = board({ staff: { window: { from: 600, until: 1140 }, untilLabel: '19:00' } })
    expect(guardRailsFor(lanes, rin(0))).toEqual([])
    expect(guardRailsFor(lanes, rin(-30))).toEqual([])
    expect(INT).toContain('if (input.stepMin <= 0) return []')
    // …and canon's own 30 still draws a full rail.
    expect(guardRailsFor(lanes, rin(30))[0].cells.length).toBe((HOURS.close - HOURS.open) / 30)
  })

  it('⚖ A1-8 — park → place-back lands in the ALLOCATOR’s room, not the old one', () => {
    // LENS-3 F1, the highest of that lens. `placeFromShelf` wrote `moves` and
    // never `bedMoves`, so the stale entry `restoreSides` wrote at park time
    // survived: the placed-back card drew into its OLD room on top of whoever
    // was in it, while the room the allocator chose read free. Pre-existing —
    // the synthesized bed row only removed the immunity room-less bookings had.
    expect(SRC).toContain('setBedMoves((was) => ({ ...was, [chip.id]: { laneKey: bed.key, ...span } }))')
    // ⚖ 45's law, machine-checked: this function writes BOTH sides from ONE span.
    const shelf = SRC.slice(SRC.indexOf('function placeFromShelf('), SRC.indexOf('const monthCells ='))
    expect(shelf).toContain('setMoves((was) => ({ ...was, [chip.id]: { laneKey: staff.key, ...span } }))')
    expect(shelf).toContain('setBedMoves((was) => ({ ...was, [chip.id]: { laneKey: bed.key, ...span } }))')
    // The board half of the same cycle: with both sides written, the pair draws
    // where the placement says — and the old room is left to its own occupant.
    const span = place(960, 1020, HOURS)
    const lanes = [
      lane({ key: 'p-01', group: 'staff', label: '見本 あずさ', stores: ['store-a'], items: [booking({ key: 'apt-1-staff', caseId: 'apt-1', title: '見本 きり' }, 960, 1020)] }),
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: [booking({ key: 'apt-1-bed', caseId: 'apt-1', title: '見本 きり' }, 960, 1020)] }),
      lane({ key: 'bed-02', group: 'beds', label: 'ベッド2' }),
    ]
    // The stale park-time origin says ベッド1; the placement solved ベッド2.
    const after = applyMoves(lanes, { 'apt-1': { laneKey: 'p-01', ...span } }, [], [], HOURS, { 'apt-1': { laneKey: 'bed-02', ...span } })
    expect(after.find((l) => l.key === 'bed-02')!.items.some((i) => i.caseId === 'apt-1')).toBe(true)
    expect(after.find((l) => l.key === 'bed-01')!.items.some((i) => i.caseId === 'apt-1')).toBe(false)
    // …and the card names the room it is actually in, on both rows.
    expect(after.find((l) => l.key === 'p-01')!.items.find((i) => i.caseId === 'apt-1')!.tag).toBe('【ベッド2】')
  })

  it('⚖ A1-9 — the synthesized bed row announces the room it is SITTING in', () => {
    // LENS-3 F3. It copied the staff row's accessible name verbatim, and that
    // name carries the room the SERVER drew — 「未定」 for a `resource_id: null`
    // booking. A screen reader heard 「未定」 from a card sitting in ベッド1. The
    // codebase's own rule at its two sibling sites is: a row that moves rebuilds
    // its sentence rather than carrying one that is no longer true.
    const span = place(960, 1020, HOURS)
    const staffRow = booking({ key: 'apt-9-staff', caseId: 'apt-9', title: '見本 きり' }, 960, 1020)
    staffRow.label = '16:00–17:00 見本 きり様 / 再来 / 見本 あずさ / 未定 / 仮押さえ'
    const lanes = [
      lane({ key: 'p-01', group: 'staff', label: '見本 あずさ', stores: ['store-a'], items: [staffRow] }),
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1' }),
    ]
    const after = applyMoves(lanes, { 'apt-9': { laneKey: 'p-01', ...span } }, [], [], HOURS, { 'apt-9': { laneKey: 'bed-01', ...span } })
    const drawn = after.find((l) => l.key === 'bed-01')!.items.find((i) => i.caseId === 'apt-9')!
    expect(drawn.label).toBe('16:00–17:00 見本 きり様 / 再来 / 見本 あずさ / ベッド1 / 仮押さえ')
    expect(drawn.label).not.toContain('未定')
    // The staff row it was copied from is NOT rewritten — it names its partner
    // through `tag`, and its own fourth segment is the server's business.
    expect(after.find((l) => l.key === 'p-01')!.items.find((i) => i.caseId === 'apt-9')!.label).toContain('未定')
    // A differently-shaped label is left alone rather than mangled.
    const odd = booking({ key: 'apt-8-staff', caseId: 'apt-8', title: '見本 ごろう' }, 960, 1020)
    odd.label = 'no slashes here'
    const after2 = applyMoves(
      [lane({ key: 'p-01', group: 'staff', label: '見本 あずさ', stores: ['store-a'], items: [odd] }), lane({ key: 'bed-01', group: 'beds', label: 'ベッド1' })],
      { 'apt-8': { laneKey: 'p-01', ...span } }, [], [], HOURS, { 'apt-8': { laneKey: 'bed-01', ...span } },
    )
    expect(after2.find((l) => l.key === 'bed-01')!.items.find((i) => i.caseId === 'apt-8')!.label).toBe('no slashes here')
  })

  // ── E / T6: the button that could not perform what it named ──────────────
  it('⚖ 31c (T6) — 注意して配置 on a 配置モード refusal actually places', () => {
    // LIVE BREACH, found by the study: `askGuard` hands its `run` the sentence
    // the operator walked past, and the 配置モード callback dropped it — so
    // `placeNextVisit`'s `override` defaulted to null, the allocator refused a
    // second time and `if (!partner) return` exited silently. The button closed
    // the box, re-said the same refusal as a toast, and placed nothing.
    expect(SRC).toContain('(s, override) => placeNextVisit(lane, s, override),')
    expect(SRC).not.toContain('(s) => placeNextVisit(lane, s),')
    // Threaded exactly as the shelf chip threads it, which is where the correct
    // spelling has been all along.
    expect(SRC).toContain('placeFromShelf(chip, laneKey, s === start ? span : place(s, s + dur, hours), override),')
    // …and it reaches the stamp, so the confirm can show the △ (T2 above).
    expect(SRC).toContain("setPending({ id, origin: { laneKey: '', x: 0, w: 0 }, ...boardStamp, override: override ?? undefined })")
    // Plain-create's drop STAYS: nothing stages there, so there is nothing to
    // stamp and nothing that could lie.
    expect(SRC).toContain('(s) => openCreateAt({ staffId: lane.key, start: s }),')
  })
})
