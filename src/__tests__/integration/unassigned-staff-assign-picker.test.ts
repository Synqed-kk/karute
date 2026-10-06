// 担当未定 picker (PR-B fix round 1): the staff offered for a staff-less
// booking are the ACTIVE staff of the BOOKING's store, never the view's store.
import { assignableStaffIdsByBooking } from '@/lib/appointments/assign-picker'

const STAFF = [{ id: 'p-ginza' }, { id: 'p-shibuya' }, { id: 'p-float' }, { id: 'p-gone' }]
const GINZA = new Set(['p-ginza', 'p-float', 'p-gone'])
const core = (fail = false) =>
  ({
    staff: {
      list: jest.fn(async () => {
        if (fail) throw new Error('core down')
        const staff = [
          { id: 's-gone', user_id: 'p-gone', is_active: false },
          { id: 's-ginza', user_id: 'p-ginza', is_active: true },
        ]
        return { staff, total: staff.length }
      }),
    },
  }) as never
const rows = [
  { id: 'b-ginza', staff_profile_id: null, store_id: 'ginza' },
  { id: 'b-staffed', staff_profile_id: 'p-ginza', store_id: 'ginza' },
]

describe('assignableStaffIdsByBooking', () => {
  it('all-stores view, a 銀座 booking → only 銀座 or floating ACTIVE staff', async () => {
    const storeSet = jest.fn(async (sid: string) => (sid === 'ginza' ? GINZA : new Set(['p-shibuya'])))
    const out = await assignableStaffIdsByBooking(rows, STAFF, core(), storeSet)
    expect(out).toEqual({ 'b-ginza': ['p-ginza', 'p-float'] })
    expect(storeSet).toHaveBeenCalledWith('ginza')
  })

  it('an unreadable assignment or roster offers nobody (fail closed)', async () => {
    await expect(assignableStaffIdsByBooking(rows, STAFF, core(), async () => null)).resolves.toEqual({ 'b-ginza': [] })
    await expect(assignableStaffIdsByBooking(rows, STAFF, core(true), async () => GINZA)).resolves.toEqual({})
  })

  it('a day with no staff-less booking reads nothing', async () => {
    const c = core()
    await expect(assignableStaffIdsByBooking([rows[1]], STAFF, c, async () => GINZA)).resolves.toEqual({})
    expect((c as unknown as { staff: { list: jest.Mock } }).staff.list).not.toHaveBeenCalled()
  })
})
