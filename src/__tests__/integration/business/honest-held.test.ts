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

const winKey = (w: { laneKey: string; start: number }) => `${w.laneKey}|${w.start}`

/** The dumbest possible answer: enumerate every assignment of each 枠 to one of
 *  its rooms or to 「unfilled」, keep the legal ones, take the biggest.
 *
 *  HONEST-COUNT ROUND 1 · fix 2 (2026-09-13, CODEX-BLIND/CODEX-REPORT-HONEST-COUNT-REVIEW.md H1)
 *  — …AND WHICH 枠 THOSE ARE. The module's tie-break promises the
 *  lexicographically EARLIEST maximum-size held set, in the candidate order it
 *  sorts by — (start, laneKey) — so the oracle answers in that order too and
 *  names the set, not only its size. A size-only oracle cannot see a search
 *  that holds the right NUMBER of the wrong rows, which is the defect this
 *  fix is about. */
function bruteForce(wins: Win[]): { best: number; earliest: string[] } {
  // the module's own order (honest-held.ts's `flat.sort`), so 「earliest」 means
  // the same thing on both sides.
  const order = [...wins].sort((a, b) => (a.start === b.start ? (a.laneKey < b.laneKey ? -1 : a.laneKey > b.laneKey ? 1 : 0) : a.start - b.start))
  let combos: Array<Array<string | null>> = [[]]
  for (const w of order) {
    const next: Array<Array<string | null>> = []
    for (const c of combos) for (const r of [null, ...w.rooms]) next.push([...c, r])
    combos = next
  }
  // first position where one holds and the other does not decides; holding wins.
  const earlierThan = (a: Array<string | null>, b: Array<string | null>) => {
    for (let k = 0; k < a.length; k += 1) {
      if ((a[k] !== null) !== (b[k] !== null)) return a[k] !== null
    }
    return false
  }
  let best = 0
  let bestVec: Array<string | null> = order.map(() => null)
  for (const c of combos) {
    let ok = true
    for (let i = 0; i < order.length && ok; i += 1) {
      for (let j = i + 1; j < order.length; j += 1) {
        if (c[i] !== null && c[i] === c[j] && overlaps(order[i], order[j])) { ok = false; break }
      }
    }
    if (!ok) continue
    const size = c.filter((x) => x !== null).length
    if (size > best || (size === best && earlierThan(c, bestVec))) { best = size; bestVec = c }
  }
  return { best, earliest: order.filter((_, i) => bestVec[i] !== null).map(winKey) }
}

/** The 枠 the module actually held, keyed the way the oracle names them. */
const heldKeys = (h: HonestHeld) => h.byLane.flatMap((l) => l.held.map((s) => winKey({ laneKey: l.laneKey, start: s.windowStart }))).sort()

