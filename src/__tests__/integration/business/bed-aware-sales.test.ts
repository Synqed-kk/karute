// THE BED-AWARE SALES LAYER — the sellability test's own suite (round 2, 2026-09-13).
//
// The module answers one question — 「may this priced offer go on sale, once the
// kept 新規用 枠 have their beds?」 — so this file asks it against the demo
// fixture's own room table (PIN-R2 §1's board dump, box for box), against the
// comparator the spec REJECTS, against the two lazy exits, against a one-bed
// store, and against the property the whole v3 amendment rests on: the answer
// may not depend on WHICH bed the netting happened to give a 枠.
//
// The book is a STUB here on purpose, exactly as `honest-held.test.ts` says:
// `freeBedKeys` is the only question the layer asks, `capacity-ledger.ts` has its
// own suite for how that answer is produced, and a real book would make these
// cases about the fixture rather than about the test.

import {
  offerKey,
  withheldOffers,
  type OfferAsk,
} from '@/app/[locale]/(business)/business/today/bed-aware-sales'
import type { BedTruth } from '@/app/[locale]/(business)/business/today/capacity-ledger'
import { honestHeld } from '@/app/[locale]/(business)/business/today/honest-held'
import type { ReservedLaneMask, ReservedSpan } from '@/app/[locale]/(business)/business/today/reserved-mask'
import type { BoardLane } from '@/business/lib/today-board'

const span = (start: number, end: number): ReservedSpan => ({ start, end, windowStart: start })
const maskOf = (laneKey: string, spans: ReservedSpan[]): ReservedLaneMask => ({ laneKey, spans, protectedCount: spans.length })
const lane = (key: string, stores: string[] | null = null) => ({ key, label: key, group: 'staff', stores } as unknown as BoardLane)

/** A book that answers `freeBedKeys` out of a table, counts every ask, and
 *  refuses every other question — the layer may not quietly grow a second one. */
function stubBook(rooms: (start: number, end: number) => readonly string[]) {
  const no = (q: string) => () => { throw new Error(`bed-aware-sales asked the book ${q}, which it may not`) }
  const asks: string[] = []
  const book: BedTruth = {
    frame: { openMin: 600, closeMin: 1140, nowMin: 600 },
    stats: { allocateBedCalls: 0, storeBindings: 0 },
    freeBedKeys: (start, end) => { asks.push(`${start}-${end}`); return rooms(start, end) },
    bedFor: no('bedFor') as BedTruth['bedFor'],
    freeBedCount: no('freeBedCount') as BedTruth['freeBedCount'],
    fullRuns: no('fullRuns') as BedTruth['fullRuns'],
    newClientMask: no('newClientMask') as BedTruth['newClientMask'],
  }
  return { book, asks }
}

// ── THE DEMO FIXTURE, read off PIN-R2 §1's board dump ───────────────────────
// The kept 枠 and the five priced boxes the board draws, each with the rooms the
// real book answered for it on origin/main `0d57b1cca`. INPUT, never an
// expectation: if the layer reads them differently the sets below move and the
// test says so.
const KEPT: Array<[string, number, number, string[]]> = [
  ['c-03', 1050, 1140, ['bed-01', 'bed-03']],
  ['p-04', 945, 1035, ['bed-01']],
  ['p-05', 870, 960, ['bed-02']],
  ['p-06', 905, 995, ['bed-02']],
]
const OFFERS: Array<[string, number, number, string[]]> = [
  ['p-05', 810, 845, ['bed-01', 'bed-03']],
  ['c-03', 870, 900, ['bed-02']],
  ['p-05', 960, 1020, ['bed-01', 'bed-02']],
  ['p-06', 995, 1032, ['bed-01', 'bed-02', 'bed-03']],
  ['p-06', 1092, 1140, ['bed-01', 'bed-02', 'bed-03']],
]

const askOf = ([laneKey, start, end]: [string, number, number, string[]]): OfferAsk =>
  ({ key: offerKey(laneKey, start), laneKey, start, end, stores: null })

