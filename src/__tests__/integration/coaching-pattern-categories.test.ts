/**
 * Unit coverage for the pattern-library taxonomy constant
 * (PR 26, replay/26). PATTERN_CATEGORIES is the production render
 * order and the canonical set of category slots — assert its
 * length, exact order, and uniqueness so a stray edit (dropped
 * slot, dupe, reorder) is caught.
 */
import {
  PATTERN_CATEGORIES,
  type PatternCategory,
} from '@/components/coaching/redesign/pattern-categories'

describe('PATTERN_CATEGORIES', () => {
  it('contains exactly the five production category slots', () => {
    expect(PATTERN_CATEGORIES).toHaveLength(5)
  })

  it('preserves the documented render order', () => {
    expect([...PATTERN_CATEGORIES]).toEqual([
      'counseling_questions',
      'conversation_flow',
      'closing',
      'rebooking',
      'objection_handling',
    ])
  })

  it('has no duplicate slots', () => {
    expect(new Set(PATTERN_CATEGORIES).size).toBe(PATTERN_CATEGORIES.length)
  })

  it('every entry is assignable to the PatternCategory union', () => {
    // Compile-time guarantee made explicit at runtime: the const is
    // typed readonly PatternCategory[], so this just documents intent.
    const all: PatternCategory[] = [...PATTERN_CATEGORIES]
    expect(all).toContain('closing')
  })
})
