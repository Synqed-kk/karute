/**
 * Regression for the QR-sync skip contract. Quick Reserve's
 * get-customer-reservations-by-date endpoint also returns staff BLOCK/HOLD (休憩)
 * and closed-slot rows, which carry a `staff` but NO resolved customer (and no
 * `treatment_course`).
 *
 * Post-2026-06 QR changed the payload shape: the old PascalCase
 * Customer/Staff/TreatmentCourse objects are gone, replaced by lowercase
 * `staff` / `treatment_course` and `resolvedCustomerId` / `resolvedCustomerName`.
 * The route skips rows missing staff/treatment_course/resolvedCustomerId before
 * calling mapReservation. These tests pin (a) the happy-path mapping, (b) the
 * skip contract, and (c) that mapReservation is now null-safe — so even if the
 * guard is ever dropped, a non-booking row can no longer crash the whole sync.
 */
import { mapReservation, type QRReservation } from '@/lib/quickreserve'

function fullReservation(overrides: Partial<QRReservation> = {}): QRReservation {
  return {
    id: 1,
    store_id: 222,
    customer_id: 10,
    treatment_course_id: 5,
    staff_id: 3,
    booth_id: 1,
    start_at: 1781881200000,
    end_at: 1781884800000,
    request: '',
    deleted: false,
    rid: 'rid-1',
    is_new_customer_flag: false,
    nominated_staff_id: null,
    resolvedCustomerId: 10,
    resolvedCustomerName: '東 雅美',
    staff: { id: 3, name: '原田 かなみ', name_kana: 'ハラダ カナミ' },
    treatment_course: { id: 5, name: '10回券', duration: 3600000, price: 0 },
    bill: null,
    ...overrides,
  }
}

// The skip rule the route applies before mapReservation (post-2026-06 QR shape).
// Kept here as the documented contract; a row failing it must never be synced.
const isBookingRow = (r: QRReservation) =>
  r.resolvedCustomerId != null && !!r.staff && !!r.treatment_course

describe('QR by-date sync — skip non-booking rows', () => {
  it('maps a complete booking row', () => {
    const m = mapReservation(fullReservation())
    expect(m.qrCustomerId).toBe(10)
    expect(m.customerName).toBe('東 雅美')
    expect(m.staffName).toBe('原田 かなみ')
    expect(m.treatmentName).toBe('10回券')
  })

  it('flags a 休憩/block row (staff, no customer/course) as a non-booking row', () => {
    const block = fullReservation({ resolvedCustomerId: null, treatment_course: null })
    expect(isBookingRow(block)).toBe(false)
    expect(isBookingRow(fullReservation())).toBe(true)
  })

  it('mapReservation is null-safe on an incomplete row — no crash even if the guard is bypassed', () => {
    const block = fullReservation({ staff: null, treatment_course: null, resolvedCustomerId: null })
    expect(() => mapReservation(block)).not.toThrow()
    const m = mapReservation(block)
    // Falls back to the always-present scalar ids; no nested-object crash.
    expect(m.qrCustomerId).toBe(10) // resolvedCustomerId null → customer_id
    expect(m.staffName).toBe('')
    expect(m.treatmentName).toBe('')
  })
})
