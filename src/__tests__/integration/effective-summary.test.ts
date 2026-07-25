/**
 * effectiveSummary (EDIT-LAYER-DESIGN §4, PR-3): the ONE overlay-resolution
 * rule every summary reader must use — `edited_summary ?? ai_summary`. Regen
 * only ever rewrites `ai_summary`; a staff correction must win over it
 * without the reader having to know the overlay exists.
 */
import { effectiveSummary } from '@/lib/karute/effective-summary'

describe('effectiveSummary', () => {
  it('the human overlay wins when a staff edit exists', () => {
    expect(
      effectiveSummary({ ai_summary: 'AI original text', edited_summary: 'Staff-corrected text' }),
    ).toBe('Staff-corrected text')
  })

  it('falls back to ai_summary when there is no overlay', () => {
    expect(effectiveSummary({ ai_summary: 'AI original text', edited_summary: null })).toBe(
      'AI original text',
    )
  })

  it('falls back to ai_summary when edited_summary is undefined (optional-field callers)', () => {
    expect(effectiveSummary({ ai_summary: 'AI original text' })).toBe('AI original text')
  })

  it('null when neither field has a value', () => {
    expect(effectiveSummary({ ai_summary: null, edited_summary: null })).toBeNull()
    expect(effectiveSummary({})).toBeNull()
  })
})
