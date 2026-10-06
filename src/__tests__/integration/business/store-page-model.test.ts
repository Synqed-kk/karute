// S49 P1 — the お店ページ switch model + CORE-47 wire codec, pinned by behaviour.
// Counts = the mock's STORES fixture (MOCK-SWITCHBOARD-v2.html :938 La Estro, :979 STUDIO FORCE). No clock is read:
// stampSave takes `now` as an argument, so the machine clock never decides a result.
import { businessProfiles } from '@/business/lib/fixtures-settings'
import { HONEST, RESET, TYPE_JA } from '@/business/lib/store-page/copy'
import {
  BUSINESS_TYPE_KEYS, CAP_KEYS, TYPE_DEFAULTS, applyReset, asksBeforeOff, changeCount, chipState, chipText, familyOf, honestLines, internalKeyOf, parseInternalRecord, parseRecord,
  pending, publicProjection, ready, recordHash, resetDiff, seedRecord, serializeRecord, stampSave, storeCapabilitiesKeyFor, typeKeyOf, wireKeyOf,
  type BusinessTypeKey, type CapKey, type CapRecord,
} from '@/business/lib/store-page/model'

const LAESTRO = { packs: 3, classes: 0, care: 2, posts: 4, questions: 3, products: 3, resources: 0 }
const FORCE = { packs: 0, classes: 12, care: 1, posts: 2, questions: 0, products: 0, resources: 24 }
const NOW = new Date('2026-09-14T03:00:00.000Z')

const flip = (rec: CapRecord, k: CapKey, on: boolean): CapRecord => ({
  ...rec, switches: { ...rec.switches, [k]: { ...rec.switches[k], on } },
})
const onKeys = (rec: CapRecord) => CAP_KEYS.filter((k) => rec.switches[k].on)

