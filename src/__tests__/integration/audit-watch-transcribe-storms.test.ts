/**
 * 監査ログ round 2, PR C — find-transcribe-storms (packet subject 2/8).
 */
import type { AuditEvent } from '@synqed-kk/client'
import { findTranscribeStorms } from '@/lib/audit-watch/find-transcribe-storms'

const event = (over: Partial<AuditEvent> & { id: string; at: string }): AuditEvent => ({
  business_id: 'biz-1',
  store_id: null,
  actor_id: null,
  actor_staff_ref: null,
  request_id: null,
  actor_type: 'system',
  actor_role: null,
  actor_label: null,
  category: 'recording',
  action: 'recording.transcribe',
  target_type: 'recording',
  target_id: 'sess-1',
  target_label: null,
  detail: { cost_cents: 10, cents_reserved: 12, customer_id: 'cust-1', staff_id: 'staff-1' },
  break_glass: false,
  severity: 'info',
  ...over,
})

const atOn = (day: string, hhmm: string) => `${day}T${hhmm}:00.000Z`

describe('findTranscribeStorms', () => {
  it('exactly 3 receipts in one day → nothing (threshold is > 3, not >=)', () => {
    const events = [1, 2, 3].map((n) => event({ id: `e${n}`, at: atOn('2026-09-05', `0${n}:00`) }))
    expect(findTranscribeStorms({ events, truncated: false })).toHaveLength(0)
  })

  it('4 receipts in one day → one storm row, summed by MAX(cost_cents, cents_reserved)', () => {
    const events = [1, 2, 3, 4].map((n) =>
      event({
        id: `e${n}`,
        at: atOn('2026-09-05', `0${n}:00`),
        detail: { cost_cents: n, cents_reserved: n + 100, customer_id: 'cust-1', staff_id: 'staff-1' },
      }),
    )
    const storms = findTranscribeStorms({ events, truncated: false })
    expect(storms).toHaveLength(1)
    expect(storms[0]).toMatchObject({
      targetId: 'sess-1',
      day: '2026-09-05',
      count: 4,
      // MAX per row is always cents_reserved here (101+102+103+104)
      costCentsEstimate: 101 + 102 + 103 + 104,
      truncated: false,
      customerId: 'cust-1',
      staffId: 'staff-1',
    })
    expect(storms[0].ids).toEqual(['e1', 'e2', 'e3', 'e4'])
  })

  it('respects the JST day boundary — 23:59 JST and 00:01 JST are different days even close in UTC', () => {
    // 2026-09-05T14:59Z = 2026-09-05 23:59 JST; 2026-09-05T15:01Z = 2026-09-06 00:01 JST.
    const events = [
      ...['14:56', '14:57', '14:58', '14:59'].map((t, i) =>
        event({ id: `late-${i}`, at: `2026-09-05T${t}:00.000Z` }),
      ),
      event({ id: 'next-day', at: '2026-09-05T15:01:00.000Z' }),
    ]
    const storms = findTranscribeStorms({ events, truncated: false })
    expect(storms).toHaveLength(1)
    expect(storms[0].day).toBe('2026-09-05')
    expect(storms[0].count).toBe(4)
  })

  it('carries the truncated flag through to every storm found in a partial read', () => {
    const events = [1, 2, 3, 4].map((n) => event({ id: `e${n}`, at: atOn('2026-09-05', `0${n}:00`) }))
    expect(findTranscribeStorms({ events, truncated: true })[0].truncated).toBe(true)
  })

  it('ignores non-transcribe recording actions and events with no target_id', () => {
    const events = [
      event({ id: 'a', at: atOn('2026-09-05', '01:00'), action: 'recording.transcribe_refused' }),
      event({ id: 'b', at: atOn('2026-09-05', '02:00'), target_id: null }),
    ]
    expect(findTranscribeStorms({ events, truncated: false })).toHaveLength(0)
  })

  // Fix round 2 (PACKET-PR-C1-FIX-ROUND2-GREPTILE-2026-09-11.md fix (b)): the
  // web transcription receipt carries no customer_id — attributing off the
  // FIRST receipt only left customerId/staffId null even when a later receipt
  // in the same storm carried both.
  it('attributes customerId/staffId off the first receipt that actually carries them, not the group\'s first receipt (old code: null)', () => {
    const events = [1, 2, 3, 4].map((n) =>
      event({
        id: `e${n}`,
        at: atOn('2026-09-05', `0${n}:00`),
        detail:
          n === 1
            ? { cost_cents: 1, cents_reserved: 1 } // no customer_id/staff_id at all
            : n === 2
              ? { cost_cents: 2, cents_reserved: 2, customer_id: 'cust-1', staff_id: 'staff-1' }
              : { cost_cents: n, cents_reserved: n, customer_id: 'cust-1', staff_id: 'staff-1' },
      }),
    )
    const storms = findTranscribeStorms({ events, truncated: false })
    expect(storms).toHaveLength(1)
    expect(storms[0].customerId).toBe('cust-1')
    expect(storms[0].staffId).toBe('staff-1')
  })
})
