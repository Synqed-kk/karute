import { mapVisit, mapDeepCustomer } from '@/lib/quickreserve'

const reservation = {
  id: 137402, start_at: 1752390000000, deleted: false, nominated_staff_id: 667, request: '',
  Bill: { BillItems: [{ item_name: '6回券', price_consumed: 10450 }] },
  Customer: { gender: 2, born_at: null, profession: '', membership_id: '', post_code: '',
    prefecture: '', address1: '', phone2: '', direct_mail: false, comment: '', remarks2: '',
    postpaid_remaining_cache: 0, has_ticket_pack: false, last_visit_at_cache: 1765267200000,
    visits_number_cache: 7, is_existing_customer: true },
  Staff: { name: '篠原 夢果' }, TreatmentCourse: { name: '6回券' },
} as unknown as Parameters<typeof mapVisit>[0] & { Customer: Parameters<typeof mapDeepCustomer>[0] }

describe('mapVisit', () => {
  it('sums BillItems and marks a billed visit settled', () => {
    const v = mapVisit(reservation)
    expect(v.qr_reservation_id).toBe(137402)
    expect(v.sales_amount).toBe(10450)
    expect(v.status).toBe('settled')
    expect(v.course_name).toBe('6回券')
    expect(v.staff_name).toBe('篠原 夢果')
  })
  it('marks a deleted reservation cancelled with zero sales', () => {
    const v = mapVisit({ ...reservation, deleted: true, Bill: null })
    expect(v.status).toBe('cancelled')
    expect(v.sales_amount).toBe(0)
  })
  it('marks an unbilled future reservation booked', () => {
    const v = mapVisit({ ...reservation, deleted: false, Bill: null })
    expect(v.status).toBe('booked')
  })
})

describe('mapDeepCustomer', () => {
  it('maps gender int 2 to female and null born_at to null DOB', () => {
    const d = mapDeepCustomer(reservation.Customer)
    expect(d.gender).toBe('female')
    expect(d.date_of_birth).toBeNull()
    expect(d.has_ticket_pack).toBe(false)
    expect(d.is_existing_customer).toBe(true)
    expect(d.installment_outstanding).toBe(0)
  })
  it('maps gender 1 to male and a born_at timestamp to YYYY-MM-DD', () => {
    const d = mapDeepCustomer({ ...reservation.Customer, gender: 1, born_at: 631152000000 })
    expect(d.gender).toBe('male')
    expect(d.date_of_birth).toBe('1990-01-01')
  })
  it('maps gender 0 to null', () => {
    expect(mapDeepCustomer({ ...reservation.Customer, gender: 0 }).gender).toBeNull()
  })
})
