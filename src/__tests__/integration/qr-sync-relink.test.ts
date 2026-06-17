/**
 * Regression for the QR-sync cross-customer leak (崎本/中川). The sync dedups
 * appointments by (staff_id, start_time); when a slot is rebooked by a DIFFERENT
 * customer the existing row is UPDATED in place. The bug: the update omitted
 * customer_id, so the row kept the previous customer while taking the new one's
 * title + reservation memo — a different person's private booking memo + AI
 * brief rendered under the wrong name.
 *
 * The route now routes BOTH the update and the create through qrAppointmentWrite,
 * whose hard invariant is that customer_id is present in BOTH payloads. This test
 * pins that invariant so the leak can never regress.
 */
import { qrAppointmentWrite } from '@/lib/sync/qr-appointment'

const mapped = {
  startTime: '2026-06-17T03:00:00.000Z',
  endTime: '2026-06-17T04:00:00.000Z',
  durationMinutes: 60,
  treatmentName: 'VIP施術',
}

describe('qrAppointmentWrite — rebooked-slot customer relink', () => {
  it('re-links customer_id on UPDATE (the live bug: 中川 slot rebooked by 崎本)', () => {
    // The 12:00 slot used to be 中川's; QR now shows it as 崎本's. The UPDATE
    // payload MUST carry 崎本 — not silently keep 中川.
    const { update } = qrAppointmentWrite('cust-sakimoto', 'staff-harada', mapped, 'QR #327563 | 崎本 memo')
    expect(update.customer_id).toBe('cust-sakimoto')
  })

  it('sets customer_id + slot fields on CREATE', () => {
    const { create } = qrAppointmentWrite('cust-sakimoto', 'staff-harada', mapped, 'QR #327563 | …')
    expect(create.customer_id).toBe('cust-sakimoto')
    expect(create.staff_id).toBe('staff-harada')
    expect(create.starts_at).toBe(mapped.startTime)
    expect(create.ends_at).toBe(mapped.endTime)
  })

  it('tags a CREATEd row source=QUICKRESERVE (sync-owned)', () => {
    const { create } = qrAppointmentWrite('c1', 's1', mapped, 'QR #1 | x')
    expect(create.source).toBe('QUICKRESERVE')
  })

  it('UPDATE relocates the row (staff + start/end) so a MOVED booking follows itself', () => {
    // A reservation matched by QR id that moved must patch its OWN row's slot —
    // not stay at the old time. Update now carries staff_id + starts_at/ends_at.
    const { update } = qrAppointmentWrite('cust-sakimoto', 'staff-harada', mapped, 'QR #327563 | …')
    expect(update.staff_id).toBe('staff-harada')
    expect(update.starts_at).toBe(mapped.startTime)
    expect(update.ends_at).toBe(mapped.endTime)
  })

  it('title + notes follow the NEW reservation, never a stale fusion', () => {
    const { update, create } = qrAppointmentWrite('cust-sakimoto', 'staff-harada', mapped, 'QR #327563 | 崎本 memo')
    expect(update.title).toBe('VIP施術')
    expect(update.notes).toContain('327563')
    expect(create.title).toBe('VIP施術')
  })

  it('INVARIANT: customer_id is present in BOTH payloads, always', () => {
    const { update, create } = qrAppointmentWrite('c1', 's1', mapped, 'n')
    expect(update.customer_id).toBe('c1')
    expect(create.customer_id).toBe('c1')
  })
})
