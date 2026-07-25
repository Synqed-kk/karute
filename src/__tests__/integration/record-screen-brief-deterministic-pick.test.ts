/**
 * Fleet S4 (wave1-recut PR-3): core reads entries by sort_order asc, and a
 * regen APPENDS its fresh AI batch after human rows — mixed-authorship order
 * needs pinning for the leading-slice picks (hooks/concerns/lastProduct/
 * recommendedFocus). The rule: HUMAN rows rank before AI rows — the human
 * layer is the authoritative record (EDIT-LAYER-DESIGN §1/§3: corrections
 * pin on top; a staff edit/hand-add at review wins the next session's pick).
 * WITHIN each rank core order is preserved (stable sort, no recency key) —
 * for the AI batch that is the extractor's importance-first ordering, which
 * the safety-first leading slices rely on.
 */
import { buildPreSessionBriefFor } from '@/lib/karute/record-screen'
import type { KaruteRecord, KaruteEntry } from '@synqed-kk/client'

function karuteEntry(overrides: Partial<KaruteEntry> = {}): KaruteEntry {
  return {
    id: 'e1',
    karute_record_id: 'r1',
    category: 'SYMPTOM',
    content: 'x',
    original_quote: null,
    confidence: 1,
    tags: [],
    sort_order: 0,
    is_manual: false,
    author: 'AI',
    original_ai_content: null,
    version: 1,
    deleted_at: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  }
}

function karuteRecord(entries: KaruteEntry[]): KaruteRecord {
  return {
    id: 'r1',
    business_id: 'biz-1',
    customer_id: 'cust-1',
    store_id: null,
    staff_id: 'staff-1',
    appointment_id: null,
    recording_session_id: null,
    status: 'APPROVED',
    ai_summary: 'AI summary first line',
    edited_summary: null,
    transcript: null,
    service: null,
    duration_minutes: null,
    session_date: null,
    created_at: '2026-07-10T00:00:00Z',
    updated_at: '2026-07-10T00:00:00Z',
    entries,
  }
}

const NOW = new Date('2026-07-11T00:00:00Z')

describe('buildPreSessionBriefFor — fleet S4 deterministic pick', () => {
  const productHuman = karuteEntry({
    id: 'p-human',
    category: 'PRODUCT',
    content: 'Human pick',
    author: 'HUMAN_CREATED',
    created_at: '2026-07-09T00:00:00Z', // newest overall
  })
  const productAiOld = karuteEntry({
    id: 'p-ai-old',
    category: 'PRODUCT',
    content: 'AI old pick',
    author: 'AI',
    created_at: '2026-07-01T00:00:00Z',
  })
  const productAiNew = karuteEntry({
    id: 'p-ai-new',
    category: 'PRODUCT',
    content: 'AI new pick',
    author: 'AI',
    created_at: '2026-07-05T00:00:00Z', // newest AI row
  })

  it('a staff-authored row wins the pick over AI siblings (human layer pins on top)', () => {
    // A staff edit/hand-add made at review is the authoritative record — it
    // must win the next session's pick over any AI row, wherever core order
    // places it.
    const rec = karuteRecord([productAiOld, productHuman, productAiNew])
    const brief = buildPreSessionBriefFor([rec], null, NOW, 'en', true)
    expect(brief?.lastProduct?.name).toBe('Human pick')
  })

  it('falls back to the first human row in core order when no AI row exists in the category', () => {
    // No recency heuristic: core order (append order) is the deterministic
    // contract for the human-only fallback.
    const olderHuman = karuteEntry({
      id: 'h-old',
      category: 'PRODUCT',
      content: 'Older human',
      author: 'HUMAN_CREATED',
      created_at: '2026-07-01T00:00:00Z',
    })
    const newerHuman = karuteEntry({
      id: 'h-new',
      category: 'PRODUCT',
      content: 'Newer human',
      author: 'HUMAN_EDITED',
      created_at: '2026-07-08T00:00:00Z',
    })
    const rec = karuteRecord([olderHuman, newerHuman])
    const brief = buildPreSessionBriefFor([rec], null, NOW, 'en', true)
    expect(brief?.lastProduct?.name).toBe('Older human')
  })

  it('the staff row wins wherever it sits in core order (deterministic across layouts)', () => {
    const orderings = [
      [productHuman, productAiOld, productAiNew],
      [productAiNew, productHuman, productAiOld],
      [productAiOld, productAiNew, productHuman],
    ]
    for (const entries of orderings) {
      const pick = buildPreSessionBriefFor([karuteRecord(entries)], null, NOW, 'en', true)
        ?.lastProduct?.name
      expect(pick).toBe('Human pick')
    }
  })

  it('recommendedFocus (NEXT_VISIT) takes the staff row over an AI sibling — the loop-closing pick', () => {
    const nextAi = karuteEntry({
      id: 'nv-ai',
      category: 'NEXT_VISIT',
      content: 'AI next-visit plan',
      author: 'AI',
    })
    const nextHuman = karuteEntry({
      id: 'nv-human',
      category: 'NEXT_VISIT',
      content: 'Staff next-visit correction',
      author: 'HUMAN_EDITED',
    })
    const rec = karuteRecord([nextAi, nextHuman])
    const brief = buildPreSessionBriefFor([rec], null, NOW, 'en', true)
    expect(brief?.recommendedFocus).toBe('Staff next-visit correction')
  })

  it('concerns keeps its SYMPTOM-before-TREATMENT category ordering, with the same authorship rank within a category', () => {
    const symptomHumanNewest = karuteEntry({
      id: 'sym-human',
      category: 'SYMPTOM',
      content: 'Human symptom (newest overall)',
      author: 'HUMAN_CREATED',
      created_at: '2026-07-09T00:00:00Z',
    })
    const symptomAi = karuteEntry({
      id: 'sym-ai',
      category: 'SYMPTOM',
      content: 'AI symptom',
      author: 'AI',
      created_at: '2026-07-02T00:00:00Z',
    })
    const treatmentAi = karuteEntry({
      id: 'treat-ai',
      category: 'TREATMENT',
      content: 'AI treatment',
      author: 'AI',
      created_at: '2026-07-03T00:00:00Z',
    })
    const rec = karuteRecord([treatmentAi, symptomHumanNewest, symptomAi])
    const brief = buildPreSessionBriefFor([rec], null, NOW, 'en', true)
    expect(brief?.concerns).toEqual([
      'Human symptom (newest overall)',
      'AI symptom',
      'AI treatment',
    ])
  })
})
