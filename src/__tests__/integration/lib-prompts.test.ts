/**
 * Coverage for the extraction-prompt category change in PR #81: categories
 * switched from TitleCase labels (Preference, Treatment, …) to a fixed
 * lowercase snake_case enum the model must emit verbatim.
 */
import { getExtractionSystemPrompt } from '@/lib/prompts'

const SNAKE_CATEGORIES = [
  'symptom',
  'treatment',
  'body_area',
  'preference',
  'lifestyle',
  'next_visit',
  'product',
  'other',
]

describe('getExtractionSystemPrompt', () => {
  for (const locale of ['en', 'ja']) {
    describe(`locale=${locale}`, () => {
      const prompt = getExtractionSystemPrompt(locale)

      it('lists every snake_case category value', () => {
        for (const cat of SNAKE_CATEGORIES) {
          expect(prompt).toContain(cat)
        }
      })

      it('no longer offers the removed TitleCase category enum', () => {
        // "Allergy" and "Style" were dropped entirely in the new enum.
        expect(prompt).not.toContain('Allergy')
        expect(prompt).not.toContain('Style')
      })

      it('instructs against translating / capitalizing the category', () => {
        expect(prompt.toLowerCase()).toContain('body_area')
        expect(prompt).toContain('next_visit')
      })
    })
  }

  it('returns locale-specific copy (ja differs from en)', () => {
    expect(getExtractionSystemPrompt('ja')).not.toBe(getExtractionSystemPrompt('en'))
  })

  it('falls back to the English prompt for unknown locales', () => {
    expect(getExtractionSystemPrompt('fr')).toBe(getExtractionSystemPrompt('en'))
  })
})
