// THE CAPACITY BOOK'S OWN BATTERY (R1 of the 今日の運営 layer rebuild).
//
// The book is dark this round — nothing imports it — so this file is the only
// thing that can prove it. Every pin below is written to be MUTATION-PROVABLE:
// break one line of capacity-ledger.ts and exactly one of these fails.
//
// It also lands the fixture the whole program runs on from here: a synthetic
// 25-staff / 10-bed / 540-minute board with a sparse and a dense profile.
// There is no such board in the repo today — the demo fixture is six people —
// and "supports a huge roster" is a claim nobody could check. It is built out
// of the REAL board shapes (`place`, `cleanupBlocks`, `BoardLane`,
// `BoardItem` from today-board.ts), not invented ones, and it is deterministic:
// one seed in, the same board out, forever.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import * as ledger from '@/app/[locale]/(business)/business/today/capacity-ledger'
import {
  bedTruthViews,
  buildClaims,
  LATTICE_STEP_MIN,
  type BedTruth,
  type NewClient,
  type OfferInput,
  type Subject,
} from '@/app/[locale]/(business)/business/today/capacity-ledger'
import { allocateBed, type RoomPolicy } from '@/app/[locale]/(business)/business/today/today-interactions'
import {
  cleanupBlocks,
  hhmm,
  place,
  type BoardItem,
  type BoardLane,
  type BookingCategory,
  type Hours,
} from '@/business/lib/today-board'

// ── the store the fixture runs in ───────────────────────────────────────────

const OPEN = 540 // 09:00
const CLOSE = 1080 // 18:00 — 540 minutes, 108 lattice slots
const HOURS: Hours = { open: OPEN, close: CLOSE }
const FRAME = { openMin: OPEN, closeMin: CLOSE, nowMin: 600 }
const POLICY: RoomPolicy = { vipStaysPrivate: true, privateIsLastResort: true }
const SLOTS = (CLOSE - OPEN) / LATTICE_STEP_MIN

/** The two hypothetical askers the single-store fixture uses. Every question
 *  names one: there is no "anybody" any more. */
const HERE: NewClient = { stores: ['store-a'] }
const AWAY: NewClient = { stores: ['store-b'] }
const FLOATING: NewClient = { stores: null }

/** The book, for one board. `bedTruthViews` is the only door — the battery goes
 *  through it exactly as production will. */
const truthOn = (lanes: BoardLane[], frame = FRAME) => bedTruthViews(lanes, POLICY, frame, null).world

/** Deterministic pseudo-randomness — a plain LCG. No Date.now, no Math.random:
 *  a fixture that changes between runs cannot pin anything. */
