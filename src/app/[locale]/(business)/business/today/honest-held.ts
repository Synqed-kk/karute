// 今日の運営 — THE HONEST 確保 COUNT: which held 枠 the store's ROOMS can honour
// at the same time. Pure, DARK on its own branch.
//
// ⚖ Liam 2026-09-12 21:1x — 「the 新規用に確保 number = WHAT CAN BE HONOURED」.
// The board used to publish one 枠 per staff row per pocket and never asked
// whether a ROOM was free for all of them at once: on the demo store four 枠
// were published and only three could ever be given to a customer, because two
// of them (ごろう 14:30–16:00 and あずさ 15:05–16:35) each had exactly one free
// room, the same one, over hours that overlap. This module is the question
// 「which set can the rooms honour together?」 and nothing else.
//
// WHERE IT SITS. Phase 1.5: after the per-lane enumeration (`reserved-mask.ts`,
// byte-untouched, whose own header forbids it from knowing `locked` or the
// publication filter) and after the caller's own locked-lane filter, ONCE per
// SETTLED board. The board world — the per-pointer-frame mask the staff door
// reads — is never netted; it is handed the settled answer's shared spans and
// demotes them (`demoteShared`), which is one Set-free overlap test per span.
//
// IT DECIDES NOTHING ABOUT WHAT IS SOLD. A 枠 this module calls SHARED keeps
// every other property it had: its minutes stay withheld from online sale, stay
// out of the gap layer's input space, and stay covered against the 清掃 wash.
// The caller keeps passing the UNCHANGED mask to those three seams. What
// changes is what the store SAYS it can honour.
//
// THE CAPACITY UNIT, STATED. 「one 枠 needs one room for its whole span」 — the
// same unit `newClientMask` already answers on (`capacity-ledger.ts:511-534`),
// asked here through `freeBedKeys` with the lane's own store binding. Its
// ceiling is inherited and named rather than papered over: `freeBedKeys` routes
// through `allocateBed`, which approves a booking whose own 清掃 tail cannot fit
// (the adjudication's F10). Every fixture room is `cleanup_minutes: 0` and
// nothing writes the 設定 dial at this SHA, so it is invisible today; it belongs
// to the 清掃 family round, and it is said here so nobody re-hunts it.
//
// NO CYCLE, BY CONSTRUCTION: every import below is a TYPE. This file names
// nothing from `today-interactions` and nothing from the screen, so it can be
// applied at the screen without an edge back into the layer files.

import type { BoardLane } from '@/business/lib/today-board'
import type { BedTruth } from './capacity-ledger'
import type { ReservedLaneMask, ReservedSpan } from './reserved-mask'

/** A held 枠 that has to share its only room with another 枠 the store is also
 *  holding. It is drawn honestly and it is NOT counted.
 *
 *  `sharedRoom` is the room the two want; `withLaneKey` / `withWindowStart` name
 *  the 枠 that got it. The partner may be a row the board does not DRAW (a
 *  price-0 staff row is still protected — the staff door's mask is deliberately
 *  not price-filtered) so a display must treat the name as optional and lead
 *  with the room. `withLaneKey` is `''` and `withWindowStart` `-1` in the one
 *  case with no claimant at all: a 枠 left unfilled by the node budget below
 *  rather than by a real collision. */
export interface SharedSpan extends ReservedSpan {
  readonly rooms: readonly string[]
  readonly sharedRoom: string
  readonly withLaneKey: string
  readonly withWindowStart: number
}

/** One staff row's honest answer. `held` and `shared` together are exactly the
 *  candidates that came in for this row — nothing is dropped, so a consumer can
 *  never lose a 枠 by reading one of the two lists. */
export interface HonestLane {
  readonly laneKey: string
  readonly held: readonly ReservedSpan[]
  /** Every room free for `held[i]` over its whole span, in key order. */
  readonly heldRooms: readonly (readonly string[])[]
  readonly shared: readonly SharedSpan[]
}

