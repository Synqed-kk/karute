/**
 * @jest-environment jsdom
 */
/**
 * S75 (DECISIONS-S75 「THE LEAD'S RULING ON THE STRUCTURE」) — one per-type table read at READ time (R265(4)), the R269
 * points lock, defaults_type (D7 kept), the pinned table hash. Pure model + the 機能 rows; the door's half is in
 * practice-door-store-capabilities-s57.test.ts (S75 block).
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { StorePageRows } from '@/app/[locale]/(business)/business/settings/StorePageRows'
import { LOCKED } from '@/business/lib/store-page/copy'
import {
  BUSINESS_TYPE_KEYS, CAP_KEYS, LockedSwitchOn, TYPE_DEFAULTS, TYPE_LOCKED_OFF, TYPE_TABLE_HASH, applyReset, isLocked, lockOff,
  parseInternalRecord, parseRecord, resetDiff, resolveRecord, seedRecord, serializeRecord, stampSave, typeTableHash, wireKeyOf,
  type BusinessTypeKey, type CapKey, type CapRecord,
} from '@/business/lib/store-page/model'

const NOW = new Date('2026-10-06T12:00:00.000Z')
const SIX: BusinessTypeKey[] = ['dental_clinic', 'medical_clinic', 'dermatology', 'osteopathy', 'acupuncture', 'physical_therapy']
const flip = (rec: CapRecord, k: CapKey, on: boolean): CapRecord => ({ ...rec, switches: { ...rec.switches, [k]: { ...rec.switches[k], on } } })
/** A stored wire value as an older writer left it: no defaults_type. */
const legacyWire = (rec: CapRecord) => { const { defaults_type: _dt, ...rest } = JSON.parse(JSON.stringify(serializeRecord(rec))); return rest } // eslint-disable-line @typescript-eslint/no-unused-vars
const save = (saved: CapRecord, draft: CapRecord, reset: CapKey[] = []) => stampSave(saved, draft, reset, NOW, 'staff-1')
const roundTrip = (rec: CapRecord) => parseRecord(JSON.parse(JSON.stringify(serializeRecord(rec))))!

afterEach(cleanup)

describe('D1 — the R269 lock', () => {
  it('TYPE_LOCKED_OFF is exactly read_points for the six insurance-billing types (LEGAL-POINTS-CHECK-S67:29-34)', () => {
    expect(Object.keys(TYPE_LOCKED_OFF).sort()).toEqual([...SIX].sort())
    for (const t of SIX) expect(TYPE_LOCKED_OFF[t]).toEqual(['read_points'])
    for (const t of BUSINESS_TYPE_KEYS) for (const k of CAP_KEYS) expect(isLocked(t, k)).toBe(SIX.includes(t) && k === 'read_points')
  })
  it('the six resolve read_points OFF even when the stored key says OWNER / ON', () => {
    for (const t of SIX) {
      const stored = { ...seedRecord(t), switches: { ...seedRecord(t).switches, read_points: { on: true, source: 'OWNER' as const, changed_at: NOW.toISOString(), changed_by: 'x' } } }
      expect(resolveRecord(stored).switches.read_points.on).toBe(false)
      expect(parseRecord(serializeRecord(stored))!.switches.read_points.on).toBe(false)
      expect(parseRecord({ ...serializeRecord(stored), defaults_type: 'hair_salon' })!.switches.read_points.on).toBe(false) // locked by business_type, whatever the defaults type
    }
  })
  it('a draft that turns a locked key ON is refused (LockedSwitchOn); a 業種 pick onto a locked type turns it OFF (lockOff)', () => {
    for (const t of SIX) expect(() => save(seedRecord(t), flip(seedRecord(t), 'read_points', true))).toThrow(LockedSwitchOn)
    const hair = seedRecord('hair_salon')
    expect(hair.switches.read_points.on).toBe(true)
    const picked = lockOff({ ...hair, business_type: 'dental_clinic' })
    expect(picked.switches.read_points.on).toBe(false)
    for (const k of CAP_KEYS) if (k !== 'read_points') expect(picked.switches[k]).toEqual(hair.switches[k]) // D7: nothing else moves
    const out = save(hair, picked)
    expect(out.switches.read_points).toEqual({ on: false, source: 'TYPE_DEFAULT' })
    expect(out.defaults_type).toBe('hair_salon')
  })
  it('cosmetic_surgery and wellness_clinic default read_points OFF, and an owner may turn it ON', () => {
    for (const t of ['cosmetic_surgery', 'wellness_clinic'] as const) {
      expect(TYPE_DEFAULTS[t]).not.toContain('read_points')
      expect(isLocked(t, 'read_points')).toBe(false)
      const out = save(seedRecord(t), flip(seedRecord(t), 'read_points', true))
      expect(out.switches.read_points).toMatchObject({ on: true, source: 'OWNER' })
      expect(roundTrip(out).switches.read_points.on).toBe(true)
    }
  })
})

