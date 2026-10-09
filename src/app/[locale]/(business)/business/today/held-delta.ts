// 今日の運営 — THE HELD DELTA: what one landing changes in the store's 新規 確保
// set, as ONE answer every popup face and row reads (LEAD RULING R1/R2/R8l,
// DECISIONS.md today-impact-2026-09-30, delegated by Liam 9/30).
//
// Pure: no React, no Date, no I/O. Type-only import of the day layer's shape —
// today-interactions imports this module's VALUE, this module imports nothing
// back at runtime, so the relationship stays 「type-only, no cycle」 like the
// netting's and the reserved mask's.
//
// THE THREE PAIRS, and what each counts:
//   counted  = every 確保枠 the store holds (Σ starts over all lanes = `.total`,
//              the header chip's own number).
//   sellable = the ones on lanes sold online (`sellable` per lane, decided by
//              `sellableLaneKeysOf` — the one predicate the online set reads).
//   value    = Σ `price(lane.starts, lane.listPrice)`, each lane at its own
//              rate; the caller hands in its `protectedValueOf` closure, so the
//              ¥ is the same arithmetic the day arm always used.
// Identity is laneKey|windowStart. On one lane, min(lost, gained) starts pair in
// start order as SHIFTS; only the remainder is a loss or a gain.
import type { DayWindows } from './today-interactions'

/** R3 seam: who the protected window is for. Only 'free' (フリー) is built. */
export type NewClientChannel = 'free' | 'nominated'
export type WindowRef = {
  readonly laneKey: string
  readonly label: string
  readonly windowStart: number
  readonly listPrice: number
  /** The lane is on the online set (the day layer's per-lane `sellable`). */
  readonly sellable: boolean
}
export type ShiftRef = { readonly laneKey: string; readonly label: string; readonly from: number; readonly to: number; readonly listPrice: number }
export type HeldDelta = {
  readonly countedBefore: number
  readonly countedAfter: number
  readonly sellableBefore: number
  readonly sellableAfter: number
  readonly valueBefore: number
  readonly valueAfter: number
  readonly exact: boolean
  readonly lost: readonly WindowRef[]
  readonly gained: readonly WindowRef[]
  readonly shifted: readonly ShiftRef[]
  readonly channel: NewClientChannel
}

type Lane = DayWindows['byLane'][number]

const tally = (w: DayWindows, price: (starts: readonly number[], listPrice: number) => number) => ({
  counted: w.byLane.reduce((n, l) => n + l.starts.length, 0),
  sellable: w.byLane.reduce((n, l) => n + (l.sellable ? l.starts.length : 0), 0),
  value: w.byLane.reduce((n, l) => n + price(l.starts, l.listPrice), 0),
})

export function heldDelta(
  before: DayWindows,
  after: DayWindows,
  price: (starts: readonly number[], listPrice: number) => number,
  channel: NewClientChannel = 'free',
): HeldDelta {
  if (channel !== 'free') throw new Error('R3: 指名 (nominated) channel is not built; DECISIONS.md today-impact-2026-09-30 R3')
  const b = tally(before, price)
  const a = tally(after, price)
  const beforeOf = new Map(before.byLane.map((l) => [l.laneKey, l]))
  const afterOf = new Map(after.byLane.map((l) => [l.laneKey, l]))
  // Lane order: the before board's, then any lane only the after board carries.
  const keys = [...before.byLane.map((l) => l.laneKey), ...after.byLane.map((l) => l.laneKey).filter((k) => !beforeOf.has(k))]
  const lost: WindowRef[] = []
  const gained: WindowRef[] = []
  const shifted: ShiftRef[] = []
  for (const key of keys) {
    const was = beforeOf.get(key)
    const now = afterOf.get(key)
    const lane = (now ?? was) as Lane
    const had = new Set(was?.starts ?? [])
    const has = new Set(now?.starts ?? [])
    const gone = [...had].filter((s) => !has.has(s)).sort((x, y) => x - y)
    const came = [...has].filter((s) => !had.has(s)).sort((x, y) => x - y)
    const ref = (l: Lane, windowStart: number): WindowRef => ({ laneKey: key, label: l.label, windowStart, listPrice: l.listPrice, sellable: l.sellable })
    // FIX ROUND 1 X-B — min(gone, came) pairs in start order are shifts; the rest
    // is a true loss or gain (a lane losing 2 and gaining 1 = 1 shift + 1 loss).
    const k = Math.min(gone.length, came.length)
    for (let i = 0; i < k; i++) shifted.push({ laneKey: key, label: lane.label, from: gone[i], to: came[i], listPrice: lane.listPrice })
    for (const s of gone.slice(k)) lost.push(ref(was as Lane, s))
    for (const s of came.slice(k)) gained.push(ref(now as Lane, s))
  }
  return {
    countedBefore: b.counted,
    countedAfter: a.counted,
    sellableBefore: b.sellable,
    sellableAfter: a.sellable,
    valueBefore: b.value,
    valueAfter: a.value,
    exact: before.exact && after.exact,
    lost,
    gained,
    shifted,
    channel,
  }
}
