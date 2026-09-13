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
const lane = (key: string, stores: string[] | null = null, group = 'staff') => ({ key, label: key, group, stores } as unknown as BoardLane)
/** ⚖ ROUND 2 · v5 — the board's BED rows. `withheldOffers` counts them for the
 *  pigeonhole exit (the one room universe); every board above draws none, which is
 *  exactly why those legs are unmoved by this round. */
const bedRows = (...keys: string[]) => keys.map((k) => lane(k, null, 'beds'))

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

  // ⚖ ROUND 2 · SPEC-R2 v5 amendment item 3 — THE PIGEONHOLE EXIT.
  it('…and a SATURATED board pays ZERO nettings once the rooms are counted (the pigeonhole)', () => {
    // The same shape as the leg above, now with the board's two BED rows present.
    // x holds bed-01 and y bed-02 over one overlapping stretch and the offer sits
    // inside it, so at 10:10 BOTH rooms on the board are spoken for. No room the
    // offer could take survives — provable by counting, without a single netting.
    const rows: Array<[string, number, number, string[]]> = [
      ['x', 600, 690, ['bed-01']],
      ['y', 605, 695, ['bed-02']],
      ['z', 610, 650, ['bed-01', 'bed-02']],
    ]
    const { book, asks } = tableBook(rows)
    const candidates = rows.slice(0, 2).map(([k, s, e]) => maskOf(k, [span(s, e)]))
    const lanes = [...['x', 'y', 'z'].map((k) => lane(k)), ...bedRows('bed-01', 'bed-02')]
    const roomUniverse = lanes.filter((l) => l.group === 'beds').length
    const honest = honestHeld(candidates, lanes, book, true)
    // SATURATION, derived rather than asserted by hand: the netting holds one 枠
    // per room, and every one of them overlaps the offer.
    expect(honest.total).toBe(roomUniverse)
    const offer = askOf(rows[2])
    const before = asks.length
    const w = withheldOffers([offer], honest, candidates, lanes, book, true)
    const nettings = (asks.length - before - 1) / candidates.length
    console.log('pigeonhole: rooms on the board =', roomUniverse, 'held =', honest.total, 'nettings =', nettings)
    expect({ withheld: setOf(w), nettings }).toEqual({ withheld: [offer.key], nettings: 0 })
    // …and NO name: two rooms on the board, so the loss lists were never computed
    // and nothing is provably the one 枠 that is 先 (v5 amendment item 4).
    expect(w.blockedBy.has(offer.key)).toBe(false)
  })

  // ⚖ ROUND 2 · SPEC-R2 v5 amendment item 2 — THE MEMO.
  it('a lattice of offers over the same spans pays ONE netting per (room, span)', () => {
    // THREE bed rows, so the pigeonhole cannot fire: two held 枠 never fill three
    // rooms. x owns bed-01 and y bed-02 across the whole stretch, and the offers
    // may only ever use those two, so there is no witness either and EVERY offer
    // reaches the search. Three staff rows draw the same two spans.
    const OFFER_SPANS: Array<[number, number]> = [[610, 640], [650, 680]]
    const OFFER_ROOMS = ['bed-01', 'bed-02']
    const OFFER_LANES = ['s1', 's2', 's3']
    const rows: Array<[string, number, number, string[]]> = [
      ['x', 600, 780, ['bed-01']],
      ['y', 605, 785, ['bed-02']],
      ...OFFER_SPANS.map(([s, e]) => ['offers', s, e, OFFER_ROOMS] as [string, number, number, string[]]),
    ]
    const { book, asks } = tableBook(rows)
    const candidates = rows.slice(0, 2).map(([k, s, e]) => maskOf(k, [span(s, e)]))
    const lanes = [...['x', 'y', ...OFFER_LANES].map((k) => lane(k)), ...bedRows('bed-01', 'bed-02', 'bed-03')]
    const honest = honestHeld(candidates, lanes, book, true)
    expect(honest.total).toBe(candidates.length)
    const offers: OfferAsk[] = OFFER_LANES.flatMap((k) =>
      OFFER_SPANS.map(([s, e]) => ({ key: offerKey(k, s), laneKey: k, start: s, end: e, stores: null })))
    const before = asks.length
    const w = withheldOffers(offers, honest, candidates, lanes, book, true)
    const nettings = (asks.length - before - offers.length) / candidates.length
    // BOTH numbers derived from the board: the memo's promise is one netting per
    // distinct (room, span), and without it every offer would pay for its own.
    const distinct = new Set(offers.flatMap((o) => OFFER_ROOMS.map((r) => `${r}|${o.start}|${o.end}`))).size
    const unmemoised = offers.length * OFFER_ROOMS.length
    console.log('memo:', offers.length, 'offers ·', distinct, 'distinct room×span · nettings =', nettings, '(un-memoised:', unmemoised, ')')
    expect({ nettings, withheld: setOf(w).length }).toEqual({ nettings: distinct, withheld: offers.length })
    expect(nettings).toBeLessThan(unmemoised)
  })

  // ⚖ ROUND 2 · SPEC-R2 v5 amendment item 2 — AND THE MEMO KEY CARRIES THE END.
  it('…and two offers that START together but end apart do NOT share one answer', () => {
    // u and w overlap each other and may each use bed-01 or bed-03, so the netting
    // holds both; THREE bed rows, so the pigeonhole cannot fire. Both offers may
    // only use bed-01 and both are overlapped by a 枠 sitting in it, so neither has
    // a witness and both reach the search.
    //
    // The SHORT offer is on sale: block bed-01 across 10:10–10:40 and u steps into
    // bed-03 while w — which starts at 10:50, after it — keeps bed-01. The LONG one
    // is withheld: blocked across 10:10–11:40 it takes bed-01 from BOTH, and two
    // overlapping 枠 cannot share bed-03. Same room, same start, opposite answers —
    // which is only true if the span's END is part of the question.
    const rows: Array<[string, number, number, string[]]> = [
      ['u', 600, 660, ['bed-01', 'bed-03']],
      ['w', 650, 710, ['bed-01', 'bed-03']],
      ['short', 610, 640, ['bed-01']],
      ['long', 610, 700, ['bed-01']],
    ]
    const { book, asks } = tableBook(rows)
    const candidates = rows.slice(0, 2).map(([k, s, e]) => maskOf(k, [span(s, e)]))
    const lanes = [...rows.map(([k]) => lane(k)), ...bedRows('bed-01', 'bed-02', 'bed-03')]
    const honest = honestHeld(candidates, lanes, book, true)
    expect(honest.total).toBe(candidates.length)
    const offers = [askOf(rows[2]), askOf(rows[3])]
    const before = asks.length
    const w = withheldOffers(offers, honest, candidates, lanes, book, true)
    const nettings = (asks.length - before - offers.length) / candidates.length
    // Derived: two distinct (room, span) questions, so two nettings — a memo that
    // forgot the end would ask ONE and answer the other offer with it.
    const distinct = new Set(offers.map((o) => `bed-01|${o.start}|${o.end}`)).size
    console.log('memo key: nettings =', nettings, '· distinct room×span =', distinct, '· withheld =', setOf(w))
    expect({ nettings, withheld: setOf(w) }).toEqual({ nettings: distinct, withheld: [offerKey('long', 610)] })
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

  // ⚖ ROUND 2 · SPEC-R2 v5 amendment item 4 — AND NO NAME WHEN ONE ROOM COSTS TWO.
  it('no name when the offer’s only room costs TWO 枠 at once', () => {
    // u and v both need bed-01 and do not overlap each other, so the netting parks
    // both there; w sits in bed-03. The offer runs across all three and may only
    // use bed-01, so bed-01 is its ONE candidate room — and blocking it costs the
    // store u AND v together. Two 枠 move, so no single 枠 is 「先」 and the box must
    // lead with the generic line rather than name whichever comes first.
    const rows: Array<[string, number, number, string[]]> = [
      ['u', 600, 660, ['bed-01']],
      ['w', 650, 710, ['bed-03']],
      ['v', 700, 760, ['bed-01']],
      ['o', 610, 750, ['bed-01']],
    ]
    const { book } = tableBook(rows)
    const candidates = rows.slice(0, 3).map(([k, s, e]) => maskOf(k, [span(s, e)]))
    const lanes = [...rows.map(([k]) => lane(k)), ...bedRows('bed-01', 'bed-02', 'bed-03')]
    const honest = honestHeld(candidates, lanes, book, true)
    expect(honest.total).toBe(candidates.length)
    const offer = askOf(rows[3])
    // THE LOSS LIST, derived here rather than asserted: block the one candidate
    // room over the offer's span and see which 枠 the netting can no longer hold.
    const want = honest.byLane.flatMap((l) => l.held.map((sp) => offerKey(l.laneKey, sp.windowStart)))
    const after = honestHeld(candidates, lanes, blockedFor(book, 'bed-01', offer.start, offer.end), true)
    const lost = want.filter((k) => !after.byLane.flatMap((l) => l.held.map((sp) => offerKey(l.laneKey, sp.windowStart))).includes(k))
    console.log('one room, two 枠: loss list =', lost)
    expect(lost.length).toBeGreaterThan(1)
    const w = withheldOffers([offer], honest, candidates, lanes, book, true)
    expect(setOf(w)).toEqual([offer.key])
    expect(w.blockedBy.has(offer.key)).toBe(false)
  })
})

