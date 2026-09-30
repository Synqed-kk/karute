/**
 * ⚖ R53 — the shell card names the SIGNED-IN PERSON, in both worlds. Door OFF (the sample
 * world) fills the business, never the viewer's identity: readShellViewer is the admission
 * alone and reaches core zero times. P1 (door OFF) · P1b (admission.displayName).
 */
const mockBuilt = { n: 0 }
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: class {
    constructor() {
      mockBuilt.n += 1
    }
  },
}))
jest.mock('@/business/lib/admission', () => ({
  ...jest.requireActual('@/business/lib/admission'),
  requireBusinessAdmission: jest.fn(),
}))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('@/business/lib/grants', () => ({
  businessIdForUser: jest.fn(async () => 'b-1'),
  hasBusinessAdminGrant: jest.fn(async () => ({ granted: true, grantedBy: 'u-1' })),
  isManagementMember: jest.fn(async () => false),
}))

import * as data from '@/business/lib/data'
import { requireBusinessAdmission, type BusinessAdmission } from '@/business/lib/admission'
import { createClient } from '@/lib/supabase/server'
import { operator } from '@/business/lib/fixtures'

const NON_TENANT = '00000000-0000-4000-8000-000000000000'
const TENANT = 'fb44dd68-4af7-44b0-8cc7-4ee10c54491d'
const saved = { tenant: process.env.BUSINESS_PRACTICE_TENANT, vercel: process.env.VERCEL_ENV }
afterEach(() => {
  if (saved.tenant === undefined) delete process.env.BUSINESS_PRACTICE_TENANT
  else process.env.BUSINESS_PRACTICE_TENANT = saved.tenant
  if (saved.vercel === undefined) delete process.env.VERCEL_ENV
  else process.env.VERCEL_ENV = saved.vercel
})

const admitted = (displayName: string | null): BusinessAdmission => ({
  userId: 'u-1',
  email: 'someone@example.com',
  displayName,
  businessId: NON_TENANT,
})

describe.each([
  ['the switch unset', undefined],
  ['the switch set to another business', TENANT],
])('P1 readShellViewer door OFF (%s): the viewer, never the fixture person', (_label, tenant) => {
  beforeEach(() => {
    mockBuilt.n = 0
    if (tenant === undefined) delete process.env.BUSINESS_PRACTICE_TENANT
    else process.env.BUSINESS_PRACTICE_TENANT = tenant
    ;(requireBusinessAdmission as jest.Mock).mockResolvedValue(admitted(null))
  })

  it('no full_name → the e-mail is the name, its first letter the mark, no role claim, zero core', async () => {
    const v = await data.readShellViewer(admitted(null))
    expect(v.name).not.toBe('見本 あずさ')
    expect(v.name).not.toBe(operator.name)
    expect(v).toEqual({ name: 'someone@example.com', mark: 'S', email: 'someone@example.com', roleLabel: null })
    expect(mockBuilt.n).toBe(0)
  })

  it('full_name present → that name, its first token the mark, zero core', async () => {
    const v = await data.readShellViewer(admitted('山田 花子'))
    expect(v.name).not.toBe('見本 あずさ')
    expect(v).toEqual({ name: '山田 花子', mark: '山田', email: 'someone@example.com', roleLabel: null })
    expect(mockBuilt.n).toBe(0)
  })

  it('no e-mail and no name → empty name, no e-mail line (the card falls back to its title)', async () => {
    const v = await data.readShellViewer({ ...admitted(null), email: null })
    expect(v).toEqual({ name: '', mark: '', email: null, roleLabel: null })
  })
})

describe('P1b admission.displayName: user_metadata.full_name off the same getUser() read', () => {
  const { requireBusinessAdmission: realAdmission } = jest.requireActual('@/business/lib/admission') as typeof import('@/business/lib/admission')
  const withUser = (user_metadata: Record<string, unknown> | undefined) =>
    (createClient as jest.Mock).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u-1', email: 'someone@example.com', user_metadata } }, error: null }) },
    })
  beforeEach(() => delete process.env.VERCEL_ENV)

  it.each([
    [{ full_name: '  山田 花子 ' }, '山田 花子'],
    [{ full_name: '   ' }, null],
    [{ full_name: 42 }, null],
    [{}, null],
    [undefined, null],
  ])('user_metadata %p → displayName %p', async (meta, expected) => {
    withUser(meta)
    await expect(realAdmission()).resolves.toEqual({ userId: 'u-1', email: 'someone@example.com', displayName: expected, businessId: 'b-1' })
  })
})
