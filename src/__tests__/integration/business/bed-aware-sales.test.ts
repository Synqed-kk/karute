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
import { heldMaskOf, honestHeld } from '@/app/[locale]/(business)/business/today/honest-held'
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
  // ⚖ D-50 (a) / D2 PIN MOVE — RESTORED to its original (pre-D) title and
  // assertion: the pre-walk eligibility exit that used to close this board at
  // zero cost is gone. Three bed rows, so (d) is silent (two held 枠 never fill
  // three rooms); x owns bed-01, y bed-02, and the offers use only those two, so
  // there's no witness either — EVERY offer reaches the search, exactly as
  // before D ever existed.
  it('a lattice of offers over the same spans pays ONE netting per (room, span)', () => {
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

  // ⚖ D-49 (c) R1 — THE MEMO, on a board the eligibility exit cannot decide.
  // ⚖ D-50 (a) / D2 — the lattice leg above reaches the walk; this board is the
  // one no counting exit could ever close (z2 starts AT the offer's end) and
  // pins the memo a second time — and it is the honest example that the
  // certifier's one-instant form is sufficient, not complete.
  it('a lattice of offers that REACHES the walk still pays ONE netting per (room, span)', () => {
    const OFFER_ROOMS = ['bed-01', 'bed-02']
    const OFFER_LANES = ['s1', 's2', 's3']
    const rows: Array<[string, number, number, string[]]> = [
      ['x', 600, 690, ['bed-01', 'bed-03']],
      ['y', 605, 695, ['bed-02', 'bed-03']],
      ['z2', 650, 740, ['bed-03']],
      ['offers', 610, 650, OFFER_ROOMS],
    ]
    const { book, asks } = tableBook(rows)
    const candidates = rows.slice(0, 3).map(([k, s, e]) => maskOf(k, [span(s, e)]))
    const lanes = [...['x', 'y', 'z2', ...OFFER_LANES].map((k) => lane(k)), ...bedRows('bed-01', 'bed-02', 'bed-03')]
    const roomUniverse = lanes.filter((l) => l.group === 'beds').length
    const honest = honestHeld(candidates, lanes, book, true)
    // Preconditions, DERIVED from the objects — the three silences this board rests on.
    expect({ total: honest.total, exact: honest.exact, roomUniverse }).toEqual({ total: 3, exact: true, roomUniverse: 3 })
    const heldRoom = Object.fromEntries(honest.byLane.map((l) => [l.laneKey, l.heldRoom[0]]))
    console.log('R1 heldRoom =', heldRoom, '· heldRooms =', honest.byLane.map((l) => l.heldRooms))
    // The assignment is FORCED (z2 can only take bed-03), so this is a fact, not a hope:
    // both of the offer's rooms are in use ⇒ the witness is silent; covering(610) = 2 < 3
    // ⇒ (d) is silent; U(610) = all three beds ⇒ |U \ {r}| = 2 is NOT < 2 ⇒ (e) is silent.
    expect(heldRoom).toEqual({ x: 'bed-01', y: 'bed-02', z2: 'bed-03' })
    const offers: OfferAsk[] = OFFER_LANES.map((k) => ({ key: offerKey(k, 610), laneKey: k, start: 610, end: 650, stores: null }))
    const before = asks.length
    const w = withheldOffers(offers, honest, candidates, lanes, book, true)
    const nettings = (asks.length - before - offers.length) / candidates.length
    const distinct = new Set(offers.flatMap((o) => OFFER_ROOMS.map((r) => `${r}|${o.start}|${o.end}`))).size
    const unmemoised = offers.length * OFFER_ROOMS.length
    console.log('R1 memo:', offers.length, 'offers ·', distinct, 'distinct room×span · nettings =', nettings, '(un-memoised:', unmemoised, ')')
    // nettings > 0 is what makes this leg the memo's pin: the walk really ran.
    expect({ nettings, withheld: setOf(w).length, unresolved: [...w.unresolved] })
      .toEqual({ nettings: distinct, withheld: offers.length, unresolved: [] })
    expect(nettings).toBeLessThan(unmemoised)
    // …and NO name: the 枠 every room costs (z2) starts at the offer's end, so it is
    // not in `hit` and `blockerOf` refuses to name it — the shared box's own rule.
    for (const o of offers) expect(w.blockedBy.has(o.key)).toBe(false)
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

// ⚖ D-19 (3) / ROUND 3 · D — these boards were built for the pre-walk
// eligibility exit of slice D; ⚖ D-50 (a) turned that exit into the
// certifier that runs only after a short walk, so on every board here the
// walk runs first and the legs pin the walk's own answer (nettings = the
// candidate rooms, names where the walk is exact); the certifier's own legs
// are C1–C4 below.
describe('bed-aware-sales — ⚖ D-19 (3) · D-50 (a): the boards that used to reach exit (e) — now the walk runs, names return', () => {
  it('P1 — the M4 shape in miniature: (d) is silent, the walk runs both rooms, no name (two different 枠 lost)', () => {
    // The saturated rows from "the doors" (x → bed-01 only, y → bed-02 only,
    // offer z wants either), now with a THIRD, foreign bed row that is never in
    // the book's answer — the M4 board's own shape, in miniature.
    const rows: Array<[string, number, number, string[]]> = [
      ['x', 600, 690, ['bed-01']],
      ['y', 605, 695, ['bed-02']],
      ['z', 610, 650, ['bed-01', 'bed-02']],
    ]
    const { book, asks } = tableBook(rows)
    const candidates = rows.slice(0, 2).map(([k, s, e]) => maskOf(k, [span(s, e)]))
    const lanes = [...['x', 'y', 'z'].map((k) => lane(k)), ...bedRows('bed-01', 'bed-02', 'bed-03')]
    const roomUniverse = lanes.filter((l) => l.group === 'beds').length
    const honest = honestHeld(candidates, lanes, book, true)
    // Preconditions, derived from the objects — not asserted by hand.
    expect(honest.total).toBe(2)
    expect(roomUniverse).toBe(3) // so (d) is silent: covering(t) = 2 < 3
    console.log('P1 heldRooms per 枠:', honest.byLane.map((l) => ({ laneKey: l.laneKey, heldRooms: l.heldRooms })))
    // Both held 枠 overlap the offer here, so this equals the module's own
    // `usedRooms`, which is built from `hit` only.
    const usedRooms = new Set(honest.byLane.flatMap((l) => l.heldRoom))
    expect([...usedRooms].sort()).toEqual(['bed-01', 'bed-02']) // the witness is silent too
    const offer = askOf(rows[2])
    const before = asks.length
    const w = withheldOffers([offer], honest, candidates, lanes, book, true)
    const nettings = (asks.length - before - 1) / candidates.length
    console.log('P1: withheld =', setOf(w), 'nettings =', nettings, 'unresolved =', [...w.unresolved])
    // ⚖ D-50 (a) / D2 PIN MOVE — there is no more pre-walk exit here: the walk
    // runs for both candidate rooms (nettings === rooms.length, not 0), and
    // since it completes exactly on this tiny board (`short` never sets), the
    // certifier never even engages — `unresolved` stays [] because the walk
    // itself is exact, not because anything certified it.
    expect({ withheld: setOf(w), nettings, unresolved: [...w.unresolved] }).toEqual({ withheld: [offer.key], nettings: 2, unresolved: [] })
    // …and no name: blocking bed-01 loses x, blocking bed-02 loses y — two
    // different 枠, so `blockerOf` refuses to pick one.
    expect(w.blockedBy.has(offer.key)).toBe(false)
  })

  it('P2 — Hall\'s condition holds: on sale through the walk, as before', () => {
    const rows: Array<[string, number, number, string[]]> = [
      ['x', 600, 690, ['bed-01', 'bed-03']],
      ['y', 605, 695, ['bed-02']],
      ['z', 610, 650, ['bed-01', 'bed-02']],
    ]
    const { book, asks } = tableBook(rows)
    const candidates = rows.slice(0, 2).map(([k, s, e]) => maskOf(k, [span(s, e)]))
    const lanes = [...['x', 'y', 'z'].map((k) => lane(k)), ...bedRows('bed-01', 'bed-02', 'bed-03')]
    const honest = honestHeld(candidates, lanes, book, true)
    const xHeldRoom = honest.byLane.find((l) => l.laneKey === 'x')?.heldRoom[0]
    console.log('P2: x heldRoom =', xHeldRoom)
    if (xHeldRoom !== 'bed-01') {
      throw new Error(`P2 precondition failed: assign() gave x room "${xHeldRoom}", expected "bed-01" — the witness fires instead of this leg's intended path; tell Fable`)
    }
    const offer = askOf(rows[2])
    const before = asks.length
    const w = withheldOffers([offer], honest, candidates, lanes, book, true)
    const nettings = (asks.length - before - 1) / candidates.length
    console.log('P2: withheld =', setOf(w), 'nettings =', nettings)
    expect(setOf(w)).toEqual([])
    expect(nettings).toBeGreaterThanOrEqual(1)
  })

  it('P3 — a LATER 枠\'s start inside the span: the walk runs, no name', () => {
    const rows: Array<[string, number, number, string[]]> = [
      ['x', 600, 690, ['bed-01']],
      ['y', 640, 730, ['bed-02']],
      ['z', 610, 700, ['bed-01', 'bed-02']],
    ]
    const { book, asks } = tableBook(rows)
    const candidates = rows.slice(0, 2).map(([k, s, e]) => maskOf(k, [span(s, e)]))
    const lanes = [...['x', 'y', 'z'].map((k) => lane(k)), ...bedRows('bed-01', 'bed-02', 'bed-03')]
    const honest = honestHeld(candidates, lanes, book, true)
    const offer = askOf(rows[2])
    const before = asks.length
    const w = withheldOffers([offer], honest, candidates, lanes, book, true)
    const nettings = (asks.length - before - 1) / candidates.length
    console.log('P3: withheld =', setOf(w), 'nettings =', nettings)
    // ⚖ D-50 (a) / D2 PIN MOVE — no pre-walk exit: the walk runs (nettings ===
    // rooms.length, not 0); the tiny board resolves exactly, so the certifier
    // never engages.
    expect({ withheld: setOf(w), nettings }).toEqual({ withheld: [offer.key], nettings: 2 })
    // …and no name: blocking bed-01 loses x, blocking bed-02 loses y.
    expect(w.blockedBy.has(offer.key)).toBe(false)
  })

  it('P4 — ⚖ D-49 (a): one candidate room keeps its name through the loop', () => {
    const rows: Array<[string, number, number, string[]]> = [
      ['x', 600, 690, ['bed-02']],
      ['z', 600, 630, ['bed-02']],
    ]
    const { book, asks } = tableBook(rows)
    const candidates = rows.slice(0, 1).map(([k, s, e]) => maskOf(k, [span(s, e)]))
    const lanes = [...['x', 'z'].map((k) => lane(k)), ...bedRows('bed-01', 'bed-02', 'bed-03')]
    const honest = honestHeld(candidates, lanes, book, true)
    const offer = askOf(rows[1])
    const before = asks.length
    const w = withheldOffers([offer], honest, candidates, lanes, book, true)
    const nettings = (asks.length - before - 1) / candidates.length
    console.log('P4: withheld =', setOf(w), 'nettings =', nettings, 'blockedBy =', w.blockedBy.get(offer.key))
    expect({ withheld: setOf(w), nettings, blocker: w.blockedBy.get(offer.key) }).toEqual({ withheld: [offer.key], nettings: 1, blocker: 'x' })
  })

  // ⚖ D-50 (a) / D2 — P7 DELETED: it pinned the standalone `roomUniverse >= 2 &&
  // rooms.length >= 2` gate on the pre-walk eligibility exit, and that gate is
  // gone — the certifier has no gate of its own beyond `short` and the
  // identity-path premise (`hit.every(h => h.rooms.length > 0)`). There is no
  // longer a "guard on its own" to pin.

  it('P8 — an earlier 枠\'s END inside the span: the walk runs and names C (the certifier keeps ends for the short-walk case — sound, and a DISCLOSED unpinned survivor, ⚖ D-51 (c))', () => {
    // Every 枠 is 90 minutes (the equal-length invariant). A and C share the same
    // span and the same two eligible rooms, so the netting must split them across
    // p and q; B ENDS at 610 — strictly inside the offer's span, and not the
    // START of any 枠 on this board — and takes its own rooms (m, j) out of the
    // union with it. Four bed rows, so (d) is silent: n(600) = 3 < 4.
    const rows: Array<[string, number, number, string[]]> = [
      ['A', 600, 690, ['p', 'q']],
      ['B', 520, 610, ['m', 'j']],
      ['C', 600, 690, ['p', 'q']],
      ['offer', 600, 700, ['p', 'q']],
    ]
    const { book, asks } = tableBook(rows)
    const candidates = rows.slice(0, 3).map(([k, s, e]) => maskOf(k, [span(s, e)]))
    const lanes = [...['A', 'B', 'C', 'offer'].map((k) => lane(k)), ...bedRows('p', 'q', 'm', 'j')]
    const roomUniverse = lanes.filter((l) => l.group === 'beds').length
    const honest = honestHeld(candidates, lanes, book, true)
    // Preconditions, derived from the objects — not asserted by hand.
    expect({ total: honest.total, exact: honest.exact, roomUniverse }).toEqual({ total: 3, exact: true, roomUniverse: 4 })
    const heldRoom = Object.fromEntries(honest.byLane.map((l) => [l.laneKey, l.heldRoom[0]]))
    console.log('P8 heldRoom =', heldRoom, '· heldRooms =', honest.byLane.map((l) => l.heldRooms))
    // All three held 枠 overlap the offer, so this equals the module's own
    // `usedRooms`, built from `hit` only.
    const usedRooms = new Set(honest.byLane.flatMap((l) => l.heldRoom))
    console.log('P8 usedRooms =', [...usedRooms].sort())
    const offer = askOf(rows[3])
    const offerRooms = book.freeBedKeys(offer.start, offer.end, { stores: null })
    expect(offerRooms.every((r) => usedRooms.has(r))).toBe(true)
    // U(t): the union of eligible rooms of the held 枠 covering instant t — the
    // same quantity the eligibility exit reads, re-derived here from the objects.
    const heldSpans = honest.byLane.flatMap((l) => l.held.map((s, i) => ({ start: s.start, end: s.end, rooms: l.heldRooms[i] })))
    const coveringAt = (t: number) => heldSpans.filter((s) => s.start <= t && t < s.end)
    const unionAt = (t: number) => new Set(coveringAt(t).flatMap((s) => s.rooms))
    console.log('P8 U(600) =', [...unionAt(600)].sort(), 'n(600) =', coveringAt(600).length)
    console.log('P8 U(610) =', [...unionAt(610)].sort(), 'n(610) =', coveringAt(610).length)
    // At 600 the margin is 1 for both p and q — not refuted there.
    expect({ u: unionAt(600).size, n: coveringAt(600).length }).toEqual({ u: 4, n: 3 })
    // At 610 — B's END, not any 枠's start — both p and q are refuted.
    expect({ u: [...unionAt(610)].sort(), n: coveringAt(610).length }).toEqual({ u: ['p', 'q'], n: 2 })
    const before = asks.length
    const w = withheldOffers([offer], honest, candidates, lanes, book, true)
    const nettings = (asks.length - before - 1) / candidates.length
    console.log('P8: withheld =', setOf(w), 'nettings =', nettings, 'unresolved =', [...w.unresolved], 'blockedBy =', w.blockedBy.get(offer.key))
    // ⚖ D-50 (a) / D2 PIN MOVE — no pre-walk exit: the walk runs (nettings 2, one
    // per candidate room); the board resolves exactly (small clique, well inside
    // the search budget), so the certifier never engages and `unresolved` stays
    // [] because the walk itself is exact.
    expect({ withheld: setOf(w), nettings, unresolved: [...w.unresolved] }).toEqual({ withheld: [offer.key], nettings: 2, unresolved: [] })
    // …and NOW it names: blocking p loses C (A keeps q), blocking q loses C too
    // (A keeps p) — the SAME lane both times, so `blockerOf` gives its name. This
    // is the walk's own tie-break (A is earlier-held, C is not), never asserted
    // by hand — printed above.
    expect(w.blockedBy.get(offer.key)).toBe('C')
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

  // ⚖ ROUND 2 · step 1d (⚖ D-14 (d)) — THE PIGEONHOLE NEEDS TWO OR MORE ROOMS.
  // Same board, now with the board's ONE bed row present (`roomUniverse === 1`).
  // The pigeonhole exists to avoid paying |rooms| nettings on a saturated board;
  // at one room there is nothing to avoid, so the guard is `>= 2` and the offer
  // still reaches the per-room loop — which is exact and names ごろう's stand-in.
  it('…and a one-bed board (one `group: "beds"` lane) keeps the exact name — the pigeonhole needs TWO OR MORE rooms', () => {
    const { book } = tableBook([...ONE_KEPT, ...ONE_OFFERS])
    const candidates = ONE_KEPT.map(([k, s, e]) => maskOf(k, [span(s, e)]))
    const lanes = [...['a', 'b', 'c'].map((k) => lane(k)), ...bedRows('bed-01')]
    const honest = honestHeld(candidates, lanes, book, true)
    expect(honest.total).toBe(ONE_KEPT.length)
    const w = withheldOffers(ONE_OFFERS.map(askOf), honest, candidates, lanes, book, true)
    console.log('one-bed pigeonhole guard: withheld =', setOf(w), 'blockedBy =', [...w.blockedBy])
    expect(setOf(w)).toEqual([offerKey('c', 630)])
    expect(w.blockedBy.get(offerKey('c', 630))).toBe('a')
  })

  // ⚖ ROUND 2 · step 1d (coordinator amendment) — THE PIGEONHOLE NEEDS A REAL
  // ASSIGNMENT TOO. An IDENTITY `honest` (the netting's own gate off) reports
  // `''` for every held 枠's room — no legality guarantee — so counting rooms
  // against it would count against nothing; `usedRooms.has('')` must fall the
  // pigeonhole through to the search exactly as the witness already does.
  it('…and an IDENTITY honest (the netting off) never fires the pigeonhole — it pays real nettings', () => {
    const rows: Array<[string, number, number, string[]]> = [
      ['x', 600, 690, ['bed-01']],
      ['y', 605, 695, ['bed-02']],
      ['z', 610, 650, ['bed-01', 'bed-02']],
    ]
    const { book, asks } = tableBook(rows)
    const candidates = rows.slice(0, 2).map(([k, s, e]) => maskOf(k, [span(s, e)]))
    const lanes = [...['x', 'y', 'z'].map((k) => lane(k)), ...bedRows('bed-01', 'bed-02')]
    const honest = honestHeld(candidates, lanes, book, false) // IDENTITY: heldRoom = ''
    const roomUniverse = lanes.filter((l) => l.group === 'beds').length
    expect(honest.total).toBe(roomUniverse) // still "saturated" by count alone
    const offer = askOf(rows[2])
    const rooms = book.freeBedKeys(offer.start, offer.end, { stores: null })
    const before = asks.length
    withheldOffers([offer], honest, candidates, lanes, book, true)
    const nettings = (asks.length - before - 1) / candidates.length
    console.log('identity honest: nettings =', nettings, '(0 would mean the pigeonhole wrongly fired on a fake assignment)')
    expect(nettings).toBe(rooms.length)
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
    // ⚖ D-17 / SPEC-R2 v7 — ONE HOME FOR THE RULE IN THE TEST TOO: the reference
    // re-nets the PUBLISHED held set, exactly as the module now does, because the
    // question is 「can these 枠 still be seated?」 and not 「is some equally large
    // set reachable?」. Spelled here from scratch, sharing no code with the module.
    const wanted = new Set(want)
    const heldOnly = candidates
      .map((m) => maskOf(m.laneKey, m.spans.filter((sp) => wanted.has(offerKey(m.laneKey, sp.windowStart))) as ReservedSpan[]))
      .filter((m) => m.spans.length > 0)
    const spans = honest.byLane.flatMap((l) => l.held.map((s) => ({ id: offerKey(l.laneKey, s.windowStart), laneKey: l.laneKey, start: s.start, end: s.end })))
    const keys: string[] = []
    const named = new Map<string, string>()
    let multiLoss = 0
    for (const o of offers) {
      const rooms = book.freeBedKeys(o.start, o.end, { stores: o.stores })
      if (rooms.length === 0) continue
      const lostPer = rooms.map((r) => {
        const after = new Set(idsOf(honestHeld(heldOnly, lanes, blockedFor(book, r, o.start, o.end), true)))
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

  /** WHICH OFFERS THE COUNT EXIT (d) DECIDES, computed from the BOARD (its held
   *  枠 and its bed rows) and not from the module — so a mutant that fires (d) on
   *  the wrong boards shows up as a SET disagreement rather than moving this
   *  scope. ⚖ D-50 (a) / D2 — back to the (d) rule only: the eligibility branch
   *  is gone (it lived inside the certifier now, engaged only on a SHORT walk,
   *  which none of these tiny boards ever reach — D-18 (2)'s clique board is the
   *  leg that reaches it, deliberately). Renamed `countDecided`; the `book`
   *  parameter is dropped — (d) never needed it. */
  const countDecided = (
    offers: readonly OfferAsk[],
    honest: ReturnType<typeof honestHeld>,
    lanes: BoardLane[],
  ): Map<string, 'count'> => {
    const universe = lanes.filter((l) => l.group === 'beds').length
    const out = new Map<string, 'count'>()
    // ⚖ step 1d (D-14 (d)): (d)'s own guard is `roomUniverse >= 2`, not `> 0` —
    // mirrored here so this reference names exactly the offers (d) decides.
    if (universe < 2) return out
    const spans = honest.byLane.flatMap((l) => l.held.map((s) => ({ start: s.start, end: s.end })))
    for (const o of offers) {
      const hit = spans.filter((s) => o.start < s.end && s.start < o.end)
      const covering = (t: number) => hit.filter((s) => s.start <= t && t < s.end).length
      const steps = [o.start, ...hit.flatMap((s) => [s.start, s.end]).filter((t) => t > o.start && t < o.end)]
      if (steps.some((t) => covering(t) >= universe)) out.set(o.key, 'count')
    }
    return out
  }

  /** ⚖ ROUND 3 · D — the M4 defeat of (d): the SAME board plus ONE extra bed row
   *  the book never returns (never in `rooms`, so no span of any offer or held
   *  枠 can ever include it) — a store whose eligible rooms are a strict subset
   *  of the board's, the exact shape D-19 (3) names. */
  const boardWithForeignBed = (seed: number): ReturnType<typeof board> => {
    const b = board(seed)
    return { ...b, lanes: [...b.lanes, ...bedRows(`bed-foreign-${seed}`)] }
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

  /** ⚖ D-51 fold 2 / S1's sweep shape — rooms 3–10, staff 8–20 with a kept 枠 on
   *  MOST (not all — a fifth of the rows draw none) staff rows, offers 1–6, ONE
   *  枠 length per board drawn from {60,90,120,240} (the equal-length invariant),
   *  grid 15. This is the board family S1's own sweep found the name cost on
   *  (staff density against a small room count, up to 100% at 5 rooms · 20
   *  staff · 60 min) — the shape the two tiny families above cannot produce. */
  const boardBusyAt = (seed: number, R: number, STAFF: number, DUR: number) => {
    const rooms = Array.from({ length: R }, (_, i) => `bed-${String(i + 1).padStart(2, '0')}`)
    const kept: Array<[string, number, number]> = []
    for (let i = 0; i < STAFF; i += 1) {
      if (mix(seed, 20 + i) % 5 === 0) continue // ~a fifth of staff rows draw no 枠 — MOST, not all
      const s = 600 + (mix(seed, 30 + i) % 20) * 15
      kept.push([`k${i}`, s, s + DUR])
    }
    if (kept.length === 0) kept.push(['k0', 600, 600 + DUR]) // never the empty board
    const N = kept.length
    const M = 1 + (mix(seed, 4) % 6)
    const offers: OfferAsk[] = []
    const taken = new Set<string>()
    for (let j = 0; j < M; j += 1) {
      const laneKey = kept[j % N][0]
      const s = 600 + (mix(seed, 50 + j) % 24) * 15
      const key = offerKey(laneKey, s)
      if (taken.has(key)) continue
      taken.add(key)
      offers.push({ key, laneKey, start: s, end: s + DUR, stores: null })
    }
    const book = stubBook((start, end) => rooms.filter((r) => mix(seed, start, end, r.charCodeAt(r.length - 1)) % 3 !== 0)).book
    const candidates = kept.map(([k, s, e]) => maskOf(k, [span(s, e)]))
    const lanes = [...kept.map(([k]) => lane(k)), ...bedRows(...rooms)]
    return { rooms, kept, offers, book, candidates, lanes }
  }
  const boardBusy = (seed: number): ReturnType<typeof board> => {
    const R = 3 + (mix(seed, 1) % 8) // 3..10
    const STAFF = 8 + (mix(seed, 2) % 13) // 8..20
    const DUR = [60, 90, 120, 240][mix(seed, 3) % 4]
    return boardBusyAt(seed, R, STAFF, DUR)
  }

  /** D (D-51 (c) fix — mutant m5 · L2's `rooms.some` survivor). L1's own rig
   *  shape (LENS-1-delta-D2.md §3): R ∈ {3,5,8,10} × S ∈ {8,14,20} × 枠 ∈
   *  {60,90,120,240}, half strict-subset book (`boardBusyAt` unchanged) and half
   *  the foreign-bed flavour (one extra bed row the book never answers — the M4
   *  shape). Neither builder nor Fable's own far-clique construction could hand-
   *  build a deterministic END-hinged short-walk board; instead this property
   *  pins the certifier ≡ a from-scratch reference on every withheld offer of a
   *  budget-tripping family, and pins the ends only on a run where
   *  `endsNeeded > 0` (this run: 0 — the leg's closing comment says so). Unlike
   *  `boardBusy` above, it is run WITHOUT the exact-outer skip: a budget-
   *  tripping board is exactly the case D exists for, so it stays IN the sample
   *  here rather than being excused from it.
   */
  const boardTrip = (seed: number): ReturnType<typeof board> => {
    const R = [3, 5, 8, 10][mix(seed, 201) % 4]
    const STAFF = [8, 14, 20][mix(seed, 202) % 3]
    const DUR = [60, 90, 120, 240][mix(seed, 203) % 4]
    const b = boardBusyAt(seed, R, STAFF, DUR)
    return mix(seed, 204) % 2 === 0 ? b : { ...b, lanes: [...b.lanes, ...bedRows(`bed-foreign-trip-${seed}`)] }
  }

  it('≡ an exit-less reference on random boards — the SET always, the NAME wherever (d) did not decide', () => {
    // ⚖ D-50 (a) / D2 — the property body, run once per board FAMILY: the
    // original `board(seed)`, `boardWithForeignBed(seed)` (the M4 defeat of
    // (d)), and `boardBusy(seed)` (S1's sweep shape — staff density against a
    // small room count, the shape the first two families cannot produce). One
    // function, three calls — never copies of the loop to drift apart.
    const runFamily = (mkBoard: (seed: number) => ReturnType<typeof board>, familyName: string, seeds = 500) => {
      const setFails: string[] = []
      const nameFails: string[] = []
      const exitNamed: string[] = []
      let skipped = 0
      let withheldBoards = 0
      let namedBoards = 0
      let multiLossBoards = 0
      let fewerStaffThanRooms = 0
      let countDecidedOffers = 0
      let namesTheExitGivesUp = 0
      for (let seed = 0; seed < seeds; seed += 1) {
        const b = mkBoard(seed)
        const honest = honestHeld(b.candidates, b.lanes, b.book, true)
        // The equivalence argument assumes the netting FINISHED (see the module's own
        // ceiling note). `board`/`boardWithForeignBed` never trip it (too small);
        // `boardBusy` (staff up to 20, rooms down to 3) sometimes does — a SKIP,
        // never a set disagreement, tracked separately so a board this property
        // cannot fairly judge is not counted as a failure.
        // ⚖ R3 D2 fix B (L1 F2) — this SKIP used to be a hard `setFails.push`
        // failure on main; relaxed because `boardBusy` really does trip the
        // search budget (63/300 on the tip) and only that family may skip at all
        // — bounded below: `main`/`foreign` assert `skipped === 0`, `busy`
        // asserts `skipped < 150`.
        if (!honest.exact) { skipped += 1; continue }
        const w = withheldOffers(b.offers, honest, b.candidates, b.lanes, b.book, true)
        const want = reference(b.offers, honest, b.candidates, b.lanes, b.book)
        const byCount = countDecided(b.offers, honest, b.lanes)
        const where = `${familyName} seed ${seed} (${b.rooms.length} rooms · ${b.kept.length} 枠 · ${b.offers.length} offers)`
        if (w.keys.size) withheldBoards += 1
        if (want.named.size) namedBoards += 1
        if (want.multiLoss) multiLossBoards += 1
        if (b.kept.length < b.rooms.length) fewerStaffThanRooms += 1
        for (const key of byCount.keys()) {
          if (w.keys.has(key)) countDecidedOffers += 1
        }
        // (1) THE SET — every board, every offer.
        if (JSON.stringify(setOf(w)) !== JSON.stringify(want.keys)) {
          setFails.push(`${where} — module ${JSON.stringify(setOf(w))} · reference ${JSON.stringify(want.keys)}`)
        }
        // (2) THE NAME — on every offer (d) did not decide (this IS the
        // name-preservation pin: no other exit exists any more to give up a
        // name, so the walk must match the reference's name wherever (d) is
        // silent — the certifier does not change this, since none of these
        // boards ever trips the search budget).
        for (const o of b.offers) {
          if (byCount.has(o.key)) {
            if (w.blockedBy.has(o.key)) exitNamed.push(`${where} — offer ${o.key} named ${w.blockedBy.get(o.key)} out of (d)`)
            if (want.named.has(o.key)) namesTheExitGivesUp += 1
            continue
          }
          if (w.blockedBy.get(o.key) !== want.named.get(o.key)) {
            nameFails.push(`${where} — offer ${o.key}: module ${w.blockedBy.get(o.key) ?? '-'} · reference ${want.named.get(o.key) ?? '-'}`)
          }
        }
      }
      console.log(`exit equivalence (${familyName}): ${seeds} boards (${skipped} skipped, outer netting inexact) · ${withheldBoards} withheld something · ${namedBoards} named a 枠 · ${multiLossBoards} had a room losing two 枠 · ${fewerStaffThanRooms} had fewer staff rows than bed rows`)
      console.log(`  set disagreements = ${setFails.length} · name disagreements off (d) = ${nameFails.length} · names given out of (d) = ${exitNamed.length}`)
      console.log(`  decided by (d) = ${countDecidedOffers}, of which ${namesTheExitGivesUp} carry a rule-4 name (d) gives up (the generic line instead)`)
      return { setFails, nameFails, exitNamed, skipped, withheldBoards, namedBoards, multiLossBoards, fewerStaffThanRooms, countDecidedOffers }
    }

    const main = runFamily(board, 'board')
    expect(main.setFails).toEqual([])
    expect(main.nameFails).toEqual([])
    expect(main.exitNamed).toEqual([])
    // …and the loop is worth running: boards really do withhold, really do name,
    // and really do carry the shapes the mutants live in — so an 「always empty」
    // module could not pass by accident.
    expect(main.withheldBoards).toBeGreaterThan(0)
    expect(main.namedBoards).toBeGreaterThan(0)
    expect(main.multiLossBoards).toBeGreaterThan(0)
    expect(main.fewerStaffThanRooms).toBeGreaterThan(0)
    expect(main.countDecidedOffers).toBeGreaterThan(0)
    console.log('main.skipped =', main.skipped)
    expect(main.skipped).toBe(0)

    // ⚖ D-51 fold 1 — a store whose eligible rooms are a strict subset of the
    // board's (the M4 shape). (d) is provably silent on this family (a foreign
    // bed inflates `roomUniverse` beyond what `covering(t)` can ever reach) — so
    // the two OLD anti-vacuity asserts that used to isolate the (now-gone)
    // eligibility exit here (`exitDecidedOffers > 0` / `eligibilityDecidedOffers
    // > 0`) would go permanently RED under D2: PINNED instead as the silence
    // itself, plus the NAME-RESTORATION proof — the strict-subset family names
    // AGAIN, through the walk, on the exact shape D took names away from (S1
    // F1's own finding).
    const foreign = runFamily(boardWithForeignBed, 'boardWithForeignBed')
    expect(foreign.setFails).toEqual([])
    expect(foreign.nameFails).toEqual([])
    expect(foreign.exitNamed).toEqual([])
    expect(foreign.withheldBoards).toBeGreaterThan(0)
    expect(foreign.countDecidedOffers).toBe(0)
    expect(foreign.namedBoards).toBeGreaterThan(0)
    console.log('foreign.skipped =', foreign.skipped)
    expect(foreign.skipped).toBe(0)

    // ⚖ D-51 fold 2 — S1's own sweep shape (rooms 3–10, staff 8–20, a kept 枠 on
    // most rows): the family the first two are too small to produce, and the
    // one S1 F1 measured the (until now, disclosed-wrong) name cost on.
    const busy = runFamily(boardBusy, 'boardBusy', 300)
    expect(busy.setFails).toEqual([])
    expect(busy.nameFails).toEqual([])
    expect(busy.exitNamed).toEqual([])
    expect(busy.namedBoards).toBeGreaterThan(0)
    console.log('busy.skipped =', busy.skipped)
    expect(busy.skipped).toBeLessThan(150)
  })

  // ⚖ D-50 (a) / D2 item 7 — THE NAME-PRESERVATION PIN, EXPLICIT. S1's worst
  // cell (60 min · 5 rooms · 20 staff — 100% of base's names lost under merged
  // D) restored byte-for-byte: with no more pre-walk exit, `blockedBy` on the
  // module must equal the reference's `named` EXACTLY (the reference has no
  // certifier either — it is the exhaustive per-room walk v5 item 4 always
  // was), on every offer (d) did not decide — (d) itself is unchanged by D2 and
  // still never names (D-14 (d) (2)); this cell reaches it often (roomUniverse
  // 5, easy to saturate), verified live below rather than assumed.
  it('name-preservation pin, explicit: boardBusy at dur 60 · 5 rooms · 20 staff — blockedBy matches the reference exactly', () => {
    let checked = 0
    let namedCount = 0
    let countDecidedSkipped = 0
    for (let seed = 0; seed < 20; seed += 1) {
      const b = boardBusyAt(seed, 5, 20, 60)
      const honest = honestHeld(b.candidates, b.lanes, b.book, true)
      if (!honest.exact) continue
      const w = withheldOffers(b.offers, honest, b.candidates, b.lanes, b.book, true)
      const want = reference(b.offers, honest, b.candidates, b.lanes, b.book)
      const byCount = countDecided(b.offers, honest, b.lanes)
      for (const o of b.offers) {
        if (!w.keys.has(o.key)) continue // on sale — nothing to name either side
        if (byCount.has(o.key)) { countDecidedSkipped += 1; continue } // (d) never names — its own rule, unchanged
        checked += 1
        expect(w.blockedBy.get(o.key) ?? null).toEqual(want.named.get(o.key) ?? null)
        if (want.named.has(o.key)) namedCount += 1
      }
    }
    console.log('name-preservation pin: dur 60 · 5 rooms · 20 staff · 20 seeds ·', checked, 'offers checked (d)-undecided ·', namedCount, 'named ·', countDecidedSkipped, 'skipped as (d)-decided')
    expect(namedCount).toBeGreaterThan(0)
  })

  // ⚖ D-50 (b) (4) — S2 LEG 7, a permanent leg: `hit` is built by pure TIME
  // overlap with no store filter, so a held 枠 of a DIFFERENT store can sit in
  // `hit` for an offer that can never take its rooms — free work lost for (d)
  // and, when the walk goes short, the certifier too — but never a wrong
  // verdict, because the witness, the walk and the certifier all read the
  // OFFER's own store-aware candidate rooms, which `book.freeBedKeys` already
  // answers store-aware. x (store A) holds its only room a1; y (store B) holds
  // its only room b1 and overlaps x in TIME only; the offer (store A) wants
  // {a1, a2} — a2 is free (nobody's tie-break needs it) so the witness alone
  // proves it ON SALE, store-correctly, with y sitting uselessly in `hit`.
  it('S2 LEG 7 — a multi-store board: a held 枠 of the OTHER store sits in `hit` (no store filter) but the answer is still store-correct — the witness sells it', () => {
    const rows: Array<[string, number, number, string[]]> = [
      ['x', 600, 690, ['a1']],
      ['y', 605, 695, ['b1']],
      ['z', 610, 650, ['a1', 'a2']],
    ]
    const { book } = tableBook(rows)
    const candidates = rows.slice(0, 2).map(([k, s, e]) => maskOf(k, [span(s, e)]))
    const lanes = [lane('x', ['store-a']), lane('y', ['store-b']), ...bedRows('a1', 'a2', 'b1')]
    const honest = honestHeld(candidates, lanes, book, true)
    const offer: OfferAsk = { key: offerKey('z', 610), laneKey: 'z', start: 610, end: 650, stores: ['store-a'] }
    const w = withheldOffers([offer], honest, candidates, lanes, book, true)
    const want = reference([offer], honest, candidates, lanes, book)
    console.log('LEG7: withheld =', w.keys.has(offer.key), '· reference =', want.keys.includes(offer.key))
    expect(w.keys.has(offer.key)).toBe(want.keys.includes(offer.key))
    expect(w.keys.has(offer.key)).toBe(false)
  })

  // ⚖ D-17 / SPEC-R2 v7 — UNRESOLVED IS THE EXCEPTION, NOT THE ROAD. A restricted
  // walk that runs out of budget withholds on the safe side, and the answer says
  // so; these boards are far inside the node budget and never reach it, so a
  // non-empty count here would mean the restricted walk got HARDER than the
  // unrestricted one it replaced — the one regression v7 could cause.
  it('…and none of the 500 boards leaves an offer UNRESOLVED', () => {
    // ⚖ ROUND 3 · D — now also on `boardWithForeignBed` (the M4 defeat of (d)):
    // the same assertion, the same loop, over both families.
    for (const [familyName, mkBoard] of [['board', board], ['boardWithForeignBed', boardWithForeignBed]] as const) {
      const unresolvedOn: string[] = []
      const namedWhileUnresolved: string[] = []
      for (let seed = 0; seed < 500; seed += 1) {
        const b = mkBoard(seed)
        const honest = honestHeld(b.candidates, b.lanes, b.book, true)
        if (!honest.exact) continue
        const w = withheldOffers(b.offers, honest, b.candidates, b.lanes, b.book, true)
        if (w.unresolved.size) unresolvedOn.push(`${familyName} seed ${seed} — ${[...w.unresolved].join(', ')}`)
        // ⚖ D-18 (2) — an UNRESOLVED verdict never names. Vacuous on these 500
        // boards (none reach `short`, which is exactly what the leg above
        // already says) — the invariant stands as a stated contract here; the
        // leg below reaches a real inexact walk and proves it live.
        for (const k of w.unresolved) if (w.blockedBy.has(k)) namedWhileUnresolved.push(`${familyName} seed ${seed} — ${k}`)
      }
      console.log(`unresolved (${familyName}): ${unresolvedOn.length} of 500 boards`)
      expect(unresolvedOn).toEqual([])
      expect(namedWhileUnresolved).toEqual([])
    }
  })

  // ⚖ D-18 (2) MINOR 1 — a board whose RESTRICTED walk really does go inexact,
  // built by hand (the 500-seed boards are too small — the leg above says so).
  // A clique of N staff who can ALL use the same N−1 rooms (5-minute starts, 90
  // minutes long, so every pair overlaps) is EXACTLY `honest-held.test.ts`'s own
  // node-budget trip shape (`describe('honest-held — the node budget')`),
  // re-spelled here one room short of the staff count so even the OUTER netting
  // trips (`honest.exact === false`) rather than just the inner re-netting.
  it('a board whose restricted walk is short never lets `blockedBy` name a 枠 for it, certified or not (RED before ⚖ D-18 (2); ⚖ D-50 (a) — now certified, see below)', () => {
    const N = 15
    const R = N - 1
    const rooms = Array.from({ length: R }, (_, i) => `bed-${String(i + 1).padStart(2, '0')}`)
    const wins = Array.from({ length: N }, (_, i) => ({ laneKey: `p-${String(i).padStart(2, '0')}`, start: 600 + i * 5, end: 600 + i * 5 + 90 }))
    const { book } = stubBook(() => rooms)
    const candidates = wins.map((w) => maskOf(w.laneKey, [span(w.start, w.end)]))
    const lanes = wins.map((w) => lane(w.laneKey))
    const honest = honestHeld(candidates, lanes, book, true)
    // The scene IS the scene: the outer netting itself has to give up for this
    // leg to mean anything (an exact outer answer would make `heldOnly` below
    // trivially small and re-netting cheap — the 500-board leg's own case).
    expect(honest.exact).toBe(false)
    // A wide offer straddling the busiest part of the clique, on a lane that
    // holds nothing of its own.
    const mid = 600 + Math.floor((N - 1) / 2) * 5
    const offer: OfferAsk = { key: offerKey('x-offer', mid), laneKey: 'x-offer', start: mid, end: mid + 90, stores: null }
    const w = withheldOffers([offer], honest, candidates, lanes, book, true)
    // RED at 72cd65aff: this offer is UNRESOLVED (the restricted re-netting
    // inside `heldWithout` also gives up) and `blockerOf` still named a lane —
    // a box would print 「◯◯の確保枠が先のため」 on a loss the walk never proved.
    //
    // ⚖ D-50 (a) / D2 PIN MOVE (disclosed deviation, not named in the packet's
    // Commit 2 list — flagged for Fable): this board has NO bed rows
    // (`roomUniverse === 0`), and the certifier has no `roomUniverse` guard of
    // its own (D-50 (a): "the certifier's own premise guard = every covering
    // 枠 carries a non-empty `heldRooms` list" — nothing about room count). This
    // stub book answers the SAME 14-room list for every query, so every held
    // 枠's `heldRooms` is that full 14-room set; at the offer's busiest instant
    // all 14 held 枠 cover it at once (`n=14`), so `U(t)\{r}` has 13 members for
    // every candidate room `r` — `13 < 14` holds for every one of them, and the
    // certifier PROVES the loss (printed: `withheld true · unresolved false ·
    // blockedBy undefined`). The SET is unchanged (still withheld, still no
    // name — D-18 (2) holds); only the HONESTY of the `unresolved` flag moves,
    // which is the certifier's whole purpose (D-50 (a)).
    expect(w.unresolved.has(offer.key)).toBe(false)
    expect(w.keys.has(offer.key)).toBe(true)
    expect(w.blockedBy.has(offer.key)).toBe(false)
  })

  // D (D-51 (c) fix; mutant m5 · L2's `rooms.some` survivor). 200 `boardTrip`
  // seeds, kept whole (no exact-outer skip). For every board: the module's
  // withheld SET must equal the exit-less `reference`'s. For every offer the
  // module withholds: a FROM-SCRATCH `shortRef` (its own per-room blocked
  // re-net, never the module's `short`) and `hallRef` (Hall's one-instant
  // condition over the offer's start plus every overlapping held 枠's start AND
  // end, read off `honest.byLane[].heldRooms` directly, never the module's
  // `proved`) must together predict `w.unresolved.has(o.key)` exactly. Among the
  // offers the reference itself certifies (`shortRef && hallRef`), `endsNeeded`
  // counts the ones whose Hall proof needs an END instant and fails on starts
  // alone — the independent pin for mutant m5, asserted only if the run
  // actually finds one (never typed in advance).
  it('D — the certifier ≡ a from-scratch reference on budget-tripping boards (D-51 (c); mutant m5 · L2\'s `rooms.some` survivor)', () => {
    const SEEDS = 200
    let inexactBoards = 0
    let withheldOffersChecked = 0
    let certifiedOffers = 0
    let endsNeeded = 0
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const b = boardTrip(seed)
      const honest = honestHeld(b.candidates, b.lanes, b.book, true)
      if (!honest.exact) inexactBoards += 1
      const w = withheldOffers(b.offers, honest, b.candidates, b.lanes, b.book, true)
      const want = reference(b.offers, honest, b.candidates, b.lanes, b.book)

      // Budget for D (packet): a SET disagreement is a finding for Fable, never
      // a thing to "fix" in the module — print the board and stop asserting
      // further on it if this ever fires.
      if (JSON.stringify(setOf(w)) !== JSON.stringify(want.keys)) {
        const dump = honest.byLane.flatMap((l) => l.held.map((s, i) => ({ start: s.start, end: s.end, rooms: l.heldRooms[i] })))
        const events = [...new Set(dump.flatMap((s) => [s.start, s.end]))].sort((x, y) => x - y)
        console.log('D DISAGREEMENT — seed', seed, 'module', setOf(w), 'reference', want.keys)
        console.log('  U(t)/n(t) per instant:', events.map((t) => {
          const cover = dump.filter((s) => s.start <= t && t < s.end)
          return [t, [...new Set(cover.flatMap((s) => s.rooms))].sort(), cover.length]
        }))
      }
      expect(setOf(w)).toEqual(want.keys)

      const heldOnly = honest.byLane.filter((l) => l.held.length > 0).map(heldMaskOf)
      const wantIds = new Set(honest.byLane.flatMap((l) => l.held.map((s) => offerKey(l.laneKey, s.windowStart))))
      const heldSpansRef = honest.byLane.flatMap((l) => l.held.map((s, i) => ({ start: s.start, end: s.end, rooms: l.heldRooms[i] ?? [] })))

      for (const o of b.offers) {
        const rooms = b.book.freeBedKeys(o.start, o.end, { stores: o.stores })
        if (rooms.length === 0 || !w.keys.has(o.key)) continue
        withheldOffersChecked += 1

        // shortRef — re-net `heldOnly` with a blocked book spelled from scratch
        // per candidate room (the module's own three-line `blocked`, re-spelled
        // — not imported, not `blockedFor`).
        const blockedBook = (r: string): BedTruth =>
          Object.create(b.book, {
            freeBedKeys: {
              value: (s: number, e: number, asker: never) =>
                (s < o.end && o.start < e ? b.book.freeBedKeys(s, e, asker).filter((k) => k !== r) : b.book.freeBedKeys(s, e, asker)),
            },
          }) as BedTruth
        let anyInexact = false
        let anySeatsAll = false
        for (const r of rooms) {
          const walk = honestHeld(heldOnly, b.lanes, blockedBook(r), true)
          if (!walk.exact) anyInexact = true
          const heldWalkIds = new Set(walk.byLane.flatMap((l) => l.held.map((s) => offerKey(l.laneKey, s.windowStart))))
          if ([...wantIds].every((id) => heldWalkIds.has(id))) anySeatsAll = true
        }
        const shortRef = anyInexact && !anySeatsAll

        // hallRef — Hall's one-instant condition, read off `heldRooms` directly.
        const hit = heldSpansRef.filter((s) => o.start < s.end && s.start < o.end)
        const premise = hit.every((s) => s.rooms.length > 0)
        const withEnds = [o.start, ...hit.flatMap((s) => [s.start, s.end]).filter((t) => t > o.start && t < o.end)]
        const startsOnly = [o.start, ...hit.flatMap((s) => [s.start]).filter((t) => t > o.start && t < o.end)]
        const hallAt = (instants: number[]) => premise && rooms.every((r) =>
          instants.some((t) => {
            const cover = hit.filter((s) => s.start <= t && t < s.end)
            const u = new Set(cover.flatMap((s) => s.rooms))
            return u.size - (u.has(r) ? 1 : 0) < cover.length
          }))
        const hallRef = hallAt(withEnds)

        expect(w.unresolved.has(o.key)).toBe(shortRef && !hallRef)

        if (shortRef && hallRef) {
          certifiedOffers += 1
          if (!hallAt(startsOnly)) endsNeeded += 1
        }
      }
    }
    console.log(`D: ${SEEDS} boards (${inexactBoards} inexact-outer) · ${withheldOffersChecked} withheld offers checked · ${certifiedOffers} certified · endsNeeded = ${endsNeeded}`)
    expect(inexactBoards).toBeGreaterThan(0)
    // endsNeeded printed 0 on this run (200 seeds, 4 certified offers, none of
    // them needing an END instant to prove) — per the packet, no assertion is
    // typed here. Mutant m5 (`steps` starts-only) stays a DISCLOSED survivor:
    // sound (the safe direction — extra instants can only let the certifier
    // prove MORE true losses, never a false one) but unpinned by this property,
    // exactly as the whole-battery run already found it (⚖ D-51 (c)).
  })
})

// ⚖ D-17 / SPEC-R2 v7 — THE FALLBACK SEATS THE PUBLISHED SET, IT DOES NOT
// RE-OPTIMISE, and this is the Codex lens's own board made executable.
//
// Five compatible beds, eleven 90-minute candidates, one 13:00–14:00 offer whose
// two eligible rooms are both already carrying a published 枠. The old fallback
// re-netted ALL candidates with a room blocked and compared held IDs, so the
// blocked walk was free to return an equal-size set that REPLACED a published 枠
// — the layer then withheld an offer the store could sell. And because the swap
// comes out of `assign`'s own tie-break, a CONSISTENT RENAME of the bed keys
// (the same physical board, different strings) flipped the verdict.
//
// Restricted to the held set the question is the one D-12 always stated — 「can
// the PUBLISHED 枠 still be seated with room r blocked?」 — and the spelling of a
// bed cannot reach it.
describe('bed-aware-sales — ⚖ D-17 / v7: the fallback seats the published set', () => {
  /** The lens's board, physically fixed; only the bed STRINGS move. */
  const BEDS = ['r0', 'r2', 'r3', 'r4', 'r5']
  const OCC: Array<[string, number, number]> = [
    ['r0', 960, 1020],
    ['r2', 960, 1050],
    ['r3', 765, 795],
    ['r4', 810, 840],
    ['r5', 765, 795],
  ]
  const STARTS = [840, 990, 945, 930, 975, 840, 885, 990, 795, 900, 825]
  const OFFER: [number, number] = [780, 840]

  /** @param rename a consistent permutation of the bed keys — the board is the
   *    same physical room table under any of them, so every answer must be too. */
  const lensBoard = (rename: (k: string) => string) => {
    const beds = BEDS.map(rename)
    const occ = OCC.map(([k, s, e]) => [rename(k), s, e] as [string, number, number])
    const { book } = stubBook((start, end) =>
      beds.filter((b) => !occ.some(([k, s, e]) => k === b && s < end && start < e)),
    )
    const kept: Array<[string, number, number]> = STARTS.map((s, i) => [`L${i}`, s, s + 90])
    const candidates = kept.map(([k, s, e]) => maskOf(k, [span(s, e)]))
    const lanes = [...kept.map(([k]) => lane(k)), ...bedRows(...beds)]
    const offer: OfferAsk = { key: offerKey('L0', OFFER[0]), laneKey: 'L0', start: OFFER[0], end: OFFER[1], stores: null }
    return { book, candidates, lanes, offer, beds }
  }

  /** THE RESTRICTED WALK, run directly: can the PUBLISHED held set still be
   *  seated with `room` blocked over the offer's span? This is the witness the
   *  leg below asserts 「on sale」 with — it shares no code with the module. */
  const seatsPublishedWithout = (b: ReturnType<typeof lensBoard>, honest: ReturnType<typeof honestHeld>, room: string) => {
    const want = new Set(honest.byLane.flatMap((l) => l.held.map((s) => offerKey(l.laneKey, s.windowStart))))
    const heldOnly = b.candidates
      .map((m) => maskOf(m.laneKey, m.spans.filter((s) => want.has(offerKey(m.laneKey, s.windowStart))) as ReservedSpan[]))
      .filter((m) => m.spans.length > 0)
    const after = honestHeld(heldOnly, b.lanes, blockedFor(b.book, room, OFFER[0], OFFER[1]), true)
    const got = new Set(after.byLane.flatMap((l) => l.held.map((s) => offerKey(l.laneKey, s.windowStart))))
    return [...want].every((k) => got.has(k))
  }

  const verdict = (rename: (k: string) => string) => {
    const b = lensBoard(rename)
    const honest = honestHeld(b.candidates, b.lanes, b.book, true)
    const w = withheldOffers([b.offer], honest, b.candidates, b.lanes, b.book, true)
    return { b, honest, withheld: w.keys.has(b.offer.key) }
  }

  /** Consistent renames: the same physical board, different bed spellings. */
  const swap = (a: string, c: string) => (k: string) => (k === a ? c : k === c ? a : k)
  const RENAMES: Array<[string, (k: string) => string]> = [
    ['identity', (k) => k],
    ['r2↔r5', swap('r2', 'r5')],
    ['r0↔r3', swap('r0', 'r3')],
    ['r0↔r5', swap('r0', 'r5')],
    ['r3↔r4', swap('r3', 'r4')],
    ['reversed', (k) => BEDS[BEDS.length - 1 - BEDS.indexOf(k)]],
  ]

  it('the verdict is invariant under a consistent bed-key permutation, and the offer is ON SALE', () => {
    const base = verdict((k) => k)
    console.log(`lens board: honest.total = ${base.honest.total} · exact = ${base.honest.exact}`)
    // THE STATE v7 EXISTS FOR, asserted rather than assumed: this board's own
    // netting burns `HONEST_SEARCH_BUDGET`, which is exactly where the old
    // fallback's 「equal size ⇒ same set」 argument stops holding.
    expect(base.honest.exact).toBe(false)
    expect(base.honest.total).toBe(8)
    // The witness, computed from the board and not from the module: with EITHER
    // eligible room blocked, the published set still seats.
    const rooms = base.b.book.freeBedKeys(OFFER[0], OFFER[1], { stores: null })
    console.log(`  offer's eligible rooms = ${JSON.stringify(rooms)}`)
    for (const r of rooms) {
      expect({ room: r, seats: seatsPublishedWithout(base.b, base.honest, r) }).toEqual({ room: r, seats: true })
    }
    const got = RENAMES.map(([name, f]) => `${name}: ${verdict(f).withheld ? 'WITHHELD' : 'on sale'}`)
    console.log(`  verdicts under a consistent rename → ${got.join(' · ')}`)
    expect(got).toEqual(RENAMES.map(([name]) => `${name}: on sale`))
  })

  it('the demo fixture leaves nothing UNRESOLVED, and an empty answer carries a frozen empty set', () => {
    const f = fixture()
    const w = withheldOffers(f.offers, f.honest, f.candidates, f.lanes, f.book, true)
    console.log(`fixture: withheld ${[...w.keys].join(', ') || '-'} · unresolved ${w.unresolved.size}`)
    expect([...w.unresolved]).toEqual([])
    // …and the gate-off answer has the field too, so the screen's 「identity when
    // the set is empty」 reading still holds by reference.
    expect([...withheldOffers(f.offers, f.honest, f.candidates, f.lanes, f.book, false).unresolved]).toEqual([])
  })
})

// ⚖ D-50 (a) / D2 item 5 — THE CERTIFIER'S OWN LEGS. The walk must be SHORT for
// the certifier to be observable at all, so every board here mirrors
// `honest-held.test.ts`'s own node-budget trip shape (N lanes chained a few
// minutes apart, all 90 minutes long, sharing N−1 rooms — a full clique, one
// must always drop) rather than the tiny 500-seed families above, none of
// which ever reaches the search budget.
describe('bed-aware-sales — ⚖ D-50 (a) / D2: the certifier', () => {
  it('C1 — the D-18 (2) clique board PLUS 14 bed rows: decided by (d), not the certifier (a real finding, not assumed)', () => {
    // The exact N=15/R=14 clique from the D-18 (2) leg above, now WITH its own
    // 14 bed rows declared (the packet's own spec). Derive, never assume: with
    // roomUniverse === R === 14, the busiest instant has ALL 14 held 枠
    // covering it at once (`covering(t) === 14 === roomUniverse`), so (d) — the
    // OLDER, cheaper exit — fires FIRST and the walk never even starts. The
    // cold read flagged this exact risk (§5/Fold 4, "not resolved") and this is
    // its resolution: printed, not guessed.
    const N = 15
    const R = N - 1
    const rooms = Array.from({ length: R }, (_, i) => `bed-${String(i + 1).padStart(2, '0')}`)
    const wins = Array.from({ length: N }, (_, i) => ({ laneKey: `p-${String(i).padStart(2, '0')}`, start: 600 + i * 5, end: 600 + i * 5 + 90 }))
    const { book, asks } = stubBook(() => rooms)
    const candidates = wins.map((w) => maskOf(w.laneKey, [span(w.start, w.end)]))
    const lanes = [...wins.map((w) => lane(w.laneKey)), ...bedRows(...rooms)]
    const roomUniverse = lanes.filter((l) => l.group === 'beds').length
    const honest = honestHeld(candidates, lanes, book, true)
    expect({ roomUniverse, exact: honest.exact, total: honest.total }).toEqual({ roomUniverse: 14, exact: false, total: 14 })
    const mid = 600 + Math.floor((N - 1) / 2) * 5
    const offer: OfferAsk = { key: offerKey('x-offer', mid), laneKey: 'x-offer', start: mid, end: mid + 90, stores: null }
    // U(t)/n(t) at the busiest instant, derived independently of the module —
    // the same quantity (d) itself reads as `covering(t)` (no eligible-room
    // union needed for the COUNT exit; printed for the record the packet asks
    // for).
    const heldSpans = honest.byLane.flatMap((l) => l.held.map((s) => ({ start: s.start, end: s.end })))
    const n = (t: number) => heldSpans.filter((s) => s.start <= t && t < s.end).length
    const busiest = [...new Set(heldSpans.flatMap((s) => [s.start, s.end]))].sort((a, b) => a - b)
    console.log('C1 n(t) at every held-枠 boundary:', busiest.map((t) => [t, n(t)]))
    const before = asks.length
    const w = withheldOffers([offer], honest, candidates, lanes, book, true)
    const nettings = asks.length - before - 1
    console.log('C1: withheld =', w.keys.has(offer.key), 'nettings(raw asks) =', nettings, 'unresolved =', w.unresolved.has(offer.key), 'blockedBy =', w.blockedBy.get(offer.key))
    // DECIDED BY (d): zero nettings (the walk never runs), so `short` is never
    // even set — `unresolved` is false because nothing needed proving, not
    // because the certifier proved it.
    expect({ withheld: w.keys.has(offer.key), nettings, unresolved: w.unresolved.has(offer.key) }).toEqual({ withheld: true, nettings: 0, unresolved: false })
    expect(w.blockedBy.has(offer.key)).toBe(false)
  })

  it('C2 — the M4 shape in miniature: a foreign bed row keeps (d) silent, and the certifier PROVES the loss', () => {
    // The SAME clique, PLUS one MORE bed row the book never returns
    // (`roomUniverse` 15 while only 14 rooms are ever seatable — the M4 shape),
    // so `covering(t)` can never reach `roomUniverse` and (d) is silent. The
    // walk is short (proven at C1's board already — 14 held 枠, all in one
    // clique) and the certifier's own Hall check on `hit`'s `heldRooms` — the
    // full 14-room union at the busiest instant, margin exactly 13 < n=14 for
    // every one of the 14 candidate rooms — proves it with zero more nettings.
    const N = 15
    const R = N - 1
    const rooms = Array.from({ length: R }, (_, i) => `bed-${String(i + 1).padStart(2, '0')}`)
    const wins = Array.from({ length: N }, (_, i) => ({ laneKey: `p-${String(i).padStart(2, '0')}`, start: 600 + i * 5, end: 600 + i * 5 + 90 }))
    const { book, asks } = stubBook(() => rooms)
    const candidates = wins.map((w) => maskOf(w.laneKey, [span(w.start, w.end)]))
    const lanes = [...wins.map((w) => lane(w.laneKey)), ...bedRows(...rooms, 'bed-foreign')]
    const roomUniverse = lanes.filter((l) => l.group === 'beds').length
    const honest = honestHeld(candidates, lanes, book, true)
    expect({ roomUniverse, exact: honest.exact, total: honest.total }).toEqual({ roomUniverse: 15, exact: false, total: 14 })
    const mid = 600 + Math.floor((N - 1) / 2) * 5
    const offer: OfferAsk = { key: offerKey('x-offer', mid), laneKey: 'x-offer', start: mid, end: mid + 90, stores: null }
    const offerRooms = book.freeBedKeys(offer.start, offer.end, { stores: null })
    const heldSpans = honest.byLane.flatMap((l) => l.held.map((s, i) => ({ start: s.start, end: s.end, rooms: l.heldRooms[i] })))
    const hit = heldSpans.filter((s) => offer.start < s.end && s.start < offer.end)
    const covering = (t: number) => hit.filter((s) => s.start <= t && t < s.end).length
    const unionAt = (t: number) => new Set(hit.filter((s) => s.start <= t && t < s.end).flatMap((s) => s.rooms))
    console.log('C2 offerRooms =', offerRooms, 'hit.length =', hit.length)
    console.log('C2 U(t)/n(t) at every hit boundary:', [...new Set(hit.flatMap((s) => [s.start, s.end]))].sort((a, b) => a - b).map((t) => [t, unionAt(t).size, covering(t)]))
    // A (L1 F1) — the certifier's own precondition: block EVERY candidate room in
    // turn and confirm the restricted walk is really SHORT there, not merely that
    // the OUTER netting went inexact (blocking a room SHRINKS the search, so one
    // does not imply the other) — today only mutant m3 observes this. The
    // module's own three-line `blocked`, re-spelled here so this precondition
    // does not depend on the shared `blockedFor` test helper either.
    const heldOnly = honest.byLane.filter((l) => l.held.length > 0).map(heldMaskOf)
    const blockedBook = (r: string): BedTruth =>
      Object.create(book, {
        freeBedKeys: {
          value: (s: number, e: number, asker: never) =>
            (s < offer.end && offer.start < e ? book.freeBedKeys(s, e, asker).filter((k) => k !== r) : book.freeBedKeys(s, e, asker)),
        },
      }) as BedTruth
    const shortPerRoom = offerRooms.map((r) => honestHeld(heldOnly, lanes, blockedBook(r), true).exact === false)
    console.log('C2 per-room blocked walk exact===false (short):', shortPerRoom)
    expect(shortPerRoom.every(Boolean)).toBe(true)
    const before = asks.length
    const w = withheldOffers([offer], honest, candidates, lanes, book, true)
    const nettings = (asks.length - before - 1) / honest.total // one honestHeld call per candidate room, each asking heldOnly.length (= honest.total) times
    console.log('C2: withheld =', w.keys.has(offer.key), 'nettings =', nettings, 'unresolved =', w.unresolved.has(offer.key), 'blockedBy =', w.blockedBy.get(offer.key))
    expect({ withheld: w.keys.has(offer.key), nettings, unresolved: w.unresolved.has(offer.key) }).toEqual({ withheld: true, nettings: offerRooms.length, unresolved: false })
    expect(w.blockedBy.has(offer.key)).toBe(false)
  })

  it('C3 — the same board with the premise broken (identity honest): the certifier must NOT prove, and the walk\'s own verdict stands', () => {
    // `heldRooms` is `[]` on the identity path (the netting's own gate off), so
    // `hit.every(h => h.rooms.length > 0)` is false and `proved` can never be
    // true — whatever the (still real, still short) walk itself found stands.
    const N = 15
    const R = N - 1
    const rooms = Array.from({ length: R }, (_, i) => `bed-${String(i + 1).padStart(2, '0')}`)
    const wins = Array.from({ length: N }, (_, i) => ({ laneKey: `p-${String(i).padStart(2, '0')}`, start: 600 + i * 5, end: 600 + i * 5 + 90 }))
    const { book } = stubBook(() => rooms)
    const candidates = wins.map((w) => maskOf(w.laneKey, [span(w.start, w.end)]))
    const lanes = [...wins.map((w) => lane(w.laneKey)), ...bedRows(...rooms, 'bed-foreign')]
    const identity = honestHeld(candidates, lanes, book, false)
    console.log('C3 identity.exact =', identity.exact, 'identity.total =', identity.total)
    expect(identity.exact).toBe(true) // the identity path never searches — count only
    const mid = 600 + Math.floor((N - 1) / 2) * 5
    const offer: OfferAsk = { key: offerKey('x-offer', mid), laneKey: 'x-offer', start: mid, end: mid + 90, stores: null }
    const w = withheldOffers([offer], identity, candidates, lanes, book, true)
    console.log('C3: withheld =', w.keys.has(offer.key), 'unresolved =', w.unresolved.has(offer.key), 'blockedBy =', w.blockedBy.get(offer.key))
    // The certifier's premise is broken, so `unresolved` reverts to the walk's
    // own honest SHORT verdict — proving the guard is load-bearing, not
    // decorative (mutant m2 kills the same guard).
    expect({ withheld: w.keys.has(offer.key), unresolved: w.unresolved.has(offer.key) }).toEqual({ withheld: true, unresolved: true })
    expect(w.blockedBy.has(offer.key)).toBe(false)
  })

  it('C4 — the exact-equality boundary for `<` vs `<=` (mutant m6): one lane carries a spare 15th room, never refuted under strict `<`', () => {
    // Same clique, but lane p-00 (the earliest-held, per the walk's own
    // tie-break) has ONE EXTRA room (bed-15) nothing else can use. Wherever
    // p-00 covers (its own whole span, [600,690)), U(t) is the full 15-room
    // union — margin (for any of the standard 14 rooms) is 15−1 = 14, and n(t)
    // never exceeds 14 (only 14 rooms are ever actually seatable) — so margin
    // === n(t) EXACTLY at the busiest instant (`<` false, `<=` true), and NEVER
    // drops below it anywhere else in the span. A single-candidate-room offer
    // (rooms.length === 1 — the certifier has no gate on that any more) proves
    // the point cleanly.
    const N = 15
    const R = N - 1
    const cliqueRooms = Array.from({ length: R }, (_, i) => `bed-${String(i + 1).padStart(2, '0')}`)
    const wins = Array.from({ length: N }, (_, i) => ({ laneKey: `p-${String(i).padStart(2, '0')}`, start: 600 + i * 5, end: 600 + i * 5 + 90 }))
    const EXTRA = 'bed-15'
    const { book, asks } = stubBook((start, end) => {
      const w = wins.find((ww) => ww.start === start && ww.end === end)
      if (!w) return []
      return w.laneKey === 'p-00' ? [...cliqueRooms, EXTRA] : cliqueRooms
    })
    const candidates = wins.map((w) => maskOf(w.laneKey, [span(w.start, w.end)]))
    const lanes = [...wins.map((w) => lane(w.laneKey)), ...bedRows(...cliqueRooms, EXTRA)]
    const roomUniverse = lanes.filter((l) => l.group === 'beds').length
    const honest = honestHeld(candidates, lanes, book, true)
    expect({ roomUniverse, exact: honest.exact, total: honest.total }).toEqual({ roomUniverse: 15, exact: false, total: 14 })
    // U(t)/n(t), derived and printed at every event instant, confirming the
    // exact-equality claim rather than assuming it.
    const heldSpans = honest.byLane.flatMap((l) => l.held.map((s, i) => ({ start: s.start, end: s.end, rooms: l.heldRooms[i] })))
    const events = [...new Set(heldSpans.flatMap((s) => [s.start, s.end]))].sort((a, b) => a - b)
    const n = (t: number) => heldSpans.filter((s) => s.start <= t && t < s.end).length
    const unionAt = (t: number) => new Set(heldSpans.filter((s) => s.start <= t && t < s.end).flatMap((s) => s.rooms))
    console.log('C4 U(t)/n(t)/margin(for a standard room) at every event instant:', events.map((t) => [t, unionAt(t).size, n(t), unionAt(t).size - 1]))
    // The claim: margin (15−1=14, or 14−1=13 once p-00 stops covering) never
    // drops strictly below n(t) anywhere a held 枠 actually covers — confirmed
    // from the printed table. (An event instant with `n === 0`, e.g. the very
    // last 枠's own end, covers nothing and is outside Hall's domain — the
    // certifier's own `at.some(...)` never refutes on an empty cover either.)
    for (const t of events) if (n(t) > 0) expect(unionAt(t).size - 1).toBeGreaterThanOrEqual(n(t))
    // …and margin === n(t) EXACTLY at the busiest instant (p-13's start, the
    // moment all 14 held 枠 — including p-00 — cover at once).
    const peak = events.find((t) => n(t) === 14)!
    expect(unionAt(peak).size - 1).toBe(14)
    const offerBook: BedTruth = Object.create(book, {
      freeBedKeys: { value: (s: number, e: number, asker: never) => (s === 600 && e === 760 ? ['bed-05'] : book.freeBedKeys(s, e, asker)) },
    })
    const offer: OfferAsk = { key: offerKey('x-offer', 600), laneKey: 'x-offer', start: 600, end: 760, stores: null }
    const before = asks.length
    const w = withheldOffers([offer], honest, candidates, lanes, offerBook, true)
    const nettings = asks.length - before - 1
    console.log('C4: withheld =', w.keys.has(offer.key), 'nettings(raw asks) =', nettings, 'unresolved =', w.unresolved.has(offer.key), 'blockedBy =', w.blockedBy.get(offer.key))
    // Under the CORRECT `<`: never refuted (margin never strictly less than
    // n(t)) — the walk is short and the certifier correctly declines, so the
    // offer stays unresolved, exactly as C3 does when the premise is broken.
    expect({ withheld: w.keys.has(offer.key), unresolved: w.unresolved.has(offer.key) }).toEqual({ withheld: true, unresolved: true })
    expect(w.blockedBy.has(offer.key)).toBe(false)
  })
})