describe('seed + TYPE_DEFAULTS (spec F1)', () => {
  it('seeds every one of the 16 keys at the TYPE default, source TYPE_DEFAULT — all 26 sets pinned (L53/TYPE-SETS-S53.md)', () => {
    expect(CAP_KEYS).toHaveLength(16)
    // Copied from TYPE-SETS-S53.md's ON column, one literal per row (R143); compared as sets.
    const SETS: Record<BusinessTypeKey, CapKey[]> = {
      esthetic_salon: ['checkin_qr', 'packs', 'homecare', 'photo_proof', 'posts', 'read_points', 'intake', 'shop'],
      hair_salon: ['checkin_qr', 'homecare', 'photo_proof', 'posts', 'read_points', 'shop', 'intake'],
      nail_salon: ['checkin_qr', 'homecare', 'photo_proof', 'posts', 'read_points', 'intake'],
      eyelash_salon: ['checkin_qr', 'packs', 'homecare', 'photo_proof', 'posts', 'read_points', 'intake'],
      massage: ['checkin_qr', 'packs', 'homecare', 'posts', 'read_points', 'intake'],
      beauty_chiropractic: ['checkin_qr', 'packs', 'homecare', 'photo_proof', 'posts', 'read_points', 'intake'],
      foot_care: ['checkin_qr', 'packs', 'homecare', 'photo_proof', 'posts', 'read_points', 'intake'],
      relaxation: ['checkin_qr', 'packs', 'posts', 'read_points', 'intake'],
      aroma: ['checkin_qr', 'packs', 'homecare', 'posts', 'read_points', 'intake', 'shop'],
      pet_grooming: ['checkin_qr', 'homecare', 'photo_proof', 'posts', 'read_points', 'intake'],
      yoga_studio: ['checkin_qr', 'packs', 'classes', 'waitlist', 'homecare', 'posts', 'read_points', 'reactions', 'rental'],
      pilates_studio: ['checkin_qr', 'packs', 'classes', 'waitlist', 'homecare', 'photo_proof', 'posts', 'read_points', 'reactions', 'rental'],
      personal_gym: ['checkin_qr', 'packs', 'homecare', 'photo_proof', 'video_proof', 'posts', 'read_points', 'reactions', 'shop'],
      training_school: ['checkin_qr', 'packs', 'classes', 'waitlist', 'homecare', 'posts', 'read_points', 'reactions'],
      chiropractic: ['checkin_qr', 'packs', 'intake', 'homecare', 'photo_proof', 'posts', 'read_points'],
      acupuncture: ['checkin_qr', 'packs', 'intake', 'homecare', 'posts'],
      osteopathy: ['checkin_qr', 'intake', 'homecare', 'photo_proof', 'posts'],
      dental_clinic: ['checkin_qr', 'intake', 'homecare', 'posts'],
      medical_clinic: ['checkin_qr', 'intake', 'posts'],
      dermatology: ['checkin_qr', 'intake', 'homecare', 'photo_proof', 'posts', 'shop'],
      cosmetic_surgery: ['checkin_qr', 'packs', 'intake', 'homecare', 'photo_proof', 'posts', 'shop'], // R269 (S75): read_points DEFAULT OFF
      physical_therapy: ['checkin_qr', 'packs', 'intake', 'homecare', 'photo_proof', 'video_proof', 'posts'],
      wellness_clinic: ['checkin_qr', 'packs', 'intake', 'homecare', 'photo_proof', 'posts', 'shop'], // R269 (S75): read_points DEFAULT OFF
      mental_health: ['checkin_qr', 'packs', 'intake', 'homecare', 'posts'],
      veterinary: ['checkin_qr', 'intake', 'homecare', 'posts', 'read_points', 'shop'],
      other: ['checkin_qr'],
    }
    expect(Object.keys(SETS)).toHaveLength(26)
    expect(Object.fromEntries(BUSINESS_TYPE_KEYS.map((t) => [t, [...onKeys(seedRecord(t))].sort()])))
      .toEqual(Object.fromEntries(Object.entries(SETS).map(([t, ks]) => [t, [...ks].sort()])))
    // TYPE-SETS-S53.md 「Counts」 line, in table order.
    const TABLE_ORDER = ['esthetic_salon', 'hair_salon', 'nail_salon', 'eyelash_salon', 'massage', 'beauty_chiropractic', 'foot_care',
      'relaxation', 'aroma', 'pet_grooming', 'yoga_studio', 'pilates_studio', 'personal_gym', 'training_school', 'chiropractic',
      'acupuncture', 'osteopathy', 'dental_clinic', 'medical_clinic', 'dermatology', 'cosmetic_surgery', 'physical_therapy',
      'wellness_clinic', 'mental_health', 'veterinary', 'other'] as const
    expect(TABLE_ORDER.map((t) => onKeys(seedRecord(t)).length)).toEqual([8, 7, 6, 7, 6, 7, 7, 5, 7, 6, 9, 10, 9, 8, 7, 5, 5, 4, 3, 6, 7, 7, 7, 5, 6, 1]) // S75: cosmetic_surgery, wellness_clinic −1 (R269)
    for (const t of BUSINESS_TYPE_KEYS) {
      expect(seedRecord(t).business_type).toBe(t)
      expect(CAP_KEYS.every((k) => seedRecord(t).switches[k].source === 'TYPE_DEFAULT')).toBe(true)
    }
  })
  it('PARENT RULE: no type set turns a sub ON without its parent (the projection drops nothing from a fresh seed)', () => {
    for (const t of BUSINESS_TYPE_KEYS) {
      expect({ t, on: publicProjection('s', seedRecord(t)).on }).toEqual({ t, on: onKeys(seedRecord(t)) })
      expect(TYPE_DEFAULTS[t].length).toBe(onKeys(seedRecord(t)).length)
    }
  })
  it('BUSINESS_TYPE_KEYS = businessProfiles values, same order (26-key twin pin)', () => {
    expect(BUSINESS_TYPE_KEYS).toEqual(businessProfiles.map((p) => p.value))
    expect(BUSINESS_TYPE_KEYS).toHaveLength(26)
  })
  it('typeKeyOf: a known key is itself; null, empty, a legacy family name, a padded key or junk → other (R145, attack S53 NIT 3)', () => {
    expect(typeKeyOf('yoga_studio')).toBe('yoga_studio')
    for (const t of BUSINESS_TYPE_KEYS) expect(typeKeyOf(t)).toBe(t)
    for (const junk of ['', null, undefined, 'SALON', 'GYM', 'CLINIC', 'RETAIL', 'GENERIC', 'zzz', 'HAIR_SALON', 'hair_salon ', ' hair_salon', '__proto__', 'toString', 5, {}]) {
      expect(typeKeyOf(junk)).toBe('other')
    }
  })
  it('maps Karute types to an internal family; unknown or empty → GENERIC', () => {
    expect(familyOf('beauty_chiropractic')).toBe('SALON')
    expect(familyOf('personal_gym')).toBe('GYM')
    expect(familyOf('chiropractic')).toBe('CLINIC')
    expect(familyOf('other')).toBe('GENERIC')
    expect(familyOf('')).toBe('GENERIC')
    expect(familyOf(null)).toBe('GENERIC')
    expect(familyOf('toString')).toBe('GENERIC')
  })
  it('pins ALL 26 FAMILY_OF entries (R143 internal grouping; any drift is red) and unknown → GENERIC', () => {
    const DRAFT = {
      esthetic_salon: 'SALON', hair_salon: 'SALON', nail_salon: 'SALON', eyelash_salon: 'SALON', massage: 'SALON',
      beauty_chiropractic: 'SALON', foot_care: 'SALON', relaxation: 'SALON', aroma: 'SALON', pet_grooming: 'SALON',
      yoga_studio: 'GYM', pilates_studio: 'GYM', personal_gym: 'GYM', training_school: 'GYM',
      chiropractic: 'CLINIC', acupuncture: 'CLINIC', osteopathy: 'CLINIC', dental_clinic: 'CLINIC',
      medical_clinic: 'CLINIC', dermatology: 'CLINIC', cosmetic_surgery: 'CLINIC', physical_therapy: 'CLINIC',
      wellness_clinic: 'CLINIC', mental_health: 'CLINIC', veterinary: 'CLINIC',
      other: 'GENERIC',
    } as const
    const types = businessProfiles.map((p) => p.value)
    expect(types).toHaveLength(26)
    expect([...types].sort()).toEqual(Object.keys(DRAFT).sort())
    expect(Object.fromEntries(types.map((t) => [t, familyOf(t)]))).toEqual(DRAFT)
    for (const junk of ['', 'unknown_type', 'HAIR_SALON', '__proto__', 'hasOwnProperty']) expect(familyOf(junk)).toBe('GENERIC')
    expect(familyOf(undefined)).toBe('GENERIC')
  })
  it('keys the record one flat org-settings key per store', () => {
    expect(storeCapabilitiesKeyFor('aa36d5fe')).toBe('reserve_store_capabilities:aa36d5fe')
  })
})