const tableBook = (rows: Array<[string, number, number, string[]]>, reversed = false) =>
  stubBook((start, end) => {
    const hit = rows.find(([, s, e]) => s === start && e === end)
    const got = hit ? hit[3] : []
    return reversed ? [...got].reverse() : got
  })

const fixture = (reversed = false) => {
  const { book, asks } = tableBook([...KEPT, ...OFFERS], reversed)
  const candidates = KEPT.map(([k, s, e]) => maskOf(k, [span(s, e)]))
  const lanes = [...new Set([...KEPT, ...OFFERS].map(([k]) => k))].map((k) => lane(k))
  const honest = honestHeld(candidates, lanes, book, true)
  return { book, asks, candidates, lanes, honest, offers: OFFERS.map(askOf) }
}

const setOf = (w: { keys: ReadonlySet<string> }) => [...w.keys].sort()

describe('bed-aware-sales — the demo fixture', () => {
  it('withholds exactly the 詰め込み at c-03 14:30, and names ごろう as the 枠 that is 先', () => {
    const f = fixture()
    // the stage is the board PIN-R2 dumped: three 枠 held, あずさ's shared.
    expect(f.honest.total).toBe(3)
    const w = withheldOffers(f.offers, f.honest, f.candidates, f.lanes, f.book, true)
    console.log('withheld (i′) =', setOf(w), 'blockedBy =', [...w.blockedBy])
    expect(setOf(w)).toEqual([offerKey('c-03', 870)])
    expect(w.blockedBy.get(offerKey('c-03', 870))).toBe('p-05')
  })

  it('is NOT the drawn-bed comparator the spec rejects — あずさ’s two スキマ枠 stay on sale', () => {
    const f = fixture()
    const w = withheldOffers(f.offers, f.honest, f.candidates, f.lanes, f.book, true)
    // Test (ii) asks 「does the offer's DRAWN bed collide with a kept 枠's
    // ASSIGNED bed?」 and, on this board, withholds these two as well
    // (PIN-R2 §2's own oracle run: `{c-03|870, p-06|995, p-06|1092}`). Both have
    // three free rooms and every kept 枠 still lands, so (i′) sells them — the
    // difference is a tie-break's chosen bed, which is not a promise.
    for (const k of [offerKey('p-06', 995), offerKey('p-06', 1092)]) expect(w.keys.has(k)).toBe(false)
  })

  it('MUTANT (o) — weakened back to count-preservation, the filler goes back on sale', () => {
    const f = fixture()
    // The count-only verdict, computed here the way the mutant would: some room
    // whose netting returns the same TOTAL. It empties the set on this board,
    // which is exactly why the module compares 枠 by identity.
    const countOnly = f.offers.filter((o) => {
      const rooms = f.book.freeBedKeys(o.start, o.end, { stores: o.stores })
      if (rooms.length === 0) return false
      return !rooms.some((r) => {
        const after = honestHeld(f.candidates, f.lanes, blockedFor(f.book, r, o.start, o.end), true)
        return after.total >= f.honest.total
      })
    })
    expect(countOnly).toEqual([])
    expect(setOf(withheldOffers(f.offers, f.honest, f.candidates, f.lanes, f.book, true))).not.toEqual([])
  })

  it('the answer does not depend on candidate order or on the book’s room order', () => {
    const base = fixture()
    const want = setOf(withheldOffers(base.offers, base.honest, base.candidates, base.lanes, base.book, true))
    // (1) the candidates permuted — the netting sorts them itself, so the set
    //     may not move.
    const p = fixture()
    const permuted = [...p.candidates].reverse()
    const honestP = honestHeld(permuted, p.lanes, p.book, true)
    expect(setOf(withheldOffers(p.offers, honestP, permuted, p.lanes, p.book, true))).toEqual(want)
    // (2) the tie-break's own input flipped — the book hands its rooms back in
    //     the opposite order, so a different equal-size assignment is reachable.
    const r = fixture(true)
    expect(setOf(withheldOffers(r.offers, r.honest, r.candidates, r.lanes, r.book, true))).toEqual(want)
  })
})

/** The module's own `blocked`, re-spelled here so the count-only oracle above is
 *  independent of it. */
