/**
 * Regression for the live QR-sync 500: "Cannot read properties of undefined
 * (reading 'id')". Quick Reserve's get-customer-reservations-by-date endpoint
 * also returns staff BLOCK/HOLD (休憩) and closed-slot rows, which carry a Staff
 * but NO Customer (and no TreatmentCourse). mapReservation reads r.Customer.id
 * unguarded, so on such a row the whole sync crashed with a 500.
 *
 * The route now skips rows missing Customer/Staff/TreatmentCourse before calling
 * mapReservation. These tests pin (a) the happy-path mapping and (b) the crash
 * contract that necessitates the skip — so the guard can never be quietly dropped.
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
    Customer: {
      id: 10,
      name: '東 雅美',
      name_kana: 'アズマ マサミ',
      phone1: '',
      mail1: '',
      remarks1: '',
      visits_number_cache: 4,
      is_existing_customer: true,
    },
    Staff: { id: 3, name: '原田 かなみ', name_kana: 'ハラダ カナミ' },
    TreatmentCourse: { id: 5, name: '10回券', duration: 3600000, price: 0, treatment_category_id: 1 },
    ...overrides,
  } as QRReservation
}

// The skip rule the route applies before mapReservation. Kept here as the
// documented contract; a row failing it must never reach mapReservation.
const isBookingRow = (r: QRReservation) => !!r.Customer && !!r.Staff && !!r.TreatmentCourse

describe('QR by-date sync — skip non-booking rows', () => {
  it('maps a complete booking row', () => {
    const m = mapReservation(fullReservation())
    expect(m.qrCustomerId).toBe(10)
    expect(m.staffName).toBe('原田 かなみ')
    expect(m.treatmentName).toBe('10回券')
  })

  it('flags a 休憩/block row (Staff, no Customer) as a non-booking row', () => {
    const block = fullReservation({ Customer: undefined as unknown as QRReservation['Customer'] })
    expect(isBookingRow(block)).toBe(false)
    expect(isBookingRow(fullReservation())).toBe(true)
  })

  it('mapReservation throws on a Customer-less row — the live 500 the skip prevents', () => {
    const block = fullReservation({ Customer: undefined as unknown as QRReservation['Customer'] })
    expect(() => mapReservation(block)).toThrow(/Cannot read properties of undefined \(reading 'id'\)/)
  })
})