describe('ready / chip (D1, E3)', () => {
  const salon = seedRecord('beauty_chiropractic')
  it('ON with a count > 0 is ready and shows; ON with 0 is pending with the need chip', () => {
    expect(ready('packs', salon, LAESTRO)).toBe(true)
    expect(chipText('packs', salon, LAESTRO)).toBe('お客様に表示中')
    expect(ready('packs', salon, FORCE)).toBe(false)
    expect(pending('packs', salon, FORCE)).toBe(true)
    expect(chipText('packs', salon, FORCE)).toBe('準備が必要 ・ 回数券が0件')
    expect(chipState('classes', salon, LAESTRO)).toBe('off')
    expect(chipText('classes', salon, LAESTRO)).toBe('オフ')
  })
  it('a row with no count is ready whenever ON; an UNKNOWN count is not 0 (R92 / R101)', () => {
    expect(ready('checkin_qr', salon, {})).toBe(true)
    expect(chipState('checkin_qr', salon, {})).toBe('on')
    const unknown = { ...LAESTRO, posts: undefined }
    expect(ready('posts', salon, unknown)).toBe(false)
    expect(pending('posts', salon, unknown)).toBe(false)
    expect(chipState('posts', salon, unknown)).toBeNull()
    expect(chipText('posts', salon, unknown)).toBeNull()
    expect(chipState('posts', salon, {})).toBeNull()
    expect(chipState('posts', flip(salon, 'posts', false), unknown)).toBe('off')
    expect(honestLines(salon, unknown)).toEqual([])
    expect(honestLines(salon, { ...unknown, posts: 0 })).toHaveLength(1)
  })
  it('subs carry no chip; WAITLIST ON shows お客様に表示中 even with no classes (mock E3)', () => {
    expect(chipState('photo_proof', salon, LAESTRO)).toBeNull()
    expect(chipState('waitlist', flip(salon, 'waitlist', true), LAESTRO)).toBe('on')
  })
})

describe('countOf — a malformed count is UNKNOWN (attack S52-1, R92 / R101 / R108)', () => {
  const salon = seedRecord('beauty_chiropractic')
  const gym = seedRecord('yoga_studio')
  it.each([
    ['null', null], ['NaN', NaN], ['-1', -1], ["'3'", '3'], ['Infinity', Infinity],
  ])('%s behaves exactly like an unknown count', (_, bad) => {
    const counts = { ...LAESTRO, packs: bad, classes: bad } as unknown as typeof LAESTRO
    expect(chipState('packs', salon, counts)).toBeNull()
    expect(chipText('packs', salon, counts)).toBeNull()
    expect(ready('packs', salon, counts)).toBe(false)
    expect(pending('packs', salon, counts)).toBe(false)
    expect(asksBeforeOff('packs', salon, counts)).toBe(true)
    expect(ready('classes', gym, counts)).toBe(false)
    expect(honestLines(gym, counts)).not.toContain(HONEST.waitlist)
  })
  it('a finite count >= 0 is still read (0 = pending, 3 = ready)', () => {
    expect(chipState('packs', salon, { ...LAESTRO, packs: 0 })).toBe('need')
    expect(ready('packs', salon, { ...LAESTRO, packs: 3 })).toBe(true)
  })
})

describe('the OFF ask (D2)', () => {
  it('asks only for a row with an off sentence AND a live count, never when turning ON', () => {
    const gym = seedRecord('yoga_studio')
    const all = { ...seedRecord('other'), switches: Object.fromEntries(CAP_KEYS.map((k) => [k, { on: true, source: 'TYPE_DEFAULT' }])) } as CapRecord
    const asking = (counts: typeof LAESTRO) => CAP_KEYS.filter((k) => asksBeforeOff(k, all, counts))
    expect(asking(LAESTRO)).toEqual(['packs', 'homecare', 'posts', 'shop'])
    expect(asking(FORCE)).toEqual(['classes', 'homecare', 'posts', 'rental'])
    expect(asksBeforeOff('packs', flip(gym, 'packs', false), LAESTRO)).toBe(false)
  })
  it('an UNKNOWN count asks before OFF (R92, safe side); a known 0 does not', () => {
    const salon = seedRecord('beauty_chiropractic')
    expect(asksBeforeOff('packs', salon, { ...LAESTRO, packs: undefined })).toBe(true)
    expect(asksBeforeOff('packs', salon, {})).toBe(true)
    expect(asksBeforeOff('packs', salon, { ...LAESTRO, packs: 0 })).toBe(false)
    expect(asksBeforeOff('checkin_qr', salon, {})).toBe(false)
  })
})

describe('subs (D4) + public projection', () => {
  it('a parent OFF never flips its subs; the projection drops them until the parent is back', () => {
    const off = flip(seedRecord('beauty_chiropractic'), 'posts', false)
    expect(off.switches.read_points.on).toBe(true)
    expect(publicProjection('s1', off)).toEqual({ store_id: 's1', on: ['checkin_qr', 'packs', 'homecare', 'photo_proof', 'intake'] })
    expect(publicProjection('s1', flip(off, 'posts', true)).on).toContain('read_points')
  })
})

describe('change count (D12) + type change (D7)', () => {
  it('counts switch keys differing from saved, +1 for the type; toggling back brings it down', () => {
    const saved = seedRecord('beauty_chiropractic')
    expect(changeCount(saved, saved)).toBe(0)
    const d1 = flip(saved, 'classes', true)
    expect(changeCount(d1, saved)).toBe(1)
    expect(changeCount(flip(d1, 'classes', false), saved)).toBe(0)
    const typed = { ...saved, business_type: 'yoga_studio' as const }
    expect(changeCount(typed, saved)).toBe(1)
    expect(onKeys(typed)).toEqual(onKeys(saved))
  })
})

