// THE HONEST 確保 COUNT — the netting's own suite (honest-count round 1, 2026-09-13).
//
// The module answers one question — 「of the 枠 the guard holds, which set can
// the store's ROOMS honour at the same time?」 — so this file asks it four ways:
// against the demo fixture's own room table (PIN-HONEST-COUNT §1, byte for
// byte), against a brute-force oracle on 500 random small boards, against a
// board big enough to trip the node budget, and against the two invariants the
// search leans on (equal-length spans, a deterministic order).
//
// The book is a STUB here on purpose. `freeBedKeys` is the only question the
// module asks, `capacity-ledger.ts` has its own suite for how that answer is
// produced, and a real book would make these cases about the fixture rather
// than about the netting.

import {
  demoteShared,
  heldMaskOf,
  honestHeld,
  HONEST_SEARCH_BUDGET,
  type HonestHeld,
} from '@/app/[locale]/(business)/business/today/honest-held'
import type { BedTruth } from '@/app/[locale]/(business)/business/today/capacity-ledger'
import type { ReservedLaneMask, ReservedSpan } from '@/app/[locale]/(business)/business/today/reserved-mask'
import type { BoardLane } from '@/business/lib/today-board'

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const span = (start: number, len: number): ReservedSpan => ({ start, end: start + len, windowStart: start })
const maskOf = (laneKey: string, spans: ReservedSpan[]): ReservedLaneMask => ({ laneKey, spans, protectedCount: spans.length })
const lane = (key: string, stores: string[] | null = null) => ({ key, label: key, group: 'staff', stores } as unknown as BoardLane)

/** A book that answers `freeBedKeys` out of a table and refuses every other
 *  question — the module may not quietly grow a second one. */
function stubBook(rooms: (start: number, end: number, stores: string[] | null) => readonly string[]): BedTruth {
  const no = (q: string) => () => { throw new Error(`honest-held asked the book ${q}, which it may not`) }
  return {
    frame: { openMin: 600, closeMin: 1140, nowMin: 600 },
    stats: { allocateBedCalls: 0, storeBindings: 0 },
    freeBedKeys: (start, end, asker) => rooms(start, end, (asker as { stores: string[] | null }).stores),
    bedFor: no('bedFor') as BedTruth['bedFor'],
    freeBedCount: no('freeBedCount') as BedTruth['freeBedCount'],
    fullRuns: no('fullRuns') as BedTruth['fullRuns'],
    newClientMask: no('newClientMask') as BedTruth['newClientMask'],
  }
}

const picture = (h: HonestHeld) => ({
  held: h.byLane.flatMap((l) => l.held.map((s) => `${l.laneKey} ${hhmm(s.start)}-${hhmm(s.end)}`)),
  shared: h.byLane.flatMap((l) => l.shared.map((s) => `${l.laneKey} ${hhmm(s.start)}-${hhmm(s.end)}→${s.sharedRoom} with ${s.withLaneKey || '(nobody)'}`)),
  total: h.total,
  exact: h.exact,
})

// ── the demo fixture's own table (PIN-HONEST-COUNT §1) ──────────────────────
// 枠 / 時間 / the rooms free for the WHOLE span, as the book answered them on
// origin/main. Never edited to match the code: if the module reads it
// differently the numbers below move and the test says so.
const FIXTURE: Array<[string, number, number, string[]]> = [
  ['c-03', 17 * 60 + 30, 19 * 60, ['bed-01', 'bed-03']],
  ['p-04', 15 * 60 + 45, 17 * 60 + 15, ['bed-01']],
  ['p-05', 14 * 60 + 30, 16 * 60, ['bed-02']],
  ['p-06', 15 * 60 + 5, 16 * 60 + 35, ['bed-02']],
]
const fixtureCandidates = () => FIXTURE.map(([k, s, e]) => maskOf(k, [span(s, e - s)]))
const fixtureLanes = () => FIXTURE.map(([k]) => lane(k))
const fixtureBook = () =>
  stubBook((start) => FIXTURE.find(([, s]) => s === start)?.[3] ?? [])

