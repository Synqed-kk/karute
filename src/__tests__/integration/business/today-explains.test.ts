// THE BOARD EXPLAINS ITSELF (⚖ LIAM flag 44, + rider 75(i)).
//
// WHAT WENT WRONG. The 60分配置 strip is honest and unreadable. A refused start
// is a grey 「—」 that states a refusal and names nothing — and two of the three
// things that can cause one are INVISIBLE on the row the chip sits under: a
// full house lives on the bed rows, and the guard protecting the 新規 window is
// a rule with no card anywhere. Liam's own reading: empty space, a board
// refusing to sell it, and no way to find out why short of dragging a card at
// it and reading the toast.
//
// WHAT THIS FILE PROVES:
//   §1 the CLASS of blocker is a field the engine's own branches set, never a
//      sentence a display has to pattern-match back.
//   §2 the 10px word each class wears — and 清掃 rather than 満室 when every
//      occupant of the judged window is a turnaround, read off the SAME walk
//      that composed the sentence beside it.
//   §3 every sentence names the exact window it judged, in each class's own
//      grammar — and the bed refusal is `fullRoomsRefusal`'s, arriving whole.
//   §4 ⚖ 75(i): the collector is OBSERVATIONAL — the reconciled cells are
//      identical with it and without it — and the honest clause it feeds either
//      names who got the room or states the absence WITHOUT inventing a cause.
//   §5 DIAL HONESTY: across all twelve dial combinations, on the REAL fixture
//      board, every blocked chip says something and every sentence carries its
//      own window. At most of those combinations the sell layer is EMPTY, which
//      is exactly when a board that cannot explain itself does the most damage.
//   §6 the rest cues are ONE decision: the dot and the hatch are read off the
//      same value the word is — and (⚖ flag 88) the LANE HATCH additionally
//      paints on empty track only, because a wash under a price box says the
//      opposite of the box.
//   §9 ⚖ flag 87: a staged change re-solves its room from the room the booking
//      OWNS, so a round trip puts the board back byte for byte.
//
// THE BOARD UNDER TEST IS THE REAL ONE for §5: `TodayPage` is executed and the
// props it hands `TodayScreen` are read, so the lanes, rooms, hours and dials
// are the operator's. §1–§4 build the scene by hand, because the shapes they
// need (an all-清掃 window, a room-drop with a named taker) are not reliably on
// the fixture at every dial.

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { STORE_A } from '@/business/lib/fixtures'
import { bedTruthViews } from '@/app/[locale]/(business)/business/today/capacity-ledger'
import { clampPriceInputs, money } from '@/business/lib/canon-logic/pricing'
import type { GapCell, SellCell } from '@/business/lib/canon-logic/availability'
import {
  allocateBed,
  applyMoves,
  explainRails,
  gapLayerFor,
  guardRailsFor,
  pairLanesOf,
  railExplain,
  restCueStarts,
  seedBed,
  sellLayerFor,
  sidesAt,
  type GuardRail,
  type Move,
  type Moves,
  type RailCell,
  type RoomPolicy,
  type SellDrop,
} from '@/app/[locale]/(business)/business/today/today-interactions'
import { TodayScreen, type TodayProps } from '@/app/[locale]/(business)/business/today/TodayScreen'
import TodayPage from '@/app/[locale]/(business)/business/today/page'
import { minuteOf, place, type BoardItem, type BoardLane } from '@/business/lib/today-board'

const service = createServiceClient as jest.Mock
const supabase = createClient as jest.Mock

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function screenProps(node: any): TodayProps | null {
  if (!node || typeof node !== 'object') return null
  if (node.type === TodayScreen) return node.props
  const kids = node.props?.children
  for (const kid of Array.isArray(kids) ? kids.flat() : [kids]) {
    const hit = screenProps(kid)
    if (hit) return hit
  }
  return null
}

let REAL: TodayProps

beforeAll(async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-08-19T00:00:00Z'))
  supabase.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'o@x.jp' } }, error: null }) },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain = (r: unknown): any => ({ select: () => chain(r), eq: () => chain(r), maybeSingle: async () => r })
  service.mockReturnValue({
    from: (table: string) =>
      chain(
        table === 'business_workspace_grants'
          ? { data: { workspace_id: 'business_admin', granted_by: 'u1' }, error: null }
          : table === 'profiles'
            ? { data: { customer_id: 'biz-1', is_management: false }, error: null }
            : { data: null, error: null },
      ),
  })
  REAL = screenProps(
    await TodayPage({
      params: Promise.resolve({ locale: 'ja' }),
      searchParams: Promise.resolve({ store: STORE_A }),
    }),
  )!
})

afterAll(() => jest.useRealTimers())

// ── the hand-built scenes ───────────────────────────────────────────────────

const HOURS = { open: 600, close: 1140 } // 10:00–19:00
const POLICY: RoomPolicy = { vipStaysPrivate: true, privateIsLastResort: true }
const GUARD = {
  services: [{ name: '整体60', dur: 60 }, { name: '骨盤90', dur: 90 }],
  newClientSessionMin: 90,
  protectedLabel: '新規',
  gapFillMinMin: 30,
  leadTimeMin: 0,
  mode: 'standard' as const,
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

const cleanup = (key: string, start: number, end: number): BoardItem => ({
  ...booking({ key, caseId: null }, start, end),
  kind: 'cleanup', state: null, category: null, title: '清掃',
})

function lane(over: Partial<BoardLane> & Pick<BoardLane, 'key' | 'group'>): BoardLane {
  return {
    label: over.key, sub: '', absentNote: null, mine: false, items: [],
    window: over.group === 'staff' ? { from: HOURS.open, until: HOURS.close } : null,
    untilLabel: over.group === 'staff' ? '19:00' : null,
    listPrice: over.group === 'staff' ? 7000 : 0,
    stores: over.group === 'staff' ? null : ['store-a'],
    roomClass: over.group === 'staff' ? null : 'standard',
    ...over,
  }
}

/** The rail exactly as the screen builds it, rooms included — flag 76's
 *  callback is what makes a bed refusal reachable here at all. */
function railOn(lanes: BoardLane[], dur = 60): GuardRail {
  const truth = bedTruthViews(lanes, POLICY, { openMin: HOURS.open, closeMin: HOURS.close, nowMin: HOURS.open }, null).world
  return guardRailsFor(lanes, {
    open: HOURS.open, close: HOURS.close, stepMin: 30, dur, protectedDur: 90,
    nowMinute: null, locked: [], guard: GUARD,
    placementFeasible: lanes.some((l) => l.group === 'beds')
      ? (l, start, d) => truth.newClientMask(l, d)(start)
      : undefined,
  })[0]
}

const at = (rail: GuardRail, minute: number): RailCell => rail.cells.find((c) => c.start === minute)!

const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** A chip the board did NOT refuse. Deliberately not `state === 'safe'`: an
 *  empty 10:00–19:00 shift has six 90-minute 新規 windows and placing a 60
 *  anywhere costs one, so canon's own honest answer there is △ and a scene
 *  built to hold a ✓ would be a scene built to pass a test. Everything these
 *  pins are about — the appended window, ⚖ 75(i)'s clause — keys on
 *  「not blocked」, which is exactly what this asks. */
const placeableOn = (rail: GuardRail): RailCell => rail.cells.find((c) => c.state !== 'blocked')!

/** The screen's own composition for one chip: `allocateBed`'s answer for the
 *  chip's own window whenever the class is `bed`, and nothing otherwise. */
const explainOn = (lanes: BoardLane[], cell: RailCell, dur = 60) =>
  railExplain(cell, dur, {
    room:
      cell.reason === 'bed'
        ? allocateBed(lanes, {
            id: null, currentBed: null, stores: null, vip: false,
            start: cell.start, end: cell.start + dur, policy: POLICY,
          })
        : null,
  })

/** ONE STAFF LANE, ONE ROOM. The room is what the scene varies. */
const sceneWith = (bedItems: BoardItem[]) => [
  lane({ key: 'p-01', group: 'staff', label: '見本 あずさ' }),
  lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: bedItems }),
]

describe('§1 — WHICH KIND of blocker is a field, never a sentence read back', () => {
  it('the three engine branches each stamp their own class, and a placeable start stamps none', () => {
    // A room busy for the whole judged window, on a staff lane that is wide
    // open: the pocket holds, so the ONLY thing left is the resource.
    const bedBusy = at(railOn(sceneWith([booking({ key: 'b1', caseId: 'x1', title: '見本 かえる' }, 780, 900)])), 780)
    expect([bedBusy.state, bedBusy.reason]).toEqual(['blocked', 'bed'])

    // The staff lane itself is busy: no pocket holds a 60 at this start, and the
    // booking that says so is DRAWN on the row.
    const noFit = at(railOn([lane({ key: 'p-01', group: 'staff', items: [booking({ key: 's1', caseId: 'y1' }, 780, 840)] })]), 780)
    expect([noFit.state, noFit.reason]).toEqual(['blocked', 'fit'])

    // A start the guard refuses to protect the 新規 window — no rooms in this
    // scene at all, so nothing can blame a bed.
    const guarded = railOn([lane({ key: 'p-01', group: 'staff', items: [booking({ key: 's1', caseId: 'y1' }, 900, 960)] })])
      .cells.find((c) => c.state === 'blocked' && c.reason === 'guard')
    expect(guarded).toBeDefined()
    expect(guarded!.sentence).not.toBe('')

    // …and a start that is fine says nothing about a blocker, because there is none.
    const fine = placeableOn(railOn(sceneWith([])))
    expect(fine.reason).toBeNull()
  })

  it('R-UNAVAILABLE is the ONLY bed class, and it is unreachable without rooms', () => {
    // ⚖ 76 — the engine emits `R-UNAVAILABLE` only when a `placementFeasible`
    // callback answered false (gap-guard :272/:347/:370). A store with no rooms
    // configured is not a store that cannot sell, and none of its chips may
    // blame a bed.
    const roomless = railOn([lane({ key: 'p-01', group: 'staff', items: [booking({ key: 's1', caseId: 'y1' }, 900, 960)] })])
    expect(roomless.cells.some((c) => c.reason === 'bed')).toBe(false)
  })
})

