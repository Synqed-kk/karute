/**
 * The reservation-id match ladder — the heart of the durable QR sync. These pin
 * the behaviors that make a MOVE/REBOOK safe (the 崎本/中川 cross-customer leak):
 * a moved reservation patches its OWN row, never the slot's current occupant;
 * a duplicate QR id (a move that left an orphan) resolves to the live row.
 */
import type { Appointment } from '@synqed-kk/client'
import {
  buildQrExistingIndexes,
  matchQrReservation,
  dropMatched,
  staffTimeKey,
} from '@/lib/sync/qr-index'

// Minimal Appointment factory — only the fields the index reads.
function appt(p: { id: string; staff_id: string; starts_at: string; notes?: string | null }): Appointment {
  return {
    id: p.id,
    business_id: 'biz',
    customer_id: 'cust',
    staff_id: p.staff_id,
    starts_at: p.starts_at,
    ends_at: p.starts_at,
    duration_minutes: 60,
    title: 'VIP施術',
    notes: p.notes ?? null,
    status: 'SCHEDULED',
    source: 'QUICKRESERVE',
    external_refs: {},
    cancelled_at: null,
    created_at: p.starts_at,
    updated_at: p.starts_at,
  } as Appointment
}

const STAFF_A = 'staff-harada'
const STAFF_B = 'staff-other'

describe('match ladder', () => {
  it('MOVE: a reservation matched by QR id re-keys its OWN row regardless of new day/slot', () => {
    // 崎本's #327563 was at 6/10; QR now shows it at 6/17 12:00.
    const existing = [appt({ id: 'sakimoto-row', staff_id: STAFF_A, starts_at: '2026-06-10T05:00:00Z', notes: 'QR #327563 | 崎本' })]
    const ix = buildQrExistingIndexes(existing)
    const match = matchQrReservation(ix, '327563', STAFF_A, '2026-06-17T03:00:00Z')
    expect(match?.id).toBe('sakimoto-row')
  })

  it('NO HIJACK: #327563 moving onto 中川’s 12:00 slot matches 崎本’s row, not 中川’s', () => {
    const existing = [
      appt({ id: 'sakimoto-row', staff_id: STAFF_A, starts_at: '2026-06-10T05:00:00Z', notes: 'QR #327563 | 崎本' }),
      appt({ id: 'nakagawa-row', staff_id: STAFF_A, starts_at: '2026-06-17T03:00:00Z', notes: 'QR #999 | 中川' }),
    ]
    const ix = buildQrExistingIndexes(existing)
    // #327563 now sits at exactly 中川's (staff, time). qrId keying must still pick 崎本's row.
    const match = matchQrReservation(ix, '327563', STAFF_A, '2026-06-17T03:00:00Z')
    expect(match?.id).toBe('sakimoto-row')
    expect(match?.id).not.toBe('nakagawa-row')
  })

  it('DUPLICATE QR id (orphan from an earlier move): later starts_at wins', () => {
    const existing = [
      appt({ id: 'orphan-610', staff_id: STAFF_A, starts_at: '2026-06-10T05:00:00Z', notes: 'QR #327563 | 崎本' }),
      appt({ id: 'live-617', staff_id: STAFF_A, starts_at: '2026-06-17T03:00:00Z', notes: 'QR #327563 | 崎本' }),
    ]
    const ix = buildQrExistingIndexes(existing)
    expect(ix.byQrId.get('327563')?.id).toBe('live-617')
  })

  it('FALLBACK: a never-synced reservation matches a non-QR row at the same (staff, time)', () => {
    const existing = [appt({ id: 'walkin', staff_id: STAFF_B, starts_at: '2026-06-18T01:00:00Z', notes: 'walk-in memo' })]
    const ix = buildQrExistingIndexes(existing)
    const match = matchQrReservation(ix, '555', STAFF_B, '2026-06-18T01:00:00Z')
    expect(match?.id).toBe('walkin')
  })

  it('CREATE: no qr-id and no (staff,time) match returns null', () => {
    const ix = buildQrExistingIndexes([])
    expect(matchQrReservation(ix, '777', STAFF_A, '2026-06-19T02:00:00Z')).toBeNull()
  })

  it('a manual row (no QR prefix) is never in the qr-id index', () => {
    const ix = buildQrExistingIndexes([appt({ id: 'manual', staff_id: STAFF_A, starts_at: '2026-06-17T03:00:00Z', notes: 'just a note' })])
    expect(ix.byQrId.size).toBe(0)
    expect(ix.byStaffTime.size).toBe(1)
  })
})

describe('dropMatched', () => {
  it('removes the row from both indexes so it cannot match twice', () => {
    const row = appt({ id: 'r', staff_id: STAFF_A, starts_at: '2026-06-17T03:00:00Z', notes: 'QR #42 | x' })
    const ix = buildQrExistingIndexes([row])
    dropMatched(ix, '42', row)
    expect(ix.byQrId.has('42')).toBe(false)
    expect(ix.byStaffTime.has(staffTimeKey(STAFF_A, '2026-06-17T03:00:00Z'))).toBe(false)
  })
})