describe('honest-held — the fixture', () => {
  it('holds THREE of the four 枠, and the one it cannot honour names the room and the partner', () => {
    const h = honestHeld(fixtureCandidates(), fixtureLanes(), fixtureBook(), true)
    expect(picture(h)).toEqual({
      held: ['c-03 17:30-19:00', 'p-04 15:45-17:15', 'p-05 14:30-16:00'],
      // ⚖ SPEC §2.2's tie-break — the EARLIER-starting 枠 survives, so ごろう
      // (p-05, 14:30) keeps ベッド2 and あずさ (p-06, 15:05) is the shared one.
      // Both existing pins that expect p-05's span to survive stay green
      // (fallback-cells.test.ts:735, selling-engine-doors.test.ts:1112).
      shared: ['p-06 15:05-16:35→bed-02 with p-05'],
      total: 3,
      exact: true,
    })
  })

  it('every held 枠 has one of its OWN rooms, and no two held 枠 share a room while overlapping', () => {
    const h = honestHeld(fixtureCandidates(), fixtureLanes(), fixtureBook(), true)
    const rooms = new Map(FIXTURE.map(([k, s, , r]) => [`${k}|${s}`, r]))
    const placed: Array<{ room: string; start: number; end: number }> = []
    for (const l of h.byLane) {
      l.held.forEach((s, i) => {
        const own = rooms.get(`${l.laneKey}|${s.windowStart}`)!
        // `heldRooms[i]` is the room list this 枠 could use — the same list the
        // book answered, so the room line on a box reads one vocabulary.
        expect({ at: `${l.laneKey} ${hhmm(s.start)}`, rooms: [...l.heldRooms[i]] }).toEqual({ at: `${l.laneKey} ${hhmm(s.start)}`, rooms: own })
        placed.push({ room: own[0], start: s.start, end: s.end })
      })
    }
    // Legality is asserted against the ORACLE below on 500 random boards; here
    // it is asserted on the one board a human can check by hand.
    const legalAssignment = feasible(
      h.byLane.flatMap((l) => l.held.map((s) => ({ rooms: rooms.get(`${l.laneKey}|${s.windowStart}`)!, start: s.start, end: s.end }))),
    )
    expect({ placed: placed.length, legal: legalAssignment }).toEqual({ placed: 3, legal: true })
  })

  it('the gate off is the identity — every candidate held, nothing shared, the book never asked', () => {
    const never = stubBook(() => { throw new Error('the book was asked with the gate off') })
    const h = honestHeld(fixtureCandidates(), fixtureLanes(), never, false)
    expect({ total: h.total, shared: h.byLane.flatMap((l) => l.shared), exact: h.exact }).toEqual({ total: 4, shared: [], exact: true })
  })

  it('an unequal-length 枠 throws rather than publishing a number nobody can honour', () => {
    const bad = [maskOf('p-05', [span(870, 90)]), maskOf('p-06', [span(905, 60)])]
    expect(() => honestHeld(bad, [lane('p-05'), lane('p-06')], stubBook(() => ['bed-02']), true)).toThrow(
      /every 確保 枠 must be the store's own protected duration/,
    )
  })

  it('asks the book on the LANE\u2019s own store binding, never on 「any room anywhere」', () => {
    // ⚖ the store-isolation law: `{ stores: null }` means a floating asker and
    // is answered with every room on the board. Asking it on behalf of a lane
    // that HAS a store would offer a 店舗B room to a 店舗A customer — and here
    // it would also hand two colliding 枠 a room each and publish a number the
    // store cannot honour.
    const a = lane('p-05', ['store-a'])
    const b = lane('p-06', ['store-a'])
    const book = stubBook((_start, _end, stores) => (stores === null ? ['bed-01', 'bed-02'] : ['bed-02']))
    const h = honestHeld([maskOf('p-05', [span(870, 90)]), maskOf('p-06', [span(905, 90)])], [a, b], book, true)
    expect({ total: h.total, shared: h.byLane.filter((l) => l.shared.length > 0).map((l) => l.laneKey) }).toEqual({ total: 1, shared: ['p-06'] })
  })

  it('answers the same thing whatever order the rows arrive in', () => {
    // The sort by (start, laneKey) is what makes a published number independent
    // of the lane loop's order. Same board, rows reversed.
    const fwd = honestHeld(fixtureCandidates(), fixtureLanes(), fixtureBook(), true)
    const rev = honestHeld([...fixtureCandidates()].reverse(), [...fixtureLanes()].reverse(), fixtureBook(), true)
    const flat = (h: HonestHeld) => ({
      held: h.byLane.flatMap((l) => l.held.map((s) => `${l.laneKey} ${hhmm(s.start)}`)).sort(),
      shared: h.byLane.flatMap((l) => l.shared.map((s) => `${l.laneKey} ${hhmm(s.start)}`)).sort(),
      total: h.total,
    })
    expect(flat(rev)).toEqual(flat(fwd))
  })

  it('a row the world does not carry gets no rooms and is never counted', () => {
    // The lane lookup misses, so the 枠 has no room it can name — it is shared
    // with nobody rather than silently held.
    const h = honestHeld([maskOf('ghost', [span(600, 90)])], [], stubBook(() => ['bed-01']), true)
    expect(picture(h)).toEqual({ held: [], shared: ['ghost 10:00-11:30→ with (nobody)'], total: 0, exact: true })
  })
})