describe('§2 — the 10px word, and 清掃 when that is the truth', () => {
  it('bed → 満室, all-清掃 → 清掃, guard → 新規用, no-fit → no word at all', () => {
    const busy = sceneWith([booking({ key: 'b1', caseId: 'x1', title: '見本 かえる' }, 780, 900)])
    expect(explainOn(busy, at(railOn(busy), 780)).word).toBe('満室')

    // EVERY occupant of the judged window is a turnaround. Same class, truer
    // word — and it is read off `allocateBed`'s own walk, so it can never
    // disagree with the sentence that walk composed.
    const turning = sceneWith([cleanup('c1', 780, 840), cleanup('c2', 840, 900)])
    const turningCell = at(railOn(turning), 780)
    expect(turningCell.reason).toBe('bed')
    expect(explainOn(turning, turningCell).word).toBe('清掃')

    // ONE booking among the 清掃 and it is a busy house again — the word never
    // softens what is actually in the room.
    const mixed = sceneWith([cleanup('c1', 780, 820), booking({ key: 'b1', caseId: 'x1', title: '見本 かえる' }, 820, 900)])
    expect(explainOn(mixed, at(railOn(mixed), 780)).word).toBe('満室')

    const guarded = railOn([lane({ key: 'p-01', group: 'staff', items: [booking({ key: 's1', caseId: 'y1' }, 900, 960)] })])
      .cells.find((c) => c.reason === 'guard')!
    // ⚖ LIAM RULING (2026-08-30) — 新規用, not 新規. Bare 新規 is the board's
    // カテゴリー word, so on a chip it read as 「put a new customer here」 —
    // the inversion of a HOLD. The 用 is what makes the word un-invertible.
    expect(explainOn([], guarded).word).toBe('新規用')

    // ⚖ Fable-accepted default (overturnable, noted in the PR body): a
    // no-pocket-fit chip keeps the bare 「—」. Its blocker is drawn on the row.
    const noFit = at(railOn([lane({ key: 'p-01', group: 'staff', items: [booking({ key: 's1', caseId: 'y1' }, 780, 840)] })]), 780)
    expect(explainOn([], noFit).word).toBeNull()

    // A start nothing refused wears nothing.
    expect(explainOn(sceneWith([]), placeableOn(railOn(sceneWith([])))).word).toBeNull()
  })

  // ⚖ 44 FIX ROUND (blind lens 1, F1) — THE TWO WAYS THE WORD USED TO LIE. The
  // chip's CLASS is the engine's and the room answer beside it is the display's
  // own `allocateBed` call; where the two legitimately disagree, the word has to
  // fall silent rather than name a state that is not on the board.
  it('a bed class with NO refusal wears no word — the display found the room the engine could not', () => {
    // The strip judged this start against the whole board, so ベッド1 is busy and
    // the chip is `bed`. The SENTENCE is asked with the card in hand lifted out
    // (`handId`), which is exactly the booking in the way — so the allocator
    // hands back that very room, free.
    const busy = sceneWith([booking({ key: 'b1', caseId: 'x1', title: '見本 かえる' }, 780, 900)])
    const cell = at(railOn(busy), 780)
    expect(cell.reason).toBe('bed')
    const lifted = allocateBed(busy, {
      id: 'x1', currentBed: null, stores: null, vip: false, start: 780, end: 840, policy: POLICY,
    })
    expect([lifted.laneKey, lifted.refusal]).toEqual(['bed-01', null])
    // 満室 over a room that is standing empty is the lie. Bare 「—」 instead.
    expect(railExplain(cell, 60, { room: lifted }).word).toBeNull()
  })

  it('a refusal that names NOBODY wears no word — 使えるベッドがありません is not a full house', () => {
    // ⚖ 46 store isolation: this staff member's store has no rooms in it at all,
    // so the allocator's candidate list is empty. It refuses — truthfully — and
    // there is no occupant anywhere in the answer.
    const split = [
      lane({ key: 'p-01', group: 'staff', label: '見本 あずさ', stores: ['store-b'] }),
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', stores: ['store-a'] }),
    ]
    const empty = allocateBed(split, {
      id: null, currentBed: null, stores: ['store-b'], vip: false, start: 780, end: 840, policy: POLICY,
    })
    expect(empty.refusal).toBe('13:00〜14:00に使えるベッドがありません')
    expect(empty.blockers).toEqual([])
    const bedCell: RailCell = { ...at(railOn(sceneWith([])), 780), state: 'blocked', reason: 'bed' }
    const said = railExplain(bedCell, 60, { room: empty })
    // 「満室」 beside 「使えるベッドがありません」 said two different things about
    // one board — and 清掃 was the LITERAL old answer here, because `every` on an
    // empty list is true. Neither now: the sentence still refuses, the chip is bare.
    expect(said.word).toBeNull()
    expect(said.sentence).toBe('13:00〜14:00に使えるベッドがありません')
  })
})

describe('§3 — every sentence names the window it judged', () => {
  it('a bed refusal is `fullRoomsRefusal`’s sentence, whole and unedited', () => {
    const busy = sceneWith([booking({ key: 'b1', caseId: 'x1', title: '見本 かえる' }, 780, 900)])
    const said = explainOn(busy, at(railOn(busy), 780)).sentence
    expect(said).toBe('13:00〜14:00はベッドに空きがありません。ベッド1が使用中（見本 かえる様）')
    // ⛔ THE RETIRED VOCABULARY, pinned dead. The 8/25 native pass ruled
    // 「…に空きがありません」; 満室 survives as the CHIP's word and nowhere else,
    // and 「空きベッドなし」 was never vocabulary at all.
    expect(said).not.toContain('この時間帯に空いているベッドがいません')
    expect(said).not.toContain('空きベッドなし')
    expect(said).not.toContain('満室')
  })

  it('every other class appends its own 「（HH:MM〜HH:MM）」', () => {
    const noFit = at(railOn([lane({ key: 'p-01', group: 'staff', items: [booking({ key: 's1', caseId: 'y1' }, 780, 840)] })]), 780)
    expect(explainOn([], noFit).sentence).toBe('この開始には60分の連続した空きがありません（13:00〜14:00）')

    const ok = placeableOn(railOn(sceneWith([])))
    expect(explainOn([], ok).sentence).toBe(`${ok.sentence}（${clock(ok.start)}〜${clock(ok.start + 60)}）`)

    const guarded = railOn([lane({ key: 'p-01', group: 'staff', items: [booking({ key: 's1', caseId: 'y1' }, 900, 960)] })])
      .cells.find((c) => c.reason === 'guard')!
    expect(explainOn([], guarded).sentence).toBe(`${guarded.sentence}（${clock(guarded.start)}〜${clock(guarded.start + 60)}）`)
    // ⚖ NATIVE PASS (2026-08-26) — 〜, one glyph for one fact. The bed branch
    // above spells its window the same way, and an en dash beside it on the
    // same strip was two punctuations for one grammar.
    expect(explainOn([], noFit).sentence).not.toContain('–')
  })

  // ⚖ 44 FIX ROUND (blind lens 2) — THE △ CLASS, PINNED BY NAME. §3 proved safe,
  // no-fit and guard by name and left the fourth class to `placeableOn`, which
  // asks 「not blocked」 and would go on passing if degraded stopped composing.
  it('a △ chip carries its own window too', () => {
    const rail = railOn(sceneWith([]))
    const degraded = rail.cells.find((c) => c.state === 'degraded')
    expect(degraded).toBeDefined()
    // The engine's own least-loss line, with the judged window appended and no
    // word — a △ is not a refusal, so it has no invisible blocker to name.
    const said = explainOn([], degraded!)
    expect(said.word).toBeNull()
    expect(said.sentence).toBe(`${degraded!.sentence}（${clock(degraded!.start)}〜${clock(degraded!.start + 60)}）`)
  })

  it('the window follows the LENGTH the strip is judging (⚖ 50)', () => {
    // A 90 in hand asks about 13:00〜14:30, and the sentence has to say so or it
    // is naming a span the operator is not holding.
    const noFit = at(railOn([lane({ key: 'p-01', group: 'staff', items: [booking({ key: 's1', caseId: 'y1' }, 780, 840)] })], 90), 780)
    expect(explainOn([], noFit, 90).sentence).toContain('（13:00〜14:30）')
  })
})

describe('§4 — ⚖ 75(i): the collector observes, and the clause never invents', () => {
  /** A cross-row collision: p-06's gap box holds ベッド1 over the hour p-05's
   *  販売可能枠 wants, and there is nowhere else for the loser to go. */
  const oneRoom = (): BoardLane[] => [
    lane({ key: 'p-05', group: 'staff', label: '見本 あずさ', stores: ['store-a'] }),
    lane({ key: 'p-06', group: 'staff', label: '見本 かおる', stores: ['store-a'] }),
    lane({ key: 'bed-01', group: 'beds', label: 'ベッド1' }),
  ]
  const promise = (laneKey: string, s: number, e: number): GapCell[] => [
    { laneKey, resourceKey: 'bed-01', group: 'staff', staff: laneKey, s, e, price: 5000 },
    { laneKey, resourceKey: 'bed-01', group: 'beds', staff: laneKey, s, e, price: 5000 },
  ]
  const priceOf = (props: TodayProps) => {
    const price = clampPriceInputs(props.dialogs.pricing.hqMax, props.dialogs.pricing.base, props.dialogs.pricing)
    return { price, depth: Math.round((1 - price.lo / price.hi) * 100) }
  }
  const layerWith = (claims: GapCell[], onDrop?: (d: SellDrop) => void) => {
    const { price, depth } = priceOf(REAL)
    return sellLayerFor(oneRoom(), REAL.hours, {
      gridMin: 60, nowMinute: null, locked: [], showPrice: true,
      hi: price.hi, hqMin: REAL.dialogs.pricing.hqMin, depth,
      reconcile: { claims, rooms: POLICY, cleanupMinutesByBed: {}, onDrop },
    })
  }

  it('PURITY: the reconciled layer is identical with the collector and without it', () => {
    const claims = promise('p-06', 900, 960)
    const drops: SellDrop[] = []
    const watched = layerWith(claims, (d) => drops.push(d))
    const blind = layerWith(claims)
    // Byte-for-byte, not merely equivalent: an observer that changed one cell
    // would make every sentence composed from it a sentence about a different
    // board.
    expect(JSON.stringify(watched)).toBe(JSON.stringify(blind))
    expect(drops.length).toBeGreaterThan(0)
  })

  it('a ROOM drop names who got the room; a LANE drop is a box that IS drawn', () => {
    const roomDrops: SellDrop[] = []
    layerWith(promise('p-06', 900, 960), (d) => roomDrops.push(d))
    const lost = roomDrops.find((d) => d.laneKey === 'p-05' && d.h === 900)
    expect(lost).toBeDefined()
    expect([lost!.kind, lost!.takerLaneKey]).toEqual(['room', 'p-06'])

    // The same person's OWN promise: no room could have saved that offer, and
    // the box that beat it is on this very row — so ⚖ 75(i) gives it no clause.
    const laneDrops: SellDrop[] = []
    layerWith(promise('p-05', 900, 960), (d) => laneDrops.push(d))
    expect(laneDrops.find((d) => d.laneKey === 'p-05' && d.h === 900)?.kind).toBe('lane')
  })

  it('the clause names the taker, or states the absence and NOTHING more', () => {
    const safe = placeableOn(railOn(sceneWith([])))
    const win = `（${clock(safe.start)}〜${clock(safe.start + 60)}）`

    // A room-drop explains the hole: the sentence says who is using the room.
    // ⚖ NATIVE PASS (2026-08-26) — the taker is a person, so it hangs off
    // スタッフ, and what took the room is that person's 枠, never a 販売枠.
    expect(railExplain(safe, 60, { adless: true, takerLabel: '見本 かおる' }).sentence)
      .toBe(`${safe.sentence}${win}。ベッドは別のスタッフ（見本 かおる）の枠が使うため、ここには販売可能枠を出していません`)

    // Nothing was dropped — the hour was simply never derived. The clause states
    // that and invents no cause for it. ⚖ NATIVE PASS (2026-08-26) — and it
    // states it as a FACT about the inventory, not about the display.
    const bare = railExplain(safe, 60, { adless: true, takerLabel: null }).sentence
    expect(bare).toBe(`${safe.sentence}${win}。この開始には販売可能枠が出ていません`)
    expect(bare).not.toContain('ベッド')

    // A window that DOES carry a box gets no clause at all.
    expect(railExplain(safe, 60, { adless: false, takerLabel: '見本 かおる' }).sentence).toBe(`${safe.sentence}${win}`)
    // …and a refused chip is already answering, so it never grows one either.
    const noFit = at(railOn([lane({ key: 'p-01', group: 'staff', items: [booking({ key: 's1', caseId: 'y1' }, 780, 840)] })]), 780)
    expect(railExplain(noFit, 60, { adless: true, takerLabel: '見本 かおる' }).sentence).not.toContain('別のスタッフ')
  })
})