describe('戻す (D9 per DECISIONS D-RESET)', () => {
  it('lists TYPE_DEFAULT flips (incl. unsaved draft flips) and keeps OWNER keys', () => {
    const saved = stampSave(seedRecord('beauty_chiropractic'), flip(seedRecord('beauty_chiropractic'), 'packs', false), [], NOW, 'staff-1')
    const draft = { ...flip(saved, 'checkin_qr', false), business_type: 'yoga_studio' as const }
    const diff = resetDiff(draft)
    expect(diff.keeps).toEqual(['packs'])
    expect(diff.flips).toEqual([
      { key: 'checkin_qr', from: false, to: true }, { key: 'classes', from: false, to: true },
      { key: 'photo_proof', from: true, to: false }, { key: 'reactions', from: false, to: true },
      { key: 'intake', from: true, to: false }, { key: 'waitlist', from: false, to: true },
      { key: 'rental', from: false, to: true },
    ])
    expect(diff.none).toBe(false)
    expect(RESET.flip(diff.flips[0].from, diff.flips[0].to)).toBe('オフ → オン')
  })
  it('none when nothing would flip', () => {
    expect(resetDiff(seedRecord('medical_clinic'))).toEqual({ flips: [], keeps: [], none: true })
  })
  it('applyReset moves only TYPE_DEFAULT keys, leaves the type, and a save keeps them TYPE_DEFAULT', () => {
    const saved = seedRecord('beauty_chiropractic')
    const draft = applyReset({ ...saved, business_type: 'yoga_studio' })
    const resetKeys = resetDiff({ ...saved, business_type: 'yoga_studio' }).flips.map((f) => f.key)
    expect(draft.business_type).toBe('yoga_studio')
    expect(onKeys(draft)).toEqual(onKeys(seedRecord('yoga_studio')))
    const after = stampSave(saved, draft, resetKeys, NOW, 'staff-1')
    expect(CAP_KEYS.every((k) => after.switches[k].source === 'TYPE_DEFAULT')).toBe(true)
    expect(resetDiff({ ...after, business_type: 'beauty_chiropractic' }).flips).toHaveLength(6)
    expect(RESET.toast(TYPE_JA.GYM)).toBe('業種「ジム・スタジオ」の標準に戻しました。保存するとお客様のアプリに反映されます')
  })
})

describe('D7 — a type change alone moves no switch; TYPE_DEFAULT = untouched by the owner (S68, DECISIONS-S49:17)', () => {
  const A = seedRecord('hair_salon')
  const B = seedRecord('yoga_studio')
  const differing = CAP_KEYS.filter((k) => A.switches[k].on !== B.switches[k].on)
  it('E1 (D7) saved hair_salon, the draft changes only business_type to yoga_studio, reset_keys [] → the type moves, every switch keeps its value, 0 OWNER', () => {
    expect(differing.length).toBeGreaterThan(0)
    const after = stampSave(A, { ...A, business_type: 'yoga_studio' }, [], NOW, 'staff-1')
    expect(after.business_type).toBe('yoga_studio')
    for (const k of CAP_KEYS) expect(after.switches[k].on).toBe(A.switches[k].on)
    expect(CAP_KEYS.filter((k) => after.switches[k].source === 'OWNER')).toEqual([])
  })
  it('E1b then 戻す: yoga_studio\'s defaults on the differing keys, those keys in reset_keys → exactly seedRecord(yoga_studio), 0 OWNER', () => {
    const typed = stampSave(A, { ...A, business_type: 'yoga_studio' }, [], NOW, 'staff-1')
    // S75 fix 1 (SF2/SF3): 戻す sets the draft's defaults_type to the type it reset to
    const draft: CapRecord = { ...typed, defaults_type: 'yoga_studio', switches: { ...typed.switches, ...Object.fromEntries(differing.map((k) => [k, { ...typed.switches[k], on: B.switches[k].on }])) } }
    expect(stampSave(typed, draft, differing, NOW, 'staff-1')).toEqual(B)
  })
})

describe('applyReset / resetDiff read the type from the record (R134 / R144)', () => {
  it('a record set to personal_gym resets to personal_gym\'s set; the save keeps those keys TYPE_DEFAULT (R89)', () => {
    const saved = seedRecord('beauty_chiropractic')
    const typed: CapRecord = { ...saved, business_type: 'personal_gym' }
    const draft = applyReset(typed)
    expect(draft.business_type).toBe('personal_gym')
    expect(onKeys(draft)).toEqual(onKeys(seedRecord('personal_gym')))
    const resetKeys = resetDiff(typed).flips.map((f) => f.key)
    expect(resetKeys).toEqual(CAP_KEYS.filter((k) => draft.switches[k].on !== saved.switches[k].on))
    expect(resetKeys).toEqual(['video_proof', 'reactions', 'intake', 'shop'])
    const after = stampSave(saved, draft, resetKeys, NOW, 'staff-1')
    for (const k of resetKeys) expect(after.switches[k]).toEqual({ on: seedRecord('personal_gym').switches[k].on, source: 'TYPE_DEFAULT' })
    expect(after.business_type).toBe('personal_gym')
  })
  it('a draft whose business_type changed from hair_salon to yoga_studio diffs against yoga_studio\'s set', () => {
    const draft: CapRecord = { ...seedRecord('hair_salon'), business_type: 'yoga_studio' }
    expect(resetDiff(draft).flips).toEqual([
      { key: 'packs', from: false, to: true }, { key: 'classes', from: false, to: true },
      { key: 'photo_proof', from: true, to: false }, { key: 'reactions', from: false, to: true },
      { key: 'intake', from: true, to: false },
      { key: 'waitlist', from: false, to: true }, { key: 'shop', from: true, to: false }, { key: 'rental', from: false, to: true },
    ])
    expect(onKeys(applyReset(draft))).toEqual(onKeys(seedRecord('yoga_studio')))
    expect(resetDiff(seedRecord('hair_salon')).none).toBe(true)
  })
  it('a record still typed beauty_chiropractic resets to its own set (no type argument exists)', () => {
    const off = flip(seedRecord('beauty_chiropractic'), 'packs', false)
    expect(onKeys(applyReset(off))).toEqual(onKeys(seedRecord('beauty_chiropractic')))
  })
})

describe('save stamp (D10 per DECISIONS)', () => {
  it('stamps only keys whose on changed; unchanged keys keep their saved state', () => {
    const first = stampSave(seedRecord('beauty_chiropractic'), flip(seedRecord('beauty_chiropractic'), 'packs', false), [], NOW, 'staff-1')
    expect(first.switches.packs).toEqual({ on: false, source: 'OWNER', changed_at: '2026-09-14T03:00:00.000Z', changed_by: 'staff-1' })
    expect(first.switches.checkin_qr).toEqual({ on: true, source: 'TYPE_DEFAULT' })
    const second = stampSave(first, flip(first, 'shop', true), [], new Date('2026-09-20T00:00:00.000Z'), 'staff-2')
    expect(second.switches.packs).toEqual(first.switches.packs)
    expect(second.switches.shop).toMatchObject({ on: true, source: 'OWNER', changed_by: 'staff-2' })
  })
})