// ── the oracle: every assignment, legality by hand ──────────────────────────
type Win = { laneKey: string; start: number; end: number; rooms: readonly string[] }
const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end

/** Is there a legal seating for these 枠 at all? (each one gets one of its own
 *  rooms; two on one room never overlap) */
function feasible(wins: Array<{ rooms: readonly string[]; start: number; end: number }>): boolean {
  const walk = (i: number, taken: Array<{ room: string; start: number; end: number }>): boolean => {
    if (i === wins.length) return true
    for (const r of wins[i].rooms) {
      if (taken.some((t) => t.room === r && overlaps(t, wins[i]))) continue
      if (walk(i + 1, [...taken, { room: r, start: wins[i].start, end: wins[i].end }])) return true
    }
    return false
  }
  return walk(0, [])
}

/** The dumbest possible answer: enumerate every assignment of each 枠 to one of
 *  its rooms or to 「unfilled」, keep the legal ones, take the biggest. */
function bruteForce(wins: Win[]): number {
  let combos: Array<Array<string | null>> = [[]]
  for (const w of wins) {
    const next: Array<Array<string | null>> = []
    for (const c of combos) for (const r of [null, ...w.rooms]) next.push([...c, r])
    combos = next
  }
  let best = 0
  for (const c of combos) {
    let ok = true
    for (let i = 0; i < wins.length && ok; i += 1) {
      for (let j = i + 1; j < wins.length; j += 1) {
        if (c[i] !== null && c[i] === c[j] && overlaps(wins[i], wins[j])) { ok = false; break }
      }
    }
    if (ok) best = Math.max(best, c.filter((x) => x !== null).length)
  }
  return best
}

