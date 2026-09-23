/**
 * The REAL removal (deleteStaffCore) + the REAL roster read
 * (staffListByBusinessOrThrow) against one in-memory profiles table: a removed
 * person drops off the roster at once, the colleague stays, the account is
 * banned, and the move is reversible (strip the prefix = back). No row deleted.
 */
import { fakeProfilesService, BUSINESS } from './helpers/removed-staff'

const service = { current: null as unknown }
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => service.current }))
jest.mock('@/lib/synqed/staff-map', () => ({
  lookupSynqedStaffIdForBusiness: async (pid: string) => `synqed-${pid}`,
}))
jest.mock('@/lib/audit', () => ({ audit: () => {} }))
jest.mock('next/cache', () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  updateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}))
jest.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }))
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: class {},
  SynqedError: class SynqedError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
}))

import { deleteStaffCore } from '@/actions/staff'
import { staffListByBusinessOrThrow } from '@/lib/staff'

const table = () => [
  { id: 'auth-user-1', full_name: '田中', customer_id: BUSINESS },
  { id: 'colleague-1', full_name: '佐藤', customer_id: BUSINESS },
]

async function remove(fake: ReturnType<typeof fakeProfilesService>, id: string) {
  service.current = fake.client
  const r = await deleteStaffCore(
    { staff: { delete: async () => ({}) } } as never,
    BUSINESS,
    { actorId: 'owner-1', source: 'facade' },
    id,
  )
  expect(r).toEqual({ ok: true })
}
const rosterIds = async () => (await staffListByBusinessOrThrow(BUSINESS)).map((s) => s.id).sort()

describe('removal → roster', () => {
  it('staffListByBusinessOrThrow no longer lists a removed person; the row survives with the name kept; account banned', async () => {
    const fake = fakeProfilesService(table())
    await remove(fake, 'auth-user-1')
    expect(await rosterIds()).toEqual(['colleague-1'])
    expect(fake.rows.find((r) => r.id === 'auth-user-1')).toMatchObject({
      full_name: '_system_removed_田中',
      customer_id: BUSINESS,
    })
    expect(fake.bans.get('auth-user-1')).toBe('876000h')
    expect(fake.bans.has('colleague-1')).toBe(false)
  })

  it('reversible: stripping the prefix puts the same row back on the roster', async () => {
    const fake = fakeProfilesService(table())
    await remove(fake, 'auth-user-1')
    const row = fake.rows.find((r) => r.id === 'auth-user-1')!
    row.full_name = String(row.full_name).replace(/^_system_removed_/, '')
    expect(row.full_name).toBe('田中')
    expect(await rosterIds()).toEqual(['auth-user-1', 'colleague-1'])
  })

  it('a null-name profile removed → bare _system_removed_ (empty suffix) is off the roster', async () => {
    const fake = fakeProfilesService([...table(), { id: 'null-1', full_name: null, customer_id: BUSINESS }])
    await remove(fake, 'null-1')
    expect(fake.rows.find((r) => r.id === 'null-1')!.full_name).toBe('_system_removed_')
    expect(await rosterIds()).toEqual(['auth-user-1', 'colleague-1'])
  })

  it('a second removal of the same id does not double-prefix', async () => {
    const fake = fakeProfilesService(table())
    await remove(fake, 'auth-user-1')
    await remove(fake, 'auth-user-1')
    expect(fake.rows.find((r) => r.id === 'auth-user-1')!.full_name).toBe('_system_removed_田中')
  })
})
