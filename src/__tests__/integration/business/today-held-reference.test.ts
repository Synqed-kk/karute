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
import { heldIdOf, type HonestHeld } from '@/app/[locale]/(business)/business/today/honest-held'

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