export interface HonestHeld {
  readonly byLane: readonly HonestLane[]
  /** Σ of `held` over every row — the number the header may say. */
  readonly total: number
  /** False when a component hit `HONEST_SEARCH_BUDGET` and the answer is the
   *  best COMPLETE legal assignment found rather than the proven maximum. Such
   *  an answer under-holds; it never over-holds. */
  readonly exact: boolean
}

/** Nodes per overlap component before the search stops widening.
 *
 *  ponytail: exact ≤ 4k nodes per overlap component; beyond that the best
 *  complete leaf so far — under-holds, never over-holds. Upgrade path: an
 *  interval-scheduling-with-eligibility solver if a real store ever trips it. */
export const HONEST_SEARCH_BUDGET = 4_096

interface Candidate {
  readonly laneKey: string
  readonly span: ReservedSpan
  readonly rooms: readonly string[]
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd

/** The identity answer: every candidate held, nothing shared. This is what the
 *  round gate off looks like, and it is a function of the input alone — the
 *  book is not asked ONE question, so a gated-off board pays nothing for a law
 *  it is not running. `heldRooms` is therefore empty on this path: it is the
 *  answer to a question nobody asked. */
function identity(candidates: readonly ReservedLaneMask[]): HonestHeld {
  let total = 0
  const byLane = candidates.map((m) => {
    total += m.spans.length
    return Object.freeze({
      laneKey: m.laneKey,
      held: m.spans,
      heldRooms: Object.freeze(m.spans.map(() => Object.freeze([] as string[]))),
      shared: Object.freeze([] as SharedSpan[]),
    })
  })
  return Object.freeze({ byLane: Object.freeze(byLane), total, exact: true })
}

/** THE NETTING.
 *
 *  @param candidates the per-lane masks for the lanes the count is ABOUT —
 *    staff rows with a window, minus the locked ones. The caller owns that
 *    filter (`reserved-mask.ts:38-40` says so in as many words) and a price-0
 *    row IS in the set: its 枠 is protected even though nobody can buy it
 *    online, so its room really is spoken for.
 *  @param lanes the same world the candidates were cut from — only the store
 *    binding of each candidate's own row is read out of it.
 *  @param book the capacity book for that world.
 *  @param on the round gate's value, passed in. False = the identity answer.
 */
export function honestHeld(
  candidates: readonly ReservedLaneMask[],
  lanes: readonly BoardLane[],
  book: BedTruth,
  on: boolean,
): HonestHeld {
  if (!on) return identity(candidates)

  const laneOf = new Map(lanes.map((l) => [l.key, l]))
  const flat: Candidate[] = []
  let unit: number | null = null
  for (const m of candidates) {
    const lane = laneOf.get(m.laneKey)
    for (const span of m.spans) {
      // ⚖ THE EQUAL-LENGTH INVARIANT, LOUD RATHER THAN A LIE. `reserved-mask.ts`
      // ends every span at `windowStart + protectedDuration` today, and the room
      // test below ("this room's last 枠 finished before this one starts") is only
      // a sufficient test while that holds. `ReservedSpan`'s own doc exists so a
      // later round MAY clip a span — the day it does, this throws instead of
      // quietly publishing a number nobody can honour.
      const len = span.end - span.start
      if (unit === null) unit = len
      if (len !== unit) {
        throw new Error(
          `honest-held: every 確保 枠 must be the store's own protected duration — got ${len} on ${m.laneKey} after ${unit}`,
        )
      }
      flat.push({
        laneKey: m.laneKey,
        span,
        rooms: lane ? [...book.freeBedKeys(span.start, span.end, { stores: lane.stores })].sort() : [],
      })
    }
  }

  // ⚖ ORDER IS DETERMINISM. Every answer below is a function of this order, so
  // a published number can never depend on which lane the loop happened to
  // reach first.
  flat.sort((a, b) => (a.span.start === b.span.start ? (a.laneKey < b.laneKey ? -1 : a.laneKey > b.laneKey ? 1 : 0) : a.span.start - b.span.start))

  const { room, exact } = assign(flat)

  // Back into per-lane shape, in the CANDIDATES' own lane order so the output
  // mirrors the mask it came from row for row.
  const at = new Map(flat.map((c, i) => [`${c.laneKey}|${c.span.windowStart}`, i]))
  let total = 0
  const byLane = candidates.map((m) => {
    const held: ReservedSpan[] = []
    const heldRooms: (readonly string[])[] = []
    const shared: SharedSpan[] = []
    for (const span of m.spans) {
      const i = at.get(`${m.laneKey}|${span.windowStart}`)
      const c = i === undefined ? undefined : flat[i]
      const taken = i === undefined ? null : room[i]
      if (c && taken !== null) {
        held.push(span)
        heldRooms.push(c.rooms)
        continue
      }
      const rooms = c?.rooms ?? []
      // WHO GOT THE ROOM. The first of this 枠's own rooms that a HELD 枠
      // overlapping it was given — that pair is the whole reason this one is
      // not counted, and it is what the box on screen has to name.
      let sharedRoom = rooms[0] ?? ''
      let withLaneKey = ''
      let withWindowStart = -1
      if (c) {
        for (const r of rooms) {
          const owner = flat.findIndex(
            (o, j) => room[j] === r && overlaps(o.span.start, o.span.end, c.span.start, c.span.end),
          )
          if (owner >= 0) {
            sharedRoom = r
            withLaneKey = flat[owner].laneKey
            withWindowStart = flat[owner].span.windowStart
            break
          }
        }
      }
      shared.push(Object.freeze({ ...span, rooms, sharedRoom, withLaneKey, withWindowStart }))
    }
    total += held.length
    return Object.freeze({
      laneKey: m.laneKey,
      held: Object.freeze(held),
      heldRooms: Object.freeze(heldRooms),
      shared: Object.freeze(shared),
    })
  })
  return Object.freeze({ byLane: Object.freeze(byLane), total, exact })
}

/** A legal assignment of the sorted candidates to rooms, maximum size,
 *  deterministic.
 *
 *  LEGAL = each held 枠 gets one of ITS OWN free rooms, and two held 枠 on one
 *  room never overlap in time. Rooms are REUSABLE over disjoint hours, which is
 *  why this is not a plain bipartite matching.
 *
 *  The candidates are split into overlap components first — 枠 connected
 *  through time overlap — because two 枠 that never overlap anybody in common
 *  cannot take a room from each other, and the budget then applies to a real
 *  tangle rather than to the size of the day.
 *
 *  TIE-BREAK: among equal-size solutions the EARLIER-starting 枠 is kept.
 *
 *  HONEST-COUNT ROUND 1 · fix 2 (2026-09-13, CODEX-BLIND/CODEX-REPORT-HONEST-COUNT-REVIEW.md H1)
 *  — THE LEAVES ARE COMPARED, not merely the first one reached. Trying rooms
 *  before 「unfilled」 makes the walk PREFER holding at each position, but which
 *  ROOM a held 枠 takes decides what the rows after it can still hold, and that
 *  consequence is not local: on Codex's three-row board (a floating 10:00
 *  {r1,r2} · b 10:15 {r1} · c 10:30 {r2}) the walk reaches a→r1, b unheld,
 *  c→r2 first, while a→r2, b→r1 is the same size and the EARLIER held set. So
 *  every complete leaf of the best size is compared on its held vector in
 *  candidate order — the first position where one holds and the other does not
 *  decides.
 *
 *  HONEST-COUNT ROUND 1 · fix 3 (2026-09-13, BLIND-CODE-HONEST-COUNT/LENS-1b-delta-verify.md MAJOR 1)
 *  — AND THE BOUND IS ON THE TIE-BREAK TOO, not only on the size. Fix 2 relaxed
 *  it from `<=` to `<`, which stops pruning altogether once `bestSize` reaches
 *  the component's own length — the ordinary busy board, every 枠 holdable —
 *  and the walk then enumerates every ROOM PERMUTATION of an answer it already
 *  has, burns the budget and publishes `exact: false` (measured: every
 *  all-holdable board from n = 7 up, and a LOWER total on 8 of 3,000 random
 *  boards). So an equal-size branch is walked only while it can still WIN: the
 *  best it can reach is its prefix plus 「hold everything left」, and if that
 *  vector is not earlier than `best`, nothing below it can replace `best`.
 *  The node budget still caps the whole thing.
 *  ⚠ IT IS BLIND TO SELLABILITY: a price-0 row's earlier 枠 beats a sellable
 *  row's later one for the same room. Physically honest; a sellability-aware
 *  comparator is one line and it is a product ruling, not this module's. */
/** Is `a` the earlier held set? Candidate order is the sorted order, so the
 *  first position where one holds and the other does not decides it, and
 *  holding beats not holding. Equal vectors are not 「earlier」 — `best` stands. */
function earlierHeld(a: readonly (string | null)[], b: readonly (string | null)[]): boolean {
  for (let k = 0; k < a.length; k += 1) {
    const ah = a[k] !== null
    const bh = b[k] !== null
    if (ah !== bh) return ah
  }
  return false
}

function assign(flat: readonly Candidate[]): { room: (string | null)[]; exact: boolean } {
  const room: (string | null)[] = flat.map(() => null)
  let exact = true
  for (const part of components(flat)) {
    const best: (string | null)[] = part.map(() => null)
    let bestSize = -1
    let nodes = 0
    let stopped = false
    // Max END per room inside this component, so the room test stays sufficient
    // even if a later round ever clips a span to a different length.
    const lastEnd = new Map<string, number>()
    const picked: (string | null)[] = part.map(() => null)

    const walk = (i: number, size: number) => {
      if (stopped) return
      nodes += 1
      if (nodes > HONEST_SEARCH_BUDGET) {
        stopped = true
        return
      }
      if (i === part.length) {
        if (size > bestSize || (size === bestSize && earlierHeld(picked, best))) {
          bestSize = size
          for (let k = 0; k < picked.length; k += 1) best[k] = picked[k]
        }
        return
      }
      // The bound: even holding everything left cannot MATCH what we have.
      if (size + (part.length - i) < bestSize) return
      // HONEST-COUNT ROUND 1 · fix 3 (2026-09-13, BLIND-CODE-HONEST-COUNT/LENS-1b-delta-verify.md MAJOR 1)
      // …and an equal-size branch is dead too unless it can still win the
      // TIE-BREAK. The best it can reach is 「this prefix + hold everything
      // left」; compared against `best` position by position, the first
      // disagreement decides, holding wins, equal is not earlier.
      // ponytail: the walk, not the answer — the node budget still caps a
      // pathological tangle and `exact: false` still says so when it trips.
      if (size + (part.length - i) === bestSize) {
        let canWin = false
        for (let k = 0; k < part.length; k += 1) {
          const ph = k < i ? picked[k] !== null : true
          const bh = best[k] !== null
          if (ph !== bh) { canWin = ph; break }
        }
        if (!canWin) return
      }
      const c = flat[part[i]]
      for (const r of c.rooms) {
        if ((lastEnd.get(r) ?? -1) > c.span.start) continue
        const was = lastEnd.get(r)
        lastEnd.set(r, c.span.end)
        picked[i] = r
        walk(i + 1, size + 1)
        picked[i] = null
        if (was === undefined) lastEnd.delete(r)
        else lastEnd.set(r, was)
        if (stopped) return
      }
      walk(i + 1, size)
    }
    walk(0, 0)
    if (stopped) exact = false
    for (let k = 0; k < part.length; k += 1) room[part[k]] = best[k]
  }
  return { room, exact }
}

/** Indices of the sorted candidates, grouped into runs connected through time
 *  overlap. Sorted by start, so a run ends the moment a candidate starts at or
 *  after the furthest end seen so far. */
function components(flat: readonly Candidate[]): number[][] {
  const out: number[][] = []
  let run: number[] = []
  let reach = -1
  for (let i = 0; i < flat.length; i += 1) {
    if (run.length > 0 && flat[i].span.start >= reach) {
      out.push(run)
      run = []
    }
    run.push(i)
    reach = Math.max(reach, flat[i].span.end)
  }
  if (run.length > 0) out.push(run)
  return out
}

/** THE BOARD WORLD'S DEMOTION (spec §3.4 + v3 N4).
 *
 *  The per-pointer-frame mask the staff door and the rail word read is never
 *  netted — it answers per-lane questions and a store-wide netting on every
 *  frame would be the cost this round refuses to pay. Instead it is handed the
 *  SETTLED board's shared spans and drops the spans that collide with them.
 *
 *  THE KEY IS LANE + TIME OVERLAP, not the guard's exact `windowStart`. The
 *  board world cuts its pockets with the hand LIFTED, so a lift can re-open a
 *  pocket and the greedy can re-enumerate at different starts; an exact-start
 *  key would miss then, and the strip would say 新規用 over a 枠 the settled
 *  chip does not count for the length of a gesture. Overlap under-holds the
 *  word for that gesture instead, which is the safe direction.
 *
 *  HONEST-COUNT ROUND 1 · fix 5 (2026-09-13, Greptile P1 on #904 — live rails)
 *  — AND ONLY WHILE THE COLLISION IS STILL ON THE BOARD. Mid-gesture the live
 *  mask already carries the tentative move while `honest` still describes the
 *  settled board, so a settled shared 枠 demotes a live span only while its
 *  WINNER (`withLaneKey`, a 枠 OTHER than the one being demoted) still holds an
 *  overlapping 枠 in the LIVE mask — lift ごろう's 14:30 枠 and あずさ's row gets
 *  its word back for the gesture. `withLaneKey === ''` (the budget's own
 *  unfilled 枠, no claimant at all) keeps demoting. The other half — a NEW
 *  collision the live board CREATES — stays main's word until the drop: seeing
 *  it needs the per-frame netting ⚖ v3 N4 refuses to pay for.
 *
 *  IDENTITY WHEN NOTHING IS SHARED — the same array comes back, so the round
 *  gate off is byte-identical to today's board rather than equal-by-inspection. */
export function demoteShared(
  mask: readonly ReservedLaneMask[] | undefined,
  honest: HonestHeld | undefined,
): readonly ReservedLaneMask[] | undefined {
  if (!mask || !honest) return mask
  const sharedBy = new Map<string, readonly SharedSpan[]>()
  for (const l of honest.byLane) if (l.shared.length > 0) sharedBy.set(l.laneKey, l.shared)
  if (sharedBy.size === 0) return mask
  const liveSpans = new Map(mask.map((m) => [m.laneKey, m.spans]))
  /** Is the 枠 that TOOK the room still on this board? One overlap scan of the
   *  winner's own lane — on the fixture, ごろう's one span, so one test. */
  const winnerHolds = (h: SharedSpan, self: ReservedSpan) =>
    h.withLaneKey === '' ||
    (liveSpans.get(h.withLaneKey) ?? []).some((w) => w !== self && overlaps(w.start, w.end, h.start, h.end))
  let moved = false
  const out = mask.map((m) => {
    const shared = sharedBy.get(m.laneKey)
    if (!shared) return m
    const kept = m.spans.filter((s) => !shared.some((h) => overlaps(s.start, s.end, h.start, h.end) && winnerHolds(h, s)))
    if (kept.length === m.spans.length) return m
    moved = true
    return Object.freeze({ laneKey: m.laneKey, spans: Object.freeze(kept), protectedCount: kept.length })
  })
  return moved ? Object.freeze(out) : mask
}

/** One honest row as the mask shape every existing consumer already takes —
 *  `reservedOffersFor` and `heldDrawnFor`'s output are this. A straight rename,
 *  so 「the online 確保 rows ≡ the honest held 枠」 is true by construction. */
export const heldMaskOf = (lane: HonestLane): ReservedLaneMask =>
  Object.freeze({ laneKey: lane.laneKey, spans: lane.held, protectedCount: lane.held.length })
