/**
 * @jest-environment jsdom
 */
/**
 * S75 (DECISIONS-S75 「THE LEAD'S RULING ON THE STRUCTURE」) — one per-type table read at READ time (R265(4)), the R269
 * points lock, defaults_type (D7 kept), the pinned table hash. Pure model + the 機能 rows; the door's half is in
 * practice-door-store-capabilities-s57.test.ts (S75 block).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StorePageRows } from '@/app/[locale]/(business)/business/settings/StorePageRows'
import { StorePageType } from '@/app/[locale]/(business)/business/settings/StorePageType'
import { BLOCK_GUIDES, LOCKED, REG, SAVE_FAIL, TYPE_BLOCK } from '@/business/lib/store-page/copy'
import { STORE_PAGE_DEFAULTS_ID, STORE_PAGE_FAMILY_ID, storePageSwitchId } from '@/business/lib/settings'
import { flippedKeys, storePageDraft, storePageEdits, storePageValues } from '@/business/lib/store-page/room-draft'
import { saveFailLines } from '@/business/lib/store-page/save-lines'
import { putStoreCapabilities } from '@/business/lib/store-page/save-client'
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
  it('a draft that turns a locked key ON is refused (LockedSwitchOn); the overlay (lockOff) reads a locked key OFF', () => {
    for (const t of SIX) expect(() => save(seedRecord(t), flip(seedRecord(t), 'read_points', true))).toThrow(LockedSwitchOn)
    const hair = seedRecord('hair_salon')
    expect(hair.switches.read_points.on).toBe(true)
    const picked = lockOff({ ...hair, business_type: 'dental_clinic' })
    expect(picked.switches.read_points.on).toBe(false)
    for (const k of CAP_KEYS) if (k !== 'read_points') expect(picked.switches[k]).toEqual(hair.switches[k]) // D7: nothing else moves
    const out = save(hair, picked)
    expect(out.switches.read_points).toEqual({ on: false, source: 'TYPE_DEFAULT', changed_at: NOW.toISOString(), changed_by: 'staff-1' }) // fix 1 (F2): this save's stamp
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

// ── S75 FIX ROUND 1 (PACKET-FIX1-PR1-S75 F1–F5) ──────────────────────────────────────────────────────────────────
const IDS = { family: STORE_PAGE_FAMILY_ID, sw: storePageSwitchId, defaults: STORE_PAGE_DEFAULTS_ID }
/** The room, reduced: values (the one truth) → the draft (storePageDraft, with the overlay) → an edit writes only what moved. */
function room(saved: CapRecord) {
  let values: Record<string, unknown> = storePageValues(saved, IDS)
  let touched: readonly CapKey[] = [] // S75 fix 3b (R-E′): as SettingsScreen — every key an edit flips becomes touched
  const draft = () => storePageDraft(saved, values, IDS, touched)
  const apply = (next: CapRecord) => {
    const moved = flippedKeys(draft(), next)
    values = { ...values, ...storePageEdits(draft(), next, IDS) }
    touched = [...touched, ...moved.filter((k) => !touched.includes(k))]
  }
  const pickType = (t: BusinessTypeKey) => {
    render(<StorePageType draft={draft()} saved={saved} canEdit onChange={apply} onResetKeys={() => {}} onToast={() => {}} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: t } })
    cleanup()
  }
  const dirty = () => Object.entries(storePageValues(saved, IDS)).some(([id, v]) => values[id] !== v)
  return { draft, apply, pickType, dirty }
}
const ownerOn = (t: BusinessTypeKey): CapRecord => ({ ...seedRecord(t), switches: { ...seedRecord(t).switches, read_points: { on: true, source: 'OWNER', changed_at: '2026-01-01T00:00:00.000Z', changed_by: 'owner' } } })

describe('F1 — the lock is a READ-TIME overlay: a 業種 round trip restores the switch', () => {
  it('beauty_chiropractic OWNER/ON → dental_clinic (OFF, disabled) → back: ON again, and a save with no other edit stamps nothing', () => {
    const saved = roundTrip(ownerOn('beauty_chiropractic'))
    const r = room(saved)
    r.pickType('dental_clinic')
    expect(r.draft().switches.read_points.on).toBe(false)
    const { container } = render(<StorePageRows draft={r.draft()} saved={saved} counts={{ posts: 1 }} canEdit onChange={() => {}} />)
    const sw = container.querySelector('.spr-row[data-key="read_points"] [role="switch"]')!
    expect(sw.getAttribute('aria-disabled')).toBe('true')
    expect(sw.getAttribute('aria-checked')).toBe('false')
    cleanup()
    r.pickType('beauty_chiropractic')
    expect(r.draft().switches.read_points).toEqual(saved.switches.read_points)
    expect(r.dirty()).toBe(false) // the room sends nothing
    expect(save(saved, r.draft())).toEqual(saved) // and the door would stamp nothing
  })
  it('hair_salon → dental_clinic → hair_salon, save: read_points source unchanged (the Sonnet case)', () => {
    const saved = roundTrip(seedRecord('hair_salon'))
    const r = room(saved)
    r.pickType('dental_clinic')
    r.pickType('hair_salon')
    const out = save(saved, r.draft())
    expect(out.switches.read_points).toEqual(saved.switches.read_points)
    expect(out).toEqual(saved)
  })
})

