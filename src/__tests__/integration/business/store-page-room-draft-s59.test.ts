/**
 * S59 P7A — the pure pair (C1: record → the room's 17 values → the draft) and R182's hand-flip rule (C4).
 * The ids are settings.ts's own (the ones controlIdsOf counts), never retyped.
 */
import { CAP_KEYS, parseInternalRecord, seedRecord, type CapKey, type CapRecord } from '@/business/lib/store-page/model'
import { afterHandFlip, storePageDraft, storePageValues } from '@/business/lib/store-page/room-draft'
import { STORE_PAGE_FAMILY_ID, storePageSwitchId } from '@/business/lib/settings'

const IDS = { family: STORE_PAGE_FAMILY_ID, sw: storePageSwitchId }
const saved = seedRecord('hair_salon')
const flip = (r: CapRecord, k: CapKey): CapRecord => ({ ...r, switches: { ...r.switches, [k]: { ...r.switches[k], on: !r.switches[k].on } } })

describe('T7 (C1) — record → values → draft', () => {
  it('17 entries under the room ids, and the round trip is the same record', () => {
    const v = storePageValues(saved, IDS)
    expect(Object.keys(v)).toHaveLength(17)
    expect(v['reserve-store-page.family']).toBe('hair_salon')
    expect(storePageDraft(saved, v, IDS, [])).toEqual(saved)
  })

  it('a value taken from the room moves only business_type / on', () => {
    const k = CAP_KEYS[0]
    const v = { ...storePageValues(saved, IDS), [STORE_PAGE_FAMILY_ID]: 'personal_gym', [storePageSwitchId(k)]: !saved.switches[k].on }
    const d = storePageDraft(saved, v, IDS, [k]) // S75 fix 3b (R-E′): the room hands in the flipped key as touched
    expect(d.business_type).toBe('personal_gym')
    expect(d.switches[k]).toEqual({ ...saved.switches[k], on: !saved.switches[k].on })
    for (const o of CAP_KEYS.slice(1)) expect(d.switches[o]).toBe(saved.switches[o])
  })

  it('a missing and a wrong-typed value fall back to the saved record; every draft parses', () => {
    const k = CAP_KEYS[1]
    const junk: Record<string, unknown>[] = [
      {},
      { [STORE_PAGE_FAMILY_ID]: 'SALON', [storePageSwitchId(k)]: 'true' },
      { [STORE_PAGE_FAMILY_ID]: 7, [storePageSwitchId(k)]: 1 },
      { [STORE_PAGE_FAMILY_ID]: null, [storePageSwitchId(k)]: null },
    ]
    for (const v of junk) {
      const d = storePageDraft(saved, v, IDS, [])
      expect(d).toEqual(saved)
      expect(parseInternalRecord(d)).toEqual(d)
    }
  })
})

describe('T4 (C4, R182) — the hand flip and the reset keys', () => {
  const [a, b] = CAP_KEYS as [CapKey, CapKey]
  const keys: readonly CapKey[] = [a, b]
  it('a hand flip of one reset key → exactly that key leaves', () => {
    expect(afterHandFlip(keys, saved, flip(saved, a))).toEqual([b])
  })
  it('a record with no flipped switch (a type pick) removes none', () => {
    expect(afterHandFlip(keys, saved, { ...saved, business_type: 'personal_gym' })).toEqual(keys)
  })
})