describe('save stamp — the server decides source (R89)', () => {
  const salon = seedRecord('beauty_chiropractic')
  const ownerPacks = stampSave(salon, flip(salon, 'packs', false), [], NOW, 'staff-1')
  it('ignores a forged client source / changed_at / changed_by on a changed key → OWNER', () => {
    const forged = { ...salon, switches: { ...salon.switches, shop: { on: true, source: 'TYPE_DEFAULT', changed_at: '1999-01-01T00:00:00.000Z', changed_by: 'evil' } } } as CapRecord
    expect(stampSave(salon, forged, [], NOW, 'staff-1').switches.shop).toEqual({ on: true, source: 'OWNER', changed_at: NOW.toISOString(), changed_by: 'staff-1' })
  })
  it('ignores a forged source on an unchanged key: the saved stamp is kept exactly', () => {
    const forged = { ...ownerPacks, switches: { ...ownerPacks.switches, packs: { on: false, source: 'TYPE_DEFAULT' } } } as CapRecord
    expect(stampSave(ownerPacks, forged, ['packs'], NOW, 'staff-2').switches.packs).toEqual(ownerPacks.switches.packs)
  })
  it('a reset_keys entry on an OWNER key cannot bring it back to TYPE_DEFAULT', () => {
    const back = stampSave(ownerPacks, flip(ownerPacks, 'packs', true), ['packs'], NOW, 'staff-2')
    expect(back.switches.packs).toEqual({ on: true, source: 'OWNER', changed_at: NOW.toISOString(), changed_by: 'staff-2' })
  })
  it('a reset_keys entry whose new value is not the type default → OWNER', () => {
    expect(stampSave(salon, flip(salon, 'classes', true), ['classes'], NOW, 's').switches.classes.source).toBe('OWNER')
  })
  it('a hand toggle that lands on the default (not in reset_keys) → OWNER', () => {
    const gymDraft = { ...flip(salon, 'classes', true), business_type: 'yoga_studio' as const }
    expect(stampSave(salon, gymDraft, [], NOW, 's').switches.classes.source).toBe('OWNER')
    expect(stampSave(salon, { ...gymDraft, defaults_type: 'yoga_studio' }, ['classes'], NOW, 's').switches.classes).toEqual({ on: true, source: 'TYPE_DEFAULT' }) // S75 fix 1: 戻す set the draft's defaults_type
  })
})

describe('recordHash (R96 / R102)', () => {
  const rec = stampSave(seedRecord('yoga_studio'), flip(seedRecord('yoga_studio'), 'packs', false), [], NOW, 'staff-1')
  it('is key-order independent: a literal built in a different key order hashes to the pin (attack S53 NIT 4)', () => {
    const reordered = JSON.parse(JSON.stringify({ switches: Object.fromEntries([...CAP_KEYS].reverse().map((k) => [k, { changed_by: rec.switches[k].changed_by, changed_at: rec.switches[k].changed_at, source: rec.switches[k].source, on: rec.switches[k].on }])), business_type: 'yoga_studio', defaults_type: 'yoga_studio', v: 1 }))
    expect(Object.keys(reordered)).toEqual(['switches', 'business_type', 'defaults_type', 'v'])
    expect(Object.keys(reordered.switches)[0]).toBe(CAP_KEYS[CAP_KEYS.length - 1])
    expect(recordHash(reordered)).toBe('2649ddd863bbdc32')
    expect(recordHash(rec)).toBe('2649ddd863bbdc32')
    expect(recordHash(rec)).toMatch(/^[0-9a-f]{16}$/)
  })
  it('changes when any field changes', () => {
    const h = recordHash(rec)
    const variants: CapRecord[] = [
      { ...rec, business_type: 'beauty_chiropractic' },
      flip(rec, 'checkin_qr', false),
      { ...rec, switches: { ...rec.switches, packs: { ...rec.switches.packs, source: 'TYPE_DEFAULT' } } },
      { ...rec, switches: { ...rec.switches, packs: { ...rec.switches.packs, changed_at: '2026-09-14T03:00:00.001Z' } } },
      { ...rec, switches: { ...rec.switches, packs: { ...rec.switches.packs, changed_by: 'staff-2' } } },
    ]
    const hashes = variants.map(recordHash)
    expect(new Set([h, ...hashes]).size).toBe(variants.length + 1)
  })
  it('pins a stamped OWNER record and a non-ASCII changed_by id (script-emitted, Sonnet NIT 3)', () => {
    expect(recordHash(rec)).toBe('2649ddd863bbdc32')
    const nonAscii = stampSave(seedRecord('yoga_studio'), flip(seedRecord('yoga_studio'), 'packs', false), [], NOW, 'staff-\u03a9\u00e9\u{1F600}')
    expect(recordHash(nonAscii)).toBe('d5ef94bd09c098b0')
    expect(recordHash(JSON.parse(JSON.stringify(nonAscii)))).toBe('d5ef94bd09c098b0')
  })
  it('null hashes to one fixed string, distinct from any record', () => {
    expect(recordHash(null)).toBe(recordHash(null))
    expect(recordHash(null)).toBe('9b55e0da69fcb93a')
    expect(recordHash(null)).not.toBe(recordHash(seedRecord('other')))
  })
})

