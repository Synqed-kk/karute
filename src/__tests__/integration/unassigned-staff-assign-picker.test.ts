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

  // ⚖ FIX ROUND 2 item 7 (X4) — the write gate's resolver links a profile to
  // its core row by user_id first, then by email (case-insensitive). A
  // profile whose only core row is inactive and linked by EMAIL would be
  // refused at write time, so the picker must not offer it either.
  it('a profile whose inactive core row is linked by email only is not offered', async () => {
    const c = {
      staff: {
        list: jest.fn(async () => {
          const staff = [
            { id: 's-mail', user_id: null, email: 'Old.Hand@Example.com', is_active: false },
            { id: 's-ginza', user_id: 'p-ginza', email: 'same@example.com', is_active: true },
            { id: 's-dup', user_id: null, email: 'same@example.com', is_active: false },
          ]
          return { staff, total: staff.length }
        }),
      },
    } as never
    const people = [
      { id: 'p-mail', email: 'old.hand@example.com' },
      // Linked by user_id to an ACTIVE row: an inactive row sharing the email
      // does not hide them (the resolver never reaches its email fallback).
      { id: 'p-ginza', email: 'same@example.com' },
      { id: 'p-float', email: null },
    ]
    const out = await assignableStaffIdsByBooking(rows, people, c, async () => new Set(['p-mail', 'p-ginza', 'p-float']))
    expect(out).toEqual({ 'b-ginza': ['p-ginza', 'p-float'] })
  })

  it('a day with no staff-less booking reads nothing', async () => {
    const c = core()
    await expect(assignableStaffIdsByBooking([rows[1]], STAFF, c, async () => GINZA)).resolves.toEqual({})
    expect((c as unknown as { staff: { list: jest.Mock } }).staff.list).not.toHaveBeenCalled()
  })
})

// ⚖ FIX ROUND 4 (R5) — a booking with NO store (legacy import): nothing to
// judge the store against, so every ACTIVE staff is offered (the write gate
// skips the store half for it too) and no store set is ever asked.
describe('assignableStaffIdsByBooking — store-less booking', () => {
  it('store_id null → every active staff (the inactive one excluded), no store lookup', async () => {
    const storeSet = jest.fn(async () => GINZA)
    const out = await assignableStaffIdsByBooking(
      [{ id: 'b-nostore', staff_profile_id: null, store_id: null }],
      STAFF,
      core(),
      storeSet,
    )
    expect(out).toEqual({ 'b-nostore': ['p-ginza', 'p-shibuya', 'p-float'] })
    expect(storeSet).not.toHaveBeenCalled()
  })

  // ⚖ Greptile pass 1 P1 (B2 #1143) — a core-only teammate (no sign-up) is in
  // the roster under its CORE id; its own is_active decides, matched by that id.
  it('a core-only teammate is offered by its core id when active, never when inactive', async () => {
    const c = {
      staff: {
        list: jest.fn(async () => {
          const staff = [
            { id: 'core-new', user_id: null, is_active: true },
            { id: 'core-left', user_id: null, is_active: false },
          ]
          return { staff, total: staff.length }
        }),
      },
    } as never
    const roster = [{ id: 'core-new' }, { id: 'core-left' }]
    const out = await assignableStaffIdsByBooking(rows, roster, c, async () => new Set(['core-new', 'core-left']))
    expect(out).toEqual({ 'b-ginza': ['core-new'] })
  })
})