describe('F2 — a locked key on the wire: OFF / TYPE_DEFAULT / this save\'s stamp', () => {
  it('OWNER/ON read_points + a locked type → on:false TYPE_DEFAULT with the new stamp; after a lock removal the key follows the table and an owner flip stamps OWNER', () => {
    const saved = roundTrip(ownerOn('beauty_chiropractic'))
    const out = save(saved, lockOff({ ...saved, business_type: 'dental_clinic' }))
    expect(out.switches.read_points).toEqual({ on: false, source: 'TYPE_DEFAULT', changed_at: NOW.toISOString(), changed_by: 'staff-1' })
    // the lock lifted (an isolated model whose lock table loses dental_clinic): the key resolves from the table
    let m: typeof import('@/business/lib/store-page/model') | undefined
    jest.isolateModules(() => {
      const freeze = Object.freeze
      Object.freeze = (<T,>(o: T): T => o) as typeof Object.freeze
      try {
        m = require('@/business/lib/store-page/model') // eslint-disable-line @typescript-eslint/no-require-imports -- an isolated, unfrozen model instance
      } finally {
        Object.freeze = freeze
      }
    })
    delete (m!.TYPE_LOCKED_OFF as Record<string, unknown>).dental_clinic
    const lifted = m!.parseRecord(JSON.parse(JSON.stringify(serializeRecord(out))))!
    expect(lifted.switches.read_points).toMatchObject({ source: 'TYPE_DEFAULT', on: m!.TYPE_DEFAULTS.beauty_chiropractic.includes('read_points') })
    const flipped = m!.stampSave(lifted, flip(lifted, 'read_points', !lifted.switches.read_points.on), [], NOW, 'staff-2')
    expect(flipped.switches.read_points).toEqual({ on: !lifted.switches.read_points.on, source: 'OWNER', changed_at: NOW.toISOString(), changed_by: 'staff-2' })
  })
})

describe('F3 — the draft carries defaults_type; 戻す sets it always', () => {
  it('戻す foot_care on a beauty_chiropractic record with zero flips → defaults_type foot_care', () => {
    const saved = roundTrip(seedRecord('beauty_chiropractic'))
    expect(resetDiff({ ...saved, business_type: 'foot_care' }).none).toBe(true) // the same set: zero flips
    const r = room(saved)
    r.pickType('foot_care')
    render(<StorePageType draft={r.draft()} saved={saved} canEdit onChange={r.apply} onResetKeys={() => {}} onToast={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '業種の標準に戻す' }))
    fireEvent.click(screen.getByRole('button', { name: '戻す' }))
    expect(r.draft().defaults_type).toBe('foot_care')
    expect(save(saved, r.draft()).defaults_type).toBe('foot_care')
  })
  it('戻す hair_salon then pick nail_salon (no second 戻す) → defaults_type hair_salon; 戻す\'s keys stay TYPE_DEFAULT; the record resolves to the page', () => {
    const saved = roundTrip(seedRecord('beauty_chiropractic'))
    const asked = { ...saved, business_type: 'hair_salon' as const }
    const keys = resetDiff(asked).flips.map((f) => f.key)
    expect(keys.length).toBeGreaterThan(0)
    const page = lockOff({ ...applyReset(asked), business_type: 'nail_salon' })
    const out = save(saved, page, keys)
    expect(out.defaults_type).toBe('hair_salon')
    for (const k of keys) expect(out.switches[k].source).toBe('TYPE_DEFAULT')
    expect(CAP_KEYS.filter((k) => out.switches[k].source === 'OWNER')).toEqual([])
    const read = roundTrip(out)
    for (const k of CAP_KEYS) expect(read.switches[k].on).toBe(page.switches[k].on)
  })
})

describe('F5 — a save refused for a locked switch shows its own line', () => {
  const cardLines = { forbidden: 'f', tenant: 't', invalid: 'i', core: 'c' }
  it('the client reads the door\'s additive `locked` as its own reason; save-lines picks SAVE_FAIL.locked (never core\'s retry)', async () => {
    const answer = (body: unknown) => { global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => body }) as unknown as typeof fetch }
    const call = () => putStoreCapabilities('b', { storeId: 's', record: seedRecord('dental_clinic'), resetKeys: [], basedOn: 'h' })
    answer({ ok: false, reason: 'invalid', locked: 'read_points' })
    expect(await call()).toEqual({ ok: false, reason: 'locked' })
    answer({ ok: false, reason: 'invalid' })
    expect(await call()).toEqual({ ok: false, reason: 'invalid' })
    expect(saveFailLines('unsent', 'locked', cardLines).caps).toBe(SAVE_FAIL.locked)
    expect(SAVE_FAIL.locked).not.toBe(SAVE_FAIL.core)
    expect(SAVE_FAIL.locked).toContain('再読み込み')
    // S75 fix 2 (R-C): the reader's line, exactly
    expect(SAVE_FAIL.locked).toBe('この業種ではオンにできない機能がオンのままだったため、保存できませんでした。ページを再読み込みしてから、もう一度変更してください（お客様のアプリに出る機能はこれまでのままです）。')
    expect(saveFailLines('unsent', 'invalid', cardLines).caps).toBe(SAVE_FAIL.core)
  })
})