const blockedFor = (book: BedTruth, room: string, start: number, end: number): BedTruth =>
  Object.create(book, {
    freeBedKeys: {
      value: (s: number, e: number, asker: never) =>
        (s < end && start < e ? book.freeBedKeys(s, e, asker).filter((k) => k !== room) : book.freeBedKeys(s, e, asker)),
    },
  }) as BedTruth

describe('bed-aware-sales — the doors', () => {
  it('the gate off and an absent netting both give the SAME frozen empty answer', () => {
    const f = fixture()
    const off = withheldOffers(f.offers, f.honest, f.candidates, f.lanes, f.book, false)
    const blind = withheldOffers(f.offers, undefined, f.candidates, f.lanes, f.book, true)
    expect(off.keys.size).toBe(0)
    // identity, not merely emptiness: the screen's 「the same object when nothing
    // is withheld」 rides on it.
    expect(blind).toBe(off)
    expect(withheldOffers([], f.honest, f.candidates, f.lanes, f.book, true)).toBe(off)
  })

  it('an offer with no free room is never withheld — we only ever subtract', () => {
    const f = fixture()
    // 10:00–10:30 is not in the room table at all, so the book answers 「no room」.
    const roomless: OfferAsk = { key: offerKey('p-09', 600), laneKey: 'p-09', start: 600, end: 630, stores: null }
    const w = withheldOffers([roomless], f.honest, f.candidates, f.lanes, f.book, true)
    expect(w.keys.has(roomless.key)).toBe(false)
  })

  it('an offer over no kept 枠 costs ZERO nettings', () => {
    const f = fixture()
    const before = f.asks.length
    withheldOffers([askOf(OFFERS[0])], f.honest, f.candidates, f.lanes, f.book, true)
    // One ask — the offer's own rooms — and then the lazy exit. A netting would
    // ask the book once per candidate.
    expect(f.asks.slice(before)).toEqual(['810-845'])
  })

  // ⚖ ROUND 2 · SPEC-R2 v4 amendment item 1 — THE WITNESS EXIT.
  it('…and a free room no overlapping 枠 was GIVEN costs zero nettings (the witness)', () => {
    const f = fixture()
    const before = f.asks.length
    // p-06 18:12–19:00 has three free rooms; the only held 枠 over it is c-03,
    // and the netting gave c-03 bed-01. bed-02 is therefore free under the
    // netting's OWN assignment, which is a legal witness — so the answer is
    // 「on sale」 with no netting at all: ONE ask, for the offer's own rooms.
    withheldOffers([askOf(OFFERS[4])], f.honest, f.candidates, f.lanes, f.book, true)
    expect(f.asks.slice(before)).toEqual(['1092-1140'])
  })

  it('a SATURATED offer — every free room in use by an overlapping 枠 — pays |rooms| nettings', () => {
    // x can only use bed-01, y only bed-02, and the offer could take either, so
    // the netting's assignment leaves the offer no witness. Both rooms are then
    // netted: |rooms| × (1 ask per candidate), plus the one ask for the rooms.
    const rows: Array<[string, number, number, string[]]> = [
      ['x', 600, 690, ['bed-01']],
      ['y', 605, 695, ['bed-02']],
      ['z', 610, 650, ['bed-01', 'bed-02']],
    ]
    const { book, asks } = tableBook(rows)
    const candidates = rows.slice(0, 2).map(([k, s, e]) => maskOf(k, [span(s, e)]))
    const lanes = ['x', 'y', 'z'].map((k) => lane(k))
    const honest = honestHeld(candidates, lanes, book, true)
    expect(honest.total).toBe(2)
    const offer = askOf(rows[2])
    const rooms = book.freeBedKeys(offer.start, offer.end, { stores: null })
    const before = asks.length
    const w = withheldOffers([offer], honest, candidates, lanes, book, true)
    const nettings = (asks.length - before - 1) / candidates.length
    console.log('saturated: rooms =', rooms, 'nettings =', nettings)
    expect({ withheld: setOf(w), nettings }).toEqual({ withheld: [offer.key], nettings: rooms.length })
  })
})