describe('honest lines (E2)', () => {
  it('one line per pending row, then the WAITLIST line while classes are not ready', () => {
    const gym = seedRecord('yoga_studio')
    expect(honestLines(gym, FORCE)).toEqual([HONEST.pending('回数券', '回数券')])
    expect(honestLines(gym, LAESTRO)).toEqual([
      'クラスはオンですが、レッスンが0件のため、まだお客様には出ません',
      '設備レンタルはオンですが、設備が0件のため、まだお客様には出ません',
      '待機リストはオンですが、いま満席のレッスンや枠がないため、画面には出ていません',
    ])
  })
  it('R108: no WAITLIST line while the classes count is unknown; a known count keeps it', () => {
    const gym = seedRecord('yoga_studio')
    const waitlistLine = HONEST.waitlist
    const noClasses = { packs: 3, care: 2, posts: 4, questions: 3, products: 3, resources: 0 }
    expect(honestLines(gym, noClasses)).not.toContain(waitlistLine)
    expect(honestLines(gym, { ...LAESTRO, classes: undefined })).not.toContain(waitlistLine)
    expect(honestLines(gym, { ...LAESTRO, classes: 0 })).toContain(waitlistLine)
    expect(honestLines(flip(gym, 'classes', false), { ...FORCE, classes: 5 })).toContain(waitlistLine)
    expect(honestLines(gym, { ...FORCE, classes: 5 })).not.toContain(waitlistLine)
  })
})

// R121: the sixteen UPPER keys, copied from DECISIONS-S51 「## CONTRACT CENSUS」 (CORE-47 9/30 owner record).
const WIRE_KEYS = ['CHECKIN_QR', 'PACKS', 'CLASSES', 'HOMECARE', 'POSTS', 'INTAKE', 'WAITLIST', 'SHOP', 'RENTAL',
  'PHOTO_PROOF', 'VIDEO_PROOF', 'READ_POINTS', 'REACTIONS', 'REUSE_IMPORT', 'POINTS_DISCOUNT', 'POINTS_FULL_PAY']
const wire = (switches: Record<string, unknown>) => ({ v: 1, business_type: 'yoga_studio', switches })