describe('D2 — a legacy record (no defaults_type)', () => {
  it('resolves from the SAVED business_type, and the next save writes defaults_type', () => {
    const rec = parseRecord(legacyWire(seedRecord('beauty_chiropractic')))!
    expect(rec.defaults_type).toBe('beauty_chiropractic')
    const wire = serializeRecord(save(rec, flip(rec, 'posts', false)))
    expect(wire.defaults_type).toBe('beauty_chiropractic')
  })
  it('the strict draft parse takes defaults_type or its absence, never junk', () => {
    const d = seedRecord('hair_salon')
    expect(parseInternalRecord(JSON.parse(JSON.stringify(d)))).toEqual(d)
    const { defaults_type: _x, ...old } = JSON.parse(JSON.stringify(d)) // eslint-disable-line @typescript-eslint/no-unused-vars
    expect(parseInternalRecord(old)?.defaults_type).toBe('hair_salon')
    expect(parseInternalRecord({ ...old, defaults_type: 'SALON' })).toBeNull()
    expect(parseInternalRecord({ ...old, defaults_type: 'hair_salon', extra: 1 })).toBeNull()
  })
})

describe('D3 / D4 — a table edit reaches TYPE_DEFAULT keys, never OWNER keys', () => {
  // A record written under an older table: its stored TYPE_DEFAULT `on` for intake / shop differs from today's table.
  const t: BusinessTypeKey = 'hair_salon'
  const older = { ...seedRecord(t), switches: { ...seedRecord(t).switches, intake: { on: false, source: 'TYPE_DEFAULT' as const }, shop: { on: false, source: 'OWNER' as const, changed_at: NOW.toISOString(), changed_by: 'owner' } } }
  it('a TYPE_DEFAULT key reads the CURRENT table; an OWNER key keeps its stored value', () => {
    expect(TYPE_DEFAULTS[t]).toContain('intake')
    expect(TYPE_DEFAULTS[t]).toContain('shop')
    const read = parseRecord(serializeRecord(older))!
    expect(read.switches.intake).toEqual({ on: true, source: 'TYPE_DEFAULT' })
    expect(read.switches.shop).toMatchObject({ on: false, source: 'OWNER' })
  })
  it('the next save does NOT stamp the table-moved key OWNER, and keeps the OWNER key', () => {
    const read = parseRecord(serializeRecord(older))!
    const out = save(read, flip(read, 'posts', false))
    expect(out.switches.intake).toEqual({ on: true, source: 'TYPE_DEFAULT' })
    expect(out.switches.shop).toMatchObject({ on: false, source: 'OWNER', changed_by: 'owner' })
    expect(CAP_KEYS.filter((k) => out.switches[k].source === 'OWNER').sort()).toEqual(['posts', 'shop'])
  })
  it('戻す keeps the OWNER key too', () => {
    const read = parseRecord(serializeRecord(older))!
    const reset = applyReset({ ...read, business_type: 'yoga_studio' })
    expect(reset.switches.shop).toMatchObject({ on: false, source: 'OWNER' })
    expect(reset.defaults_type).toBe('yoga_studio')
  })
})

