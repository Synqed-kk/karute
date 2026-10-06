/**
 * S59 P2 (DECISIONS-S59 R201, R190's last sentence) — parseLoses, the ONE loss check of a stored value: a value is
 * lossy when it is not held in the wire form of its own parse (every own key at every depth comes back deep-equal;
 * keys the round trip adds are not loss).
 */
import { parseLoses, seedRecord, serializeRecord } from '@/business/lib/store-page/model'

const SAVED = serializeRecord({
  ...seedRecord('hair_salon'),
  switches: { ...seedRecord('hair_salon').switches, classes: { on: true, source: 'OWNER', changed_at: '2026-09-01T00:00:00.000Z', changed_by: 'staff-1' } },
})
const clone = (): Record<string, any> => JSON.parse(JSON.stringify(SAVED)) // eslint-disable-line @typescript-eslint/no-explicit-any
const reversed = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).reverse())

describe('S59 P2 — parseLoses (R201)', () => {
  it('our own wire record → not lossy', () => {
    expect(parseLoses(clone())).toBe(false)
  })

  it('same keys, different order (top level, switches, inside an entry) → not lossy', () => {
    const raw = clone()
    raw.switches.CLASSES = reversed(raw.switches.CLASSES)
    const r = reversed({ ...raw, switches: reversed(raw.switches) })
    expect(Object.keys(r)).toEqual(['switches', 'defaults_type', 'business_type', 'v'])
    expect(parseLoses(r)).toBe(false)
  })

  it('known switches missing (the round trip ADDS them) → not lossy', () => {
    expect(parseLoses({ v: 1, business_type: 'hair_salon', switches: { POSTS: { on: true, source: 'OWNER' } } })).toBe(false)
  })

  it('a nested extra key inside a known switch entry → lossy', () => {
    const raw = clone()
    raw.switches.POSTS.note = 'x'
    expect(parseLoses(raw)).toBe(true)
  })

  it('a stamp under the old name `changed_by` → lossy', () => {
    const raw = clone()
    raw.switches.CLASSES.changed_by = 'staff-old'
    expect(parseLoses(raw)).toBe(true)
  })

  it('R190 cases: a top-level key outside the three · an unknown switch key → lossy', () => {
    expect(parseLoses({ ...clone(), extra: 1 })).toBe(true)
    const raw = clone()
    raw.switches.classes = { on: true, source: 'OWNER' }
    expect(parseLoses(raw)).toBe(true)
  })

  it('a value the parse would not carry back as stored (it refuses it: changed_at a number) → lossy', () => {
    const raw = clone()
    raw.switches.POSTS.changed_at = 42
    expect(parseLoses(raw)).toBe(true)
  })
})