function rng(seed: number): () => number {
  let s = (seed * 2654435761 + 1013904223) >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const pick = <T,>(next: () => number, xs: readonly T[]): T => xs[Math.floor(next() * xs.length) % xs.length]

// ── THE SYNTHETIC BOARD ─────────────────────────────────────────────────────

export interface BoardSpec {
  staff: number
  beds: number
  openMin: number
  closeMin: number
  profile: 'sparse' | 'dense'
  seed: number
  /** ⚖ flag 77 — the turnaround dial is OFF by default, so a bare board carries
   *  bookings and nothing else. */
  cleanupMinutes?: number
  /** How many of the rooms are 個室. The LAST rooms, so bed-01 is always a plain
   *  treatment room. */
  privateBeds?: number
  /** More than one store = staff and rooms are dealt round-robin between them,
   *  which is the only way the store-isolation rule is visible. */
  stores?: string[]
  /** Bookings to leave OFF the board entirely — a board where a card was never
   *  placed, as opposed to a board with a card lifted out of it. */
  omit?: string[]
}

interface SyntheticBooking {
  id: string
  staffKey: string
  staffName: string
  bedKey: string
  bedLabel: string
  customerName: string
  category: BookingCategory
  start: number
  end: number
}

const pad = (n: number) => String(n + 1).padStart(2, '0')
const staffKeyOf = (i: number) => `p-${pad(i)}`
const bedKeyOf = (j: number) => `bed-${pad(j)}`
const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.end > b.start && a.start < b.end

/** The day's bookings, before they become lanes. Exposed on its own because
 *  some pins need to know which booking sits where (the hand for the two-views
 *  law has to be one that is FIRST on its own room — see pin 3). */
export function syntheticBookings(spec: BoardSpec): SyntheticBooking[] {
  const { staff, beds, openMin, closeMin, profile, seed } = spec
  const stores = spec.stores ?? ['store-a']
  const privateBeds = spec.privateBeds ?? 1
  const omit = new Set(spec.omit ?? [])
  const next = rng(seed)
  const perLane = profile === 'dense' ? 5 : 2
  const durations = [45, 60, 90] as const
  const isPrivate = (j: number) => j >= beds - privateBeds
  const storeOfStaff = (i: number) => stores[i % stores.length]
  const storeOfBed = (j: number) => stores[j % stores.length]

  const out: SyntheticBooking[] = []
  const busy = (key: string, span: { start: number; end: number }) => out.some((b) => (b.staffKey === key || b.bedKey === key) && overlaps(b, span))

  for (let i = 0; i < staff; i += 1) {
    for (let n = 0; n < perLane; n += 1) {
      const id = `apt-${pad(i)}-${n}`
      const dur = pick(next, durations)
      // Bookings land on the store's own 30-minute booking lattice.
      const steps = Math.floor((closeMin - openMin - dur) / 30)
      const start = openMin + Math.floor(next() * (steps + 1)) * 30
      const span = { start, end: start + dur }
      const category: BookingCategory = (i + n) % 7 === 0 ? 'vip' : (i + n) % 3 === 0 ? 'new' : 'repeat'
      // ⚖ 51 — a VIP is never drawn in a room the rule says they cannot be in;
      // impossible states get fixed at the DATA, never displayed and explained.
      const candidates: number[] = []
      for (let j = 0; j < beds; j += 1) {
        if (category === 'vip' && POLICY.vipStaysPrivate && !isPrivate(j)) continue
        if (storeOfBed(j) !== storeOfStaff(i)) continue
        candidates.push(j)
      }
      if (candidates.length === 0) continue
      const bedIdx = candidates[Math.floor(next() * candidates.length) % candidates.length]
      // Two people never share a room and nobody is in two places: a board that
      // draws the impossible cannot prove anything about capacity.
      if (busy(staffKeyOf(i), span) || busy(bedKeyOf(bedIdx), span)) continue
      out.push({
        id,
        staffKey: staffKeyOf(i),
        staffName: `見本 ${pad(i)}`,
        bedKey: bedKeyOf(bedIdx),
        bedLabel: `ベッド${bedIdx + 1}`,
        customerName: `顧客 ${pad(i)}-${n}`,
        category,
        start,
        end: start + dur,
      })
    }
  }
  // `omit` is applied LAST, never during the walk: the day has to be the SAME
  // day with one card missing. Dropping a booking mid-walk would let the next
  // one take the space it was refused, and the two boards would be different
  // worlds rather than the same world minus a card.
  return out.filter((b) => !omit.has(b.id))
}

/** One BoardLane, with every field today-board.ts's `buildLanes` fills. */
function lane(over: Partial<BoardLane> & Pick<BoardLane, 'key' | 'group'>): BoardLane {
  return {
    label: over.key,
    sub: '',
    absentNote: null,
    mine: false,
    items: [],
    window: over.group === 'staff' ? { from: OPEN, until: CLOSE } : null,
    untilLabel: over.group === 'staff' ? hhmm(CLOSE) : null,
    listPrice: over.group === 'staff' ? 7000 : 0,
    stores: ['store-a'],
    roomClass: over.group === 'staff' ? null : 'standard',
    ...over,
  }
}

/** A booking card, shaped exactly like today-board.ts's `bookingItem`. */
function bookingItem(b: SyntheticBooking, hours: Hours, tag: string, keySuffix: 'staff' | 'bed'): BoardItem {
  return {
    key: `${b.id}-${keySuffix}`,
    kind: 'booking',
    state: 'confirmed',
    category: b.category,
    ...place(b.start, b.end, hours),
    title: b.customerName,
    tag: `【${tag}】`,
    time: `${hhmm(b.start)}〜`,
    ticketCat: b.category === 'vip' ? 'VIP' : '単発',
    ticketCore: b.category === 'vip' ? '月額' : '¥6,600',
    held: false,
    micro: false,
    caseId: b.id,
    label: `${hhmm(b.start)}〜${hhmm(b.end)} ${b.customerName}様 / ${b.staffName} / ${b.bedLabel}`,
  }
}

/** THE PROOF BOARD. 25 staff, 10 rooms, 09:00–18:00 by default. */
export function syntheticBoard(spec: BoardSpec): BoardLane[] {
  const hours: Hours = { open: spec.openMin, close: spec.closeMin }
  const stores = spec.stores ?? ['store-a']
  const privateBeds = spec.privateBeds ?? 1
  const cleanupMinutes = spec.cleanupMinutes ?? 0
  const bookings = syntheticBookings(spec)
  const lanes: BoardLane[] = []

  for (let i = 0; i < spec.staff; i += 1) {
    const key = staffKeyOf(i)
    const mine = bookings.filter((b) => b.staffKey === key)
    lanes.push(
      lane({
        key,
        group: 'staff',
        label: `見本 ${pad(i)}`,
        sub: `施術 / ${hhmm(spec.closeMin)}まで`,
        mine: i === 0,
        items: mine.map((b) => bookingItem(b, hours, b.bedLabel, 'staff')).sort((a, b) => a.x - b.x),
        window: { from: spec.openMin, until: spec.closeMin },
        untilLabel: hhmm(spec.closeMin),
        stores: [stores[i % stores.length]],
      }),
    )
  }

  for (let j = 0; j < spec.beds; j += 1) {
    const key = bedKeyOf(j)
    const on = bookings.filter((b) => b.bedKey === key)
    const items = on.map((b) => bookingItem(b, hours, b.staffName, 'bed'))
    for (const c of cleanupBlocks(
      on.map((b) => ({ id: b.id, start: b.start, end: b.end })),
      cleanupMinutes,
      hours,
    )) {
      items.push({
        key: c.id,
        kind: 'cleanup',
        state: null,
        category: null,
        ...place(c.start, c.end, hours),
        title: '清掃',
        tag: '',
        time: `${hhmm(c.start)}〜`,
        ticketCat: null,
        ticketCore: null,
        held: false,
        micro: c.end - c.start <= 20,
        caseId: null,
        label: `ベッド${j + 1}、${hhmm(c.start)}から${hhmm(c.end)}、清掃・予約不可`,
      })
    }
    lanes.push(
      lane({
        key,
        group: 'beds',
        label: `ベッド${j + 1}`,
        sub: j >= spec.beds - privateBeds ? '個室' : '施術室',
        items: items.sort((a, b) => a.x - b.x),
        stores: [stores[j % stores.length]],
        roomClass: j >= spec.beds - privateBeds ? 'private' : 'standard',
      }),
    )
  }
  return lanes
}

const SPARSE_25: BoardSpec = { staff: 25, beds: 10, openMin: OPEN, closeMin: CLOSE, profile: 'sparse', seed: 4242 }
const DENSE_25: BoardSpec = { ...SPARSE_25, profile: 'dense', seed: 9001 }
const SMALL_6: BoardSpec = { staff: 6, beds: 3, openMin: OPEN, closeMin: CLOSE, profile: 'dense', seed: 77 }
/** Two stores sharing one board — the lens the store-isolation law lives for. */
const TWO_STORE: BoardSpec = { ...SPARSE_25, staff: 8, beds: 4, stores: ['store-a', 'store-b'], seed: 1212 }

const lattice = (dur = 0) => {
  const out: number[] = []
  for (let s = OPEN; s + dur <= CLOSE; s += LATTICE_STEP_MIN) out.push(s)
  return out
}

const staffLanesOf = (lanes: BoardLane[]) => lanes.filter((l) => l.group === 'staff')

/** One full frame's worth of Phase-1 work: the guard's mask for every staff
 *  lane plus the day's 満室 runs, on that board's store bindings. */
function fullPass(truth: BedTruth, lanes: BoardLane[], dur = 60) {
  for (const l of staffLanesOf(lanes)) truth.newClientMask(l, dur)
  const bindings = [...new Set(staffLanesOf(lanes).map((l) => (l.stores ?? []).join('|')))]
  return bindings.map((b) => truth.fullRuns(dur, b === '' ? null : b.split('|')))
}

const distinctBindings = (lanes: BoardLane[]) =>
  new Set(staffLanesOf(lanes).map((l) => (l.stores === null ? '*' : [...l.stores].sort().join('|')))).size

const PERF: Array<{ staff: number; beds: number; lanes: number; buildMs: number; passMs: number; calls: number }> = []

// ── 1 · WRAP FIDELITY ───────────────────────────────────────────────────────

describe('1 — the book wraps the one bed search and never disagrees with it', () => {
  it('bedFor ≡ allocateBed for 400 randomised spans and askers', () => {
    const lanes = syntheticBoard(SMALL_6)
    const truth = truthOn(lanes)
    const next = rng(31337)
    const ids = lanes.flatMap((l) => l.items).map((i) => i.caseId).filter((x): x is string => x != null)
    let refusals = 0
    let placements = 0
    for (let n = 0; n < 400; n += 1) {
      const start = pick(next, lattice(90))
      const dur = pick(next, [30, 45, 60, 90])
      const asker: Subject | NewClient =
        next() < 0.6
          ? {
              id: pick(next, ids),
              currentBed: next() < 0.5 ? pick(next, ['bed-01', 'bed-02', 'bed-03']) : null,
              vip: next() < 0.3,
              stores: next() < 0.8 ? ['store-a'] : null,
            }
          : next() < 0.5
            ? HERE
            : FLOATING
      const book = truth.bedFor(start, start + dur, asker)
      const q = 'id' in asker ? asker : { id: null, currentBed: null, vip: false, stores: asker.stores }
      const direct = allocateBed(lanes, {
        id: q.id,
        currentBed: q.currentBed,
        stores: q.stores,
        vip: q.vip,
        start,
        end: start + dur,
        policy: POLICY,
      })
      expect({ laneKey: book.laneKey, refusal: book.refusal }).toEqual(direct)
      if (book.laneKey === null) refusals += 1
      else placements += 1
    }
    // Both outcomes actually occurred — a battery that only ever saw one of
    // them would pass on a book that always says the same thing.
    expect(refusals).toBeGreaterThan(0)
    expect(placements).toBeGreaterThan(0)
  })
})

// ── 2 · WHO IS ASKING, AND WHAT EXISTS ──────────────────────────────────────

describe('2 — 満室 and 「使える部屋がない」 are different answers', () => {
  const busyBed = (key: string, roomClass: 'standard' | 'private', stores: string[]) =>
    lane({
      key,
      group: 'beds',
      roomClass,
      stores,
      items: [
        {
          key: `${key}-x`,
          kind: 'booking',
          state: 'confirmed',
          category: 'repeat',
          ...place(600, 720, HOURS),
          title: '見本 さくら',
          tag: '',
          time: '10:00〜',
          ticketCat: null,
          ticketCore: null,
          held: false,
          micro: false,
          caseId: `case-${key}`,
          label: '',
        },
      ],
    })

  it('rooms exist but are busy → 満室, and the book says the rooms exist', () => {
    const lanes = [lane({ key: 'p-01', group: 'staff' }), busyBed('bed-01', 'standard', ['store-a']), busyBed('bed-02', 'standard', ['store-a'])]
    const a = truthOn(lanes).bedFor(600, 660, HERE)
    expect(a.laneKey).toBeNull()
    expect(a.compatibleRoomsExist).toBe(true)
    expect(a.refusal).toContain('満室')
  })

  it('a VIP on a board with no 個室 → no compatible room exists at all', () => {
    const lanes = [lane({ key: 'p-01', group: 'staff' }), lane({ key: 'bed-01', group: 'beds' }), lane({ key: 'bed-02', group: 'beds' })]
    const truth = truthOn(lanes)
    const vip: Subject = { id: 'apt-x', currentBed: null, vip: true, stores: ['store-a'] }
    const a = truth.bedFor(600, 660, vip)
    expect(a.laneKey).toBeNull()
    expect(a.compatibleRoomsExist).toBe(false)
    // The same board, same empty rooms, for a non-VIP: the rooms exist AND are free.
    const b = truth.bedFor(600, 660, { ...vip, vip: false })
    expect(b.compatibleRoomsExist).toBe(true)
    expect(b.laneKey).toBe('bed-01')
  })

  it('another store’s rooms are invisible, not busy', () => {
    const lanes = [lane({ key: 'p-01', group: 'staff', stores: ['store-b'] }), lane({ key: 'bed-01', group: 'beds', stores: ['store-a'] })]
    const truth = truthOn(lanes)
    expect(truth.bedFor(600, 660, AWAY).compatibleRoomsExist).toBe(false)
    // A floating asker (stores: null) pairs with any room — the same board answers yes.
    expect(truth.bedFor(600, 660, FLOATING).compatibleRoomsExist).toBe(true)
  })

  it('existence is not freeness: a busy room still exists for the count', () => {
    const lanes = [lane({ key: 'p-01', group: 'staff' }), busyBed('bed-01', 'standard', ['store-a'])]
    const truth = truthOn(lanes)
    expect(truth.bedFor(600, 660, HERE).compatibleRoomsExist).toBe(true)
    expect(truth.freeBedCount(600, 660, HERE)).toBe(0)
    expect(truth.freeBedCount(780, 840, HERE)).toBe(1)
  })

  it('freeBedKeys names the rooms that are free, not every room that exists', () => {
    const lanes = [lane({ key: 'p-01', group: 'staff' }), busyBed('bed-01', 'standard', ['store-a']), lane({ key: 'bed-02', group: 'beds' })]
    const truth = truthOn(lanes)
    // One room is taken and one is free: a book that answered "somebody was
    // free" would name both.
    expect(truth.freeBedKeys(600, 660, HERE)).toEqual(['bed-02'])
    expect(truth.freeBedCount(600, 660, HERE)).toBe(1)
  })

  it('…and on the whole proof board, free means nothing is standing on it', () => {
    const lanes = syntheticBoard({ ...DENSE_25, beds: 4, cleanupMinutes: 15 })
    const truth = truthOn(lanes)
    const beds = lanes.filter((l) => l.group === 'beds')
    let clearSeen = 0
    let takenSeen = 0
    for (const s of lattice(60)) {
      const free = truth.freeBedKeys(s, s + 60, HERE)
      for (const b of beds) {
        // Read off the raw board rather than through the allocator: 清掃 counts
        // as standing on the room, exactly as the board draws it.
        const clear = !b.items.some((i) => i.endMin > s && i.startMin < s + 60)
        expect(free.includes(b.key)).toBe(clear)
        if (clear) clearSeen += 1
        else takenSeen += 1
      }
    }
    expect(clearSeen).toBeGreaterThan(0)
    expect(takenSeen).toBeGreaterThan(0)
  })
})

// ── 2b · THE HYPOTHETICAL PATH IS STORE-SCOPED ──────────────────────────────

describe('2b — a hypothetical booking asks on ITS store’s rooms, never on the board’s', () => {
  /** store-a's only room is busy 10:00–11:00; store-b's is free all day. A
   *  store-a customer is 満室 at 10:00 whatever store-b is doing. */
  const split = () => [
    lane({ key: 'p-a', group: 'staff', stores: ['store-a'] }),
    lane({ key: 'p-b', group: 'staff', stores: ['store-b'] }),
    lane({
      key: 'bed-a',
      group: 'beds',
      stores: ['store-a'],
      items: [
        {
          key: 'x-bed',
          kind: 'booking',
          state: 'confirmed',
          category: 'repeat',
          ...place(600, 660, HOURS),
          title: '顧客 A',
          tag: '',
          time: '10:00〜',
          ticketCat: null,
          ticketCore: null,
          held: false,
          micro: false,
          caseId: 'apt-a',
          label: '',
        },
      ],
    }),
    lane({ key: 'bed-b', group: 'beds', stores: ['store-b'] }),
  ]

  it('bedFor refuses a store-a hypothetical while store-b sits empty', () => {
    const truth = truthOn(split())
    const a = truth.bedFor(600, 660, HERE)
    expect(a.laneKey).toBeNull()
    expect(a.refusal).toContain('満室')
    expect(a.compatibleRoomsExist).toBe(true)
    // The same question from store-b, and from a floating asker, is answered.
    expect(truth.bedFor(600, 660, AWAY).laneKey).toBe('bed-b')
    expect(truth.bedFor(600, 660, FLOATING).laneKey).toBe('bed-b')
  })

  it('freeBedKeys never hands one store the other store’s room', () => {
    const truth = truthOn(split())
    expect(truth.freeBedKeys(600, 660, HERE)).toEqual([])
    expect(truth.freeBedKeys(600, 660, AWAY)).toEqual(['bed-b'])
    expect(truth.freeBedKeys(600, 660, FLOATING)).toEqual(['bed-b'])
    expect(truth.freeBedCount(720, 780, HERE)).toBe(1)
  })

  it('fullRuns is 満室 for store-a over exactly the busy hour, and never for store-b', () => {
    const truth = truthOn(split())
    // A 60-minute booking is blocked from 09:05 (09:05+60 = 10:05, overlapping
    // the 10:00 card) through 10:55 — the runs are START minutes, so the run
    // opens a length BEFORE the card and closes when it ends.
    expect(truth.fullRuns(60, ['store-a'])).toEqual([{ startMin: 545, endMin: 660 }])
    expect(truth.fullRuns(60, ['store-b'])).toEqual([])
    expect(truth.fullRuns(60, null)).toEqual([])
  })

  it('freeBedCountNet subtracts inside the asker’s own store', () => {
    const truth = truthOn(split())
    const book = buildClaims(truth, [{ resourceKey: 'bed-b', start: 720, end: 780, kind: 'sell', laneKey: 'p-b' }])
    expect(book.freeBedCountNet(720, 780, AWAY)).toBe(0)
    // store-a's room is free then, and store-b's claim is none of its business.
    expect(book.freeBedCountNet(720, 780, HERE)).toBe(1)
  })

  it('a half-object carrying a stray id is read as a HYPOTHETICAL, never as that booking', () => {
    // TypeScript's excess-property check is literal-only, so an object built in
    // a variable can carry an `id` and still type as a NewClient. Reading it as
    // a Subject is the dangerous direction: allocateBed would lift that
    // booking's own card and offer the room it is standing in.
    const truth = truthOn(split())
    const strayId = { id: 'apt-a', stores: ['store-a'] } as NewClient
    const honest = truth.bedFor(600, 660, HERE)
    const withStray = truth.bedFor(600, 660, strayId)
    expect(withStray).toEqual(honest)
    // The room apt-a is standing in is NOT offered back to a hypothetical.
    expect(withStray.laneKey).toBeNull()
    expect(truth.freeBedKeys(600, 660, strayId)).toEqual([])
  })

  it('a half-object never inherits a VIP exemption from an absent field', () => {
    // `vip` arriving `undefined` on a Subject read would make `vip && policy`
    // false and walk a 個室 booking onto a standard room, past the ⚖ 51 floor.
    const lanes = [lane({ key: 'p-01', group: 'staff' }), lane({ key: 'bed-01', group: 'beds' })]
    const truth = truthOn(lanes)
    const halfVip = { id: 'zz', vip: true, stores: ['store-a'] } as unknown as NewClient
    // Read as the hypothetical it is: a plain new booking, no VIP claim either way.
    expect(truth.bedFor(600, 660, halfVip)).toEqual(truth.bedFor(600, 660, HERE))
    // And a REAL VIP subject on the same board is still refused the standard room.
    expect(truth.bedFor(600, 660, { id: 'zz', currentBed: null, vip: true, stores: ['store-a'] }).laneKey).toBeNull()
  })

  it('a half-object stays on the memoised path instead of paying for a search each time', () => {
    const truth = truthOn(split())
    const strayId = { id: undefined, stores: ['store-a'] } as unknown as NewClient
    truth.bedFor(600, 660, strayId)
    const afterFirst = truth.stats.allocateBedCalls
    truth.bedFor(600, 660, strayId)
    truth.bedFor(600, 660, strayId)
    expect(truth.stats.allocateBedCalls).toBe(afterFirst)
  })

  it('the excluded world takes a half-object as a hypothetical, not as a second lift', () => {
    const spec = { ...DENSE_25, beds: 3 }
    const hand = syntheticBookings(spec)[0]
    const views = bedTruthViews(syntheticBoard(spec), POLICY, FRAME, { id: hand.id })
    const strayId = { id: 'apt-02-1', stores: ['store-a'] } as NewClient
    // Fail-safe: a half-object is a hypothetical, so it cannot lift anything
    // and there is nothing to throw about.
    expect(() => views.worldMinusHand!.bedFor(600, 660, strayId)).not.toThrow()
    expect(views.worldMinusHand!.bedFor(600, 660, strayId)).toEqual(views.worldMinusHand!.bedFor(600, 660, HERE))
  })

  it('two store bindings that would join to the same text keep their own answers', () => {
    // ['a|b'] and ['a','b'] have the same `join('|')` fingerprint. One row for
    // both means whichever asks second is served the first one's answers.
    const lanes = [
      lane({ key: 'p-01', group: 'staff', stores: ['a|b'] }),
      lane({ key: 'bed-weird', group: 'beds', stores: ['a|b'] }),
      lane({
        key: 'bed-plain',
        group: 'beds',
        stores: ['a'],
        items: [
          {
            key: 'busy',
            kind: 'booking',
            state: 'confirmed',
            category: 'repeat',
            ...place(600, 660, HOURS),
            title: '顧客 A',
            tag: '',
            time: '10:00〜',
            ticketCat: null,
            ticketCore: null,
            held: false,
            micro: false,
            caseId: 'apt-plain',
            label: '',
          },
        ],
      }),
    ]
    const weird: NewClient = { stores: ['a|b'] }
    const split2: NewClient = { stores: ['a', 'b'] }
    // Asked in one order…
    const first = truthOn(lanes)
    expect(first.freeBedKeys(600, 660, weird)).toEqual(['bed-weird'])
    expect(first.freeBedKeys(600, 660, split2)).toEqual([])
    // …and in the other. A shared row shows up as one of these flipping.
    const second = truthOn(lanes)
    expect(second.freeBedKeys(600, 660, split2)).toEqual([])
    expect(second.freeBedKeys(600, 660, weird)).toEqual(['bed-weird'])
    // The null binding is its own row too, never the literal '*' store.
    const star = truthOn([lane({ key: 'p-01', group: 'staff' }), lane({ key: 'bed-star', group: 'beds', stores: ['*'] })])
    expect(star.freeBedKeys(600, 660, { stores: ['*'] })).toEqual(['bed-star'])
    expect(star.freeBedKeys(600, 660, FLOATING)).toEqual(['bed-star'])
    expect(star.freeBedKeys(600, 660, { stores: ['store-a'] })).toEqual([])
  })

  it('past thirty-two store bindings the book stops REMEMBERING, never stops answering', () => {
    // A binding is a staff lane's store-list, so a 本部 board with a hundred
    // stores has a hundred of them — an ordinary board under the
    // any-business-size law. Saturation must degrade, not refuse.
    const lanes = split()
    const truth = truthOn(lanes)
    const fresh = truthOn(lanes)
    for (let n = 0; n < 32; n += 1) truth.bedFor(600, 660, { stores: [`store-${n}`] })
    expect(truth.stats.storeBindings).toBe(32)

    // The 33rd is answered correctly — compared against a book that has room
    // for it — and mints no row.
    const beyond: NewClient = { stores: ['store-a'] }
    expect(truth.bedFor(600, 660, beyond)).toEqual(fresh.bedFor(600, 660, beyond))
    expect(truth.freeBedKeys(600, 660, beyond)).toEqual(fresh.freeBedKeys(600, 660, beyond))
    expect(truth.fullRuns(60, beyond.stores)).toEqual(fresh.fullRuns(60, beyond.stores))
    expect(truth.newClientMask(lanes[0], 60)(600)).toBe(fresh.newClientMask(lanes[0], 60)(600))
    expect(truth.stats.storeBindings).toBe(32)

    // A binding it already knows is still served from cache: zero new searches.
    truth.bedFor(720, 780, { stores: ['store-0'] })
    const settled = truth.stats.allocateBedCalls
    truth.bedFor(720, 780, { stores: ['store-0'] })
    truth.bedFor(720, 780, { stores: ['store-0'] })
    expect(truth.stats.allocateBedCalls).toBe(settled)
  })

  it('a 33-store 本部 board runs a full frame without refusing anything', () => {
    const hq = syntheticBoard({ ...SPARSE_25, staff: 33, beds: 33, stores: Array.from({ length: 33 }, (_, i) => `store-${i}`), seed: 3333 })
    const truth = truthOn(hq)
    expect(() => fullPass(truth, hq)).not.toThrow()
    // 33 bindings, 32 of them cached; the last is answered every time it is
    // asked, which is the whole cost of saturation.
    expect(truth.stats.storeBindings).toBe(32)
    expect(truth.stats.allocateBedCalls).toBeGreaterThan(32 * SLOTS)
    // And the uncached store still tells the truth.
    const last = staffLanesOf(hq)[32]
    const naive = truthOn(hq)
    for (const s of lattice(60)) {
      expect(truth.bedFor(s, s + 60, { stores: last.stores })).toEqual(naive.bedFor(s, s + 60, { stores: last.stores }))
    }
  })

  it('the same lane key in two stores would be ambiguous, so the book refuses to build', () => {
    const twins = [lane({ key: 'bed-01', group: 'beds', stores: ['store-a'] }), lane({ key: 'bed-01', group: 'beds', stores: ['store-b'] })]
    expect(() => truthOn(twins)).toThrow(/share a key/)
  })
})

// ── 3 · TWO VIEWS, AND NO THIRD ─────────────────────────────────────────────

describe('3 — exactly two worlds, and the second one needs a hand', () => {
  /** A booking that is FIRST on its own room, with room to breathe after it —
   *  the one shape where lifting a card and never placing it agree exactly (see
   *  the inherited-ceiling note on `excludedWorld`). */
  const firstOnItsBed = (spec: BoardSpec) => {
    const bookings = syntheticBookings(spec)
    const found = bookings.find(
      (b) =>
        !bookings.some((o) => o.bedKey === b.bedKey && o.start < b.start) &&
        !bookings.some((o) => o.bedKey === b.bedKey && o.start === b.end),
    )
    expect(found).toBeDefined()
    return found!
  }

  const sameAnswers = (a: BedTruth, b: BedTruth) => {
    for (const start of lattice(60)) {
      expect(a.bedFor(start, start + 60, HERE)).toEqual(b.bedFor(start, start + 60, HERE))
      expect(a.freeBedKeys(start, start + 60, HERE)).toEqual(b.freeBedKeys(start, start + 60, HERE))
    }
    expect(a.fullRuns(60, HERE.stores)).toEqual(b.fullRuns(60, HERE.stores))
    expect(a.fullRuns(90, HERE.stores)).toEqual(b.fullRuns(90, HERE.stores))
  }

  /** The lift, spelled out here rather than borrowed from the module: the card
   *  and its own trailing 清掃 come off the lanes, nothing else changes. */
  const lanesWithout = (lanes: BoardLane[], id: string) =>
    lanes.map((l) => ({ ...l, items: l.items.filter((i) => i.caseId !== id && i.key !== `${id}-cleanup`) }))

  it('worldMinusHand ≡ a book built on physically lifted lanes (清掃 off)', () => {
    const spec = { ...DENSE_25, beds: 4 }
    const hand = firstOnItsBed(spec)
    const lanes = syntheticBoard(spec)
    const views = bedTruthViews(lanes, POLICY, FRAME, { id: hand.id })
    expect(views.worldMinusHand).not.toBeNull()
    sameAnswers(views.worldMinusHand!, truthOn(lanesWithout(lanes, hand.id)))
  })

  it('…and with 清掃 on, the card’s own turnaround is lifted with it', () => {
    const spec = { ...DENSE_25, beds: 4, cleanupMinutes: 15 }
    const hand = firstOnItsBed(spec)
    const lanes = syntheticBoard(spec)
    // The board really does carry the hand's own 清掃 block — otherwise this
    // pin would prove nothing about the second exclusion.
    expect(lanes.flatMap((l) => l.items).some((i) => i.key === `${hand.id}-cleanup`)).toBe(true)
    const views = bedTruthViews(lanes, POLICY, FRAME, { id: hand.id })
    sameAnswers(views.worldMinusHand!, truthOn(lanesWithout(lanes, hand.id)))
  })

  it('on THIS shape the lift also equals a board where the card was never placed', () => {
    // Scoped deliberately: the lift is an item filter, so on a card that is NOT
    // first on its room another booking's 清掃 tail stays clipped where this
    // card used to start. That inherited ceiling is documented on
    // `excludedWorld`; this pin claims the equality only where it holds.
    const spec = { ...DENSE_25, beds: 4, cleanupMinutes: 15 }
    const hand = firstOnItsBed(spec)
    const views = bedTruthViews(syntheticBoard(spec), POLICY, FRAME, { id: hand.id })
    sameAnswers(views.worldMinusHand!, truthOn(syntheticBoard({ ...spec, omit: [hand.id] })))
  })

  it('the world itself keeps the card: staged is real for every reader', () => {
    const spec = { ...DENSE_25, beds: 2 }
    const hand = firstOnItsBed(spec)
    const views = bedTruthViews(syntheticBoard(spec), POLICY, FRAME, { id: hand.id })
    sameAnswers(views.world, truthOn(syntheticBoard(spec)))
    expect(views.world.freeBedKeys(hand.start, hand.end, HERE)).not.toContain(hand.bedKey)
    expect(views.worldMinusHand!.freeBedKeys(hand.start, hand.end, HERE)).toContain(hand.bedKey)
  })

  it('no hand, no second world', () => {
    const views = bedTruthViews(syntheticBoard(SMALL_6), POLICY, FRAME, null)
    expect(views.worldMinusHand).toBeNull()
    expect(views.world.bedFor(600, 660, HERE).laneKey).not.toBeUndefined()
  })

  it('a hand with no id is not a hand — it throws rather than deleting nothing', () => {
    expect(() => bedTruthViews(syntheticBoard(SMALL_6), POLICY, FRAME, { id: '' })).toThrow(/live gesture/)
  })

  it('a pending id is not expressible: the hand is an object, not a loose string', () => {
    // @ts-expect-error — a bare id is exactly the binding (`live ?? pending`)
    // that produced the three-world board; the type is the guard, and
    // `npm run type-check` is where this line is proved.
    expect(() => bedTruthViews(syntheticBoard(SMALL_6), POLICY, FRAME, 'apt-01-0')).toThrow()
  })

  it('ONE lift per world: asking the excluded world about a second booking throws', () => {
    const spec = { ...DENSE_25, beds: 3 }
    const bookings = syntheticBookings(spec)
    const hand = bookings[0]
    const other = bookings.find((b) => b.id !== hand.id)!
    const views = bedTruthViews(syntheticBoard(spec), POLICY, FRAME, { id: hand.id })
    const asOther: Subject = { id: other.id, currentBed: other.bedKey, vip: false, stores: ['store-a'] }
    // allocateBed excludes the subject's own card, so this would lift a SECOND
    // one — the three-world board rebuilt by composition.
    expect(() => views.worldMinusHand!.bedFor(600, 660, asOther)).toThrow(/second card/)
    expect(() => views.worldMinusHand!.freeBedKeys(600, 660, asOther)).toThrow(/second card/)
    // The hand's own question, and any hypothetical, are answered normally.
    const asHand: Subject = { id: hand.id, currentBed: hand.bedKey, vip: false, stores: ['store-a'] }
    expect(() => views.worldMinusHand!.bedFor(600, 660, asHand)).not.toThrow()
    expect(() => views.worldMinusHand!.bedFor(600, 660, HERE)).not.toThrow()
    // …and the un-lifted world takes any subject, as it always could.
    expect(() => views.world.bedFor(600, 660, asOther)).not.toThrow()
  })
})

// ── 4 · SUBJECT INDEPENDENCE ────────────────────────────────────────────────

describe('4 — a hypothetical booking’s answer depends on the rooms, nothing else', () => {
  const base = syntheticBoard(DENSE_25)
  const answersOf = (lanes: BoardLane[]) => {
    const truth = truthOn(lanes)
    return lattice(60).map((s) => truth.bedFor(s, s + 60, HERE))
  }
  const countsOf = (lanes: BoardLane[]) => {
    const truth = truthOn(lanes)
    return { counts: lattice(60).map((s) => truth.freeBedCount(s, s + 60, HERE)), runs: truth.fullRuns(60, HERE.stores) }
  }

  it('permuting every other booking’s category and VIP-ness changes nothing', () => {
    const rotated = base.map((l) => ({
      ...l,
      items: l.items.map((i) => (i.kind === 'booking' ? { ...i, category: (i.category === 'vip' ? 'repeat' : 'vip') as BookingCategory } : i)),
    }))
    expect(answersOf(rotated)).toEqual(answersOf(base))
  })

  it('moving bookings between STAFF lanes changes nothing (rooms untouched)', () => {
    const staff = staffLanesOf(base)
    const shuffled = base.map((l) => {
      if (l.group !== 'staff') return l
      const at = staff.findIndex((s) => s.key === l.key)
      return { ...l, items: staff[(at + 1) % staff.length].items }
    })
    expect(answersOf(shuffled)).toEqual(answersOf(base))
  })

  it('swapping two interchangeable rooms’ occupancy leaves the counts and the 満室 runs alone', () => {
    const a = base.find((l) => l.key === 'bed-01')!
    const b = base.find((l) => l.key === 'bed-02')!
    const swapped = base.map((l) => (l.key === a.key ? { ...l, items: b.items } : l.key === b.key ? { ...l, items: a.items } : l))
    expect(countsOf(swapped)).toEqual(countsOf(base))
  })
})

// ── 5 · CACHE SOUNDNESS ─────────────────────────────────────────────────────

describe('5 — memoised answers equal unmemoised ones, across both views', () => {
  it('300 randomised questions, world and worldMinusHand interleaved', () => {
    const spec = { ...SMALL_6, cleanupMinutes: 10 }
    const lanes = syntheticBoard(spec)
    const handId = lanes.flatMap((l) => l.items).find((i) => i.caseId != null)!.caseId!
    const memo = bedTruthViews(lanes, POLICY, FRAME, { id: handId })
    const next = rng(505)
    for (let n = 0; n < 300; n += 1) {
      const start = pick(next, lattice(90))
      const dur = pick(next, [30, 60, 90])
      const inHand = n % 2 === 0
      const asker: Subject | NewClient =
        next() < 0.35 ? { id: handId, currentBed: 'bed-01', vip: next() < 0.4, stores: ['store-a'] } : next() < 0.5 ? HERE : FLOATING
      // The unmemoised twin: a book built for this ONE question, so nothing it
      // returns can have come from a cache.
      const fresh = bedTruthViews(lanes, POLICY, FRAME, { id: handId })
      const asked = inHand ? memo.worldMinusHand! : memo.world
      const virgin = inHand ? fresh.worldMinusHand! : fresh.world
      expect(asked.bedFor(start, start + dur, asker)).toEqual(virgin.bedFor(start, start + dur, asker))
      expect(asked.freeBedKeys(start, start + dur, asker)).toEqual(virgin.freeBedKeys(start, start + dur, asker))
    }
  })

  it('the two views never hand each other an answer', () => {
    const spec = { ...DENSE_25, beds: 3 }
    const lanes = syntheticBoard(spec)
    const hand = syntheticBookings(spec)[0]
    const views = bedTruthViews(lanes, POLICY, FRAME, { id: hand.id })
    const staff = staffLanesOf(lanes)[0]
    // Each view is compared against a FRESHLY BUILT book on the lanes that view
    // is supposed to be reading — not against itself.
    const world = truthOn(lanes)
    const lifted = truthOn(lanes.map((l) => ({ ...l, items: l.items.filter((i) => i.caseId !== hand.id && i.key !== `${hand.id}-cleanup`) })))
    const maskWorld = views.world.newClientMask(staff, 60)
    const maskMinus = views.worldMinusHand!.newClientMask(staff, 60)
    const naiveWorld = world.newClientMask(staff, 60)
    const naiveLifted = lifted.newClientMask(staff, 60)
    for (const s of lattice()) {
      // Interleaved on purpose: a shared cache shows up as one view answering
      // with the other's row.
      expect(views.world.bedFor(s, s + 60, HERE)).toEqual(world.bedFor(s, s + 60, HERE))
      expect(views.worldMinusHand!.bedFor(s, s + 60, HERE)).toEqual(lifted.bedFor(s, s + 60, HERE))
      expect(maskWorld(s)).toBe(naiveWorld(s))
      expect(maskMinus(s)).toBe(naiveLifted(s))
    }
    // …and the two worlds really do disagree about the hand's own room, so a
    // bled answer would have been visible here.
    expect(views.world.freeBedKeys(hand.start, hand.end, HERE)).not.toContain(hand.bedKey)
    expect(views.worldMinusHand!.freeBedKeys(hand.start, hand.end, HERE)).toContain(hand.bedKey)
  })
})

// ── 6 · 満室 RUNS ───────────────────────────────────────────────────────────

describe('6 — the 満室 runs are the brute-force scan, and only that', () => {
  const spec: BoardSpec = { staff: 10, beds: 2, openMin: OPEN, closeMin: CLOSE, profile: 'dense', seed: 616 }

  it('runs ≡ the starts where freeBedCount is 0, at the same length', () => {
    const lanes = syntheticBoard(spec)
    const truth = truthOn(lanes)
    for (const dur of [45, 60, 90]) {
      const brute = new Set(lattice(dur).filter((s) => truthOn(lanes).freeBedCount(s, s + dur, HERE) === 0))
      const fromRuns = new Set<number>()
      for (const run of truth.fullRuns(dur, HERE.stores)) for (let s = run.startMin; s < run.endMin; s += LATTICE_STEP_MIN) fromRuns.add(s)
      expect([...fromRuns].sort((a, b) => a - b)).toEqual([...brute].sort((a, b) => a - b))
      // The board really is full somewhere — otherwise this pin is vacuous.
      expect(brute.size).toBeGreaterThan(0)
    }
  })

  it('two builds of the same board produce identical runs', () => {
    const a = truthOn(syntheticBoard(spec)).fullRuns(60, HERE.stores)
    const b = truthOn(syntheticBoard(spec)).fullRuns(60, HERE.stores)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('a start whose booking cannot finish before closing is not a 満室 start', () => {
    // The room is busy from 17:30 to closing, so at 17:30 a 60-minute booking
    // has no room — but it also has no day: the run must stop at 17:00, the
    // last start that fits. A board whose bed is free everywhere could not tell
    // the two reasons apart.
    const lanes = [
      lane({ key: 'p-01', group: 'staff' }),
      lane({
        key: 'bed-01',
        group: 'beds',
        items: [
          {
            key: 'late-bed',
            kind: 'booking',
            state: 'confirmed',
            category: 'repeat',
            ...place(1050, CLOSE, HOURS),
            title: '顧客 遅番',
            tag: '',
            time: '17:30〜',
            ticketCat: null,
            ticketCore: null,
            held: false,
            micro: false,
            caseId: 'apt-late',
            label: '',
          },
        ],
      }),
    ]
    const truth = truthOn(lanes)
    // 17:00 + 60 = 18:00 exactly: the last start that fits, and it IS full.
    expect(truth.bedFor(1020, 1080, HERE).laneKey).toBeNull()
    // The run opens at 16:35 (16:35+60 = 17:35, overlapping the card) and stops
    // at the last start that fits inside the day. 17:05 onwards has no room
    // EITHER, but it is not a 満室 start — it is not a start at all, and
    // without the closing clip the run would swallow the tail to 18:00.
    expect(truth.fullRuns(60, HERE.stores)).toEqual([{ startMin: 995, endMin: 1025 }])
    // The book still answers an out-of-day question honestly when asked.
    expect(truth.bedFor(1050, 1110, HERE).laneKey).toBeNull()
  })
})

// ── 7 · THE GUARD'S MASK ────────────────────────────────────────────────────

describe('7 — the precomputed mask is the same answer as asking one by one', () => {
  it.each([
    ['sparse', SPARSE_25, false],
    ['dense', DENSE_25, true],
  ])('%s 25-staff board: mask ≡ naive per lattice start', (_name, spec, everFull) => {
    const lanes = syntheticBoard(spec as BoardSpec)
    const truth = truthOn(lanes)
    const naive = truthOn(lanes)
    let trues = 0
    let falses = 0
    for (const l of staffLanesOf(lanes)) {
      const mask = truth.newClientMask(l, 90)
      for (const s of lattice()) {
        const direct = naive.bedFor(s, s + 90, { stores: l.stores }).laneKey !== null
        expect(mask(s)).toBe(direct)
        if (direct) trues += 1
        else falses += 1
      }
    }
    expect(trues).toBeGreaterThan(0)
    // Ten rooms and fifty bookings never run out, and that IS the sparse
    // board's truth — the refusals have to come from the dense one, or the
    // equality above is only ever proving one answer.
    if (everFull) expect(falses).toBeGreaterThan(0)
  })

  it('the mask is bound to the lane’s own stores, and two stores get two masks', () => {
    const lanes = syntheticBoard({ ...TWO_STORE, profile: 'dense' })
    const truth = truthOn(lanes)
    const naive = truthOn(lanes)
    let disagreementsBetweenStores = 0
    for (const l of staffLanesOf(lanes)) {
      const mask = truth.newClientMask(l, 60)
      const otherStore = l.stores?.[0] === 'store-a' ? ['store-b'] : ['store-a']
      for (const s of lattice(60)) {
        expect(mask(s)).toBe(naive.bedFor(s, s + 60, { stores: l.stores }).laneKey !== null)
        if (mask(s) !== (naive.bedFor(s, s + 60, { stores: otherStore }).laneKey !== null)) disagreementsBetweenStores += 1
      }
    }
    // The two stores really do answer differently somewhere — without this the
    // pin would pass on a book that ignored stores entirely.
    expect(disagreementsBetweenStores).toBeGreaterThan(0)
  })

  it('an off-lattice start still gets the true answer, not a miss', () => {
    const lanes = syntheticBoard(SMALL_6)
    const truth = truthOn(lanes)
    const l = staffLanesOf(lanes)[0]
    const mask = truth.newClientMask(l, 60)
    for (const odd of [OPEN + 3, OPEN + 47, CLOSE + 60, OPEN - 30]) {
      expect(mask(odd)).toBe(truth.bedFor(odd, odd + 60, { stores: l.stores }).laneKey !== null)
    }
  })
})

// ── 8 · CLAIMS ──────────────────────────────────────────────────────────────

describe('8 — the claims book: one offer per box, separation, and purity', () => {
  const truthOf = () => truthOn(syntheticBoard(SMALL_6))
  const offer = (over: Partial<OfferInput> = {}): OfferInput => ({ resourceKey: 'bed-01', start: 600, end: 660, kind: 'sell', laneKey: 'p-01', ...over })

  it('the paired staff-row and bed-row emission of one offer is ONE claim', () => {
    const book = buildClaims(truthOf(), [offer({ laneKey: 'p-01' }), offer({ laneKey: 'bed-01' })])
    expect(book.claims).toHaveLength(1)
    // First emission wins — the book does not invent an order.
    expect(book.claims[0].laneKey).toBe('p-01')
    const wider = buildClaims(truthOf(), [offer({ laneKey: 'p-01' }), offer({ laneKey: 'bed-01' }), offer({ laneKey: 'p-01' })])
    expect(wider.claims).toHaveLength(1)
  })

  it('a sell box and a スキマ枠 box on the SAME room and span are TWO promises', () => {
    const book = buildClaims(truthOf(), [offer({ kind: 'sell', laneKey: 'p-01' }), offer({ kind: 'gap', laneKey: 'p-02' })])
    expect(book.claims).toHaveLength(2)
    expect(book.claims.map((c) => c.kind).sort()).toEqual(['gap', 'sell'])
    const [conflict, ...rest] = book.violations({})
    expect(rest).toEqual([])
    expect(conflict.gapMin).toBe(-60)
    expect(conflict.requiredMin).toBe(0)
    expect(conflict.resourceKey).toBe('bed-01')
    expect([conflict.earlier.kind, conflict.later.kind].sort()).toEqual(['gap', 'sell'])
    const truth = truthOf()
    const bare = buildClaims(truth, []).freeBedCountNet(600, 660, HERE)
    const wasFree = truth.freeBedKeys(600, 660, HERE).includes('bed-01')
    expect(book.freeBedCountNet(600, 660, HERE)).toBe(bare - (wasFree ? 1 : 0))
  })

  it('the same span on a DIFFERENT room is a different claim', () => {
    const book = buildClaims(truthOf(), [offer(), offer({ resourceKey: 'bed-02' })])
    expect(book.claims).toHaveLength(2)
  })

  it('a different span on the same room is a different claim', () => {
    const book = buildClaims(truthOf(), [offer(), offer({ end: 690 })])
    expect(book.claims).toHaveLength(2)
  })

  it('an offer with no room is refused rather than filed under ""', () => {
    // The sell engine emits `bed?.key ?? ''` on a bed-less store; collapsing
    // those into one nameless room invents conflicts between unrelated boxes.
    expect(() => buildClaims(truthOf(), [offer({ resourceKey: '' })])).toThrow(/no room/)
  })

  it.each([
    [0, [['a', 'b']]],
    [15, [['a', 'b'], ['b', 'c']]],
    [30, [['a', 'b'], ['b', 'c'], ['c', 'd']]],
  ])('with %i minutes of turnaround the conflicting pairs are exactly the named ones', (cleanup, expected) => {
    //  a 10:00–11:00 · b 10:30–11:30 (overlaps a by 30) · c 11:40–12:10 (10
    //  minutes after b) · d 12:30–13:00 (20 minutes after c). Each turnaround
    //  setting adds exactly one more pair the room cannot honour.
    const claims: Record<string, OfferInput> = {
      a: offer({ start: 600, end: 660 }),
      b: offer({ start: 630, end: 690 }),
      c: offer({ start: 700, end: 730 }),
      d: offer({ start: 750, end: 780 }),
    }
    const book = buildClaims(truthOf(), [claims.a, claims.b, claims.c, claims.d])
    const pairs = book.violations({ 'bed-01': cleanup }).map((v) => [
      Object.keys(claims).find((k) => claims[k].start === v.earlier.startMin)!,
      Object.keys(claims).find((k) => claims[k].start === v.later.startMin)!,
    ])
    expect(pairs).toEqual(expected)
  })

  it('a room with no turnaround still cannot honour two overlapping promises', () => {
    const book = buildClaims(truthOf(), [offer({ start: 600, end: 660 }), offer({ start: 630, end: 690 })])
    const [v] = book.violations({})
    expect(v.gapMin).toBe(-30)
    expect(v.requiredMin).toBe(0)
  })

  it('each room is judged by its own minutes', () => {
    const book = buildClaims(truthOf(), [
      offer({ resourceKey: 'bed-01', start: 600, end: 660 }),
      offer({ resourceKey: 'bed-01', start: 670, end: 700 }),
      offer({ resourceKey: 'bed-02', start: 600, end: 660 }),
      offer({ resourceKey: 'bed-02', start: 670, end: 700 }),
    ])
    const found = book.violations({ 'bed-01': 30, 'bed-02': 0 })
    expect(found).toHaveLength(1)
    expect(found[0].resourceKey).toBe('bed-01')
    expect(found[0].gapMin).toBe(10)
  })

  it('a room missing from the map is a bare room (0 minutes), by decision', () => {
    const book = buildClaims(truthOf(), [offer({ start: 600, end: 660 }), offer({ start: 670, end: 700 })])
    // 10 minutes apart, no entry for bed-01: 0 is the dial's own OFF value, so
    // these two are not in conflict.
    expect(book.violations({})).toEqual([])
    expect(book.violations({ 'bed-02': 30 })).toEqual([])
    expect(book.violations({ 'bed-01': 30 })).toHaveLength(1)
  })

  it('a turnaround that is not a number of minutes is a caller bug, not a conflict storm', () => {
    const book = buildClaims(truthOf(), [offer({ start: 600, end: 660 }), offer({ start: 670, end: 700 })])
    expect(() => book.violations({ 'bed-01': Number.NaN })).toThrow(/not a number of minutes/)
    expect(() => book.violations({ 'bed-01': Number.POSITIVE_INFINITY })).toThrow(/not a number of minutes/)
  })

  it('an inherited property is not a turnaround', () => {
    // `map['bed-01']` would find Object.prototype.toString and `?? 0` would let
    // the function through — every pair on the room would "conflict".
    const inherited = Object.create({ 'bed-01': 30 }) as Record<string, number>
    const book = buildClaims(truthOf(), [offer({ start: 600, end: 660 }), offer({ start: 670, end: 700 })])
    expect(book.violations(inherited)).toEqual([])
    const proto = buildClaims(truthOf(), [offer({ resourceKey: 'toString', start: 600, end: 660 }), offer({ resourceKey: 'toString', start: 670, end: 700 })])
    expect(proto.violations({})).toEqual([])
  })

  it('freeBedCountNet is the truth minus what has already been advertised', () => {
    const lanes = syntheticBoard({ ...SMALL_6, profile: 'sparse', seed: 5 })
    const truth = truthOn(lanes)
    const span = lattice(60).find((s) => truth.freeBedCount(s, s + 60, HERE) >= 2)!
    const free = truth.freeBedKeys(span, span + 60, HERE)
    const book = buildClaims(truth, [{ resourceKey: free[0], start: span, end: span + 60, kind: 'sell', laneKey: 'p-01' }])
    expect(book.freeBedCountNet(span, span + 60, HERE)).toBe(free.length - 1)
    // A claim on a room that was already busy subtracts nothing.
    const busyKey = lanes.filter((l) => l.group === 'beds').map((l) => l.key).find((k) => !free.includes(k))
    if (busyKey) {
      const other = buildClaims(truth, [{ resourceKey: busyKey, start: span, end: span + 60, kind: 'gap', laneKey: 'p-01' }])
      expect(other.freeBedCountNet(span, span + 60, HERE)).toBe(free.length)
    }
    // A claim that does not overlap the span is not subtracted either.
    const elsewhere = buildClaims(truth, [{ resourceKey: free[0], start: span + 60, end: span + 120, kind: 'sell', laneKey: 'p-01' }])
    expect(elsewhere.freeBedCountNet(span, span + 60, HERE)).toBe(free.length)
  })

  it('StrictMode mutant — building twice on identical inputs is deep-equal', () => {
    const truth = truthOf()
    const offers = [offer(), offer({ laneKey: 'bed-01' }), offer({ start: 700, end: 760, kind: 'gap' })]
    const a = buildClaims(truth, offers)
    const b = buildClaims(truth, offers)
    expect(a.claims).toEqual(b.claims)
    expect(a.claims.length).toBe(b.claims.length)
    expect(a.violations({ 'bed-01': 15 })).toEqual(b.violations({ 'bed-01': 15 }))
    expect(a.freeBedCountNet(600, 660, HERE)).toBe(b.freeBedCountNet(600, 660, HERE))
  })

  it('the input offers are never touched, and the output is frozen', () => {
    const offers = [offer({ start: 700, end: 760 }), offer(), offer({ laneKey: 'bed-01' })]
    const before = JSON.stringify(offers)
    const book = buildClaims(truthOf(), offers)
    book.violations({ 'bed-01': 30 })
    expect(JSON.stringify(offers)).toBe(before)
    expect(Object.isFrozen(book)).toBe(true)
    expect(Object.isFrozen(book.claims)).toBe(true)
    expect(Object.isFrozen(book.claims[0])).toBe(true)
  })
})

// ── 9 · COST ────────────────────────────────────────────────────────────────

describe('9 — the cost of the book, measured rather than asserted in prose', () => {
  it.each([6, 15, 25, 30])('%i staff, sparse: build + one full frame of Phase-1 work', (staff) => {
    const spec: BoardSpec = { ...SPARSE_25, staff, seed: 100 + staff }
    const lanes = syntheticBoard(spec)
    const t0 = performance.now()
    const truth = truthOn(lanes)
    const t1 = performance.now()
    fullPass(truth, lanes)
    const t2 = performance.now()
    PERF.push({ staff, beds: spec.beds, lanes: lanes.length, buildMs: t1 - t0, passMs: t2 - t1, calls: truth.stats.allocateBedCalls })
    // The budget is the call count below, not a wall clock: timings are
    // recorded, never asserted.
    expect(truth.stats.allocateBedCalls).toBe(SLOTS)
  })

  it('a full frame costs one search per lattice slot per store binding, and a second frame costs none', () => {
    for (const spec of [SPARSE_25, TWO_STORE]) {
      const lanes = syntheticBoard(spec)
      const truth = truthOn(lanes)
      fullPass(truth, lanes, 60)
      // Every staff lane in one store asks the SAME question, so they share one
      // row: 25 lanes cost 108 searches, not 25 × 108.
      expect(truth.stats.allocateBedCalls).toBe(distinctBindings(lanes) * SLOTS)
      const after = truth.stats.allocateBedCalls
      fullPass(truth, lanes, 60)
      expect(truth.stats.allocateBedCalls).toBe(after)
      // …including the runs, which read the same rows the masks filled.
      truth.fullRuns(60, ['store-a'])
      truth.newClientMask(staffLanesOf(lanes)[0], 60)
      expect(truth.stats.allocateBedCalls).toBe(after)
    }
  })

  it('a second length is a second row, priced the same', () => {
    const lanes = syntheticBoard(SPARSE_25)
    const truth = truthOn(lanes)
    fullPass(truth, lanes, 60)
    fullPass(truth, lanes, 90)
    expect(truth.stats.allocateBedCalls).toBe(2 * SLOTS)
  })

  /** ⚖ R3 FIX-1 (blind round, 2026-08-25) — PAST THE CEILING THE BOOK DEGRADES,
   *  IT DOES NOT REFUSE.
   *
   *  This used to assert a THROW on the ninth distinct length, which was safe
   *  only while the book was dark. R3 puts `newClientMask` on the render path
   *  and ⚖ flag 50 makes the rail's length follow the gesture, so eight
   *  short-pocket clicks or eight chip lengths on one unmoved board reach the
   *  ninth — during render, with no error boundary under 今日の運営 and no way
   *  back. Caching is a memory ceiling; it may never be a correctness one.
   *
   *  A length ≤ 0 or non-finite still throws, and the difference is the point:
   *  that is a programmer contract (a span with no minutes in it is not a
   *  question), not board traffic. */
  it('past eight distinct lengths the book keeps answering — uncached, never a throw', () => {
    const lanes = syntheticBoard(SMALL_6)
    const truth = truthOn(lanes)
    for (let n = 1; n <= 8; n += 1) truth.fullRuns(n * 5, HERE.stores)
    // The ninth length, and the twentieth: answered, every surface.
    for (let n = 9; n <= 20; n += 1) {
      expect(() => truth.fullRuns(n * 5, HERE.stores)).not.toThrow()
    }
    const ninth = 9 * 5
    expect(() => truth.newClientMask(staffLanesOf(lanes)[0], ninth)).not.toThrow()
    expect(() => truth.bedFor(OPEN, OPEN + ninth, HERE)).not.toThrow()
    expect(() => truth.freeBedKeys(OPEN, OPEN + ninth, HERE)).not.toThrow()

    // …and the answers past the ceiling are the SAME answers. Uncached is a
    // cost, never a different reading of the board: every lattice start of the
    // ninth length is checked against the allocator directly.
    const lane = staffLanesOf(lanes)[0]
    const mask = truth.newClientMask(lane, ninth)
    for (let start = OPEN; start + ninth <= CLOSE; start += LATTICE_STEP_MIN) {
      const direct = allocateBed(lanes, {
        id: null, currentBed: null, stores: lane.stores, vip: false,
        start, end: start + ninth, policy: POLICY,
      })
      expect([start, mask(start)]).toEqual([start, direct.laneKey !== null])
      expect([start, truth.bedFor(start, start + ninth, { stores: lane.stores }).laneKey])
        .toEqual([start, direct.laneKey])
    }
    // The rows already minted keep serving — degrading is not forgetting.
    const before = truth.stats.allocateBedCalls
    truth.fullRuns(5, HERE.stores)
    expect(truth.stats.allocateBedCalls).toBe(before)

    // A length that is not a length is still the caller's bug.
    expect(() => truth.fullRuns(0, HERE.stores)).toThrow(/positive number of minutes/)
    expect(() => truth.fullRuns(Number.NaN, HERE.stores)).toThrow(/positive number of minutes/)
  })

  const heapIt = typeof (global as unknown as { gc?: () => void }).gc === 'function' ? it : it.skip
  heapIt('60 consecutive builds at 25 staff retain nothing (needs --expose-gc; skipped without it)', () => {
    const lanes = syntheticBoard(SPARSE_25)
    const gc = (global as unknown as { gc: () => void }).gc
    gc()
    const before = process.memoryUsage().heapUsed
    for (let n = 0; n < 60; n += 1) fullPass(truthOn(lanes), lanes)
    gc()
    const growth = process.memoryUsage().heapUsed - before
    PERF.push({ staff: -60, beds: 10, lanes: lanes.length, buildMs: 0, passMs: 0, calls: Math.round(growth / 1024) })
    expect(growth).toBeLessThan(1024 * 1024)
  })

  afterAll(() => {
    const rows = PERF.filter((r) => r.staff > 0)
    if (rows.length === 0) return
    const heap = PERF.find((r) => r.staff === -60)
    console.log(
      ['', 'PERF-TABLE-r1 (sparse profile, 10 beds, 540-minute day, 108 lattice slots)', 'staff | lanes | build ms | full pass ms | allocateBed calls']
        .concat(rows.map((r) => `${r.staff} | ${r.lanes} | ${r.buildMs.toFixed(3)} | ${r.passMs.toFixed(2)} | ${r.calls}`))
        .concat(heap ? [`60 builds @25 staff heap growth: ${heap.calls} KB (global.gc available)`] : ['60 builds @25 staff heap: NOT MEASURED (no global.gc — the pin is skipped, never passed)'])
        .join('\n'),
    )
  })
})

// ── 10 · DETERMINISM ────────────────────────────────────────────────────────

describe('10 — the same seed is the same day, every time', () => {
  it('the fixture board is byte-identical across builds', () => {
    expect(JSON.stringify(syntheticBoard(DENSE_25))).toBe(JSON.stringify(syntheticBoard(DENSE_25)))
    expect(JSON.stringify(syntheticBoard(SPARSE_25))).not.toBe(JSON.stringify(syntheticBoard(DENSE_25)))
  })

  it('the fixture is the board the program says it is', () => {
    const lanes = syntheticBoard(SPARSE_25)
    expect(staffLanesOf(lanes)).toHaveLength(25)
    expect(lanes.filter((l) => l.group === 'beds')).toHaveLength(10)
    expect(lanes.filter((l) => l.roomClass === 'private')).toHaveLength(1)
    expect(SLOTS).toBe(108)
    const sparse = syntheticBookings(SPARSE_25).length
    const dense = syntheticBookings(DENSE_25).length
    expect(sparse).toBeGreaterThan(25)
    expect(dense).toBeGreaterThan(sparse)
    // No impossible states: nobody is in two places and no room holds two people.
    for (const key of ['staffKey', 'bedKey'] as const) {
      const all = syntheticBookings(DENSE_25)
      for (const b of all) {
        expect(all.filter((o) => o !== b && o[key] === b[key] && overlaps(o, b))).toEqual([])
      }
    }
  })

  it('every answer the book gives is the same on a rebuild', () => {
    const one = truthOn(syntheticBoard(DENSE_25))
    const two = truthOn(syntheticBoard(DENSE_25))
    const readOut = (t: BedTruth) => ({
      answers: lattice(60).map((s) => t.bedFor(s, s + 60, HERE)),
      free: lattice(60).map((s) => t.freeBedKeys(s, s + 60, HERE)),
      runs: t.fullRuns(60, HERE.stores),
      mask: lattice().map((s) => t.newClientMask(staffLanesOf(syntheticBoard(DENSE_25))[3], 60)(s)),
    })
    expect(readOut(one)).toEqual(readOut(two))
  })
})

// ── 11 · THE FRAME, THE DOOR, THE LATTICE ───────────────────────────────────

describe('11 — what the book refuses, and what it exports', () => {
  const lanes = () => syntheticBoard(SMALL_6)

  /** A store that opens at 10:03. Small on purpose: these pins walk every
   *  minute of the day twice. */
  const ODD_FRAME = { openMin: 603, closeMin: 663, nowMin: 610 }
  const EVEN_FRAME = { openMin: 605, closeMin: 663, nowMin: 610 }
  /** The grid the frozen engine walks, computed here from the clock rather than
   *  from the store: every whole five-minute cell inside the day, starting at
   *  the first absolute slot at or after the door. */
  const absoluteGrid = (frame: { openMin: number; closeMin: number }) => {
    const out: number[] = []
    for (let m = Math.ceil(frame.openMin / LATTICE_STEP_MIN) * LATTICE_STEP_MIN; m + LATTICE_STEP_MIN <= frame.closeMin; m += LATTICE_STEP_MIN) out.push(m)
    return out
  }
  /** Which minutes this book REMEMBERS: ask twice, and a cached minute is the
   *  one whose second ask costs no search. */
  const cachedMinutes = (frame: { openMin: number; closeMin: number; nowMin: number }, board: BoardLane[]) => {
    const truth = truthOn(board, frame)
    const out: number[] = []
    for (let m = frame.openMin; m < frame.closeMin; m += 1) {
      truth.bedFor(m, m + 30, HERE)
      const before = truth.stats.allocateBedCalls
      truth.bedFor(m, m + 30, HERE)
      if (truth.stats.allocateBedCalls === before) out.push(m)
    }
    return out
  }

  it('a store that opens at 10:03 builds, and answers exactly what a naive book answers', () => {
    // An opening time is not a caller error — the operating-hours contract
    // allows any minute, so refusing to build would be the wrong failure
    // direction (the same class as the old store-binding throw).
    const board = lanes()
    expect(() => truthOn(board, ODD_FRAME)).not.toThrow()
    const truth = truthOn(board, ODD_FRAME)
    const naive = truthOn(board, ODD_FRAME)
    for (let m = ODD_FRAME.openMin; m + 30 <= ODD_FRAME.closeMin; m += 1) {
      expect(truth.bedFor(m, m + 30, HERE)).toEqual(naive.bedFor(m, m + 30, HERE))
      expect(truth.freeBedKeys(m, m + 30, HERE)).toEqual(naive.freeBedKeys(m, m + 30, HERE))
    }
  })

  it('the lattice is anchored to the CLOCK, so it is a subset of the engine’s own grid', () => {
    // The frozen engine walks `Math.ceil(pocket.s / 5) * 5` (gap-guard.ts:195
    // and :276) — absolute minutes, not store-relative ones. A book anchored at
    // the door would sit on a different grid for a 10:03 store and miss every
    // engine probe. Anchored this way, every minute the book remembers is one
    // the engine can actually ask about.
    const remembered = cachedMinutes(ODD_FRAME, lanes())
    expect(remembered.length).toBeGreaterThan(0)
    for (const m of remembered) {
      expect(m % LATTICE_STEP_MIN).toBe(0)
      expect(m).toBeGreaterThanOrEqual(ODD_FRAME.openMin)
    }
    // …and it remembers ALL of them, not just some: every whole five-minute
    // cell that fits inside the day, starting at the first absolute slot at or
    // after the door.
    expect(remembered).toEqual(absoluteGrid(ODD_FRAME))
    // fullRuns walks the same grid, so its start minutes are absolute too.
    for (const run of truthOn(lanes(), ODD_FRAME).fullRuns(30, HERE.stores)) {
      expect(run.startMin % LATTICE_STEP_MIN).toBe(0)
      expect(run.endMin % LATTICE_STEP_MIN).toBe(0)
    }
  })

  it('the sliver between the door and the first slot is answered live, and answered right', () => {
    const board = lanes()
    const truth = truthOn(board, ODD_FRAME)
    const naive = truthOn(board, ODD_FRAME)
    for (const m of [603, 604]) {
      expect(truth.bedFor(m, m + 30, HERE)).toEqual(naive.bedFor(m, m + 30, HERE))
      // Not remembered — the fallback path, same one every off-lattice question
      // already used.
      truth.bedFor(m, m + 30, HERE)
      const before = truth.stats.allocateBedCalls
      truth.bedFor(m, m + 30, HERE)
      expect(truth.stats.allocateBedCalls).toBeGreaterThan(before)
    }
  })

  it('a store already on the grid is unchanged: the first slot IS the opening minute', () => {
    const remembered = cachedMinutes(EVEN_FRAME, lanes())
    expect(remembered[0]).toBe(EVEN_FRAME.openMin)
    expect(remembered).toEqual(absoluteGrid(EVEN_FRAME))
    // And the fixture every other pin runs on opens on the grid, so none of
    // them moved: 09:00 is slot zero, and the day is still 108 slots.
    expect(absoluteGrid(FRAME)).toHaveLength(SLOTS)
    expect(absoluteGrid(FRAME)[0]).toBe(OPEN)
  })

  it('a day that closes before it opens, or a frame that is not minutes, is refused', () => {
    expect(() => truthOn(lanes(), { ...FRAME, closeMin: OPEN - 60 })).toThrow(/closes before/)
    expect(() => truthOn(lanes(), { ...FRAME, nowMin: Number.NaN })).toThrow(/three real minutes/)
    expect(() => truthOn(lanes(), { ...FRAME, closeMin: Number.POSITIVE_INFINITY })).toThrow(/three real minutes/)
  })

  it('mutating the frame after the build changes nothing, and truth.frame is frozen', () => {
    const mutable = { openMin: OPEN, closeMin: CLOSE, nowMin: 600 }
    const board = lanes()
    const truth = truthOn(board, mutable)
    const before = lattice(60).map((s) => truth.bedFor(s, s + 60, HERE))
    const runsBefore = truth.fullRuns(60, HERE.stores)
    mutable.openMin = OPEN + 300
    mutable.closeMin = OPEN + 400
    mutable.nowMin = 0
    expect(lattice(60).map((s) => truth.bedFor(s, s + 60, HERE))).toEqual(before)
    expect(truth.fullRuns(60, HERE.stores)).toEqual(runsBefore)
    expect(truth.frame).toEqual({ openMin: OPEN, closeMin: CLOSE, nowMin: 600 })
    expect(Object.isFrozen(truth.frame)).toBe(true)
  })

  it('the module’s door is exactly two functions and one constant', () => {
    const doors = Object.keys(ledger).filter((k) => k !== '__esModule').sort()
    expect(doors).toEqual(['LATTICE_STEP_MIN', 'bedTruthViews', 'buildClaims'])
    // The world-builders are NOT among them: exported, either one would be the
    // free exclusion that produced the three-world board.
    expect((ledger as Record<string, unknown>).buildBedTruth).toBeUndefined()
    expect((ledger as Record<string, unknown>).excludedWorld).toBeUndefined()
  })

  it('the lattice step still matches the frozen engine’s own', () => {
    // The constant is re-declared rather than imported (it is module-private
    // inside a frozen file). This is what keeps the duplicate honest.
    const engine = readFileSync(join(process.cwd(), 'src/business/lib/canon-logic/gap-guard.ts'), 'utf8')
    expect(engine).toContain(`const LATTICE_STEP_MIN = ${LATTICE_STEP_MIN}`)
  })
})
