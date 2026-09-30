/**
 * @jest-environment jsdom
 */
// ⚖ DECISIONS.md R4 · R8e as amended (S4 PR-B) — the session holder of the
// settled held set. Client-side (jsdom): keyed `storeId|date`, survives a
// remount, empty after a reload. The server guard is asserted in node by
// today-held-delta.test.ts.
import {
  heldReferenceFor, identitiesOf, resetHeldReferenceForTests, settleHeldReference,
} from '@/app/[locale]/(business)/business/today/held-reference'
import { heldIdOf, honestHeld, type HonestHeld } from '@/app/[locale]/(business)/business/today/honest-held'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardLane } from '@/business/lib/today-board'

const answer = (rows: Array<[string, number[]]>): HonestHeld => ({
  total: rows.reduce((n, [, s]) => n + s.length, 0),
  exact: true,
  byLane: rows.map(([laneKey, starts]) => ({
    laneKey, held: starts.map((w) => ({ start: w, end: w + 90, windowStart: w })), heldRooms: [], heldRoom: [], shared: [],
  })),
})

describe('held-reference — the session holder', () => {
  beforeEach(() => resetHeldReferenceForTests())

  it('identitiesOf spells every held window with heldIdOf', () => {
    expect([...identitiesOf(answer([['p-04', [945]], ['p-05', [870, 1000]]]))].sort()).toEqual(
      [heldIdOf('p-04', 945), heldIdOf('p-05', 1000), heldIdOf('p-05', 870)].sort())
  })

  it('reload: empty — the first answer settles', () => {
    expect(heldReferenceFor('store-a', '0|d')).toBeUndefined()
    const ids = identitiesOf(answer([['p-04', [945]]]))
    settleHeldReference('store-a', '0|d', ids)
    expect(heldReferenceFor('store-a', '0|d')).toBe(ids)
  })

  it('remount within the session: the module map survives, the same reference comes back', () => {
    const ids = identitiesOf(answer([['p-04', [945]]]))
    settleHeldReference('store-a', '0|d', ids)
    // a remount re-reads the module; nothing in the holder is component state
    expect(heldReferenceFor('store-a', '0|d')).toBe(ids)
  })

  it('store or date change: another key — that key’s reference if seen, else empty', () => {
    const a = identitiesOf(answer([['p-04', [945]]]))
    const b = identitiesOf(answer([['p-06', [905]]]))
    settleHeldReference('store-a', '0|d', a)
    expect(heldReferenceFor('store-b', '0|d')).toBeUndefined()
    expect(heldReferenceFor('store-a', '1|e')).toBeUndefined()
    settleHeldReference('store-b', '0|d', b)
    expect([heldReferenceFor('store-a', '0|d'), heldReferenceFor('store-b', '0|d')]).toEqual([a, b])
  })
})

// ⚖ C1/F1 (S5 PR-B fix round 1) — A PENDING LANDING OF ANY KIND NEVER SETTLES.
// The attacker's case (ATTACK-OPUS-PR-B.md, C1): a landing that stages no staff
// move (a bed row only) left `dayStaged` false, so the old guard settled the
// STAGED answer and 元に戻す then read it back — the board hopped. The guard is
// read from the screen's own source and evaluated here, so this fails on a guard
// without `pendingId == null` and passes with it.
describe('held-reference — the settle guard (C1/F1)', () => {
  beforeEach(() => resetHeldReferenceForTests())

  const SRC = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
  const found = SRC.match(/if \((.+?)\) settleHeldReference\(heldRefStore, heldRefDate, identitiesOf\(honest\)\)/)
  const guard = new Function('honest', 'dayStaged', 'pendingId', 'live', `return Boolean(${found?.[1] ?? 'undefined'})`) as
    (honest: HonestHeld | null, dayStaged: boolean, pendingId: string | null, live: unknown) => boolean

  it('the screen settles through ONE guarded line', () => {
    expect(SRC.match(/settleHeldReference\(heldRefStore/g)?.length).toBe(1)
    expect(found?.[1]).toContain('!dayStaged')
  })

  it('a bed-row-only staged landing (pending, no staff move) never settles — 元に戻す returns the pre-stage board', () => {
    const lane = (key: string) => ({ key, label: key, group: 'staff', stores: ['st'] } as unknown as BoardLane)
    const book = (rooms: (start: number) => readonly string[]) => ({ freeBedKeys: (s: number) => rooms(s) } as never)
    const mask = (laneKey: string, start: number) => ({ laneKey, spans: [{ start, end: start + 90, windowStart: start }], protectedCount: 1 })
    const rows = [lane('la'), lane('lb')]
    const cands = [mask('la', 600), mask('lb', 615)]
    const origin = book(() => ['bed-01']) // both 枠 can use bed-01, not both at once
    const staged = book((s) => (s === 600 ? [] : ['bed-01'])) // the staged bed move takes la's only room
    const run = (b: never) => honestHeld(cands, rows, b, true, undefined, { sellable: () => true, reference: heldReferenceFor('store-A', '0|d') })
    const settle = (h: HonestHeld, dayStaged: boolean, pendingId: string | null) => {
      if (guard(h, dayStaged, pendingId, null)) settleHeldReference('store-A', '0|d', identitiesOf(h))
    }
    const r0 = run(origin)
    settle(r0, false, null)
    expect([...identitiesOf(r0)]).toEqual(['la|600'])
    // stage(): setMoves only `if (staffLane)` — a bed-only landing leaves moves empty, so dayStaged is false while pendingId is set
    const rs = run(staged)
    settle(rs, false, 'bk-1')
    expect([...identitiesOf(rs)]).toEqual(['lb|615'])
    // 元に戻す: the honest memo recomputes on the origin board, reading the holder
    expect([...identitiesOf(run(origin))]).toEqual(['la|600'])
  })
})