describe('wire codec (R121 = CORE-47 owner record)', () => {
  it('writes all sixteen UPPER keys, each with changed_by_staff_id, and nothing else', () => {
    const rec = stampSave(seedRecord('hair_salon'), flip(seedRecord('hair_salon'), 'rental', true), [], NOW, 'staff-1')
    const out = JSON.parse(JSON.stringify(serializeRecord(rec)))
    expect(Object.keys(out).sort()).toEqual(['business_type', 'defaults_type', 'switches', 'v'])
    expect(out.v).toBe(1)
    expect(out.business_type).toBe('hair_salon')
    expect(Object.keys(out.switches).sort()).toEqual([...WIRE_KEYS].sort())
    expect(out.switches.RENTAL).toEqual({ on: true, source: 'OWNER', changed_at: NOW.toISOString(), changed_by_staff_id: 'staff-1' })
    expect(out.switches.CHECKIN_QR).toEqual({ on: true, source: 'TYPE_DEFAULT' })
    expect(JSON.stringify(out)).not.toContain('"changed_by"')
  })
  it('round-trips every one of the sixteen keys, each alone ON, through JSON', () => {
    for (const wk of WIRE_KEYS) {
      const k = internalKeyOf(wk) as CapKey
      expect(k).not.toBeNull()
      expect(wireKeyOf(k)).toBe(wk)
      // S75 fix 3 (R-E): all-OFF as core stamps it — a TYPE_DEFAULT key set back to its standard stays TYPE_DEFAULT (unstamped)
      const allOff = stampSave(seedRecord('other'), CAP_KEYS.reduce((r, x) => flip(r, x, false), seedRecord('other')), [], NOW, 'staff-0')
      const rec = stampSave(allOff, flip(allOff, k, true), [], NOW, `staff-${wk}`)
      const back = parseRecord(JSON.parse(JSON.stringify(serializeRecord(rec))))
      expect(back).toEqual(rec)
      expect(CAP_KEYS.filter((x) => back?.switches[x].on)).toEqual([k])
      expect(back?.switches[k].changed_by).toBe(`staff-${wk}`)
    }
  })
  it('business_type on the wire = the type key; yoga_studio round-trips (R121 + S52 B5)', () => {
    const rec = stampSave(seedRecord('yoga_studio'), flip(seedRecord('yoga_studio'), 'shop', true), [], NOW, 'staff-1')
    const out = JSON.parse(JSON.stringify(serializeRecord(rec)))
    expect(out.business_type).toBe('yoga_studio')
    expect(parseRecord(out)).toEqual(rec)
    for (const t of BUSINESS_TYPE_KEYS) expect(parseRecord(JSON.parse(JSON.stringify(serializeRecord(seedRecord(t)))))?.business_type).toBe(t)
  })
  it('internalKeyOf refuses the lowercase spelling and junk', () => {
    for (const k of CAP_KEYS) expect(internalKeyOf(k)).toBeNull()
    for (const junk of ['', 'NOMINATION', 'Checkin_Qr', 'CHECKIN_QR ']) expect(internalKeyOf(junk)).toBeNull()
  })
  it('a lowercase-only legacy record parses as absent', () => {
    const legacy = JSON.parse(JSON.stringify({ v: 1, business_type: 'yoga_studio', switches: Object.fromEntries(CAP_KEYS.map((k) => [k, { on: true, source: 'OWNER', changed_by: 'x' }])) }))
    expect(parseRecord(legacy)).toBeNull()
  })
  it('a mixed record keeps only its UPPER keys (lowercase twins ignored, even junk ones)', () => {
    const rec = parseRecord(wire({ CLASSES: { on: true, source: 'OWNER' }, classes: { on: 'junk' }, packs: { on: true, source: 'OWNER' }, NOMINATION: { on: 1 } }))
    expect(rec?.switches.classes).toEqual({ on: true, source: 'OWNER' })
    // S75: a missing known key resolves to the defaults type's table value (resolveRecord), no longer a flat OFF
    expect(rec?.switches.packs).toEqual({ on: TYPE_DEFAULTS.yoga_studio.includes('packs'), source: 'TYPE_DEFAULT' })
    expect(rec?.switches.checkin_qr).toEqual({ on: true, source: 'TYPE_DEFAULT' })
  })
  it('R124: switches holding no known key = absent', () => {
    expect(parseRecord(wire({}))).toBeNull()
    expect(parseRecord(wire({ checkin_qr: { on: true, source: 'OWNER' }, NOMINATION: { on: true, source: 'OWNER' } }))).toBeNull()
  })
  it('reads changed_by_staff_id; the old changed_by field is ignored', () => {
    const rec = parseRecord(wire({ PACKS: { on: true, source: 'OWNER', changed_at: 'T', changed_by_staff_id: 'staff-9', changed_by: 'old' } }))
    expect(rec?.switches.packs).toEqual({ on: true, source: 'OWNER', changed_at: 'T', changed_by: 'staff-9' })
    const oldOnly = parseRecord(wire({ PACKS: { on: true, source: 'OWNER', changed_by: 'old' } }))
    expect(oldOnly?.switches.packs).toEqual({ on: true, source: 'OWNER' })
    expect(parseRecord(wire({ PACKS: { on: true, source: 'OWNER', changed_by: 5 } }))).not.toBeNull()
  })
  it('recordHash hashes the wire spelling (script-emitted pin) and null keeps its fixed hash', () => {
    expect(recordHash(seedRecord('other'))).toBe('0900781b9f0aca70')
    expect(recordHash(null)).toBe('9b55e0da69fcb93a')
  })
  it('caps changed_by_staff_id at 128 and changed_at at 64 UTF-16 code units; one over = the whole record absent (attack S52-5)', () => {
    const at = (n: number) => 'T'.repeat(n)
    const by = (n: number) => 's'.repeat(n)
    const ok = (s: Record<string, unknown>) => wire({ CLASSES: { on: true, source: 'OWNER' }, PACKS: { on: true, source: 'OWNER', ...s } })
    expect(parseRecord(ok({ changed_at: at(64), changed_by_staff_id: by(128) }))?.switches.packs).toEqual({ on: true, source: 'OWNER', changed_at: at(64), changed_by: by(128) })
    expect(parseRecord(ok({ changed_by_staff_id: by(129) }))).toBeNull()
    expect(parseRecord(ok({ changed_at: at(65) }))).toBeNull()
    expect(parseRecord(ok({ changed_by_staff_id: by(5_000_000) }))).toBeNull()
  })
  it.each([
    ['null', null], ['a string', 'x'], ['an array', []], ['wrong v', { v: 2, business_type: 'yoga_studio', switches: { PACKS: { on: true, source: 'OWNER' } } }],
    ['unknown family', { v: 1, business_type: 'SPA', switches: { PACKS: { on: true, source: 'OWNER' } } }], ['no switches', { v: 1, business_type: 'yoga_studio' }],
    ['switches as array', { v: 1, business_type: 'yoga_studio', switches: [] }],
    ...['SALON', 'GYM', 'CLINIC', 'RETAIL', 'GENERIC', '', null, 'YOGA_STUDIO'].map((t) => [`legacy / non-key business_type ${JSON.stringify(t)} (B10)`, { v: 1, business_type: t, switches: { PACKS: { on: true, source: 'OWNER' } } }] as [string, unknown]),
    ['on as string', wire({ CLASSES: { on: true, source: 'OWNER' }, PACKS: { on: 'true', source: 'OWNER' } })],
    ['bad source', wire({ CLASSES: { on: true, source: 'OWNER' }, PACKS: { on: true, source: 'ADMIN' } })],
    ['numeric changed_at', wire({ CLASSES: { on: true, source: 'OWNER' }, PACKS: { on: true, source: 'OWNER', changed_at: 5 } })],
    ['numeric changed_by_staff_id', wire({ CLASSES: { on: true, source: 'OWNER' }, PACKS: { on: true, source: 'OWNER', changed_by_staff_id: 5 } })],
    ['switch as null', wire({ CLASSES: { on: true, source: 'OWNER' }, PACKS: null })],
  ])('treats %s as absent', (_, raw) => {
    expect(parseRecord(raw)).toBeNull()
  })
})

describe('R155 — every type reader goes through typeKeyOf (attack S53 finding 1)', () => {
  const JUNK = ['SALON', '', '__proto__', 'hair_salon '] as unknown as BusinessTypeKey[]
  const base = flip(flip(seedRecord('hair_salon'), 'packs', true), 'shop', false)
  it.each(JUNK.map((j) => [JSON.stringify(j), j]))('%s behaves as other in seedRecord · resetDiff · applyReset · stampSave, never throws', (_, junk) => {
    expect(seedRecord(junk)).toEqual(seedRecord('other'))
    const asJunk = { ...base, business_type: junk }
    const asOther = { ...base, business_type: 'other' as const }
    expect(resetDiff(asJunk)).toEqual(resetDiff(asOther))
    expect(resetDiff(asJunk).none).toBe(false)
    expect(applyReset(asJunk)).toEqual(applyReset(asOther))
    expect(applyReset(asJunk).business_type).toBe('other')
    const saved = seedRecord('hair_salon')
    expect(stampSave(saved, asJunk, ['packs', 'shop'], NOW, 's')).toEqual(stampSave(saved, asOther, ['packs', 'shop'], NOW, 's'))
  })
  it("a stampSave of a draft typed 'SALON' returns business_type other, and its OWNER flips survive serialize → parse", () => {
    const saved = seedRecord('hair_salon')
    const draft = { ...base, business_type: 'SALON' as unknown as BusinessTypeKey }
    const out = stampSave(saved, draft, [], NOW, 'staff-1')
    expect(out.business_type).toBe('other')
    const back = parseRecord(JSON.parse(JSON.stringify(serializeRecord(out))))
    expect(back).not.toBeNull()
    expect(back).toEqual(out)
    expect(back?.switches.packs).toEqual({ on: true, source: 'OWNER', changed_at: NOW.toISOString(), changed_by: 'staff-1' })
    expect(back?.switches.shop).toEqual({ on: false, source: 'OWNER', changed_at: NOW.toISOString(), changed_by: 'staff-1' })
  })
})