describe('S75 fix 2 (R-D) — the 業種 note names read_points by its row label', () => {
  it('renders byte-identical to the ruled sentence, and the label is the row list\'s own', () => {
    const NOTE = 'ただし、保険診療が関わる業種を選ぶと、読んでポイントはオフになります。'
    expect(REG.find((r) => r.key === 'read_points')?.ja).toBe('読んでポイント')
    expect(TYPE_BLOCK.sub.endsWith('その場では何も変わりません。' + NOTE)).toBe(true)
    expect(BLOCK_GUIDES.find((g) => g.title === '業種')?.guide.endsWith('その場では何も変わりません。' + NOTE)).toBe(true)
  })
})

// ── S75 FIX ROUND 3 (R-E, READ-FIX2-SONNET-S75 SF1) — a TYPE_DEFAULT key never gets a phantom OWNER stamp ─────────────
describe('R-E — the lock is an overlay in BOTH directions; a TYPE_DEFAULT key at its standard stays TYPE_DEFAULT', () => {
  it('(b) beauty_chiropractic OWNER/ON → dental_clinic → save → pick back: the draft reads the table ON → save: TYPE_DEFAULT/ON, no stamp', () => {
    const owned = roundTrip(ownerOn('beauty_chiropractic'))
    const r1 = room(owned)
    r1.pickType('dental_clinic')
    const s1 = roundTrip(save(owned, r1.draft()))
    expect(s1.switches.read_points).toEqual({ on: false, source: 'TYPE_DEFAULT', changed_at: NOW.toISOString(), changed_by: 'staff-1' })
    const r2 = room(s1)
    r2.pickType('beauty_chiropractic')
    expect(r2.draft().switches.read_points).toEqual({ ...s1.switches.read_points, on: true }) // the table's standard, still TYPE_DEFAULT
    const s2 = save(s1, r2.draft()) // no reset_keys: R-E (2) needs none
    expect(s2.switches.read_points).toEqual({ on: true, source: 'TYPE_DEFAULT' })
    expect(roundTrip(s2).switches.read_points).toEqual({ on: true, source: 'TYPE_DEFAULT' })
    expect(CAP_KEYS.filter((k) => s2.switches[k].source === 'OWNER')).toEqual([])
  })
  it('a key the owner touched keeps the room value: dental_clinic → pick beauty_chiropractic, read_points flipped OFF by hand → OWNER/OFF', () => {
    const owned = roundTrip(ownerOn('beauty_chiropractic'))
    const r0 = room(owned)
    r0.pickType('dental_clinic')
    const s1 = roundTrip(save(owned, r0.draft()))
    const r = room(s1)
    r.pickType('beauty_chiropractic')
    expect(r.draft().switches.read_points.on).toBe(true)
    r.apply(flip(r.draft(), 'read_points', false))
    expect(r.draft().switches.read_points.on).toBe(false)
    expect(save(s1, r.draft()).switches.read_points).toEqual({ on: false, source: 'OWNER', changed_at: NOW.toISOString(), changed_by: 'staff-1' })
  })
  it('D2(d) still holds: 戻す moved a key, the owner set it back by hand → OWNER (reset_keys or not); a 戻す key left alone → TYPE_DEFAULT without reset_keys', () => {
    const saved = roundTrip(seedRecord('beauty_chiropractic'))
    const r = room(saved)
    r.pickType('hair_salon')
    const reset = applyReset(r.draft())
    const moved = CAP_KEYS.filter((k) => reset.switches[k].on !== saved.switches[k].on)
    expect(moved.length).toBeGreaterThan(1)
    r.apply(reset)
    const [back, left] = moved
    r.apply(flip(r.draft(), back, saved.switches[back].on))
    expect(r.draft().switches[back].on).toBe(saved.switches[back].on)
    for (const keys of [[], [back]] as CapKey[][]) {
      const out = save(saved, r.draft(), keys)
      expect(out.switches[back]).toEqual({ on: saved.switches[back].on, source: 'OWNER', changed_at: NOW.toISOString(), changed_by: 'staff-1' })
      expect(out.switches[left]).toEqual({ on: reset.switches[left].on, source: 'TYPE_DEFAULT' })
    }
  })
})