/** A seeded LCG. `Math.imul` is the whole generator — no dependency, and a
 *  failing seed is printed so the board can be rebuilt by hand. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function randomBoard(seed: number, len = 90) {
  const r = rng(seed + 1)
  const rooms = ['bed-01', 'bed-02', 'bed-03'].slice(0, 1 + Math.floor(r() * 3))
  const n = 1 + Math.floor(r() * 6)
  const wins: Win[] = []
  for (let i = 0; i < n; i += 1) {
    const start = 600 + Math.floor(r() * 12) * 15
    const mine = rooms.filter(() => r() < 0.6)
    wins.push({ laneKey: `p-${String(i).padStart(2, '0')}`, start, end: start + len, rooms: mine.length ? mine : [rooms[0]] })
  }
  const candidates = wins.map((w) => maskOf(w.laneKey, [span(w.start, len)]))
  const lanes = wins.map((w) => lane(w.laneKey))
  const book = stubBook((start) => wins.find((w) => w.start === start)?.rooms ?? [])
  return { wins, candidates, lanes, book }
}

describe('honest-held — against a brute-force oracle', () => {
  it('publishes exactly the maximum, legally, on 500 random small boards', () => {
    for (let seed = 0; seed < 500; seed += 1) {
      const { wins, candidates, lanes, book } = randomBoard(seed)
      // One lane per 枠 here, so a lane's rooms are found by START — two 枠 at
      // the same start on different lanes would collide in the stub. Skipped
      // rather than papered over; the fixture case covers distinct starts.
      if (new Set(wins.map((w) => w.start)).size !== wins.length) continue
      const h = honestHeld(candidates, lanes, book, true)
      const want = bruteForce(wins)
      const roomsOf = new Map(wins.map((w) => [w.laneKey, w.rooms]))
      const held = h.byLane.flatMap((l) => l.held.map((s) => ({ rooms: roomsOf.get(l.laneKey)!, start: s.start, end: s.end })))
      expect({ seed, total: h.total, exact: h.exact, legal: feasible(held) }).toEqual({ seed, total: want, exact: true, legal: true })
      // Nothing is lost on the way out: held + shared is the input, per row.
      expect({ seed, kept: h.byLane.reduce((a, l) => a + l.held.length + l.shared.length, 0) }).toEqual({ seed, kept: wins.length })
    }
  })
})

describe('honest-held — the node budget', () => {
  // A single overlap component long enough that the exact search gives up: 24
  // 枠 chained 30 minutes apart, each 90 long, each with two rooms.
  const tripBoard = () => {
    const wins: Win[] = []
    for (let i = 0; i < 24; i += 1) {
      wins.push({ laneKey: `p-${String(i).padStart(2, '0')}`, start: 600 + i * 30, end: 600 + i * 30 + 90, rooms: ['bed-01', 'bed-02'] })
    }
    return {
      wins,
      candidates: wins.map((w) => maskOf(w.laneKey, [span(w.start, 90)])),
      lanes: wins.map((w) => lane(w.laneKey)),
      book: stubBook((start) => wins.find((w) => w.start === start)?.rooms ?? []),
    }
  }

  it('gives up loudly: the answer stays LEGAL and never exceeds the true maximum', () => {
    const { wins, candidates, lanes, book } = tripBoard()
    const h = honestHeld(candidates, lanes, book, true)
    const roomsOf = new Map(wins.map((w) => [w.laneKey, w.rooms]))
    const held = h.byLane.flatMap((l) => l.held.map((s) => ({ rooms: roomsOf.get(l.laneKey)!, start: s.start, end: s.end })))
    // The true maximum on this chain is 2 rooms × the disjoint runs each can
    // take; whatever it is, an inexact answer may be under it and never over.
    const ceiling = 2 * Math.ceil((wins[wins.length - 1].end - wins[0].start) / 90)
    expect({ budget: HONEST_SEARCH_BUDGET, exact: h.exact, legal: feasible(held), overCeiling: h.total > ceiling }).toEqual({
      budget: 4096,
      exact: false,
      legal: true,
      overCeiling: false,
    })
  })

  it('and it answers the same thing twice — the published number never depends on traversal luck', () => {
    const a = tripBoard()
    const b = tripBoard()
    expect(picture(honestHeld(a.candidates, a.lanes, a.book, true))).toEqual(picture(honestHeld(b.candidates, b.lanes, b.book, true)))
  })
})

describe('demoteShared — the board world', () => {
  const settled = () => honestHeld(fixtureCandidates(), fixtureLanes(), fixtureBook(), true)

  it('drops a board-world span that OVERLAPS a settled shared 枠, not only one with the same start', () => {
    // ⚖ v3 N4(2) — the board world cuts its pockets with the hand lifted, so a
    // lift can re-enumerate あずさ's 枠 five minutes along. An exact-start key
    // would miss it and the strip would speak 新規用 over a 枠 the chip does not
    // count.
    const board = [maskOf('p-05', [span(870, 90)]), maskOf('p-06', [span(910, 90)])]
    const out = demoteShared(board, settled())!
    expect(out.map((m) => ({ laneKey: m.laneKey, spans: m.spans.map((s) => hhmm(s.start)), n: m.protectedCount }))).toEqual([
      { laneKey: 'p-05', spans: ['14:30'], n: 1 },
      { laneKey: 'p-06', spans: [], n: 0 },
    ])
  })

  it('keeps a span on the SAME lane that does not overlap the shared one', () => {
    // The key is lane + OVERLAP, and the overlap test is a real half-open
    // interval test on BOTH sides: あずさ's own earlier 枠 (08:00-09:30, nowhere
    // near her shared 15:05-16:35) is not the 枠 the settled board demoted, and
    // the rail must keep speaking over it. A one-sided test (`a.start < b.end`
    // alone) would swallow every span earlier in the day.
    const board = [maskOf('p-06', [span(480, 90), span(905, 90), span(1020, 90)])]
    const out = demoteShared(board, settled())!
    expect(out[0].spans.map((s) => hhmm(s.start))).toEqual(['08:00', '17:00'])
  })

  it('is the IDENTITY when nothing is shared, so the gate off is the board that ships', () => {
    const board = [maskOf('p-05', [span(870, 90)])]
    const nothingShared = honestHeld(fixtureCandidates().slice(0, 2), fixtureLanes().slice(0, 2), fixtureBook(), true)
    expect(demoteShared(board, nothingShared)).toBe(board)
    expect(demoteShared(board, undefined)).toBe(board)
    expect(demoteShared(undefined, settled())).toBeUndefined()
  })
})

describe('heldMaskOf', () => {
  it('is a rename, so the online 確保 rows are the honest held 枠 by construction', () => {
    const h = honestHeld(fixtureCandidates(), fixtureLanes(), fixtureBook(), true)
    const p06 = h.byLane.find((l) => l.laneKey === 'p-06')!
    const p05 = h.byLane.find((l) => l.laneKey === 'p-05')!
    expect(heldMaskOf(p06)).toEqual({ laneKey: 'p-06', spans: [], protectedCount: 0 })
    expect(heldMaskOf(p05)).toEqual({ laneKey: 'p-05', spans: p05.held, protectedCount: 1 })
  })
})
