/**
 * The class-bound verticals are REGISTRY values, not guesses.
 *
 * A yoga class of twelve is ONE booking row, so minutes booked over minutes
 * open is a percentage of nothing (C1 §6 / C2). Those stores take the count
 * table at every layer. That rule is only as good as the strings it keys on:
 * a typo — 'yoga' for the registry's 'yoga_studio' — would silently hand a
 * studio a percentage while every test still passed, because the predicate
 * would simply never match.
 */
import {
  BUSINESS_TYPES,
  CLASS_BOUND_BUSINESS_TYPES,
  coreBusinessType,
  isClassBoundBusinessType,
} from '@/lib/welcome/business-types'

describe('class-bound business types', () => {
  it('every class-bound value EXISTS in BUSINESS_TYPES', () => {
    const known = new Set(BUSINESS_TYPES.map((t) => t.value))
    for (const value of CLASS_BOUND_BUSINESS_TYPES) {
      expect(known.has(value)).toBe(true)
    }
  })

  it('names the three the adjudication names — studios and lessons', () => {
    expect([...CLASS_BOUND_BUSINESS_TYPES].sort()).toEqual([
      'pilates_studio',
      'training_school',
      'yoga_studio',
    ])
  })

  it('a chair-and-bed vertical is NOT class-bound', () => {
    for (const value of ['hair_salon', 'esthetic_salon', 'massage', 'chiropractic', 'other']) {
      expect(isClassBoundBusinessType(value)).toBe(false)
    }
  })

  it('unknown / absent reads as not class-bound — never a silent withdrawal', () => {
    expect(isClassBoundBusinessType(null)).toBe(false)
    expect(isClassBoundBusinessType(undefined)).toBe(false)
    expect(isClassBoundBusinessType('')).toBe(false)
    expect(isClassBoundBusinessType('yoga')).toBe(false) // the near-miss spelling
  })
})

describe('coreBusinessType — tolerant read of a core row', () => {
  it('returns the string when core carries one', () => {
    expect(coreBusinessType({ business_type: 'yoga_studio' })).toBe('yoga_studio')
  })

  it('absent, empty or non-string reads as null (the column may not exist yet)', () => {
    expect(coreBusinessType({})).toBeNull()
    expect(coreBusinessType({ business_type: '' })).toBeNull()
    expect(coreBusinessType({ business_type: 7 })).toBeNull()
    expect(coreBusinessType({ business_type: null })).toBeNull()
  })
})
