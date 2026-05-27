/**
 * Unit coverage for the customer-identity display helpers added in PR #81
 * (replay/06-foundation-libs). Pure functions — no DB — but they live in the
 * jest suite alongside the integration tests.
 */
import {
  deriveFamilyInitials,
  assignSequentialKaruteNumbers,
} from '@/lib/customers/identity'

describe('deriveFamilyInitials', () => {
  it('returns "?" for empty / nullish / whitespace input', () => {
    expect(deriveFamilyInitials('')).toBe('?')
    expect(deriveFamilyInitials('   ')).toBe('?')
    expect(deriveFamilyInitials(null)).toBe('?')
    expect(deriveFamilyInitials(undefined)).toBe('?')
  })

  describe('Latin / ASCII names', () => {
    it('uses first + last initial for multi-word names', () => {
      expect(deriveFamilyInitials('Jon Chan')).toBe('JC')
    })
    it('uppercases', () => {
      expect(deriveFamilyInitials('jon chan')).toBe('JC')
    })
    it('takes first two chars of a single word', () => {
      expect(deriveFamilyInitials('Madonna')).toBe('MA')
    })
    it('handles 3+ word names (first + last)', () => {
      expect(deriveFamilyInitials('Mary Jane Watson')).toBe('MW')
    })
  })

  describe('Japanese names (family-name preference)', () => {
    it('shows a 2-char family name whole', () => {
      expect(deriveFamilyInitials('伊藤 大輝')).toBe('伊藤')
    })
    it('takes first 2 chars of a spaceless name', () => {
      expect(deriveFamilyInitials('田中健太')).toBe('田中')
    })
    it('compresses a long family name to 2 chars', () => {
      expect(deriveFamilyInitials('ぴあそん りえむ')).toBe('ぴあ')
    })
    it('returns a single-char name as-is', () => {
      expect(deriveFamilyInitials('林')).toBe('林')
    })
  })
})

describe('assignSequentialKaruteNumbers', () => {
  it('numbers customers by created_at ascending, zero-padded to 5', () => {
    const map = assignSequentialKaruteNumbers([
      { id: 'c', created_at: '2024-03-01T00:00:00Z' },
      { id: 'a', created_at: '2024-01-01T00:00:00Z' },
      { id: 'b', created_at: '2024-02-01T00:00:00Z' },
    ])
    expect(map.get('a')).toBe('#00001')
    expect(map.get('b')).toBe('#00002')
    expect(map.get('c')).toBe('#00003')
  })

  it('breaks created_at ties deterministically by id', () => {
    const map = assignSequentialKaruteNumbers([
      { id: 'z', created_at: '2024-01-01' },
      { id: 'a', created_at: '2024-01-01' },
    ])
    expect(map.get('a')).toBe('#00001')
    expect(map.get('z')).toBe('#00002')
  })

  it('treats missing created_at as earliest', () => {
    const map = assignSequentialKaruteNumbers([
      { id: 'has', created_at: '2024-01-01' },
      { id: 'none' },
    ])
    expect(map.get('none')).toBe('#00001')
    expect(map.get('has')).toBe('#00002')
  })

  it('pads beyond single digits correctly', () => {
    const customers = Array.from({ length: 12 }, (_, i) => ({
      id: `c${i}`,
      created_at: `2024-01-${String(i + 1).padStart(2, '0')}`,
    }))
    const map = assignSequentialKaruteNumbers(customers)
    expect(map.get('c0')).toBe('#00001')
    expect(map.get('c11')).toBe('#00012')
    expect(map.size).toBe(12)
  })

  it('does not mutate the input array order', () => {
    const input = [
      { id: 'b', created_at: '2024-02-01' },
      { id: 'a', created_at: '2024-01-01' },
    ]
    assignSequentialKaruteNumbers(input)
    expect(input.map((c) => c.id)).toEqual(['b', 'a'])
  })
})