/** A seeded LCG. `Math.imul` is the whole generator — no dependency, and a
 *  failing seed is printed so the board can be rebuilt by hand. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

// HONEST-COUNT ROUND 1 · fix 3 (2026-09-13, BLIND-CODE-HONEST-COUNT/LENS-1b-delta-verify.md MAJOR 1)
// `maxN` is the only thing this round added: the 500-seed leg keeps its own
// boards byte for byte (the default is the 6 it always used), and the wider
// net below asks the same generator for boards the oracle can still afford.
function randomBoard(seed: number, len = 90, maxN = 6) {
  const r = rng(seed + 1)
  const rooms = ['bed-01', 'bed-02', 'bed-03'].slice(0, 1 + Math.floor(r() * 3))
  const n = 1 + Math.floor(r() * maxN)
  const wins: Win[] = []
  for (let i = 0; i < n; i += 1) {
    const start = 600 + Math.floor(r() * 12) * 15
    const mine = rooms.filter(() => r() < 0.6)
    wins.push({ laneKey: `p-${String(i).padStart(2, '0')}`, start, end: start + len, rooms: mine.length ? mine : [rooms[0]] })
  }
  const candidates = wins.map((w) => maskOf(w.laneKey, [span(w.start, len)]))
  // HONEST-COUNT ROUND 1 · fix 2 (2026-09-13, BLIND-CODE-HONEST-COUNT/LENS-1-delta.md NOTE 2)
  // Every lane carries its OWN store binding, so the stub book is keyed on
  // (lane, start) instead of on start alone. Two 枠 that begin at the same
  // minute on two rows now get their own room lists — which is what lets the
  // comparison below keep those boards instead of skipping them. Two staff free
  // at 14:00 is the normal board, not an edge.
  const lanes = wins.map((w) => lane(w.laneKey, [w.laneKey]))
  const book = stubBook((start, _end, stores) => wins.find((w) => w.start === start && w.laneKey === stores?.[0])?.rooms ?? [])
  return { wins, candidates, lanes, book }
}

describe('honest-held — against a brute-force oracle', () => {
  it('publishes exactly the maximum, legally, on 500 random small boards — boards where 枠 START TOGETHER included', () => {
    // HONEST-COUNT ROUND 1 · fix 2 (2026-09-13, BLIND-CODE-HONEST-COUNT/LENS-1-delta.md NOTE 2)
    // This loop used to `continue` past every board on which two 枠 begin at
    // the same minute, because the stub book could not tell the two rows apart.
    // The book is keyed on (lane, start) now, so nothing is skipped and the
    // commonest real board — two staff free at the same time — is in the
    // comparison.
    for (let seed = 0; seed < 500; seed += 1) {
      const { wins, candidates, lanes, book } = randomBoard(seed)
      const h = honestHeld(candidates, lanes, book, true)
      const want = bruteForce(wins)
      const roomsOf = new Map(wins.map((w) => [w.laneKey, w.rooms]))
      const held = h.byLane.flatMap((l) => l.held.map((s) => ({ rooms: roomsOf.get(l.laneKey)!, start: s.start, end: s.end })))
      expect({ seed, total: h.total, exact: h.exact, legal: feasible(held) }).toEqual({ seed, total: want.best, exact: true, legal: true })
      // HONEST-COUNT ROUND 1 · fix 2 (2026-09-13, CODEX H1) — …and it is the
      // EARLIEST maximum set, not merely one of them. The count alone cannot
      // see a search that holds the right number of the wrong rows.
      expect({ seed, held: heldKeys(h) }).toEqual({ seed, held: [...want.earliest].sort() })
      // Nothing is lost on the way out: held + shared is the input, per row.
      expect({ seed, kept: h.byLane.reduce((a, l) => a + l.held.length + l.shared.length, 0) }).toEqual({ seed, kept: wins.length })
    }
  })

  // HONEST-COUNT ROUND 1 · fix 3 (2026-09-13, BLIND-CODE-HONEST-COUNT/LENS-1b-delta-verify.md MAJOR 1)
  // THE ORDINARY BUSY BOARD: n staff whose 確保 枠 all overlap, and n rooms any
  // of them may use. Every 枠 is holdable, so the honest answer is n — and it is
  // exactly the board on which the size bound can never prune again, because
  // `bestSize` reaches the component's own length. Without a bound on the
  // TIE-BREAK the walk then enumerates every ROOM PERMUTATION of an answer it
  // already has, burns the node budget and publishes `exact: false` from n = 7
  // up. Seven staff with overlapping 枠 and seven free rooms is a real salon.
  const allHoldableBoard = (n: number) => {
    const rooms = Array.from({ length: n }, (_, i) => `bed-${String(i + 1).padStart(2, '0')}`)
    const wins: Win[] = Array.from({ length: n }, (_, i) => ({
      laneKey: `p-${String(i).padStart(2, '0')}`, start: 600 + i * 5, end: 600 + i * 5 + 90, rooms,
    }))
    return {
      wins,
      candidates: wins.map((w) => maskOf(w.laneKey, [span(w.start, 90)])),
      lanes: wins.map((w) => lane(w.laneKey)),
      book: stubBook(() => rooms),
    }
  }
  const allHoldable = (n: number) => {
    const { wins, candidates, lanes, book } = allHoldableBoard(n)
    const h = honestHeld(candidates, lanes, book, true)
    const roomsOf = new Map(wins.map((w) => [w.laneKey, w.rooms]))
    const held = h.byLane.flatMap((l) => l.held.map((s) => ({ rooms: roomsOf.get(l.laneKey)!, start: s.start, end: s.end })))
    return { total: h.total, exact: h.exact, shared: h.byLane.reduce((a, l) => a + l.shared.length, 0), legal: feasible(held) }
  }

  it('SEVEN staff, seven rooms, every 枠 holdable: all seven are held and the count is EXACT', () => {
    expect(allHoldable(7)).toEqual({ total: 7, exact: true, shared: 0, legal: true })
  })

  it('TWELVE staff, twelve rooms, every 枠 holdable: still all of them, still EXACT', () => {
    expect(allHoldable(12)).toEqual({ total: 12, exact: true, shared: 0, legal: true })
  })

  it('the wider net: 200 seeds, up to EIGHT 枠 and three rooms — the total, the earliest set AND exactness', () => {
    // HONEST-COUNT ROUND 1 · fix 3 (2026-09-13, BLIND-CODE-HONEST-COUNT/LENS-1b-delta-verify.md MAJOR 1)
    // The 500-seed leg's boards (1–6 枠, 1–3 rooms) are too small to trip the
    // bound. These are as wide as the oracle can still afford — it enumerates
    // (rooms+1)^n ≤ 4^8 = 65,536 assignments per board — and they are asked the
    // whole question: the number, WHICH 枠, and whether the search finished.
    // Every disagreement is collected rather than thrown at, so the first
    // failing seed is printed and the board can be rebuilt by hand from it.
    const fails: string[] = []
    for (let seed = 0; seed < 200; seed += 1) {
      const { wins, candidates, lanes, book } = randomBoard(seed, 90, 8)
      const h = honestHeld(candidates, lanes, book, true)
      const want = bruteForce(wins)
      const got = { total: h.total, exact: h.exact, held: heldKeys(h) }
      const wanted = { total: want.best, exact: true, held: [...want.earliest].sort() }
      if (JSON.stringify(got) !== JSON.stringify(wanted)) {
        fails.push(`seed ${seed} (${wins.length} 枠) — module ${JSON.stringify(got)} · oracle ${JSON.stringify(wanted)}`)
      }
    }
    if (fails.length > 0) console.log(`\nWIDER NET — first failing seed: ${fails[0]}\n(${fails.length} of 200 boards disagree)\n`)
    expect({ boards: 200, disagreeing: fails.length, first: fails[0] ?? '(none)' }).toEqual({ boards: 200, disagreeing: 0, first: '(none)' })
  })

  it('a room a floating 枠 could take is LEFT for the row that has no other — the earliest set of its size wins', () => {
    // HONEST-COUNT ROUND 1 · fix 2 (2026-09-13, CODEX-BLIND/CODEX-REPORT-HONEST-COUNT-REVIEW.md H1)
    // Codex's three-row board. あ floats (either room), い can only use ベッド1,
    // う only ベッド2, and all three overlap — so two is the most the store can
    // honour, three different ways. Trying rooms in order reaches あ→1, い lost,
    // う→2 FIRST; the answer the tie-break promises is あ+い, because い starts
    // before う and the rule is 「the earlier 枠 survives」. Holding the right
    // NUMBER of the wrong rows is invisible to a count.
    const rooms = (start: number) => (start === 600 ? ['bed-01', 'bed-02'] : start === 615 ? ['bed-01'] : ['bed-02'])
    const wins: Win[] = [
      { laneKey: 'p-01', start: 600, end: 690, rooms: rooms(600) },
      { laneKey: 'p-02', start: 615, end: 705, rooms: rooms(615) },
      { laneKey: 'p-03', start: 630, end: 720, rooms: rooms(630) },
    ]
    const h = honestHeld(
      wins.map((w) => maskOf(w.laneKey, [span(w.start, 90)])),
      wins.map((w) => lane(w.laneKey)),
      stubBook((start) => rooms(start)),
      true,
    )
    const want = bruteForce(wins)
    expect({ total: h.total, oracle: want.best, held: heldKeys(h), earliest: want.earliest }).toEqual({
      total: 2, oracle: 2, held: ['p-01|600', 'p-02|615'], earliest: ['p-01|600', 'p-02|615'],
    })
    expect(picture(h).shared).toEqual(['p-03 10:30-12:00→bed-02 with p-01'])
  })

  it('same size, different set: the 枠 with a second room steps aside for the one without', () => {
    // HONEST-COUNT ROUND 1 · fix 2 (2026-09-13, CODEX H1) — the same defect on a
    // board where the LAST row is the flexible one: あ and う can use either
    // room, い only ベッド1. Two is the maximum either way; あ+い is the earlier
    // set and the room-first walk finds あ+う first.
    const rooms = (start: number) => (start === 615 ? ['bed-01'] : ['bed-01', 'bed-02'])
    const wins: Win[] = [
      { laneKey: 'p-01', start: 600, end: 690, rooms: rooms(600) },
      { laneKey: 'p-02', start: 615, end: 705, rooms: rooms(615) },
      { laneKey: 'p-03', start: 630, end: 720, rooms: rooms(630) },
    ]
    const h = honestHeld(
      wins.map((w) => maskOf(w.laneKey, [span(w.start, 90)])),
      wins.map((w) => lane(w.laneKey)),
      stubBook((start) => rooms(start)),
      true,
    )
    const want = bruteForce(wins)
    expect({ total: h.total, oracle: want.best, held: heldKeys(h), earliest: want.earliest }).toEqual({
      total: 2, oracle: 2, held: ['p-01|600', 'p-02|615'], earliest: ['p-01|600', 'p-02|615'],
    })
  })

  it('one lane, two 枠, one room: the earlier is held, the later is shared, and it names the lane itself', () => {
    // HONEST-COUNT ROUND 1 · fix 2 (2026-09-13, BLIND-CODE-HONEST-COUNT/LENS-1-delta.md NOTE 2)
    // A lane can publish more than one 枠 (pocket order), and the per-lane
    // rebuild keys on `${laneKey}|${windowStart}` — this is the board that key
    // has to survive. Both 枠 want ベッド1 and they overlap, so the partner the
    // shared one names is its own row.
    const book = stubBook((start, _end, stores) => (stores?.[0] === 'p-01' && (start === 600 || start === 660) ? ['bed-01'] : []))
    const h = honestHeld([maskOf('p-01', [span(600, 90), span(660, 90)])], [lane('p-01', ['p-01'])], book, true)
    expect(picture(h)).toEqual({
      held: ['p-01 10:00-11:30'],
      shared: ['p-01 11:00-12:30→bed-01 with p-01'],
      total: 1,
      exact: true,
    })
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

describe('heldMaskOf', () => {
  it('is a rename, so the online 確保 rows are the honest held 枠 by construction', () => {
    const h = honestHeld(fixtureCandidates(), fixtureLanes(), fixtureBook(), true)
    const p06 = h.byLane.find((l) => l.laneKey === 'p-06')!
    const p05 = h.byLane.find((l) => l.laneKey === 'p-05')!
    expect(heldMaskOf(p06)).toEqual({ laneKey: 'p-06', spans: [], protectedCount: 0 })
    expect(heldMaskOf(p05)).toEqual({ laneKey: 'p-05', spans: p05.held, protectedCount: 1 })
  })
})