describe('§5 — DIAL HONESTY: the board explains itself on empty boards too', () => {
  const GRID = [30, 60]
  const SESSION = [45, 60, 90]
  const MIN_SELLABLE = [0, 30]

  it('at all 12 dial combinations every blocked chip says something, and says WHICH window', () => {
    const price = clampPriceInputs(REAL.dialogs.pricing.hqMax, REAL.dialogs.pricing.base, REAL.dialogs.pricing)
    const depth = Math.round((1 - price.lo / price.hi) * 100)
    const frame = { hi: price.hi, lo: price.lo, hqMin: REAL.dialogs.pricing.hqMin, hqMax: REAL.dialogs.pricing.hqMax }
    const truth = bedTruthViews(
      REAL.lanes,
      REAL.rooms,
      { openMin: REAL.hours.open, closeMin: REAL.hours.close, nowMin: REAL.sell.nowMinute ?? REAL.hours.open },
      null,
    ).world

    const rows: string[] = []
    const mute: string[] = []
    for (const gridMin of GRID) {
      for (const sessionMin of SESSION) {
        for (const minSellableMin of MIN_SELLABLE) {
          const at = `grid=${gridMin} S=${sessionMin} minSell=${minSellableMin}`
          // ⚖ 44 FIX ROUND (blind lenses 2 + 3) — THE STRIP MOVES WITH THE DIAL
          // TOO. The rails used to be built ONCE, outside this loop, at the
          // fixture's own S — so twelve combinations swept the sell layer past a
          // strip that never changed, and the S column proved nothing at all
          // about the chips. ⚖ 50 makes the judged length follow the session, so
          // the rails are rebuilt per combo and every window below is that
          // combo's own.
          const rails = guardRailsFor(REAL.lanes, {
            open: REAL.hours.open, close: REAL.hours.close, stepMin: 30,
            dur: sessionMin, protectedDur: REAL.guard.protectedDurationMin,
            nowMinute: REAL.sell.nowMinute, locked: [], guard: REAL.guard.config,
            placementFeasible: (l, start, d) => truth.newClientMask(l, d)(start),
          })
          expect(rails.length).toBeGreaterThan(0)
          const gap = gapLayerFor(REAL.lanes, {
            gridMin, sessionMin, gapFillMin: REAL.guard.gapFillMinMin,
            gapFillDiscountPct: REAL.guard.gapFillDiscountPct, minSellableMin,
            nowMinute: REAL.sell.nowMinute, locked: [], frame, depth, guard: REAL.guard.config,
          })
          const claims = [...gap.packed, ...gap.scraps]
          const drops: SellDrop[] = []
          const sell = sellLayerFor(REAL.lanes, REAL.hours, {
            gridMin, nowMinute: REAL.sell.nowMinute, locked: [], showPrice: true,
            hi: price.hi, hqMin: REAL.dialogs.pricing.hqMin, depth,
            reconcile: {
              claims, rooms: REAL.rooms, cleanupMinutesByBed: REAL.bedCleanupMinutes,
              onDrop: (d) => drops.push(d),
            },
          })
          // ⚖ 44 FIX ROUND (blind lens 3) — AND THE SCREEN'S OWN COMPOSITION,
          // not a second one written for the test. The sweep used to call
          // `railExplain` with the room alone, so ⚖ 75(i)'s two clauses — the
          // widest thing a sentence can grow on this board — were swept at
          // exactly zero of the twelve combinations. `explainRails` is the
          // function TodayScreen's memo calls, with the layer and the drops this
          // combo just produced.
          const explained = explainRails(rails, REAL.lanes, {
            dur: sessionMin,
            handId: null,
            rooms: REAL.rooms,
            stagedId: null,
            sellCells: sell.cells,
            claims,
            drops,
            inHand: false,
            sellDisplayed: true,
          })

          let blocked = 0
          let worded = 0
          let claused = 0
          for (const rail of rails) {
            for (const c of rail.cells) {
              const said = explained.get(rail.laneKey)!.get(c.start)!
              // THE BAR, on every single chip of every single lane: it says
              // something, and what it says names the window it judged. Both
              // grammars satisfy it — the bed refusal opens with 「HH:MM〜HH:MM」
              // and everything else closes with 「（HH:MM〜HH:MM）」 — which is
              // why the clock strings themselves are the pin rather than the
              // position of the window in the sentence.
              expect({ at, chip: `${rail.laneKey}@${c.start}`, empty: said.sentence === '' })
                .toEqual({ at, chip: `${rail.laneKey}@${c.start}`, empty: false })
              const from = clock(c.start)
              const to = clock(c.start + sessionMin)
              expect({ at, chip: `${rail.laneKey}@${c.start}`, names: said.sentence.includes(from) && said.sentence.includes(to) })
                .toEqual({ at, chip: `${rail.laneKey}@${c.start}`, names: true })
              if (c.state === 'blocked') blocked += 1
              if (said.word != null) worded += 1
              if (said.sentence.includes('販売可能枠')) claused += 1
              // A word only ever rides a refusal, and only the two invisible ones.
              if (said.word != null) expect(c.reason === 'bed' || c.reason === 'guard').toBe(true)
              // ⚖ 75(i) — and a clause only ever rides a start the board said
              // YES to. A refusal is already answering.
              if (c.state === 'blocked') expect(said.sentence).not.toContain('販売可能枠')
            }
          }
          expect(blocked).toBeGreaterThan(0)
          const offers = sell.cells.length + gap.packed.length + gap.scraps.length
          if (sell.cells.length === 0) mute.push(at)
          rows.push(
            `${at} | chips blocked ${blocked} worded ${worded} claused ${claused}` +
              ` | sell ${sell.cells.length} packed ${gap.packed.length} scraps ${gap.scraps.length} (total ${offers})` +
              ` | drops ${drops.length}`,
          )
        }
      }
    }
    expect(rows).toHaveLength(12)
    // ⚠ THE POINT OF THE SWEEP, asserted rather than hoped for: the strip is
    // asked to explain itself on boards whose SELL LAYER IS EMPTY. That is not a
    // failure — canon's grid mode legitimately silences it — it is precisely
    // when a board that cannot explain itself does the most damage, so the
    // sweep has to actually reach those combinations or every pin above it was
    // proved only on boards that were already advertising something.
    // 8 of the 12 at the time of writing; the pin is the FACT that some are
    // reached, not the count — a dial change that moved it is not a regression,
    // a sweep that stopped reaching any of them is.
    expect(mute.length).toBeGreaterThan(0)
    // ⚖ 44 FIX ROUND — AND THE CLAUSE COUNT IS ZERO AT ALL TWELVE, RECORDED
    // RATHER THAN ASSERTED AWAY. `claused` is threaded through the real
    // composer now, and it comes back 0 everywhere because this fixture board
    // refuses 88 of its ~90 chips and advertises every start it does not: there
    // is no ad-less ✓ on it at any dial. That is the board being what it is, not
    // the wiring being absent — ⚖ 75(i)'s clause is proved in §4 and §7, where a
    // scene can be built to hold one. If a future fixture grows an ad-less ✓
    // this column starts counting on its own.
    expect(rows.every((r) => r.includes('claused 0 '))).toBe(true)
  })
})

// ── §7 ─────────────────────────────────────────────────────────────────────
//
// ⚖ 44 FIX ROUND — WHAT THE SCREEN ACTUALLY ASKS. All four blind lenses named
// the same gap: `railExplain` composes ONE chip and was pinned to death, while
// the thing that decides what each chip is ASKED — is this window advertised,
// who took the room, is a card in hand, is the sell layer even on screen —
// lived inline in a React memo where nothing could reach it. It is
// `explainRails` now, beside its own composer, and this is its coverage.
describe('§7 — the whole strip’s reading of itself: `explainRails`', () => {
  /** Two staff on one room, so a room-drop with a real taker is buildable. */
  const twoStaff = (): BoardLane[] => [
    lane({ key: 'p-05', group: 'staff', label: '見本 あずさ', stores: ['store-a'] }),
    lane({ key: 'p-06', group: 'staff', label: '見本 かおる', stores: ['store-a'] }),
    lane({ key: 'bed-01', group: 'beds', label: 'ベッド1' }),
  ]
  const railsOn = (lanes: BoardLane[], dur = 60): GuardRail[] => {
    const truth = bedTruthViews(lanes, POLICY, { openMin: HOURS.open, closeMin: HOURS.close, nowMin: HOURS.open }, null).world
    return guardRailsFor(lanes, {
      open: HOURS.open, close: HOURS.close, stepMin: 30, dur, protectedDur: 90,
      nowMinute: null, locked: [], guard: GUARD,
      placementFeasible: lanes.some((l) => l.group === 'beds') ? (l, start, d) => truth.newClientMask(l, d)(start) : undefined,
    })
  }
  const ask = (lanes: BoardLane[], over: Partial<Parameters<typeof explainRails>[2]> = {}) =>
    explainRails(railsOn(lanes), lanes, {
      dur: 60, handId: null, rooms: POLICY, stagedId: null,
      sellCells: [], claims: [], drops: [], inHand: false, sellDisplayed: true,
      ...over,
    })
  const sellAt = (laneKey: string, h: number): SellCell => ({
    laneKey, resourceKey: 'bed-01', group: 'staff', staff: laneKey, bed: 'ベッド1', h, price: 7000, tier: 2,
  })
  /** The first start on p-05 the board did not refuse — where ⚖ 75(i) lives. */
  const okStart = (lanes: BoardLane[]) => railsOn(lanes).find((r) => r.laneKey === 'p-05')!.cells.find((c) => c.state !== 'blocked')!.start

  it('an ADVERTISED window gets no clause, an ad-less one does', () => {
    const lanes = twoStaff()
    const start = okStart(lanes)
    expect(ask(lanes).get('p-05')!.get(start)!.sentence).toContain('この開始には販売可能枠が出ていません')
    // One box overlapping this window and the question ⚖ 75(i) asks is answered
    // by the board itself — the operator can see the offer.
    expect(ask(lanes, { sellCells: [sellAt('p-05', start)] }).get('p-05')!.get(start)!.sentence)
      .not.toContain('販売可能枠')
    // A box on the OTHER person's row is not this row's advertisement.
    expect(ask(lanes, { sellCells: [sellAt('p-06', start)] }).get('p-05')!.get(start)!.sentence)
      .toContain('この開始には販売可能枠が出ていません')
  })

  it('a room-drop names the TAKER by their label — and never this lane itself', () => {
    const lanes = twoStaff()
    const start = okStart(lanes)
    const named = ask(lanes, { drops: [{ laneKey: 'p-05', h: start, kind: 'room', takerLaneKey: 'p-06' }] })
    expect(named.get('p-05')!.get(start)!.sentence)
      .toContain('ベッドは別のスタッフ（見本 かおる）の枠が使うため、ここには販売可能枠を出していません')

    // ⚖ 44 FIX ROUND (blind lens 1, F4/F5) — 別の = ANOTHER. A drop whose winner
    // is this very lane cannot be its subject, so it falls to the bare clause.
    const own = ask(lanes, { drops: [{ laneKey: 'p-05', h: start, kind: 'room', takerLaneKey: 'p-05' }] })
    expect(own.get('p-05')!.get(start)!.sentence).toContain('この開始には販売可能枠が出ていません')
    expect(own.get('p-05')!.get(start)!.sentence).not.toContain('別のスタッフ')

    // A `lane` drop is the person's own promise: the box IS drawn, no clause.
    const laneDrop = ask(lanes, { drops: [{ laneKey: 'p-05', h: start, kind: 'lane' }] })
    expect(laneDrop.get('p-05')!.get(start)!.sentence).toContain('この開始には販売可能枠が出ていません')
    expect(laneDrop.get('p-05')!.get(start)!.sentence).not.toContain('別のスタッフ')
  })

  it('a BED-refused chip is asked the room question, and nothing else is', () => {
    const busy = sceneWith([booking({ key: 'b1', caseId: 'x1', title: '見本 かえる' }, 780, 900)])
    const per = ask(busy).get('p-01')!
    // `fullRoomsRefusal`'s sentence, whole — the composer was handed a real
    // `allocateBed` answer for this chip's own window.
    expect(per.get(780)).toEqual({ word: '満室', sentence: '13:00〜14:00はベッドに空きがありません。ベッド1が使用中（見本 かえる様）' })
    // …and a chip of any other class never grew a room answer, so it can never
    // wear a room word.
    for (const [start, said] of per) {
      const c = at(railOn(busy), start)
      if (c.reason !== 'bed') expect(said.word === '満室' || said.word === '清掃').toBe(false)
    }
  })

  it('the CARD IN HAND is lifted out of the room question (⚖ R3), and can silence the word', () => {
    // The engine judged the whole board, so the chip is `bed`; the sentence is
    // asked with `handId` lifted out, which is the booking in the way — case (a).
    const busy = sceneWith([booking({ key: 'b1', caseId: 'x1', title: '見本 かえる' }, 780, 900)])
    expect(ask(busy, { handId: 'x1' }).get('p-01')!.get(780)).toEqual({ word: null, sentence: expect.any(String) })
    expect(ask(busy, { handId: 'x1' }).get('p-01')!.get(780)!.sentence).not.toContain('ベッド1が使用中')
  })

  it('A GESTURE EMPTIES THE MAP — nothing is composed while a card is in hand', () => {
    // ⚖ 44 FIX ROUND (blind lens 4, SF2). The live board re-derives the rails on
    // every pointer frame, and this map was re-composed inside that — one
    // `allocateBed` per bed-refused chip per frame — for answers the render pass
    // then discarded, because the chip wears the verdict's × mid-drag.
    const busy = sceneWith([booking({ key: 'b1', caseId: 'x1', title: '見本 かえる' }, 780, 900)])
    expect(ask(busy, { inHand: true }).size).toBe(0)
    // The cue and the word are gated on the same gesture in the render pass
    // (§6), so an empty map is the whole rest-state face standing down together.
    expect(ask(busy, { inHand: false }).size).toBeGreaterThan(0)
  })

  it('the sell layer switched OFF takes ⚖ 75(i)’s clause with it', () => {
    // ⚖ 44 FIX ROUND (blind lens 4, N4). 表示設定 → 空き枠表示「非表示」 hides
    // every box, so every window is ad-less and the clause would fire on every ✓
    // chip on the board — about a display the operator turned off themselves.
    const lanes = twoStaff()
    const start = okStart(lanes)
    const off = ask(lanes, { sellDisplayed: false, drops: [{ laneKey: 'p-05', h: start, kind: 'room', takerLaneKey: 'p-06' }] })
    expect(off.get('p-05')!.get(start)!.sentence).not.toContain('販売可能枠')
    // Every other sentence is untouched by the dial: it is the CLAUSE that is
    // gated, never the board's own answer.
    const on = ask(lanes, { sellDisplayed: true })
    for (const [start, said] of off.get('p-05')!) {
      expect(said.sentence).toBe(on.get('p-05')!.get(start)!.sentence.replace(/。この開始には販売可能枠が出ていません$/, ''))
    }
  })

  it('a 詰め込み／スキマ promise counts as an advertisement too', () => {
    const lanes = twoStaff()
    const start = okStart(lanes)
    const claims: GapCell[] = [
      { laneKey: 'p-05', resourceKey: 'bed-01', group: 'staff', staff: 'p-05', s: start, e: start + 60, price: 5000 },
      { laneKey: 'p-05', resourceKey: 'bed-01', group: 'beds', staff: 'p-05', s: start, e: start + 60, price: 5000 },
    ]
    expect(ask(lanes, { claims }).get('p-05')!.get(start)!.sentence).not.toContain('販売枠')
  })
})

