jest.mock('react', () => {
  const actual = jest.requireActual('react')
  return { ...actual, cache: (fn: (...a: unknown[]) => unknown) => fn }
})
jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))

const cookieStore: Record<string, string | undefined> = {}
const cookieDelete = jest.fn((name: string) => { delete cookieStore[name] })
jest.mock('next/headers', () => ({
  cookies: jest.fn(async () => ({
    get: (name: string) => (cookieStore[name] ? { name, value: cookieStore[name] } : undefined),
    set: jest.fn(),
    delete: cookieDelete,
  })),
}))

const rosterIds: string[] = []
jest.mock('@/lib/staff', () => ({
  getStaffList: jest.fn(async () => rosterIds.map((id) => ({ id, full_name: id, has_pin: false, created_at: '' }))),
}))

import { getActiveStaffId } from '@/lib/active-staff'

beforeEach(() => {
  jest.clearAllMocks()
  rosterIds.length = 0
  for (const k of Object.keys(cookieStore)) delete cookieStore[k]
})

describe('getActiveStaffId', () => {
  it('returns the cookie id when it is a current roster member', async () => {
    rosterIds.push('staff-a')
    cookieStore['active_staff_id'] = 'staff-a'
    expect(await getActiveStaffId()).toBe('staff-a')
  })

  it('returns null when no cookie is set', async () => {
    rosterIds.push('staff-a')
    expect(await getActiveStaffId()).toBeNull()
  })

  it('returns null without mutating the cookie when the id is stale/foreign', async () => {
    // Read-only path: it runs during server-component render, where deleting a
    // cookie throws. A stale/foreign id resolves to null and the cookie is left
    // as-is (overwritten by the next setActiveStaff/clearActiveStaff).
    rosterIds.push('staff-a')
    cookieStore['active_staff_id'] = 'ghost'
    expect(await getActiveStaffId()).toBeNull()
    expect(cookieDelete).not.toHaveBeenCalled()
  })

  it('returns null when the roster is empty (synqed-core down)', async () => {
    cookieStore['active_staff_id'] = 'staff-a'
    expect(await getActiveStaffId()).toBeNull()
  })
})
