// upsertOrgSettings capability gate (packet 03, gap 1). The action had NO gate —
// any signed-in staff could rewrite org settings. It now requires settings.manage.
// The ungated writeOrgSettingsBlob remains available to the voice service, which
// enforces OWNERSHIP instead (so staff self-enrollment isn't blocked).
jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: class {} }))
jest.mock('@/lib/staff', () => ({ getBusinessId: jest.fn(async () => 'business-1') }))
jest.mock('@/lib/auth/require-permission', () => ({
  getMyCapabilities: jest.fn(),
  ensureCapability: (caps: Set<string>, cap: string) => {
    if (!caps.has(cap)) throw new Error(`Missing capability: ${cap}`)
  },
}))

const orgUpsert = jest.fn(async () => ({}))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({
    orgSettings: { get: jest.fn(async () => ({ settings: {} })), upsert: orgUpsert },
  })),
}))

import { upsertOrgSettings } from '@/actions/org-settings'
import { getMyCapabilities } from '@/lib/auth/require-permission'
import { getSynqedClient } from '@/lib/synqed/client'

beforeEach(() => jest.clearAllMocks())

describe('upsertOrgSettings capability gate', () => {
  it('refuses a caller WITHOUT settings.manage — returns error, no core write', async () => {
    ;(getMyCapabilities as jest.Mock).mockResolvedValue(new Set(['customers.view']))
    const res = await upsertOrgSettings({ salon_name: 'Hijacked' })
    expect(res).toHaveProperty('error')
    expect(getSynqedClient).not.toHaveBeenCalled()
    expect(orgUpsert).not.toHaveBeenCalled()
  })

  it('allows a caller WITH settings.manage to write', async () => {
    ;(getMyCapabilities as jest.Mock).mockResolvedValue(new Set(['settings.manage']))
    const res = await upsertOrgSettings({ salon_name: 'New Name' })
    expect(res).toEqual({ success: true })
    expect(orgUpsert).toHaveBeenCalled()
  })

  it('a failing getSynqedClient resolves to { error } — never a server-action rejection (S1 WithClient-extraction pin)', async () => {
    // Sections await upsertOrgSettings with no try/catch of their own; a
    // session blip / DB hiccup during client init must keep the { error }
    // contract main always had (fails on the unguarded `await getSynqedClient()` shape).
    ;(getMyCapabilities as jest.Mock).mockResolvedValue(new Set(['settings.manage']))
    ;(getSynqedClient as jest.Mock).mockRejectedValueOnce(new Error('upstream unavailable'))
    const res = await upsertOrgSettings({ salon_name: 'New Name' })
    expect(res).toEqual({ error: 'upstream unavailable' })
    expect(orgUpsert).not.toHaveBeenCalled()
  })
})