describe('bed-aware-sales — the one-bed store', () => {
  // Three staff rows, ONE room. Every kept 枠 owns the only bed for its span, so
  // every offer over one is withheld and the day's stock is the hours outside.
  const ONE_KEPT: Array<[string, number, number, string[]]> = [
    ['a', 600, 660, ['bed-01']],
    ['b', 700, 760, ['bed-01']],
  ]
  const ONE_OFFERS: Array<[string, number, number, string[]]> = [
    ['c', 630, 690, ['bed-01']],
    ['c', 800, 860, ['bed-01']],
  ]

  it('withholds every offer over a kept 枠 and leaves the rest alone', () => {
    const { book } = tableBook([...ONE_KEPT, ...ONE_OFFERS])
    const candidates = ONE_KEPT.map(([k, s, e]) => maskOf(k, [span(s, e)]))
    const lanes = ['a', 'b', 'c'].map((k) => lane(k))
    const honest = honestHeld(candidates, lanes, book, true)
    expect(honest.total).toBe(ONE_KEPT.length)
    const w = withheldOffers(ONE_OFFERS.map(askOf), honest, candidates, lanes, book, true)
    // The first offer overlaps both kept 枠 (630–690 covers a's tail and nothing
    // of b); the second overlaps neither.
    expect(setOf(w)).toEqual([offerKey('c', 630)])
    expect(w.blockedBy.get(offerKey('c', 630))).toBe('a')
  })

  it('…and when the kept 枠 are released the offers come back through the SAME test', () => {
    const { book } = tableBook([...ONE_KEPT, ...ONE_OFFERS])
    const lanes = ['a', 'b', 'c'].map((k) => lane(k))
    const none = honestHeld([], lanes, book, true)
    expect(setOf(withheldOffers(ONE_OFFERS.map(askOf), none, [], lanes, book, true))).toEqual([])
  })
})

describe('bed-aware-sales — whose 枠 the box may name', () => {
  it('no name when two different rooms cost two different 枠', () => {
    // `x` can only use bed-01, `y` only bed-02; the offer could take either, and
    // whichever it takes a DIFFERENT 枠 is the one that loses. No single 枠 is
    // 先, so the box says so rather than picking one.
    const rows: Array<[string, number, number, string[]]> = [
      ['x', 600, 660, ['bed-01']],
      ['y', 605, 665, ['bed-02']],
      ['z', 610, 650, ['bed-01', 'bed-02']],
    ]
    const { book } = tableBook(rows)
    const candidates = rows.slice(0, 2).map(([k, s, e]) => maskOf(k, [span(s, e)]))
    const lanes = ['x', 'y', 'z'].map((k) => lane(k))
    const honest = honestHeld(candidates, lanes, book, true)
    expect(honest.total).toBe(2)
    const offer = askOf(rows[2])
    const w = withheldOffers([offer], honest, candidates, lanes, book, true)
    expect(setOf(w)).toEqual([offer.key])
    expect(w.blockedBy.has(offer.key)).toBe(false)
  })
})

