// THE TIMED RELEASE — the clock half of round 2 (2026-09-13).
//
// One question: 「is this kept 枠 still held at `now`?」 The module has no book and
// no clock of its own, so this file is arithmetic and identity: the boundary, the
// three off states, the manager's way back, and the proof that what comes out is
// the manual release's OWN subtraction with a predicate instead of a list.

import { releaseTimed } from '@/app/[locale]/(business)/business/today/timed-release'
import type { ReleasedWindow, ReservedLaneMask, ReservedSpan } from '@/app/[locale]/(business)/business/today/reserved-mask'

const span = (start: number, len: number): ReservedSpan => ({ start, end: start + len, windowStart: start })
const maskOf = (laneKey: string, spans: ReservedSpan[]): ReservedLaneMask => ({ laneKey, spans, protectedCount: spans.length })

// Two rows, three 枠 — the shape the demo board has: ごろう at 14:30, あずさ at
// 15:05, しろう at 15:45.
const MASK = (): ReservedLaneMask[] => [
  maskOf('p-05', [span(870, 90)]),
  maskOf('p-06', [span(905, 90)]),
  maskOf('p-04', [span(945, 90)]),
]
const stamp = (laneKey: string, windowStart: number): ReleasedWindow => ({ laneKey, windowStart, dayOffset: 0, store: null })
const windowsOf = (m: readonly ReservedLaneMask[] | undefined) =>
  (m ?? []).flatMap((x) => x.spans.map((s) => `${x.laneKey}|${s.windowStart}`))

describe('timed-release — the off states are identity, not a copy', () => {
  it('a future day (no clock), 解除しない, and an absent mask all hand the SAME object back', () => {
    const mask = MASK()
    expect(releaseTimed(mask, null, 60, []).mask).toBe(mask)
    expect(releaseTimed(mask, 900, null, []).mask).toBe(mask)
    expect(releaseTimed(undefined, 900, 60, []).mask).toBeUndefined()
    for (const r of [releaseTimed(mask, null, 60, []), releaseTimed(mask, 900, null, []), releaseTimed(undefined, 900, 60, [])]) {
      expect(r.released).toEqual([])
    }
  })

  it('…and so does a clock that has reached nobody’s cut-off', () => {
    const mask = MASK()
    const earliest = Math.min(...mask.flatMap((m) => m.spans.map((s) => s.windowStart)))
    const out = releaseTimed(mask, earliest - 60 - 1, 60, [])
    expect(out.mask).toBe(mask)
    expect(out.released).toEqual([])
  })
})

describe('timed-release — the boundary', () => {
  it('releases AT start − N and holds one minute earlier', () => {
    const mask = MASK()
    const cut = mask[0].spans[0].windowStart - 60
    const at = releaseTimed(mask, cut, 60, [])
    const before = releaseTimed(mask, cut - 1, 60, [])
    expect(at.released.map((r) => `${r.laneKey}|${r.span.windowStart}`)).toEqual(['p-05|870'])
    expect(before.released).toEqual([])
    // …and the mask that comes back has lost exactly that 枠 and nothing else.
    expect(windowsOf(at.mask)).toEqual(windowsOf(mask).filter((w) => w !== 'p-05|870'))
  })

  it('the row that lost its 枠 is rebuilt and the untouched rows keep their identity', () => {
    const mask = MASK()
    const out = releaseTimed(mask, mask[0].spans[0].windowStart - 60, 60, [])
    expect(out.mask![0]).not.toBe(mask[0])
    expect(out.mask![0].protectedCount).toBe(0)
    expect(out.mask![1]).toBe(mask[1])
    expect(out.mask![2]).toBe(mask[2])
  })

  it('every released row carries the cut-off it was released at', () => {
    const mask = MASK()
    const latest = Math.max(...mask.flatMap((m) => m.spans.map((s) => s.windowStart)))
    for (const beforeMin of [30, 60, 120]) {
      const out = releaseTimed(mask, latest, beforeMin, [])
      expect(out.released.map((r) => r.beforeMin)).toEqual(out.released.map(() => beforeMin))
    }
  })

  it('a bigger cut-off releases at least as much, never less', () => {
    const mask = MASK()
    const clock = mask[0].spans[0].windowStart - 60
    const wide = windowsOf(releaseTimed(mask, clock, 120, []).mask)
    const narrow = windowsOf(releaseTimed(mask, clock, 60, []).mask)
    expect(wide.every((w) => narrow.includes(w))).toBe(true)
  })
})

describe('timed-release — 確保を戻す', () => {
  it('a kept-back 枠 stays held and stays out of the released rows', () => {
    const mask = MASK()
    const clock = Math.max(...mask.flatMap((m) => m.spans.map((s) => s.windowStart)))
    const all = releaseTimed(mask, clock, 60, [])
    const back = releaseTimed(mask, clock, 60, [stamp('p-05', 870)])
    expect(windowsOf(back.mask)).toEqual(['p-05|870'])
    expect(back.released.length).toBe(all.released.length - 1)
    expect(back.released.some((r) => r.laneKey === 'p-05')).toBe(false)
  })

  it('…and a stamp naming another lane or another start is ignored', () => {
    const mask = MASK()
    const clock = Math.max(...mask.flatMap((m) => m.spans.map((s) => s.windowStart)))
    const all = releaseTimed(mask, clock, 60, [])
    for (const other of [stamp('p-09', 870), stamp('p-05', 871)]) {
      expect(windowsOf(releaseTimed(mask, clock, 60, [other]).mask)).toEqual(windowsOf(all.mask))
    }
  })

  it('keeping every 枠 back is 解除しない again — by value, and nothing is released', () => {
    const mask = MASK()
    const clock = Math.max(...mask.flatMap((m) => m.spans.map((s) => s.windowStart)))
    const every = mask.flatMap((m) => m.spans.map((s) => stamp(m.laneKey, s.windowStart)))
    const out = releaseTimed(mask, clock, 60, every)
    expect(out.mask).toBe(mask)
    expect(out.released).toEqual([])
  })
})

describe('timed-release — the mask it returns IS the manual release’s own arithmetic', () => {
  it('mask minus released == reserved-mask.ts’s filter applied to the same list', () => {
    const mask = MASK()
    const clock = Math.max(...mask.flatMap((m) => m.spans.map((s) => s.windowStart)))
    const out = releaseTimed(mask, clock, 60, [stamp('p-06', 905)])
    // `reserved-mask.ts:240-242`, reproduced on a literal mask: the enumerated
    // spans filtered by `laneKey + windowStart` against a LIST. The timed form is
    // that filter with a predicate, so the two must agree span for span.
    const asList = out.released.map((r) => ({ laneKey: r.laneKey, windowStart: r.span.windowStart }))
    const byHand = mask.map((m) => ({
      laneKey: m.laneKey,
      spans: m.spans.filter((s) => !asList.some((r) => r.laneKey === m.laneKey && r.windowStart === s.windowStart)),
    }))
    expect(windowsOf(out.mask)).toEqual(byHand.flatMap((m) => m.spans.map((s) => `${m.laneKey}|${s.windowStart}`)))
    // …and every row's own count agrees with its own spans.
    for (const m of out.mask ?? []) expect(m.protectedCount).toBe(m.spans.length)
  })
})