describe('§6 — the cues are ONE decision, so they cannot appear apart', () => {
  const SRC = readFileSync(
    join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'),
    'utf8',
  )
  const INT = readFileSync(
    join(process.cwd(), 'src/app/[locale]/(business)/business/today/today-interactions.ts'),
    'utf8',
  )
  const CSS = readFileSync(
    join(process.cwd(), 'src/app/[locale]/(business)/business/today/today.css'),
    'utf8',
  )

  it('the word, the dot and the hatch are all read off the same `word`', () => {
    // The chip prints the word instead of the bare 「—」…
    expect(SRC).toContain('<i>{word ?? label}</i>')
    // …the dot rides `data-reason`, which is set from that SAME value…
    expect(SRC).toContain('data-reason={word ? (c.reason ?? undefined) : undefined}')
    // …and the hatch starts from the same filter, now inside `restCueStarts`
    // (⚖ flag 88): the SOURCE of all three is still one value, and what the
    // helper adds is a narrowing of the PAINT, never a second reading of the
    // engine. The filter is pinned at its new home.
    // ⚖ PIN MIGRATED at E3a, WITH the decision (SPEC-SELLING-ENGINE §2's
    // consumer registry, (c)): the call grew a FOURTH argument, this lane's
    // 新規用に確保 spans. It is the same narrowing, for the same reason flag 88
    // gave — a quarter-strength wash under something the board is deliberately
    // drawing says the opposite of that drawing — and E3b's 確保 chip is that
    // something. The argument defaults to empty, so with the round gate off the
    // cue is byte-identical to today's; nothing about "one source, three cues"
    // moved.
    // ⚖ PIN MIGRATED at the FIX ROUND, WITH the decision (F5, blind-final L1#5):
    // the fourth argument is the COMMITTED world's held spans, like the second
    // and third arguments beside it. It was the BOARD world's, and the cue's own
    // reason for standing down is the 確保 chip drawn over it — which is drawn
    // from the committed mask. Idle they coincide; mid-gesture they diverge, and
    // the divergence paints flag 88's artifact. `heldHere` is that committed
    // list, already in hand one line above in the renderer.
    expect(SRC).toContain('restCueStarts(explainedHere, cells, gapHere, heldHere)')
    expect(INT).toContain('.filter(([, e]) => e.word != null)')
    // Both cues stand down while a card is in hand — the strip is answering a
    // different question then, and the chip wears the verdict's × instead.
    expect(SRC).toContain('const word = v ? null : (explained?.word ?? null)')
    expect(SRC).toContain("lane.group === 'staff' && !inHand && explainedHere")
    // ⚖ 44 FIX ROUND — and the MAP is empty for the whole of that gesture, so
    // the standing-down is one decision rather than three (§7 proves the
    // behaviour; this is the wiring that reaches it).
    expect(SRC).toContain('inHand: inHand != null,')
    expect(SRC).toContain("sellDisplayed: sellMode !== 'off',")
  })

  // ⚖ LIAM flag 88 (2026-08-30) — THE HATCH PAINTS ON EMPTY TRACK ONLY.
  //
  // Liam read the wash under a price box as a rendering artifact, and the ruled
  // mock agrees with him: it hatched empty track and nothing else. What narrows
  // is the LANE PAINT alone — the chip's word and dot are untouched, because a
  // start really can be advertised at one length and refused at another. So
  // word-without-hatch is legal from this round on, and legal EXACTLY where a
  // box overlaps: the paired-appearance pin for empty spans is the first
  // assertion below and may never weaken.
  const worded = (...starts: number[]): ReadonlyMap<number, { word: string | null }> =>
    new Map(starts.map((s) => [s, { word: '満室' }] as [number, { word: string | null }]))
  const sellAt = (h: number): SellCell => ({
    laneKey: 'p-01', resourceKey: 'bed-01', group: 'staff', staff: 'p-01', bed: 'ベッド1', h, price: 7000, tier: 2,
  })
  const gapAt = (s: number, e: number): GapCell => ({
    laneKey: 'p-01', resourceKey: 'bed-01', group: 'staff', staff: 'p-01', s, e, price: 5000,
  })

  it('⚖ 88 — a cue under an advertised box is dropped; a cue on empty track stands', () => {
    const cues = worded(600, 630, 660, 690)
    // NOTHING ADVERTISED: every worded start keeps its hatch, which is §6's own
    // pairing and the assertion this whole section exists for.
    expect(restCueStarts(cues, [], [])).toEqual([600, 630, 660, 690])
    // One 販売可能枠 covers TWO half hours — the box is a standard hour wide.
    expect(restCueStarts(cues, [sellAt(630)], [])).toEqual([600, 690])
    // A 詰め込み／スキマ枠 promise advertises the span it draws, no more: an
    // offer is an offer, whichever layer drew it.
    expect(restCueStarts(cues, [], [gapAt(660, 690)])).toEqual([600, 630, 690])
    // Both layers at once, and what survives is the genuinely empty start.
    expect(restCueStarts(cues, [sellAt(600)], [gapAt(690, 720)])).toEqual([660])
  })

  it('⚖ 88 — the WORD is not narrowed with the paint, and the overlap is half-open', () => {
    // A start the engine did not word never grows a cue, box or no box: the
    // source of all three faces is still the one value.
    const mixed: ReadonlyMap<number, { word: string | null }> = new Map([
      [600, { word: null }],
      [630, { word: '新規用' }],
    ])
    expect(restCueStarts(mixed, [], [])).toEqual([630])
    // A box that ENDS at the cue's start is not over it…
    expect(restCueStarts(worded(660), [], [gapAt(630, 660)])).toEqual([660])
    // …and one that BEGINS at the cue's end is not either.
    expect(restCueStarts(worded(660), [], [gapAt(690, 720)])).toEqual([660])
    // One minute of overlap on either side IS overlap.
    expect(restCueStarts(worded(660), [], [gapAt(630, 661)])).toEqual([])
    expect(restCueStarts(worded(660), [], [gapAt(689, 720)])).toEqual([])
    // The sell box's hour at both of its edges, so the 60 cannot drift to 30.
    expect(restCueStarts(worded(570, 600, 630, 660), [sellAt(600)], [])).toEqual([570, 660])
  })

  it('the hatch never outlives the strip that explains it, and the marks are the price boxes’ own', () => {
    // ⚖ 44 FIX ROUND (blind lens 4, SF1) — the 配置ガイド dial hides the strip in
    // two modes, and the cue is hidden by the SAME two selectors.
    expect(CSS).toContain('.biz .timeline.guard-guide-mode-drag:not(.guard-guide-aiming) .cell-rest-cue,')
    expect(CSS).toContain('.biz .timeline.guard-guide-mode-hidden .cell-rest-cue { display: none; }')
    // ⚖ 44 FIX ROUND (blind lenses 2 + 4, N3) — `.cell-price`'s inset grammar to
    // the pixel: discrete rounded marks, never a full-bleed band.
    expect(CSS).toContain('.biz .cell-rest-cue { position: absolute; z-index: 0; top: 4px; bottom: 4px; left: calc(var(--x) + 1px); width: calc(var(--w) - 2px); border-radius: 4px;')
    expect(CSS).toContain('.biz .cell-price {\n  position: absolute;\n  top: 4px;\n  bottom: 4px;\n  left: calc(var(--x) + 1px);\n  width: calc(var(--w) - 2px);\n  border-radius: 4px;')
  })

  it('the ring is the KEYBOARD’s, and the micro-word shrinks with the strip', () => {
    // ⚖ 44 FIX ROUND (blind lens 4, SF3) — a mouse press focuses a real button,
    // so a plain `:focus` ring fired on every click.
    expect(CSS).toContain('.biz button.guard-rail-cell:focus-visible { z-index: 6;')
    expect(CSS).not.toContain('.biz button.guard-rail-cell:focus {')
    // ⚖ 44 FIX ROUND (blind lens 4, N2) — the 10px word is the widest thing the
    // strip carries and was the one rule ignoring the narrow-viewport shrink.
    const narrow = CSS.slice(CSS.indexOf('@media (max-width: 1200px) {'))
    expect(narrow.slice(0, narrow.indexOf('\n}'))).toContain('.biz .guard-rail-cell[data-reason] i { font-size: 8px; }')
  })

  it('the paint hangs off `[data-reason]` and nowhere else, and adds no colour', () => {
    expect(CSS).toContain('.biz .guard-rail-cell[data-reason] i { font-size: 10px;')
    expect(CSS).toContain('.biz .guard-rail-cell[data-reason]::after')
    // The dot is the chip's own grey, and the hatch is the board's own 清掃
    // pattern at a quarter strength — the identical grammar and the identical
    // two colours as `.event.cleanup`.
    expect(CSS).toContain('background: currentColor; opacity: .5;')
    expect(CSS).toContain('.biz .cell-rest-cue')
    expect(CSS).toContain('repeating-linear-gradient(135deg, #ebe6e0 0 4px, #f4f1ec 4px 8px); opacity: .25;')
    expect(CSS).toContain('.biz .event.cleanup { border-color: #d9d0c7; background: repeating-linear-gradient(135deg, #ebe6e0 0 4px, #f4f1ec 4px 8px);')
  })

  it('every chip is pressable and answers with its sentence — and the — chip has a cursor', () => {
    // ⚖ 44 (3) — the strip was `role="img"`; it is real buttons now.
    expect(SRC).not.toContain('role="img"\n                aria-label={`${rail.laneLabel}')
    expect(SRC).toContain('aria-label={`${rail.laneLabel}、${hhmm(c.start)}。${sentence}`}')
    // …and the press is a CLICK, so the keyboard reaches it too. A button that
    // answers a mouse and ignores Enter is a control lying about being one —
    // the absence hatch's `onPointerDown` precedent is a `<span role="note">`
    // that can never be focused, which is why it is not the spelling here.
    //
    // ⚖ 44 FIX ROUND (blind lenses 1 F7 + 4 N1) — A REST AFFORDANCE, GUARDED
    // FOR REAL. The first cut tested two refs that a release's own pointerup has
    // already cleared by the time a click is dispatched: dead code wearing a
    // safety net's clothes. All four conditions the track's own window uses now,
    // and `suppressClickUntil` is the one that can actually be true here.
    expect(SRC).toContain(
      'onClick={(e) => {\n' +
        '                  if (dragRef.current || blockDragRef.current || chipDragRef.current) return\n' +
        '                  if (e.timeStamp < suppressClickUntil.current) return\n' +
        '                  show(sentence)',
    )
    // Cursor honesty on the grey chip, and the hover exclusion is gone with it.
    expect(CSS).toContain('background: #f2f2f4; color: #8a8a93; cursor: pointer;')
    expect(CSS).not.toContain('.guard-rail-cell:hover:not(.blocked)')
    // The chip is still 14px — the micro-word may not grow the 18px strip.
    expect(CSS).toContain('height: 14px;')
  })

  it('the strip is ONE tab stop and ←/→ walk it (⚖ 44 fix round, blind lens 4)', () => {
    // A dozen lanes of eighteen chips is 200 tab stops between this board and
    // whatever comes after it. The plain toolbar pattern instead — and the walk
    // wraps because a strip is a closed row of starts.
    expect(SRC).toContain("const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0")
    expect(SRC).toContain('chips[(at + step + chips.length) % chips.length].focus()')
    // The handler is on the TRACK — a keypress on a chip bubbles to it, and the
    // chips it walks are the ones actually rendered under it.
    expect(SRC).toContain("const chips = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('.guard-rail-cell')]")
    // ⚖ 44 FIX ROUND (blind lens 4, N5) — and the doc above `renderRail` says
    // so. It still claimed the cells were 「guidance, not controls」 a round
    // after they became buttons.
    expect(SRC).not.toContain('The cells are guidance, not')
    expect(SRC).toContain('⚖ 44 (3) — THE CELLS ARE CONTROLS NOW')
  })

  it('⚖ Greptile re-review — the one tab stop ROVES, and cannot go missing', () => {
    // HALF A PATTERN IS THE BUG. ←/→ moved focus from the first round, but the
    // stop was the literal first chip — `tabIndex={i === 0 ? 0 : -1}` — so
    // tabbing out of the board and back always threw the operator to the first
    // start of the strip, whatever they had walked to. The stop is the chip
    // last focused on THIS rail now, and the index-pinned spelling is pinned
    // dead so it cannot come back.
    expect(SRC).toContain('tabIndex={c.start === stop ? 0 : -1}')
    expect(SRC).not.toContain('tabIndex={i === 0 ? 0 : -1}')
    // …written by the chip's own `onFocus`, which is the ONE hook that catches
    // the arrow walk and a mouse press alike — both are the operator's last
    // position, which is exactly what a roving stop remembers. The `s[…] ===
    // c.start ? s :` short-circuit is load-bearing, not tidiness: a chip
    // re-focused where it already sits must not queue a render.
    expect(SRC).toContain(
      'onFocus={() => setRailStop((s) => (s[rail.laneKey] === c.start ? s : { ...s, [rail.laneKey]: c.start }))}',
    )
    // The remembered value is a `start`, not an index — the identity of a chip
    // survives a reshaped strip and an index does not — and it is per rail, so
    // one lane's walk cannot move another lane's stop.
    expect(SRC).toContain('const [railStop, setRailStop] = useState<Record<string, number>>({})')
    // THE STALE-START GUARD, which is what stops the fix from creating a worse
    // bug than the one it fixes: the start set only moves if the store's hours
    // or the 30-min step change — dormant today, hours are a constant — so a
    // remembered start can stop existing. A stop matching NO chip would leave
    // that strip with ZERO tab stops — unreachable by Tab entirely — so an
    // unrecognised start is treated as unset and the first chip takes it back.
    expect(SRC).toContain('const remembered = railStop[rail.laneKey]')
    expect(SRC).toContain(
      'const stop = rail.cells.some((c) => c.start === remembered) ? remembered : rail.cells[0]?.start',
    )
    // Resolved ONCE per rail, above the map — not a `.some()` per chip.
    expect(SRC.indexOf('const stop = rail.cells.some')).toBeLessThan(SRC.indexOf('{rail.cells.map((c) => {'))
    // ⚖ 44's N5 lesson, applied to this round: the doc above `renderRail` says
    // what the pattern actually is. It described two parts while the code had
    // three.
    expect(SRC).toContain('that one stop ROVES: it is the chip last focused on this rail')
  })

  it('the tour sentence teaches the third face — flag 25c’s one-sentence precedent', () => {
    const guide = SRC.slice(SRC.indexOf("'data-guide':"), SRC.indexOf("'data-guide':") + 1400)
    expect(guide).toContain('どのコマも押すと、何時から何時までを判定したかと、その理由を表示します')
    expect(guide).toContain('薄い斜線')
    // ⚖ LIAM RULING (2026-08-30) — the tour quotes the chips' OWN labels, so the
    // guard one moved with the chip. Bare 「新規」 is pinned dead in the quoted
    // list: a tour that teaches a word the board no longer wears is worse than
    // no entry at all.
    expect(guide).toContain('「満室」「清掃」「新規用」')
    expect(guide).not.toContain('「満室」「清掃」「新規」')
    // ⚖ NATIVE PASS (2026-08-26) — ふさがっている was FALSE of 新規, which is a
    // guard HOLD on an empty slot, not an occupied one. 置けない is true of all
    // three, and the retired word is pinned dead so it cannot come back.
    expect(guide).toContain('この行には見えない事情で置けないという意味です')
    expect(guide).not.toContain('ふさがっているという意味')
  })
})