describe('the defaults are frozen (attack S53 NIT 5)', () => {
  it('TYPE_DEFAULTS and BUSINESS_TYPE_KEYS are frozen; the record cannot be reassigned', () => {
    expect(Object.isFrozen(TYPE_DEFAULTS)).toBe(true)
    expect(Object.isFrozen(BUSINESS_TYPE_KEYS)).toBe(true)
    expect(() => { (BUSINESS_TYPE_KEYS as BusinessTypeKey[]).push('other') }).toThrow(TypeError)
    expect(() => { (TYPE_DEFAULTS as Record<string, unknown>).other = ['shop'] }).toThrow(TypeError)
    expect(onKeys(seedRecord('other'))).toEqual(['checkin_qr'])
    expect(resetDiff(seedRecord('other')).none).toBe(true)
  })
  // Greptile PR #1126 (model.ts:89): the export is the frozen arrays themselves — no caller can change any type default.
  it('a caller cannot push, splice or write any type default, even via Array.prototype; the model answer is unchanged', () => {
    for (const t of BUSINESS_TYPE_KEYS) {
      const a = TYPE_DEFAULTS[t] as CapKey[]
      const before = Array.from(a)
      expect(Array.isArray(a)).toBe(true)
      expect(Object.isFrozen(a)).toBe(true)
      expect(() => a.push('shop')).toThrow(TypeError)
      expect(() => a.splice(0, 1)).toThrow(TypeError)
      expect(() => { a[0] = 'shop' }).toThrow(TypeError)
      expect(() => Array.prototype.push.call(a, 'video_proof')).toThrow(TypeError)
      expect(() => Array.prototype.splice.call(a, 0, a.length)).toThrow(TypeError)
      expect(Array.from(a)).toEqual(before)
      expect(a.length).toBe(onKeys(seedRecord(t)).length)
      expect(onKeys(seedRecord(t))).toEqual(CAP_KEYS.filter((k) => a.includes(k)))
      expect(resetDiff(seedRecord(t)).none).toBe(true)
    }
    expect(Object.isFrozen(TYPE_DEFAULTS)).toBe(true)
    expect(TYPE_DEFAULTS.other).toEqual(['checkin_qr'])
  })
})

describe('parseInternalRecord — the strict INTERNAL draft read (R126)', () => {
  const rec = { ...seedRecord('hair_salon'), switches: { ...seedRecord('hair_salon').switches, packs: { on: true, source: 'OWNER' as const, changed_at: '2026-09-01T00:00:00.000Z', changed_by: 'staff-9' } } }
  const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Record<string, unknown>
  it('a whole internal record round-trips exactly (changed_by kept)', () => {
    expect(parseInternalRecord(json(rec))).toEqual(rec)
    for (const t of BUSINESS_TYPE_KEYS) expect(parseInternalRecord(json(seedRecord(t)))?.business_type).toBe(t)
  })
  const sw = rec.switches as Record<string, unknown>
  it.each([
    ['null', null],
    ['an array', [rec]],
    ['an extra record field', { ...rec, extra: 1 }],
    ['no switches', { v: 1, business_type: 'hair_salon' }],
    ['v = 2', { ...rec, v: 2 }],
    ['a family name as the type', { ...rec, business_type: 'SALON' }],
    ['a padded type key', { ...rec, business_type: ' hair_salon' }],
    ['the wire spelling', serializeRecord(rec)],
    ['a missing switch', { ...rec, switches: Object.fromEntries(Object.entries(sw).filter(([k]) => k !== 'posts')) }],
    ['an unknown switch', { ...rec, switches: { ...sw, sauna: { on: true, source: 'OWNER' } } }],
    ['an UPPER key among the lowercase', { ...rec, switches: { ...Object.fromEntries(Object.entries(sw).filter(([k]) => k !== 'posts')), POSTS: { on: true, source: 'OWNER' } } }],
    ['on a string', { ...rec, switches: { ...sw, posts: { on: 'true', source: 'OWNER' } } }],
    ['an unknown source', { ...rec, switches: { ...sw, posts: { on: true, source: 'ADMIN' } } }],
    ['changed_by_staff_id (wire field)', { ...rec, switches: { ...sw, posts: { on: true, source: 'OWNER', changed_by_staff_id: 'x' } } }],
    ['changed_by a number', { ...rec, switches: { ...sw, posts: { on: true, source: 'OWNER', changed_by: 5 } } }],
    ['changed_by over 128', { ...rec, switches: { ...sw, posts: { on: true, source: 'OWNER', changed_by: 'b'.repeat(129) } } }],
    ['changed_at over 64', { ...rec, switches: { ...sw, posts: { on: true, source: 'OWNER', changed_at: 't'.repeat(65) } } }],
    ['a switch that is an array', { ...rec, switches: { ...sw, posts: [true] } }],
  ])('anything else → null (%s)', (_l, raw) => {
    expect(parseInternalRecord(raw)).toBeNull()
  })
  it('a non-plain object (class instance / inherited prototype) → null', () => {
    class Rec { v = 1; business_type = 'hair_salon'; switches = sw }
    expect(parseInternalRecord(new Rec())).toBeNull()
    expect(parseInternalRecord(Object.assign(Object.create({ inherited: 1 }), json(rec)))).toBeNull()
  })
})