describe('D6 — the pinned table hash', () => {
  it('typeTableHash() over TYPE_ON + TYPE_LOCKED_OFF equals the pinned literal', () => {
    expect(TYPE_TABLE_HASH).toBe('ff4025458512e739')
    expect(typeTableHash()).toBe(TYPE_TABLE_HASH)
  })
})

describe('D7 — the wire still carries all 16 UPPER keys + defaults_type', () => {
  it('every type, seeded and after a save', () => {
    for (const t of BUSINESS_TYPE_KEYS) {
      for (const rec of [seedRecord(t), save(seedRecord(t), flip(seedRecord(t), 'checkin_qr', false))]) {
        const w = JSON.parse(JSON.stringify(serializeRecord(rec)))
        expect(Object.keys(w).sort()).toEqual(['business_type', 'defaults_type', 'switches', 'v'])
        expect(Object.keys(w.switches).sort()).toEqual(CAP_KEYS.map(wireKeyOf).sort())
        for (const k of CAP_KEYS) expect(typeof w.switches[wireKeyOf(k)].on).toBe('boolean')
      }
    }
  })
})

describe('D8 — the D7 case from the read: hair_salon picked on a beauty_chiropractic record', () => {
  const saved = parseRecord(legacyWire(seedRecord('beauty_chiropractic')))! // テスト東京店's shape: legacy, all TYPE_DEFAULT
  it('save with no 戻す → packs stays ON (TYPE_DEFAULT), defaults_type stays beauty_chiropractic', () => {
    expect(saved.switches.packs.on).toBe(true)
    const out = save(saved, lockOff({ ...saved, business_type: 'hair_salon' }))
    expect(out.business_type).toBe('hair_salon')
    expect(out.defaults_type).toBe('beauty_chiropractic')
    expect(out.switches.packs).toEqual({ on: true, source: 'TYPE_DEFAULT' })
    expect(roundTrip(out).switches.packs.on).toBe(true)
  })
  it('with 戻す → packs OFF, source TYPE_DEFAULT, defaults_type hair_salon (and shop ON)', () => {
    const asked = { ...saved, business_type: 'hair_salon' as const }
    const reset = resetDiff(asked).flips.map((f) => f.key)
    expect(reset).toEqual(expect.arrayContaining(['packs', 'shop']))
    const out = save(saved, applyReset(asked), reset)
    expect(out.defaults_type).toBe('hair_salon')
    expect(out.switches.packs).toEqual({ on: false, source: 'TYPE_DEFAULT' })
    expect(out.switches.shop).toEqual({ on: true, source: 'TYPE_DEFAULT' })
    expect(CAP_KEYS.every((k) => out.switches[k].source === 'TYPE_DEFAULT')).toBe(true)
    expect(roundTrip(out)).toEqual(out)
  })
})

describe('C — the locked switch renders disabled with its reason', () => {
  it('dental_clinic: read_points is aria-disabled, shows LOCKED.reason, and a press does nothing', () => {
    const rec = seedRecord('dental_clinic')
    const onChange = jest.fn()
    const { container } = render(<StorePageRows draft={rec} saved={rec} counts={{ posts: 1 }} canEdit onChange={onChange} />)
    const row = container.querySelector('.spr-row[data-key="read_points"]')!
    expect(row.querySelector('.spr-src')?.textContent).toBe(LOCKED.reason)
    const sw = row.querySelector('[role="switch"]')!
    expect(sw.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(sw)
    expect(onChange).not.toHaveBeenCalled()
    expect(container.querySelector('.spr-row[data-key="reactions"] [role="switch"]')?.getAttribute('aria-disabled')).toBeNull()
  })
})