// ── §8 ─────────────────────────────────────────────────────────────────────
// ⚖ LABELS RULING (Liam 8/30) — THE BOX SAYS WHAT KIND IT IS.
//
// Three washes on one staff row are three different products — an hour on
// sale, a session packed into a pocket, a discounted leftover — and until this
// round the board said so in colour alone. Liam read the difference as one
// price moving on its own. 案C, chosen off the mock: the word on every box, and
// its meaning in the band, once.
//
// Same shape as §6 and for the same reason — this folder's import fence allows
// only react/next/node specifiers, so there is no renderer here and the render
// pass is pinned at its source. What that buys is real all the same: the three
// mutations this section is built against (a word mapped to the wrong layer, a
// staff guard put back on the tags — ⚖ 8/30 ruled them onto the bed rows and
// the pin inverted with it — the legend dropped) each change one of these
// exact strings.
describe('§8 — ⚖ LABELS RULING: the box wears its layer, the band explains it', () => {
  const SRC = readFileSync(
    join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'),
    'utf8',
  )
  const CSS = readFileSync(
    join(process.cwd(), 'src/app/[locale]/(business)/business/today/today.css'),
    'utf8',
  )

  it('each layer wears its own word — and a crumb is 詰め込み, off the same value as its colour', () => {
    // 販売可能枠 is its own render pass and says so outright.
    expect(SRC).toContain(`<span className="cell-nametag">販売可能枠</span>`)
    // The gap pass carries BOTH remaining words, and the branch that picks
    // between them is `packedHere` — the SAME value the class attribute above it
    // uses to choose `cell-packed` over `cell-gapfill`. One read, so the word
    // and the fill cannot drift apart.
    expect(SRC).toContain(
      `<span className="cell-nametag">{packedHere ? '詰め込み' : 'スキマ枠'}</span>`,
    )
    expect(SRC).toContain(
      "className={`${packedHere ? 'cell-packed' : 'cell-gapfill'}${crumbHere ? ' crumb' : ''}",
    )
    // …and `crumbHere` is NOT in the word's branch. A crumb is a 詰め込み box
    // that happens to be short of a session: the orange reports the SHAPE of the
    // leftover, not a fourth kind of thing (the mock's own masthead). It gets
    // the word through `packedHere`, which is exactly what has to stay true.
    expect(SRC).not.toContain("crumbHere ? '詰め込み'")
    expect(SRC).not.toMatch(/cell-nametag">\{crumbHere/)
  })

  it('⚖ 8/30 — EVERY row wears the tag, and the PRICE is still the staff row’s alone', () => {
    // ⚖ LIAM RULING (2026-08-30), overturning the Fable default this test used
    // to pin the other way round: bed-row boxes were wordless, and he ruled that
    // 「bed rows having the tags might be useful」. A bed box carries no price
    // text, so the tag is the only thing that can tell three anonymous washes
    // apart down there — which is 案C's whole complaint, one row down.
    //
    // Machine-checked rather than spot-checked, in BOTH directions: both tags
    // exist, and NEITHER carries the staff guard, so re-adding one anywhere
    // fails here.
    const tags = SRC.match(/className="cell-nametag"/g) ?? []
    const guarded = SRC.match(/\{c\.group === 'staff' && <span className="cell-nametag"/g) ?? []
    expect(tags).toHaveLength(2)
    expect(guarded).toHaveLength(0)
    // …and the guard did NOT come off the money. A bed row advertises no price
    // and never has; both price texts keep the guard the tags just lost, which
    // is what makes 「the tag is a bed box's only text」 true rather than hoped.
    const priced = SRC.match(/\{c\.group === 'staff' && (c\.price != null && )?<i>/g) ?? []
    expect(priced).toHaveLength(2)
    expect(SRC).toContain(`{c.group === 'staff' && c.price != null && <i>{money(c.price)}</i>}`)
  })

  it('the band carries the three words and their three meanings, verbatim from the mock', () => {
    // ⚖ NATIVE PASS (2026-08-26, three rounds on the mock). These glosses are
    // carried, never re-written: re-writing them here would spend that pass.
    expect(SRC).toContain(
      `<span className="lk lk-sell"><i /><b>販売可能枠</b><span>いま出ている価格で売り出している1時間</span></span>`,
    )
    expect(SRC).toContain(
      `<span className="lk lk-packed"><i /><b>詰め込み</b><span>空きに収めた1回分（満額）</span></span>`,
    )
    expect(SRC).toContain(
      `<span className="lk lk-scrap"><i /><b>スキマ枠</b><span>余った時間の割引枠</span></span>`,
    )
    // Three, and only three: the legend names the layers the board can draw.
    expect((SRC.match(/className="lk lk-/g) ?? [])).toHaveLength(3)
    // The word in the legend wears the colour the word ON THE BOX wears — that
    // pairing is the whole mechanism, so both ends are pinned.
    expect(CSS).toContain('.biz .layer-legend .lk-sell b, .biz .layer-legend .lk-packed b { color: var(--indigo); }')
    expect(CSS).toContain('.biz .layer-legend .lk-scrap b { color: var(--orange-line); }')
    expect(CSS).toContain('.biz .cell-price .cell-nametag, .biz .cell-packed .cell-nametag { color: var(--indigo); }')
    expect(CSS).toContain('.biz .cell-packed.crumb .cell-nametag, .biz .cell-gapfill .cell-nametag { color: var(--orange-line); }')
  })

  it('a guard-OFF store keeps the legend, in the same one container', () => {
    // ⚖ Fable default (overturnable). The band used to be gated on `guardOn`
    // whole. The legend is not about the guard — a store with no protection
    // policy still draws all three kinds of box — so the CONTAINER is
    // unconditional now and the guard KEYS are what comes and goes.
    expect(SRC).toContain(
      '          <div\n            className={`guard-band${guardOn ? \'\' : \' legend-only\'}`}\n            role="note"\n' +
        `            data-guide-title={guardOn ? 'スキマガード' : '価格箱'}`,
    )
    // The old gating shape is pinned dead: the whole band behind `guardOn`.
    expect(SRC).not.toContain('{guardOn && (\n            <div\n              className="guard-band"')
    // One legend, and it is OUTSIDE the guarded fragment.
    expect((SRC.match(/className="layer-legend"/g) ?? [])).toHaveLength(1)
    const band = SRC.slice(SRC.indexOf('className={`guard-band'))
    expect(band.indexOf('className="layer-legend"')).toBeGreaterThan(band.indexOf('{guardOn && ('))
    expect(band.indexOf('className="layer-legend"')).toBeGreaterThan(band.indexOf('className="guard-band-note"'))
    // ⚖ fresh-eyes finding 8/30 — a guard-off store draws no keys, so the
    // dashed separator above the legend and the guard-purple left edge both
    // lose their referent. `.legend-only` neutralizes both; it is present
    // exactly when the guard is off, and absent when it is on.
    expect(SRC).toContain("className={`guard-band${guardOn ? '' : ' legend-only'}`}")
    expect(CSS).toContain('.biz .guard-band.legend-only { border-left-color: var(--control); }')
    expect(CSS).toContain(
      '.biz .guard-band.legend-only .layer-legend { margin-top: 0; padding-top: 0; border-top: 0; }',
    )
    // And no guard wording reaches a guard-off store's tour entry: the clause is
    // the WHOLE sentence there, so it had to be true standing alone.
    expect(SRC).toContain('const LAYER_LEGEND_GUIDE =')
    expect(SRC).toContain('スタッフの行に並ぶ価格箱には種類ごとの名前が付いていて、それぞれの意味はこの帯で確認できます。')
    expect(SRC).toContain('各スタッフの下に細い帯が出ているときは、その帯の説明をご覧ください。${LAYER_LEGEND_GUIDE}`')
    expect(SRC).toContain('                : LAYER_LEGEND_GUIDE')
  })

  it('価格を隠す leaves the word standing; 空き枠表示 off takes it with the box', () => {
    // ⚖ Fable default (overturnable): the tag names the KIND, not the price, so
    // the price dial has no business hiding it. The three `hide-slot-prices`
    // rules each end in ` i `, and none of them reaches the tag — pinned by the
    // absence, because a fourth rule is exactly how this default would be lost.
    for (const box of ['cell-price', 'cell-gapfill', 'cell-packed']) {
      expect(CSS).toContain(`.biz .timeline.hide-slot-prices .${box} i { display: none; }`)
    }
    expect(CSS).not.toMatch(/hide-slot-prices[^\n]*cell-nametag/)
    // ⚖ LIAM RULING (2026-08-30) — the tag DOES have a switch of its own now
    // (種類の名札, below), and it is the only one: exactly one rule in the whole
    // stylesheet hides the tag directly, so the dials that remove a BOX still
    // remove it by removing the box, and nothing else can reach it sideways.
    expect(CSS.match(/^[^\n]*\.cell-nametag[^\n]*display: none/gm) ?? []).toHaveLength(1)
    expect(CSS).toContain('.biz .timeline.sell-off .cell-price { display: none; }')
    expect(CSS).toContain('.biz .timeline.sell-off .cell-packed { display: none; }')
    expect(CSS).toContain('.biz .lane.locked .cell-price { display: none; }')
  })

  it('the tag adds no colour and cannot grow a box', () => {
    // The mock's `.nametag`, to the value: the box's own text colour at 55%, and
    // out of the flex flow so the price stays pinned to the bottom of the box.
    expect(CSS).toContain(
      '.biz .cell-nametag { position: absolute; top: 3px; left: 5px; right: 3px; font-size: 8px; font-weight: 700; line-height: 1; letter-spacing: -.2px; white-space: nowrap; overflow: hidden; opacity: .55; pointer-events: none; }',
    )
    // The price sits at the BOTTOM of every box, which is what makes a top-left
    // tag collision-proof rather than merely lucky.
    for (const box of ['.biz .cell-gapfill {', '.biz .cell-packed {']) {
      expect(CSS.slice(CSS.indexOf(box), CSS.indexOf(box) + 260)).toContain('align-items: flex-end;')
    }
    expect(CSS).toContain('.biz .cell-price {\n  position: absolute;')
    expect(CSS.slice(CSS.indexOf('.biz .cell-price {'), CSS.indexOf('.biz .cell-price {') + 400)).toContain('align-items: flex-end;')
    // A narrow box CLIPS the word; it never widens to fit one. The offer's
    // length is the box's width and a label may not move it.
    expect(CSS).not.toMatch(/\.cell-nametag[^\n]*(min-width|white-space: normal)/)
    // The legend's swatches are the boxes' own fills — the sell one at tier 2,
    // which is `calc(.04 + var(--tier) * .03)` = .10.
    expect(CSS).toContain('.biz .layer-legend .lk-sell i { background: rgba(130, 151, 233, .10);')
    expect(CSS).toContain('.biz .layer-legend .lk-packed i { background: rgba(130, 151, 233, .18);')
    expect(CSS).toContain('.biz .layer-legend .lk-scrap i { background: rgba(232, 130, 60, .09);')
    expect(CSS).toContain('background: rgba(130, 151, 233, calc(.04 + var(--tier) * .03));')
    expect(CSS).toContain('.biz .cell-packed { position: absolute; top: 4px; bottom: 4px; left: calc(var(--x) + 1px); width: calc(var(--w) - 2px); border-radius: 4px; pointer-events: none; display: flex; align-items: flex-end; padding: 3px 5px; background: rgba(130, 151, 233, .18);')
    expect(CSS).toContain('background: rgba(232, 130, 60, .09); z-index: 0; }')
  })

  // ⚖ LIAM RULING (2026-08-30) — 表示設定 ▸ 種類の名札, one switch, default ON.
  it('the 種類の名札 switch is its siblings’ own three-part mechanism, default ON', () => {
    // 1 — THE STATE, declared ON. `useState(true)` is the default, and it is
    // pinned as the literal rather than inferred from a checkbox being checked.
    expect(SRC).toContain('const [showNametags, setShowNametags] = useState(true)')
    // 2 — THE CLASS, in the same list and the same polarity as its three
    // siblings: the boolean is what shows the tags, so the CLASS is the hiding
    // one and an unset state can never blank the board.
    expect(SRC).toContain("    showSlotPrice ? '' : 'hide-slot-prices',\n    showNametags ? '' : 'hide-nametags',")
    // 3 — THE RULE. Exactly the sibling shape, and — the point of ONE switch —
    // it names no row group, so `.timeline` carries the class once and BOTH the
    // staff boxes and the bed boxes lose their tags together. A selector that
    // mentioned a group is how this would silently become two switches.
    expect(CSS).toContain('.biz .timeline.hide-nametags .cell-nametag { display: none; }')
    expect(CSS).not.toMatch(/hide-nametags[^\n]*(lane|\.staff|\.beds)/)
    // …and the render has no row branch left for it to disagree with (§8's
    // inverted pin above holds the other end of this).
    expect(SRC).not.toMatch(/hide-nametags[^\n]*c\.group/)

    // THE ROW ITSELF, in the 表示設定 popover beside its sibling dial.
    expect(SRC).toContain('<input type="checkbox" checked={showNametags} onChange={() => setShowNametags((v) => !v)} /> 種類の名札')
    const pop = SRC.slice(SRC.indexOf('<strong>予約カードの表示項目（店舗設定）</strong>'))
    expect(pop.indexOf('種類の名札')).toBeGreaterThan(pop.indexOf('空き枠の価格'))

    // ⚖ 8/23 GUIDED-TOUR LAW — a new function declares itself the same round.
    // ⚖ NATIVE PASS (2026-08-30): the tour sentence is native-confirmed final.
    expect(SRC).toContain('data-guide-title="種類の名札"')
    expect(SRC).toContain(
      'data-guide="価格箱に付く「販売可能枠」「詰め込み」「スキマ枠」の名札を表示するかどうかを切り替えます。非表示にしても、箱の色と下の帯にある色の説明はそのまま残ります。"',
    )

    // THE DEFAULT THE RULING NAMES: the band legend is NOT hidden with the tags.
    // The colours survive the switch, so the key to them has to as well —
    // pinned by the absence of any rule that reaches the legend from the class.
    expect(CSS).not.toMatch(/hide-nametags[^\n]*(layer-legend|guard-band|lk-)/)
  })

  // ⚖ LIAM RULING (2026-08-30, 案C) — the 表示設定 ▸ 色の意味 key names the boxes
  // by the same words as everywhere else. It was pinned dropping 詰め込み and
  // still saying bare 販売可能; both are fixed at the source and pinned exact.
  it('表示設定 ▸ 色の意味 carries the ruled words, 詰め込み included', () => {
    const legend = SRC.slice(SRC.indexOf('<strong>色の意味</strong>'), SRC.indexOf('</div>\n\n                    <div className="pop-divider" role="presentation" />\n                    <strong>密度</strong>'))
    expect(legend).toContain('<span className="public"><i />販売可能枠</span>')
    expect(legend).toContain('<span className="packed"><i />詰め込み</span>')
    expect(legend).toContain('<span className="gapfill"><i />スキマ枠</span>')
    // order: 販売可能枠, then 詰め込み, then スキマ枠 — the box order on the board.
    expect(legend.indexOf('販売可能枠')).toBeLessThan(legend.indexOf('詰め込み'))
    expect(legend.indexOf('詰め込み')).toBeLessThan(legend.indexOf('スキマ枠'))
    // the bare, unruled word is pinned dead.
    expect(legend).not.toContain('>販売可能<')
    // the swatch is .cell-packed's own fill, no new colour.
    expect(CSS).toContain('.biz .legend .packed i { background: rgba(130, 151, 233, .18); border: 1px dashed var(--indigo); }')
  })
})

// ── §9 ─────────────────────────────────────────────────────────────────────
// ⚖ LIAM flag 87 (2026-08-30) — THE ROOM NEVER CAME HOME.
//
// WHAT WENT WRONG (pre-existing, and root-caused rather than patched). ⚖ 51
// re-solves the bed at EVERY landing and `allocateBed` keeps the carried room
// when it is free — but the room it was handed came from `sidesAt`, which reads
// the board AS IT STANDS. Once something is staged, that board is the staged
// one, so a second gesture on the same booking carried the OUTBOUND leg's
// borrowed room instead of the booking's own. Drag a card off its room and back
// again and the borrowed room was kept for good; `bedMoves` claimed it, and
// every box that depended on the room the booking actually vacated died —
// honestly, about a move the operator had already undone.
//
// Neither `reconcileSellCells` nor keep-if-free was wrong: the SEED was. The
// origin is already snapped at the first gesture's pointerdown, both sides
// (`PendingChange.bedOrigin`), so `seedBed` prefers it and nothing else moves.
//
// HOW THIS IS PROVED WITHOUT A RENDERER. The four lines of `land()` that decide
// a room are `pairLanesOf` → `sidesAt` → `seedBed` → `allocateBed`, every one of
// them exported and pure, and `stage()`'s writes are two `Moves` entries. So the
// gesture is replayed here on the REAL fixture board and the whole advertised
// face of the day is read back through the same two layer builders the screen
// uses. The keyboard nudge is the SAME four lines (pinned below, byte for byte),
// which is what makes one replay stand for both landings.
describe('§9 — ⚖ flag 87: a staged change re-solves from the room it OWNS', () => {
  const SRC = readFileSync(
    join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'),
    'utf8',
  )

  /** What `stage()` writes, and the one field of `pending` a room solve reads. */
  interface Staged {
    moves: Moves
    bedMoves: Moves
    pending: { id: string; bedOrigin?: Move; bedChosen?: string } | null
  }
  const REST: Staged = { moves: {}, bedMoves: {}, pending: null }

  /** The screen's `boardLanes` at rest: `placedLanes` is `props.lanes` while no
   *  block has been dragged, and nothing is parked, added or in flight. */
  const boardOf = (s: Staged) => applyMoves(REAL.lanes, s.moves, [], [], REAL.hours, s.bedMoves)

  const span = (start: number, end: number) => place(start, end, REAL.hours)

  /** ONE STAFF-ROW LANDING — `land()` (TodayScreen :2657-2691) and the keyboard
   *  nudge's `land()` (:3423-3435), which are one spelling. `seeded: false` is
   *  the pre-flag-87 line, which is how the counterfactual's red half is taken. */
  function landOn(s: Staged, id: string, targetLane: string, at: { x: number; w: number }, seeded = true): Staged {
    const board = boardOf(s)
    const item = board.flatMap((l) => l.items).find((i) => i.caseId === id)!
    const home = pairLanesOf(board, id, { x: item.x, w: item.w })
    const sides = sidesAt(home, 'staff', targetLane)
    const carried = seeded ? seedBed(s.pending, id, sides.bedLane) : sides.bedLane
    const solved = allocateBed(board, {
      id,
      currentBed: carried,
      stores: board.find((l) => l.key === sides.staffLane)?.stores ?? null,
      vip: item.category === 'vip',
      start: minuteOf(at.x, REAL.hours),
      end: minuteOf(at.x + at.w, REAL.hours),
      policy: REAL.rooms,
      stagedId: s.pending?.id ?? null,
    })
    // ⚖ 47 — a refusal changes nothing, so a scene that produces one is a scene
    // that proves nothing about the seed. None of these do.
    expect(solved.refusal).toBeNull()
    return {
      moves: { ...s.moves, [id]: { laneKey: sides.staffLane!, ...at } },
      bedMoves: { ...s.bedMoves, [id]: { laneKey: solved.laneKey!, ...at } },
      // ⚖ 50(d) — a second gesture on the same staged change KEEPS the first
      // gesture's origin, which is the record this whole fix rests on.
      pending: s.pending?.id === id ? s.pending : { id, bedOrigin: home.bed ?? undefined },
    }
  }

  /** ONE BED-ROW LANDING — the OTHER gesture, and the only one that CHOOSES a
   *  room. `land()` skips the solve entirely on it (`if (ctx.group !== 'beds')`)
   *  because the operator has already said which room out loud, and `stage()`
   *  records that room on the staged change. `records: false` is this half's
   *  counterfactual switch, exactly as `seeded` is the seed's: it takes the
   *  recording site away and leaves every other line standing. */
  function landOnBed(s: Staged, id: string, targetBed: string, at: { x: number; w: number }, records = true): Staged {
    const board = boardOf(s)
    const item = board.flatMap((l) => l.items).find((i) => i.caseId === id)!
    const home = pairLanesOf(board, id, { x: item.x, w: item.w })
    const sides = sidesAt(home, 'beds', targetBed)
    // The screen's `ctx.group === 'beds' && laneChanged`: a bed-row drag that
    // re-times a card inside the room it already stands in has chosen nothing.
    const chosen = records && sides.bedLane !== home.bed?.laneKey ? (sides.bedLane ?? undefined) : undefined
    return {
      moves: { ...s.moves, [id]: { laneKey: sides.staffLane!, ...at } },
      bedMoves: { ...s.bedMoves, [id]: { laneKey: sides.bedLane!, ...at } },
      // `bedChosen ?? was.bedChosen` — `stage()`'s own line: a later choice
      // replaces this one, and no other landing may clear it.
      pending:
        s.pending?.id === id
          ? { ...s.pending, bedChosen: chosen ?? s.pending.bedChosen }
          : { id, bedOrigin: home.bed ?? undefined, bedChosen: chosen },
    }
  }

  /** THE WHOLE ADVERTISED FACE OF THE DAY, both layers, every lane — with the
   *  ROOM and the PRICE on every line, so a room that moved shows up as a
   *  changed line rather than as a count that happens to still match. */
  function inventory(lanes: BoardLane[]): string[] {
    const price = clampPriceInputs(REAL.dialogs.pricing.hqMax, REAL.dialogs.pricing.base, REAL.dialogs.pricing)
    const depth = Math.round((1 - price.lo / price.hi) * 100)
    const gap = gapLayerFor(lanes, {
      gridMin: REAL.sell.gridMin,
      sessionMin: REAL.guard.standardSessionMin,
      gapFillMin: REAL.guard.gapFillMinMin,
      gapFillDiscountPct: REAL.guard.gapFillDiscountPct,
      minSellableMin: REAL.guard.minSellableMin ?? 0,
      nowMinute: REAL.sell.nowMinute,
      locked: [],
      frame: { hi: price.hi, lo: price.lo, hqMin: REAL.dialogs.pricing.hqMin, hqMax: REAL.dialogs.pricing.hqMax },
      depth,
      guard: REAL.guard.config,
    })
    const claims = [...gap.packed, ...gap.scraps]
    const sell = sellLayerFor(lanes, REAL.hours, {
      gridMin: REAL.sell.gridMin,
      nowMinute: REAL.sell.nowMinute,
      locked: [],
      showPrice: true,
      hi: price.hi,
      hqMin: REAL.dialogs.pricing.hqMin,
      depth,
      reconcile: { claims, rooms: REAL.rooms, cleanupMinutesByBed: REAL.bedCleanupMinutes },
    })
    const yen = (p: number | null) => (p == null ? '—' : money(p))
    return [
      ...sell.cells.map((c) => `SELL ${c.laneKey} ${clock(c.h)} on ${c.resourceKey} ${yen(c.price)}`),
      ...gap.packed.map((c) => `PACK ${c.laneKey} ${clock(c.s)}-${clock(c.e)} on ${c.resourceKey} ${yen(c.price)}`),
      ...gap.scraps.map((c) => `SCRAP ${c.laneKey} ${clock(c.s)}-${clock(c.e)} on ${c.resourceKey} ${yen(c.price)}`),
    ].sort()
  }

  /** Which room every booking is drawn in — the server's answer at rest. */
  const occupancy = (lanes: BoardLane[]) =>
    lanes
      .filter((l) => l.group === 'beds')
      .flatMap((l) => l.items.filter((i) => i.caseId != null).map((i) => `${i.caseId} ${l.key}`))
      .sort()

  // apt-28 is 見本 ゆうすけ's 16:00 half hour in ベッド3 (the 個室). ベッド3 is
  // busy at 11:00 — apt-25 has it — so the outbound leg is FORCED off it, which
  // is what makes the return leg a real question rather than a no-op.
  // Lazily, both of them: `REAL` is assembled in `beforeAll` and a describe body
  // runs before that.
  const HOME = () => span(960, 990)
  const OUT = () => span(660, 690)

  it('THE COUNTERFACTUAL: a round trip puts the board back byte for byte', () => {
    const base = inventory(REAL.lanes)
    // The named casualty, alive at rest — the 16:00 hour 見本 しろう's row
    // advertises ON ベッド3's neighbour, which only survives while apt-28 is in
    // the room it belongs in.
    expect(base).toContain('SELL p-04 16:00 on bed-01 ¥8,060')

    // OUTBOUND, and honest: ベッド3 is taken at 11:00, so keep-if-free fails and
    // the allocator hands out a free room. Nothing about this leg changes.
    const out = landOn(REST, 'apt-28', 'c-03', OUT())
    expect(out.bedMoves['apt-28'].laneKey).toBe('bed-01')
    expect(out.pending).toEqual({ id: 'apt-28', bedOrigin: { laneKey: 'bed-03', x: HOME().x, w: HOME().w } })

    // BACK. The seed is the change's own origin room, which is free at 16:00,
    // so keep-if-free keeps it — and every layer is exactly where it started.
    const back = landOn(out, 'apt-28', 'c-03', HOME())
    // The INVENTORY first and the room second: the layers are the pin, the room
    // is only the explanation for them (and an assertion that fires first hides
    // the one that matters from every red run after it).
    expect(JSON.stringify(inventory(boardOf(back)))).toBe(JSON.stringify(base))
    expect(occupancy(boardOf(back))).toEqual(occupancy(REAL.lanes))
    expect(back.bedMoves['apt-28'].laneKey).toBe('bed-03')
  })

  it('THE OTHER HALF OF IT: without the seed the borrowed room is kept for good', () => {
    // The exact defect Liam saw, reproduced on the same board by changing the
    // one line — which is what makes the pin above a counterfactual rather than
    // a scene that was always going to pass.
    const out = landOn(REST, 'apt-28', 'c-03', OUT(), false)
    const back = landOn(out, 'apt-28', 'c-03', HOME(), false)
    expect(back.bedMoves['apt-28'].laneKey).toBe('bed-01')
    expect(inventory(boardOf(back))).not.toContain('SELL p-04 16:00 on bed-01 ¥8,060')
    expect(occupancy(boardOf(back))).not.toEqual(occupancy(REAL.lanes))
  })

  it('a busy origin gets a FRESH SOLVE on return, never a blind restore', () => {
    // 14:30, where ベッド3 is 見本 ゆうこ's (apt-29, 14:05–15:05): the outbound
    // leg is re-bedded, and so is the leg back — the seed is a candidate the
    // allocator judges, not an instruction it obeys.
    const out = landOn(REST, 'apt-28', 'c-03', span(870, 900))
    expect(out.bedMoves['apt-28'].laneKey).not.toBe('bed-03')
    const back = landOn(out, 'apt-28', 'c-03', span(840, 870))
    expect(back.bedMoves['apt-28'].laneKey).not.toBe('bed-03')
  })

  it('the keyboard leg brings the room home too — one spelling, two gestures', () => {
    // Shift/Alt+Arrow moves ONE EDGE by 30 minutes and is otherwise the same
    // landing, so a trip that leaves by pointer and comes back through a widened
    // span still lands in the booking's own room. Without the seed it keeps the
    // borrowed one: ベッド1 is free across 16:00–17:00 too.
    const out = landOn(REST, 'apt-28', 'c-03', OUT())
    const wider = landOn(out, 'apt-28', 'c-03', span(660, 720))
    const back = landOn(wider, 'apt-28', 'c-03', span(960, 1020))
    expect(back.bedMoves['apt-28'].laneKey).toBe('bed-03')
    const red = landOn(landOn(landOn(REST, 'apt-28', 'c-03', OUT(), false), 'apt-28', 'c-03', span(660, 720), false), 'apt-28', 'c-03', span(960, 1020), false)
    expect(red.bedMoves['apt-28'].laneKey).toBe('bed-01')
  })

  // ── the fix round (Greptile 4/5, adjudicated REAL) ────────────────────────
  // WHAT THE SEED GOT WRONG IN ITS TURN. ⚖ 87 prefers the booking's own origin
  // room over the board as it stands, which is right about a room the BOARD
  // chose — an outbound leg's borrowed room answers a question the operator
  // never asked. It is wrong about a room the OPERATOR chose: a bed-row drag is
  // the one gesture that says WHICH ROOM (`solveBed` is not even called on it),
  // and preferring the origin over it meant the next TIME adjustment — a
  // staff-row drag, a Shift/Alt+Arrow — re-solved from the origin, keep-if-free
  // kept it, and the operator's own choice was undone by a gesture that was not
  // about rooms at all.
  //
  // 12:00–12:30, where all three rooms are free: the staff leg keeps ベッド3
  // (⚖ 87's origin preference, working), so the bed-row drag that follows is a
  // real change of room rather than a no-op the board would have made anyway.
  const MID = () => span(720, 750)

  it("THE OPERATOR'S OWN ROOM SURVIVES THE NEXT TIME ADJUSTMENT", () => {
    const moved = landOn(REST, 'apt-28', 'c-03', MID())
    expect(moved.bedMoves['apt-28'].laneKey).toBe('bed-03')

    // The bed-row drag: 「ベッド1」, out loud. No solve runs, and the change now
    // carries the room beside the origin it already had.
    const chosen = landOnBed(moved, 'apt-28', 'bed-01', MID())
    expect(chosen.bedMoves['apt-28'].laneKey).toBe('bed-01')
    expect(chosen.pending).toEqual({
      id: 'apt-28',
      bedOrigin: { laneKey: 'bed-03', x: HOME().x, w: HOME().w },
      bedChosen: 'bed-01',
    })

    // …and then a TIME adjustment — the right edge out to 13:00, which is not an
    // opinion about rooms. ベッド3 is free across it, so the origin preference
    // would have taken the booking straight back into it.
    const nudged = landOn(chosen, 'apt-28', 'c-03', span(720, 780))
    expect(nudged.bedMoves['apt-28'].laneKey).toBe('bed-01')
    // The choice is not spent by being obeyed once: the NEXT landing gets it too.
    expect(nudged.pending?.bedChosen).toBe('bed-01')
  })

  it('THE OTHER HALF OF IT: without the recording the origin silently takes it back', () => {
    // The reviewer's exact scenario with the recording site neutered — the same
    // three gestures on the same board, and the room the operator picked is gone
    // one nudge later.
    const chosen = landOnBed(landOn(REST, 'apt-28', 'c-03', MID()), 'apt-28', 'bed-01', MID(), false)
    expect(chosen.bedMoves['apt-28'].laneKey).toBe('bed-01')
    expect(chosen.pending?.bedChosen).toBeUndefined()
    const nudged = landOn(chosen, 'apt-28', 'c-03', span(720, 780))
    expect(nudged.bedMoves['apt-28'].laneKey).toBe('bed-03')
  })

  it('a busy CHOSEN room gets the same fresh solve a busy origin gets', () => {
    const chosen = landOnBed(landOn(REST, 'apt-28', 'c-03', MID()), 'apt-28', 'bed-01', MID())
    // 14:30–15:00: ベッド1 is 見本 しろう's 仮押さえ (apt-26) and ベッド3 is
    // apt-29's, so neither the choice nor the origin can be kept — the seed is a
    // candidate the allocator judges, never an instruction it obeys, and the
    // popover names the room it actually landed in.
    const later = landOn(chosen, 'apt-28', 'c-03', span(870, 900))
    expect(later.bedMoves['apt-28'].laneKey).toBe('bed-02')
    // Refused ≠ forgotten: it is judged again at the next span, as the origin is.
    expect(later.pending?.bedChosen).toBe('bed-01')
  })

  it('a bed-row drag INSIDE the same room chooses nothing', () => {
    // That gesture is a re-time on the bed row, and reading it as a choice would
    // pin whichever room the outbound leg borrowed — ⚖ 87 itself, coming back
    // through the other row. The round trip still comes home.
    const out = landOn(REST, 'apt-28', 'c-03', OUT())
    expect(out.bedMoves['apt-28'].laneKey).toBe('bed-01')
    const retimed = landOnBed(out, 'apt-28', 'bed-01', span(690, 720))
    expect(retimed.pending?.bedChosen).toBeUndefined()
    expect(landOn(retimed, 'apt-28', 'c-03', HOME()).bedMoves['apt-28'].laneKey).toBe('bed-03')
  })

  it('the three rungs are ordered by WHO decided the room', () => {
    const origin: Move = { laneKey: 'bed-02', x: 0, w: 0 }
    // The operator's own room outranks the booking's origin…
    expect(seedBed({ id: 'apt-28', bedOrigin: origin, bedChosen: 'bed-01' }, 'apt-28', 'bed-03')).toBe('bed-01')
    // …and it stands alone on a change that never had a bed row to snap.
    expect(seedBed({ id: 'apt-28', bedChosen: 'bed-01' }, 'apt-28', 'bed-03')).toBe('bed-01')
    // A choice made on ANOTHER booking's staged change is not this one's.
    expect(seedBed({ id: 'apt-29', bedChosen: 'bed-01' }, 'apt-28', 'bed-03')).toBe('bed-03')
    // No choice made: ⚖ 87's own order, unchanged.
    expect(seedBed({ id: 'apt-28', bedOrigin: origin }, 'apt-28', 'bed-03')).toBe('bed-02')
  })

  it('the seed changes NOTHING outside a staged change on this very booking', () => {
    const origin: Move = { laneKey: 'bed-02', x: 0, w: 0 }
    // Nothing staged: the carried room is the answer, exactly as before.
    expect(seedBed(null, 'apt-28', 'bed-03')).toBe('bed-03')
    // A staged change on ANOTHER booking is not this one's origin.
    expect(seedBed({ id: 'apt-29', bedOrigin: origin }, 'apt-28', 'bed-03')).toBe('bed-03')
    // Staged with no bed row at the origin (⚖ 45's own clause — a booking with
    // no room, or a creation): the staged room is the only room there is.
    expect(seedBed({ id: 'apt-28' }, 'apt-28', 'bed-01')).toBe('bed-01')
    // …and a booking with no room on either side stays roomless, which is the
    // null `currentBed` ⚖ 59 requires the allocator to be asked with.
    expect(seedBed({ id: 'apt-28' }, 'apt-28', null)).toBeNull()
    // Staged on this booking, with an origin: the origin wins.
    expect(seedBed({ id: 'apt-28', bedOrigin: origin }, 'apt-28', 'bed-01')).toBe('bed-02')
  })

  it('BOTH landing sites carry the seed, and the two excluded solves are untouched', () => {
    // The drop and the keyboard nudge, byte for byte — this is the parity claim
    // the replay above stands on.
    expect(SRC).toContain(
      "const bed = solveBed(on.staffLane, ctx.id, seedBed(pending, ctx.id, on.bedLane), item.category === 'vip', at)",
    )
    expect(SRC).toContain(
      "const bed = solveBed(on.staffLane, id, seedBed(pending, id, on.bedLane), item.category === 'vip', next)",
    )
    // ⛔ DELIBERATELY EXCLUDED. A 次回予約 placement and a shelf chip are FIRST
    // landings: neither has a staged change of its own to have an origin from,
    // and 配置モード's solve is asked with no room at all. Different semantics,
    // and they stay byte-untouched.
    expect(SRC).toContain('solveBed(lane.key, null, null, false, place(start, end, hours))')
    expect(SRC).toContain(
      "solveBed(staff?.key ?? null, chip.id, home?.key ?? null, chip.item.category === 'vip', span)",
    )
    // ⚖ flag 92 — A THIRD SITE, and it is the same law rather than an exception:
    // taking the warn card's safe start is another landing of a change that is
    // already staged, so it re-solves from the room that change OWNS. It seeds
    // the VERDICT'S carried room rather than a second `solveBed` — the press
    // judges and stages in one tick, so one solve is the whole answer (⚖ 54),
    // which is why the `solveBed` count below is unmoved.
    expect(SRC).toContain('bedLane: seedBed(pending, pending.id, bedMoves[pending.id]?.laneKey ?? null),')
    expect(SRC.match(/seedBed\(/g) ?? []).toHaveLength(3)
    expect(SRC.match(/solveBed\(/g) ?? []).toHaveLength(5)
  })

  it('the RECORDING is the bed-row drag alone, and no other landing can clear it', () => {
    // The replay above stands on these four lines the way it stands on the two
    // `solveBed` spellings: the harness is `stage()`'s writes by hand, so the
    // wiring is pinned here rather than executed.
    //
    // ONE write, gated on the gesture that chooses a room…
    expect(SRC).toContain(
      "const bedChosen = ctx.group === 'beds' && laneChanged ? (sides.bedLane ?? undefined) : undefined",
    )
    expect(SRC).toContain('const on = { ...sides, bedChosen }')
    // …carried onto the change, and PRESERVED by every landing that follows.
    // Written `bedChosen` alone, either line would be cleared by the very time
    // adjustment this fix exists to survive.
    expect(SRC).toContain('bedChosen: bedChosen ?? was.bedChosen')
    expect(SRC).toContain('bedOrigin: from.bed ?? undefined, bedChosen,')
    // The keyboard nudge spells its sides WITHOUT one, which is how an edge
    // nudge says it has no opinion about rooms.
    const nudge = SRC.slice(SRC.indexOf('function onCardKeyDown('), SRC.indexOf('function park('))
    expect(nudge).toContain('const on = { ...sides }')
    expect(nudge).not.toContain('bedChosen:')
  })
})
