/**
 * S57 P2 (DECISIONS-S57 R188, R162 as written) — seedTypeOf, the pure seed-type rule the door's write and its
 * readStoreSeedType share: the store's own type wins; only an EMPTY store type falls back to the signup type;
 * anything typeKeyOf does not know → `other` (a non-empty junk store type never borrows the signup type).
 */
import { seedTypeOf } from '@/business/lib/store-page/model'

describe('S57 P2 — seedTypeOf(storeType, signupType)', () => {
  it('the store’s own type wins over the signup type', () => {
    expect(seedTypeOf('hair_salon', 'yoga_studio')).toBe('hair_salon')
    expect(seedTypeOf('dental_clinic', '')).toBe('dental_clinic')
  })
  it.each([[''], [undefined], [null]])('store type %p → the signup type', (store) => {
    expect(seedTypeOf(store, 'yoga_studio')).toBe('yoga_studio')
  })
  it.each([['', ''], [undefined, undefined], ['', 'beauty'], [null, 'SALON'], ['', 42]])('both empty or junk (%p, %p) → other', (store, signup) => {
    expect(seedTypeOf(store, signup)).toBe('other')
  })
  it.each([['beauty'], ['SALON'], ['Hair_Salon'], [' hair_salon']])('a non-empty junk store type %p → other, never the signup type', (store) => {
    expect(seedTypeOf(store, 'yoga_studio')).toBe('other')
  })
})