// ⚖ ROUND 2 · SPEC-R2 v4 item 1 + v5 items 2/3/5 — THE CLAIM EVERY EXIT RESTS ON,
// MADE EXECUTABLE. The witness reads `heldRoom`, which is a TIE-BREAK, and the whole
// v3 amendment exists because a money decision may not hang off a tie-break; the
// pigeonhole and the memo are cheaper still. So the claim is that the exits change
// only the COST and never the ANSWER, checked on 500 random boards against a
// reference with no exits and no memo — the pin harness's own oracle shape,
// re-spelled here so it shares no code with the module.
//
// ⚠ AND THE ANSWER IS TWO THINGS, which this round separated because they came
// apart (report §STOP, and the module's own note on the pigeonhole):
//   · THE WITHHELD SET — the money — is compared on EVERY board and EVERY offer,
//     and it agrees everywhere. That is the property that matters.
//   · THE NAME in the box is compared wherever a name is computed at all. The
//     pigeonhole decides WITHOUT the loss lists, and a name is made of loss lists,
//     so on those offers it gives the generic line and this leg asserts that it
//     names NOBODY (v5 item 4's 「one room ⇒ provably [X]」 carve-out is disproved
//     below and gone). How many rule-4 names that costs is PRINTED, not hidden —
//     it is the open question the report hands back.
describe('bed-aware-sales — the exits change the cost, never the answer', () => {
  /** One 32-bit mixer, so a seed is a board and the board is the same every run. */
  const mix = (...xs: number[]) => {
    let h = 0x9e3779b9
    for (const x of xs) {
      h = (h ^ Math.imul(x + 0x85ebca6b, 0xcc9e2d51)) >>> 0
      h = (Math.imul(h << 13 | h >>> 19, 0x1b873593) + 0xe6546b64) >>> 0
    }
    return h >>> 0
  }

  /** THE REFERENCE: test (i′) with every exit and the memo removed — every room of
   *  every overlapping offer is netted, and BOTH the verdict and the name are read
   *  off the FULL loss lists (v5 item 4's rule, spelled here from scratch). */
  const reference = (
    offers: readonly OfferAsk[],
    honest: ReturnType<typeof honestHeld>,
    candidates: ReservedLaneMask[],
    lanes: BoardLane[],
    book: BedTruth,
  ) => {
    const idsOf = (h: ReturnType<typeof honestHeld>) => h.byLane.flatMap((l) => l.held.map((s) => offerKey(l.laneKey, s.windowStart)))
    const want = idsOf(honest)
    const spans = honest.byLane.flatMap((l) => l.held.map((s) => ({ id: offerKey(l.laneKey, s.windowStart), laneKey: l.laneKey, start: s.start, end: s.end })))
    const keys: string[] = []
    const named = new Map<string, string>()
    let multiLoss = 0
    for (const o of offers) {
      const rooms = book.freeBedKeys(o.start, o.end, { stores: o.stores })
      if (rooms.length === 0) continue
      const lostPer = rooms.map((r) => {
        const after = new Set(idsOf(honestHeld(candidates, lanes, blockedFor(book, r, o.start, o.end), true)))
        return want.filter((k) => !after.has(k))
      })
      if (lostPer.some((lost) => lost.length === 0)) continue
      keys.push(o.key)
      if (lostPer.some((lost) => lost.length > 1)) multiLoss += 1
      // v5 item 4: EVERY room's loss list exactly `[X]`, and X overlaps the offer.
      const only = lostPer[0].length === 1 ? lostPer[0][0] : null
      if (only && lostPer.every((lost) => lost.length === 1 && lost[0] === only)) {
        const owner = spans.find((s) => s.id === only && o.start < s.end && s.start < o.end)
        if (owner) named.set(o.key, owner.laneKey)
      }
    }
    return { keys: keys.sort(), named, multiLoss }
  }

  /** WHICH OFFERS THE PIGEONHOLE DECIDES, computed from the BOARD (its held 枠 and
   *  its bed rows) and not from the module — so a mutant that fires the exit on the
   *  wrong boards shows up as a SET disagreement rather than moving this scope. */
  const pigeonholed = (
    offers: readonly OfferAsk[],
    honest: ReturnType<typeof honestHeld>,
    lanes: BoardLane[],
  ): Set<string> => {
    const universe = lanes.filter((l) => l.group === 'beds').length
    const spans = honest.byLane.flatMap((l) => l.held.map((s) => ({ start: s.start, end: s.end })))
    const out = new Set<string>()
    if (universe === 0) return out
    for (const o of offers) {
      const hit = spans.filter((s) => o.start < s.end && s.start < o.end)
      const covering = (t: number) => hit.filter((s) => s.start <= t && t < s.end).length
      const steps = [o.start, ...hit.map((s) => s.start).filter((t) => t > o.start && t < o.end)]
      if (steps.some((t) => covering(t) >= universe)) out.add(o.key)
    }
    return out
  }

  /** A board that is a pure function of its seed: R BED ROWS, N kept 枠 of the
   *  store's one protected length, M priced offers ON THE KEPT LANES — the board's
   *  own shape (a staff row draws its 新規用 枠 AND its priced boxes), which is also
   *  what makes the ROOM UNIVERSE independent of the staff count — and a book whose
   *  free-room answer is a deterministic subset of the rooms for any span. */
  const board = (seed: number) => {
    const R = 1 + (mix(seed, 1) % 4)
    const rooms = Array.from({ length: R }, (_, i) => `bed-${String(i + 1).padStart(2, '0')}`)
    const N = 1 + (mix(seed, 2) % 5)
    const M = 1 + (mix(seed, 3) % 4)
    const kept: Array<[string, number, number]> = Array.from({ length: N }, (_, i) => {
      const s = 600 + (mix(seed, 10 + i) % 10) * 15
      return [`k${i}`, s, s + 90]
    })
    const offers: OfferAsk[] = []
    const taken = new Set<string>()
    for (let j = 0; j < M; j += 1) {
      const laneKey = kept[j % N][0]
      const s = 600 + (mix(seed, 40 + j) % 12) * 15
      const key = offerKey(laneKey, s)
      if (taken.has(key)) continue // the key IS the identity: a repeated (lane, start) is one offer
      taken.add(key)
      offers.push({ key, laneKey, start: s, end: s + (mix(seed, 70 + j) % 2 === 0 ? 30 : 60), stores: null })
    }
    // Deterministic, span-keyed, and never the empty set for every span at once:
    // a room is free for a span unless the mixer says otherwise.
    const book = stubBook((start, end) => rooms.filter((r) => mix(seed, start, end, r.charCodeAt(r.length - 1)) % 3 !== 0)).book
    const candidates = kept.map(([k, s, e]) => maskOf(k, [span(s, e)]))
    const lanes = [...kept.map(([k]) => lane(k)), ...bedRows(...rooms)]
    return { rooms, kept, offers, book, candidates, lanes }
  }

  it('≡ an exit-less reference on 500 random boards — the SET always, the NAME wherever one is computed', () => {
    const setFails: string[] = []
    const nameFails: string[] = []
    const exitNamed: string[] = []
    let withheldBoards = 0
    let namedBoards = 0
    let multiLossBoards = 0
    let fewerStaffThanRooms = 0
    let pigeonholedOffers = 0
    let namesTheExitGivesUp = 0
    for (let seed = 0; seed < 500; seed += 1) {
      const b = board(seed)
      const honest = honestHeld(b.candidates, b.lanes, b.book, true)
      // The equivalence argument assumes the netting FINISHED (see the module's own
      // ceiling note); these boards are far inside the node budget and the
      // assertion says so rather than assuming it.
      if (!honest.exact) { setFails.push(`seed ${seed} — the netting was not exact, so the board is not a fair comparison`); continue }
      const w = withheldOffers(b.offers, honest, b.candidates, b.lanes, b.book, true)
      const want = reference(b.offers, honest, b.candidates, b.lanes, b.book)
      const byExit = pigeonholed(b.offers, honest, b.lanes)
      const where = `seed ${seed} (${b.rooms.length} rooms · ${b.kept.length} 枠 · ${b.offers.length} offers)`
      if (w.keys.size) withheldBoards += 1
      if (want.named.size) namedBoards += 1
      if (want.multiLoss) multiLossBoards += 1
      if (b.kept.length < b.rooms.length) fewerStaffThanRooms += 1
      pigeonholedOffers += [...byExit].filter((k) => w.keys.has(k)).length
      // (1) THE SET — every board, every offer.
      if (JSON.stringify(setOf(w)) !== JSON.stringify(want.keys)) {
        setFails.push(`${where} — module ${JSON.stringify(setOf(w))} · reference ${JSON.stringify(want.keys)}`)
      }
      // (2) THE NAME — on every offer the pigeonhole did not decide.
      for (const o of b.offers) {
        if (byExit.has(o.key)) {
          if (w.blockedBy.has(o.key)) exitNamed.push(`${where} — offer ${o.key} named ${w.blockedBy.get(o.key)} out of the pigeonhole exit`)
          if (want.named.has(o.key)) namesTheExitGivesUp += 1
          continue
        }
        if (w.blockedBy.get(o.key) !== want.named.get(o.key)) {
          nameFails.push(`${where} — offer ${o.key}: module ${w.blockedBy.get(o.key) ?? '-'} · reference ${want.named.get(o.key) ?? '-'}`)
        }
      }
    }
    console.log(`exit equivalence: 500 boards · ${withheldBoards} withheld something · ${namedBoards} named a 枠 · ${multiLossBoards} had a room losing two 枠 · ${fewerStaffThanRooms} had fewer staff rows than bed rows`)
    console.log(`  set disagreements = ${setFails.length} · name disagreements off the exit = ${nameFails.length} · names given out of the exit = ${exitNamed.length}`)
    console.log(`  ⚠ THE OPEN QUESTION: ${pigeonholedOffers} withheld offers were decided by the pigeonhole, and ${namesTheExitGivesUp} of them carry a rule-4 name the exit gives up (the generic line instead).`)
    expect(setFails).toEqual([])
    expect(nameFails).toEqual([])
    expect(exitNamed).toEqual([])
    // …and the loop is worth running: boards really do withhold, really do name,
    // and really do carry the shapes the mutants live in — so an 「always empty」
    // module could not pass by accident.
    expect(withheldBoards).toBeGreaterThan(0)
    expect(namedBoards).toBeGreaterThan(0)
    expect(multiLossBoards).toBeGreaterThan(0)
    expect(fewerStaffThanRooms).toBeGreaterThan(0)
    expect(pigeonholedOffers).toBeGreaterThan(0)
  })
})
