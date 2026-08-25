/**
 * SessionsScreenDTO / SessionsScreenWindowedDTO round-trips (PR-2a
 * 日付チャンク読み込み). Pins the two properties the release-17 fleet depends
 * on:
 *   1. The BASE schema's output shape is unchanged — parsing a legacy payload
 *      injects NO window keys (zod applies `.default()` at parse time, so a
 *      merged schema would have leaked them into every legacy body).
 *   2. The windowed schema is strictly ADDITIVE: base keys first, in the same
 *      order, then hasMore + windowStart.
 * Plus the enum-tolerance rider: an unknown palette key / status degrades to
 * the neutral member instead of failing the whole screen parse — a release-17
 * bundle meeting a value added later must still render a list.
 */
import {
  SessionsScreenDTO,
  SessionsScreenWindowedDTO,
} from '@/lib/app-api/sessions-screen-dto'

const item = () => ({
  id: 'rec-1',
  customerId: 'cust-1',
  customerName: '山田 花子',
  customerInitials: '山田',
  customerKaruteNumber: '#00001',
  date: '2026-08-20',
  weekday: '木',
  service: '—',
  duration: 0,
  staffId: 'staff-2',
  staffColorKey: 'violet',
  staffName: '田中 太郎',
  summary: 'まとめ',
  aiStatus: 'summarized',
  conversionStatus: 'active',
  href: '/karute/rec-1',
})

const screen = () => ({
  items: [item()],
  placeholders: [],
  monthCount: 1,
  total: 1,
  staffList: [{ id: 'staff-2', name: '田中 太郎', initials: '田中', isManagement: false }],
  currentStaffId: 'staff-2',
  customerOptions: [{ id: 'cust-1', name: '山田 花子', phone: null, furigana: null }],
})

describe('SessionsScreenDTO — the legacy shape stays exactly the legacy shape', () => {
  it('round-trips without gaining window keys', () => {
    const parsed = SessionsScreenDTO.parse(screen())
    expect(Object.keys(parsed)).toEqual([
      'items',
      'placeholders',
      'monthCount',
      'total',
      'staffList',
      'currentStaffId',
      'customerOptions',
    ])
    expect(JSON.stringify(parsed)).not.toContain('hasMore')
    expect(JSON.stringify(parsed)).not.toContain('windowStart')
    // Re-parsing its own output is a fixed point.
    expect(SessionsScreenDTO.parse(parsed)).toEqual(parsed)
  })

  it('placeholders stays REQUIRED — a payload missing it fails loudly', () => {
    const withoutPlaceholders: Record<string, unknown> = { ...screen() }
    delete withoutPlaceholders.placeholders
    expect(() => SessionsScreenDTO.parse(withoutPlaceholders)).toThrow()
  })

  it('strips unknown keys rather than failing (old-bundle tolerance)', () => {
    const parsed = SessionsScreenDTO.parse({ ...screen(), somethingNewLater: 42 })
    expect(parsed).not.toHaveProperty('somethingNewLater')
  })
})

describe('SessionsScreenWindowedDTO — additive only', () => {
  it('adds hasMore + windowStart AFTER every base key, in order', () => {
    const parsed = SessionsScreenWindowedDTO.parse({
      ...screen(),
      hasMore: true,
      windowStart: '2026-08-12',
    })
    expect(Object.keys(parsed)).toEqual([
      'items',
      'placeholders',
      'monthCount',
      'total',
      'staffList',
      'currentStaffId',
      'customerOptions',
      'hasMore',
      'windowStart',
    ])
    expect(SessionsScreenWindowedDTO.parse(parsed)).toEqual(parsed)
  })

  it('a payload predating the window fields still parses with safe defaults', () => {
    const parsed = SessionsScreenWindowedDTO.parse(screen())
    expect(parsed.hasMore).toBe(false)
    expect(parsed.windowStart).toBeNull()
  })
})

describe('enum-tolerance rider — one unknown value never blanks the whole tab', () => {
  it('an unknown staffColorKey degrades to the neutral null, not a parse failure', () => {
    const parsed = SessionsScreenDTO.parse({
      ...screen(),
      items: [{ ...item(), staffColorKey: 'chartreuse-added-in-2027' }],
    })
    expect(parsed.items[0].staffColorKey).toBeNull()
  })

  it('an unknown aiStatus / conversionStatus degrade to the "unset" members', () => {
    const parsed = SessionsScreenDTO.parse({
      ...screen(),
      items: [{ ...item(), aiStatus: 'transcribing', conversionStatus: 'archived' }],
    })
    expect(parsed.items[0].aiStatus).toBe('draft')
    expect(parsed.items[0].conversionStatus).toBe('provisional')
  })

  it('a KNOWN value is never rewritten by the tolerance', () => {
    const parsed = SessionsScreenDTO.parse(screen())
    expect(parsed.items[0].staffColorKey).toBe('violet')
    expect(parsed.items[0].aiStatus).toBe('summarized')
    expect(parsed.items[0].conversionStatus).toBe('active')
  })
})
