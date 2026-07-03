/**
 * Passport merge contract (2026-07-03): staff overrides win over AI values,
 * passport rows never leak into the category sections, honest dashes for
 * unanswered fields.
 */
import { buildCustomerMemory } from '@/lib/karute/memory-adapter'
import type { MemoryItem } from '@/lib/karute/memory-types'

const item = (over: Partial<MemoryItem>): MemoryItem => ({
  id: 'x',
  category: 'personal',
  label: 'l',
  detail: null,
  source: 'ai_extraction',
  confidence: 0.9,
  pinned: false,
  suggestTalkingPoint: false,
  updatedAt: '2026-07-03T00:00:00Z',
  ...over,
})

const DEFS = [
  { key: 'occupation', label: '職業' },
  { key: 'referral_source', label: '来店きっかけ' },
]

describe('buildCustomerMemory passport merge', () => {
  it('staff override wins over the AI value and reads as locked', () => {
    const memory = buildCustomerMemory(
      [
        item({ id: 'p1', category: 'passport' as MemoryItem['category'], label: 'occupation', detail: '経営者（本人申告）', source: 'staff', pinned: true }),
        item({ id: 'i1', label: '愛犬パグ' }),
      ],
      'c1',
      {
        fieldDefs: DEFS,
        ai: { fields: [{ key: 'occupation', value: 'ITエンジニア', quote: '仕事はIT系で' }] },
        firstVisitAt: '2026-05-24',
      },
    )
    const occ = memory.intake?.fields?.find((f) => f.key === 'occupation')
    expect(occ?.value).toBe('経営者（本人申告）')
    expect(occ?.source).toBe('staff')
    expect(occ?.quote).toBeNull()
  })

  it('AI value carries its quote; unanswered fields stay null (dash)', () => {
    const memory = buildCustomerMemory([], 'c1', {
      fieldDefs: DEFS,
      ai: { fields: [{ key: 'occupation', value: 'ITエンジニア', quote: '仕事はIT系で' }] },
      firstVisitAt: null,
    })
    const occ = memory.intake?.fields?.find((f) => f.key === 'occupation')
    expect(occ?.value).toBe('ITエンジニア')
    expect(occ?.quote).toBe('仕事はIT系で')
    expect(memory.intake?.fields?.find((f) => f.key === 'referral_source')?.value).toBeNull()
  })

  it('passport rows never leak into the category sections or the count', () => {
    const memory = buildCustomerMemory(
      [
        item({ id: 'p1', category: 'passport' as MemoryItem['category'], label: 'occupation', detail: 'x', source: 'staff' }),
        item({ id: 'i1', label: '愛犬パグ' }),
      ],
      'c1',
      { fieldDefs: DEFS, ai: null, firstVisitAt: null },
    )
    expect(memory.items).toHaveLength(1)
    expect(memory.items[0].label).toBe('愛犬パグ')
  })

  it('no passport param → legacy shape (intake null)', () => {
    const memory = buildCustomerMemory([item({ id: 'i1' })], 'c1')
    expect(memory.intake).toBeNull()
    expect(memory.items).toHaveLength(1)
  })
})
