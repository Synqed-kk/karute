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
//   §6 the rest cues are ONE decision: the dot and the hatch appear exactly
//      where the word does, because all three are read off the same value.
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
import { clampPriceInputs } from '@/business/lib/canon-logic/pricing'
import type { GapCell } from '@/business/lib/canon-logic/availability'
import {
  allocateBed,
  gapLayerFor,
  guardRailsFor,
  railExplain,
  sellLayerFor,
  type GuardRail,
  type RailCell,
  type RoomPolicy,
  type SellDrop,
} from '@/app/[locale]/(business)/business/today/today-interactions'
import { TodayScreen, type TodayProps } from '@/app/[locale]/(business)/business/today/TodayScreen'
import TodayPage from '@/app/[locale]/(business)/business/today/page'
import { place, type BoardItem, type BoardLane } from '@/business/lib/today-board'

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
  it('bed → 満室, all-清掃 → 清掃, guard → 新規, no-fit → no word at all', () => {
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
    expect(explainOn([], guarded).word).toBe('新規')

    // ⚖ Fable-accepted default (overturnable, noted in the PR body): a
    // no-pocket-fit chip keeps the bare 「—」. Its blocker is drawn on the row.
    const noFit = at(railOn([lane({ key: 'p-01', group: 'staff', items: [booking({ key: 's1', caseId: 'y1' }, 780, 840)] })]), 780)
    expect(explainOn([], noFit).word).toBeNull()

    // A start nothing refused wears nothing.
    expect(explainOn(sceneWith([]), placeableOn(railOn(sceneWith([])))).word).toBeNull()
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

  it('every other class appends its own 「（HH:MM–HH:MM）」', () => {
    const noFit = at(railOn([lane({ key: 'p-01', group: 'staff', items: [booking({ key: 's1', caseId: 'y1' }, 780, 840)] })]), 780)
    expect(explainOn([], noFit).sentence).toBe('この開始には60分の連続した空きがありません（13:00–14:00）')

    const ok = placeableOn(railOn(sceneWith([])))
    expect(explainOn([], ok).sentence).toBe(`${ok.sentence}（${clock(ok.start)}–${clock(ok.start + 60)}）`)

    const guarded = railOn([lane({ key: 'p-01', group: 'staff', items: [booking({ key: 's1', caseId: 'y1' }, 900, 960)] })])
      .cells.find((c) => c.reason === 'guard')!
    expect(explainOn([], guarded).sentence).toBe(`${guarded.sentence}（${clock(guarded.start)}–${clock(guarded.start + 60)}）`)
  })

  it('the window follows the LENGTH the strip is judging (⚖ 50)', () => {
    // A 90 in hand asks about 13:00–14:30, and the sentence has to say so or it
    // is naming a span the operator is not holding.
    const noFit = at(railOn([lane({ key: 'p-01', group: 'staff', items: [booking({ key: 's1', caseId: 'y1' }, 780, 840)] })], 90), 780)
    expect(explainOn([], noFit, 90).sentence).toContain('（13:00–14:30）')
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
    const win = `（${clock(safe.start)}–${clock(safe.start + 60)}）`

    // A room-drop explains the hole: the sentence says who is using the room.
    expect(railExplain(safe, 60, { adless: true, takerLabel: '見本 かおる' }).sentence)
      .toBe(`${safe.sentence}${win}。ベッドは別の販売枠（見本 かおる）が使っています`)

    // Nothing was dropped — the hour was simply never derived. The clause states
    // that and invents no cause for it.
    const bare = railExplain(safe, 60, { adless: true, takerLabel: null }).sentence
    expect(bare).toBe(`${safe.sentence}${win}。この開始の販売枠は表示されていません`)
    expect(bare).not.toContain('ベッド')

    // A window that DOES carry a box gets no clause at all.
    expect(railExplain(safe, 60, { adless: false, takerLabel: '見本 かおる' }).sentence).toBe(`${safe.sentence}${win}`)
    // …and a refused chip is already answering, so it never grows one either.
    const noFit = at(railOn([lane({ key: 'p-01', group: 'staff', items: [booking({ key: 's1', caseId: 'y1' }, 780, 840)] })]), 780)
    expect(railExplain(noFit, 60, { adless: true, takerLabel: '見本 かおる' }).sentence).not.toContain('別の販売枠')
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
    const rails = guardRailsFor(REAL.lanes, {
      open: REAL.hours.open, close: REAL.hours.close, stepMin: 30,
      dur: REAL.guard.standardSessionMin, protectedDur: REAL.guard.protectedDurationMin,
      nowMinute: REAL.sell.nowMinute, locked: [], guard: REAL.guard.config,
      placementFeasible: (l, start, d) => truth.newClientMask(l, d)(start),
    })
    expect(rails.length).toBeGreaterThan(0)

    const rows: string[] = []
    const mute: string[] = []
    for (const gridMin of GRID) {
      for (const sessionMin of SESSION) {
        for (const minSellableMin of MIN_SELLABLE) {
          const at = `grid=${gridMin} S=${sessionMin} minSell=${minSellableMin}`
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

          let blocked = 0
          let worded = 0
          for (const rail of rails) {
            const staff = REAL.lanes.find((l) => l.key === rail.laneKey)!
            for (const c of rail.cells) {
              const said = railExplain(c, REAL.guard.standardSessionMin, {
                room:
                  c.reason === 'bed'
                    ? allocateBed(REAL.lanes, {
                        id: null, currentBed: null, stores: staff.stores, vip: false,
                        start: c.start, end: c.start + REAL.guard.standardSessionMin, policy: REAL.rooms,
                      })
                    : null,
              })
              // THE BAR, on every single chip of every single lane: it says
              // something, and what it says names the window it judged. Both
              // grammars satisfy it — the bed refusal opens with 「HH:MM〜HH:MM」
              // and everything else closes with 「（HH:MM–HH:MM）」 — which is
              // why the clock strings themselves are the pin rather than either
              // punctuation.
              expect({ at, chip: `${rail.laneKey}@${c.start}`, empty: said.sentence === '' })
                .toEqual({ at, chip: `${rail.laneKey}@${c.start}`, empty: false })
              const from = clock(c.start)
              const to = clock(c.start + REAL.guard.standardSessionMin)
              expect({ at, chip: `${rail.laneKey}@${c.start}`, names: said.sentence.includes(from) && said.sentence.includes(to) })
                .toEqual({ at, chip: `${rail.laneKey}@${c.start}`, names: true })
              if (c.state === 'blocked') blocked += 1
              if (said.word != null) worded += 1
              // A word only ever rides a refusal, and only the two invisible ones.
              if (said.word != null) expect(c.reason === 'bed' || c.reason === 'guard').toBe(true)
            }
          }
          expect(blocked).toBeGreaterThan(0)
          const offers = sell.cells.length + gap.packed.length + gap.scraps.length
          if (sell.cells.length === 0) mute.push(at)
          rows.push(
            `${at} | chips blocked ${blocked} worded ${worded}` +
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
  })
})

describe('§6 — the cues are ONE decision, so they cannot appear apart', () => {
  const SRC = readFileSync(
    join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'),
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
    // …and the hatch is the same filter, one row up.
    expect(SRC).toContain('[...explainedHere].filter(([, e]) => e.word != null).map(([start]) => start)')
    // Both cues stand down while a card is in hand — the strip is answering a
    // different question then, and the chip wears the verdict's × instead.
    expect(SRC).toContain('const word = v ? null : (explained?.word ?? null)')
    expect(SRC).toContain("lane.group === 'staff' && !inHand && explainedHere")
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
    expect(SRC).toContain('onClick={() => {\n                  if (dragRef.current || blockDragRef.current) return\n                  show(sentence)')
    // A rest affordance: a press arriving mid-gesture belongs to that gesture.
    expect(SRC).toContain('if (dragRef.current || blockDragRef.current) return')
    // Cursor honesty on the grey chip, and the hover exclusion is gone with it.
    expect(CSS).toContain('background: #f2f2f4; color: #8a8a93; cursor: pointer;')
    expect(CSS).not.toContain('.guard-rail-cell:hover:not(.blocked)')
    // The chip is still 14px — the micro-word may not grow the 18px strip.
    expect(CSS).toContain('height: 14px;')
  })

  it('the tour sentence teaches the third face — flag 25c’s one-sentence precedent', () => {
    const guide = SRC.slice(SRC.indexOf("'data-guide':"), SRC.indexOf("'data-guide':") + 1400)
    expect(guide).toContain('どのコマも押すと、判定した時間帯とその理由を表示します')
    expect(guide).toContain('薄い斜線')
    expect(guide).toContain('「満室」「清掃」「新規」')
  })
})
