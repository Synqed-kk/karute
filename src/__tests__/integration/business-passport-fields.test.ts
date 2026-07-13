/**
 * Passport-field invariants across all business types. Locks the contract so a
 * future edit to business-ai-tokens.ts can't silently break locale parity, key
 * uniqueness, or the count bounds the これまで box relies on.
 */
import { resolvePassportFields } from '@/lib/karute/business-ai-tokens'

// The 26 canonical business types (kept local so this suite has no cross-file
// dependency — it guards business-ai-tokens.ts in isolation).
const TYPES = [
  'esthetic_salon', 'hair_salon', 'nail_salon', 'eyelash_salon', 'massage',
  'chiropractic', 'beauty_chiropractic', 'acupuncture', 'osteopathy',
  'physical_therapy', 'foot_care', 'yoga_studio', 'pilates_studio',
  'personal_gym', 'training_school', 'other', 'dental_clinic', 'medical_clinic',
  'dermatology', 'cosmetic_surgery', 'mental_health', 'relaxation', 'aroma',
  'wellness_clinic', 'veterinary', 'pet_grooming',
]

describe('passport fields — every business type', () => {
  it.each(TYPES)('%s: 4–6 fields, complete, unique keys, ja/en parity', (type) => {
    const ja = resolvePassportFields(type, 'ja')
    const en = resolvePassportFields(type, 'en')

    for (const set of [ja, en]) {
      expect(set.length).toBeGreaterThanOrEqual(4)
      expect(set.length).toBeLessThanOrEqual(6)
      for (const f of set) {
        expect(f.key).toBeTruthy()
        expect(f.label).toBeTruthy()
        expect(f.hint).toBeTruthy()
      }
      const keys = set.map((f) => f.key)
      expect(new Set(keys).size).toBe(keys.length) // no dupes
    }

    // ja and en describe the SAME fields in the same order.
    expect(ja.map((f) => f.key)).toEqual(en.map((f) => f.key))
  })

  it('resolves live, type-specific fields (not the generic fallback)', () => {
    // veterinary must expose animal-subject fields, proving its own set is wired.
    const vet = resolvePassportFields('veterinary', 'ja').map((f) => f.key)
    expect(vet).toContain('species_breed')
    expect(vet).toContain('temperament')
  })

  it('unknown type falls back safely to an authored set', () => {
    const unknown = resolvePassportFields('spaceship_repair', 'ja')
    expect(unknown.length).toBeGreaterThanOrEqual(4)
  })
})
