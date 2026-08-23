// PACKET-DATE-JA-2026-08-23: karuteToHeader's sessionDateLong flips to
// Japanese (with weekday) in the ja locale; en stays byte-identical. Both
// branches pin Asia/Tokyo (A-4) — the JST-boundary fixture below proves a
// created_at-fallback row in the 15:00-24:00 UTC window now reports its JST
// day, asymmetric from a naive UTC read.
import { karuteToHeader } from '@/lib/adapters/karute-detail'
import type { KaruteWithRelations } from '@/lib/supabase/karute'

const baseKarute: KaruteWithRelations = {
  id: 'kar-1',
  created_at: '2026-08-22T10:00:00.000Z', // JST 2026-08-22 19:00 (Sat)
  session_date: null,
  summary: null,
  transcript: null,
  customer_id: 'cust-1',
  client_id: 'cust-1',
  staff_profile_id: 'staff-1',
  recording_session_id: null,
  profiles: null,
  customers: null,
  entries: [],
}

// created_at is UTC 22nd 16:30 -> JST 23rd 01:30: a naive UTC read says the
// 22nd, the JST-pinned formatter says the 23rd.
const boundaryKarute: KaruteWithRelations = {
  ...baseKarute,
  created_at: '2026-08-22T16:30:00.000Z',
}

describe('karuteToHeader — sessionDateLong locale + JST pin', () => {
  it('ja: year/month/day/weekday, no space before the paren', () => {
    expect(karuteToHeader(baseKarute, 'ja').sessionDateLong).toBe('2026年8月22日(土)')
  })

  it('ja JST-boundary: reports the JST day, not the UTC day', () => {
    expect(karuteToHeader(boundaryKarute, 'ja').sessionDateLong).toBe('2026年8月23日(日)')
  })

  it('en: unchanged shape, byte-pinned', () => {
    expect(karuteToHeader(baseKarute, 'en').sessionDateLong).toBe('August 22, 2026')
  })

  it('en JST-boundary: also reports the JST day (tz pin applies to both branches)', () => {
    expect(karuteToHeader(boundaryKarute, 'en').sessionDateLong).toBe('August 23, 2026')
  })
})
