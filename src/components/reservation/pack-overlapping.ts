/**
 * Side-by-side packing for one lane whose items may overlap in time (the
 * desktop grid's 担当未定 lane: several bookings nobody has taken yet can sit
 * in the same slot, and every one of them must stay visible and pressable).
 *
 * Greedy: items sorted by start; each takes the first sub-column whose last
 * item ended at or before its start, else a new sub-column. A CLUSTER is a run
 * of items chained by overlap; every item in it shares the lane equally, so
 * each comes back with its sub-column `col` and the cluster's column count
 * `cols` (the caller places it at col/cols of the lane, 1/cols in size). An
 * item that overlaps nothing comes back { col: 0, cols: 1 }.
 *
 * Pure: spans come from the items themselves via `spanOf` (no durations here),
 * and the result is in the INPUT order.
 */
export interface PackSpan {
  start: number
  end: number
}

export interface Packed<T> {
  item: T
  col: number
  cols: number
}

export function packOverlapping<T>(items: readonly T[], spanOf: (item: T) => PackSpan): Packed<T>[] {
  const order = items
    .map((item, index) => ({ index, ...spanOf(item) }))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.index - b.index)
  const out: Packed<T>[] = new Array(items.length)
  let cluster: { index: number; col: number }[] = []
  let colEnds: number[] = []
  let clusterEnd = -Infinity
  const flush = () => {
    const cols = colEnds.length
    for (const c of cluster) out[c.index] = { item: items[c.index], col: c.col, cols }
    cluster = []
    colEnds = []
    clusterEnd = -Infinity
  }
  for (const o of order) {
    if (cluster.length > 0 && o.start >= clusterEnd) flush()
    let col = colEnds.findIndex((end) => end <= o.start)
    if (col === -1) {
      col = colEnds.length
      colEnds.push(o.end)
    } else {
      colEnds[col] = o.end
    }
    cluster.push({ index: o.index, col })
    clusterEnd = Math.max(clusterEnd, o.end)
  }
  flush()
  return out
}
