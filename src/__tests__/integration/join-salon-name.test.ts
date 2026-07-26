// /join salon name = org truth (store-scope design §6). Pins: the name comes
// from core orgSettings (settings 事業所名), read through a client scoped to
// the INVITE's business — never the owner's profile full_name (renaming the
// owner renamed the join screen); an orgSettings failure or unconfigured
// salon degrades to 'Karute' and never blocks the pre-auth join page.
process.env.SYNQED_CORE_URL ??= 'https://core.test'
process.env.SYNQED_CORE_API_KEY ??= 'test-core-key'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'

const inviteRow = {
  id: 'inv-1',
  email: 'staff@example.com',
  status: 'pending',
  expires_at: null,
  business_id: 'business-9',
}
const invitesGetByToken = jest.fn(async () => inviteRow)
const clientCtorArgs: unknown[] = []
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn((args: unknown) => {
    clientCtorArgs.push(args)
    return { invites: { getByToken: invitesGetByToken } }
  }),
  SynqedError: class extends Error {},
}))

const orgSettingsWithClient = jest.fn()
jest.mock('@/actions/org-settings', () => ({
  orgSettingsWithClient: (...a: unknown[]) => orgSettingsWithClient(...a),
}))

import { getInviteByToken } from '@/actions/invites'

describe('getInviteByToken salon name', () => {
  beforeEach(() => {
    clientCtorArgs.length = 0
    orgSettingsWithClient.mockReset()
  })

  it('returns the org settings salon_name via a client scoped to the invite business', async () => {
    orgSettingsWithClient.mockResolvedValue({ salon_name: '銀座サロン' })
    const r = await getInviteByToken('tok-32-chars')
    expect(r).toEqual({ valid: true, email: 'staff@example.com', salonName: '銀座サロン' })
    // Second client construction is the org-settings read — scoped to the
    // invite's business, not the empty pre-auth scope.
    expect(clientCtorArgs[1]).toMatchObject({ businessId: 'business-9' })
  })

  it('falls back to Karute when the org read fails — join still renders', async () => {
    orgSettingsWithClient.mockRejectedValue(new Error('core down'))
    const r = await getInviteByToken('tok-32-chars')
    expect(r).toEqual({ valid: true, email: 'staff@example.com', salonName: 'Karute' })
  })

  it('falls back to Karute for an unconfigured salon (null settings / empty name)', async () => {
    orgSettingsWithClient.mockResolvedValue(null)
    expect(await getInviteByToken('tok-32-chars')).toMatchObject({ salonName: 'Karute' })
    orgSettingsWithClient.mockResolvedValue({ salon_name: '' })
    expect(await getInviteByToken('tok-32-chars')).toMatchObject({ salonName: 'Karute' })
  })
})
