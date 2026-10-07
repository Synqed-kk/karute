/**
 * ⚖ S81 R2 / F4 (M16) — 次回予約 reads an in-progress row (core's IN_PROGRESS, carried as 'in_progress') as a booked slot,
 * exactly as it reads a 'booked' one. A direct call of customersProps on a one-customer world whose ONLY future row
 * carries the status under test: the row's 次回予約 must show it, and the two statuses must paint identically.
 */
jest.mock('react', () => ({
  cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
    let resolved = false
    let value: R
    return (...args: A): R => {
      if (!resolved) {
        resolved = true
        value = fn(...args)
      }
      return value
    }
  },
}))

import { listAppointments, listCustomers } from '@/business/lib/data'
import { STORE_A } from '@/business/lib/fixtures'
import { customersProps } from '@/app/[locale]/(business)/business/customers/customers-props'

describe('S81 R2 — 次回予約 counts an in-progress row as a booked slot', () => {
  const rowFor = async (status: 'booked' | 'in_progress' | 'cancelled') => {
    const [customer] = await listCustomers(STORE_A)
    const [base] = await listAppointments(STORE_A)
    const only = { ...base, id: 'm16-next', customer_id: customer.id, store_id: STORE_A, status, starts_at: '2099-01-05T01:00:00.000Z', ends_at: '2099-01-05T02:00:00.000Z' }
    const { props } = await customersProps({ locale: 'ja', store: STORE_A, world: { customers: [customer], appointments: [only] } })
    return props.rows.find((r) => r.id === customer.id)!
  }

  it("'in_progress' shows as 次回予約, identically to 'booked'", async () => {
    const booked = await rowFor('booked')
    const inProgress = await rowFor('in_progress')
    expect(booked.hasNext).toBe(true)
    expect(booked.nextLabel).not.toBe('なし')
    expect(inProgress).toEqual(booked)
  })

  it('a cancelled row is still never a 次回予約 (the test separates the statuses)', async () => {
    expect((await rowFor('cancelled')).hasNext).toBe(false)
  })
})