// ⚖ ROUND 2 · SPEC-R2 v4 amendment item 1 — THE CLAIM THE WITNESS EXIT RESTS ON,
// MADE EXECUTABLE. The exit reads `heldRoom`, which is a TIE-BREAK, and the whole
// v3 amendment exists because a money decision may not hang off a tie-break. So
// the claim is that the exit changes only the COST and never the answer: it can
// prove 「on sale」 early (a legal assignment exists) and it never decides
// 「withheld」. This loop is that claim on 500 random boards against a reference
// with no exits at all — the pin harness's own oracle shape, re-spelled here so
// it shares no code with the module.
describe('bed-aware-sales — the witness exit changes the cost, never the answer', () => {
  /** One 32-bit mixer, so a seed is a board and the board is the same every run. */
  const mix = (...xs: number[]) => {
    let h = 0x9e3779b9
    for (const x of xs) {
      h = (h ^ Math.imul(x + 0x85ebca6b, 0xcc9e2d51)) >>> 0
      h = (Math.imul(h << 13 | h >>> 19, 0x1b873593) + 0xe6546b64) >>> 0
    }
    return h >>> 0
  }

  /** THE REFERENCE: test (i′) with every lazy exit removed — every room of every
   *  overlapping offer is netted, and the verdict is read off the results. */
  const referenceWithheld = (
    offers: readonly OfferAsk[],
    honest: ReturnType<typeof honestHeld>,
    candidates: ReservedLaneMask[],
    lanes: BoardLane[],
    book: BedTruth,
  ): string[] => {
    const idsOf = (h: ReturnType<typeof honestHeld>) => h.byLane.flatMap((l) => l.held.map((s) => offerKey(l.laneKey, s.windowStart)))
    const want = idsOf(honest)
    const out: string[] = []
    for (const o of offers) {
      const rooms = book.freeBedKeys(o.start, o.end, { stores: o.stores })
      if (rooms.length === 0) continue
      const tries = rooms.map((r) => {
        const after = new Set(idsOf(honestHeld(candidates, lanes, blockedFor(book, r, o.start, o.end), true)))
        return want.every((k) => after.has(k))
      })
      if (!tries.some(Boolean)) out.push(o.key)
    }
    return out.sort()
  }

  /** A board that is a pure function of its seed: R rooms, N kept 枠 of the
   *  store's one protected length, M offers, and a book whose free-room answer
   *  is a deterministic subset of the rooms for any span it is asked about. */
  const board = (seed: number) => {
    const R = 1 + (mix(seed, 1) % 4)
    const rooms = Array.from({ length: R }, (_, i) => `bed-${String(i + 1).padStart(2, '0')}`)
    const N = 1 + (mix(seed, 2) % 5)
    const M = 1 + (mix(seed, 3) % 4)
    const kept: Array<[string, number, number]> = Array.from({ length: N }, (_, i) => {
      const s = 600 + (mix(seed, 10 + i) % 10) * 15
      return [`k${i}`, s, s + 90]
    })
    const offers: OfferAsk[] = Array.from({ length: M }, (_, j) => {
      const s = 600 + (mix(seed, 40 + j) % 12) * 15
      const len = mix(seed, 70 + j) % 2 === 0 ? 30 : 60
      return { key: offerKey(`o${j}`, s), laneKey: `o${j}`, start: s, end: s + len, stores: null }
    })
    // Deterministic, span-keyed, and never the empty set for every span at once:
    // a room is free for a span unless the mixer says otherwise.
    const book = stubBook((start, end) => rooms.filter((r) => mix(seed, start, end, r.charCodeAt(r.length - 1)) % 3 !== 0)).book
    const candidates = kept.map(([k, s, e]) => maskOf(k, [span(s, e)]))
    const lanes = [...kept.map(([k]) => lane(k)), ...offers.map((o) => lane(o.laneKey))]
    return { rooms, kept, offers, book, candidates, lanes }
  }

  it('≡ an exit-less reference on 500 random boards', () => {
    const fails: string[] = []
    let saturated = 0
    for (let seed = 0; seed < 500; seed += 1) {
      const b = board(seed)
      const honest = honestHeld(b.candidates, b.lanes, b.book, true)
      // The equivalence argument assumes the netting FINISHED (see the module's
      // own ceiling note); these boards are far inside the node budget and the
      // assertion says so rather than assuming it.
      if (!honest.exact) { fails.push(`seed ${seed} — the netting was not exact, so the board is not a fair comparison`); continue }
      const got = setOf(withheldOffers(b.offers, honest, b.candidates, b.lanes, b.book, true))
      const want = referenceWithheld(b.offers, honest, b.candidates, b.lanes, b.book)
      if (got.length) saturated += 1
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        fails.push(`seed ${seed} (${b.rooms.length} rooms · ${b.kept.length} 枠 · ${b.offers.length} offers) — module ${JSON.stringify(got)} · reference ${JSON.stringify(want)}`)
      }
    }
    console.log(`witness-exit equivalence: 500 boards, ${saturated} of them withheld something; disagreements = ${fails.length}`)
    expect(fails).toEqual([])
    // …and the loop is worth running: some boards really do withhold, so an
    // 「always empty」 module would not pass by accident.
    expect(saturated).toBeGreaterThan(0)
  })
})
