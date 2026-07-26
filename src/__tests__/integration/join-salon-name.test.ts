// /join salon name = org truth (store-scope design §6). Pins: the name comes
// from core orgSettings (settings 事業所名), read through a client scoped to
// the INVITE's business — never the owner's profile full_name (renaming the
// owner renamed the join screen); an orgSettings failure or unconfigured
// salon degrades to 'Karute' and never blocks the pre-auth join page.
// Every case also pins "the old profiles path is DEAD": createServiceClient
// is never called by getInviteByToken, and if it were, the distinctive fake
// owner name would leak into salonName and fail the assertion.
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
// The mocked client carries its construction-time businessId so scoping can
// be asserted SEMANTICALLY (on the client handed to the org read), not by
// constructor call order.
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn((args: { businessId?: string }) => ({
    businessId: args?.businessId,
    invites: { getByToken: invitesGetByToken },
  })),
  SynqedError: class extends Error {},
}))

const orgSettingsWithClient = jest.fn()
jest.mock('@/actions/org-settings', () => ({
  orgSettingsWithClient: (...a: unknown[]) => orgSettingsWithClient(...a),
}))

// The OLD implementation read the owner's profile full_name through
// createServiceClient. Mock it with a distinctive name that would satisfy
// the old code's query — if the profiles path ever comes back, salonName
// becomes 'オーナー個人名' and every case below fails on both assertions.
const createServiceClient = jest.fn(() => {
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit']) builder[m] = () => builder
  ;(builder as { maybeSingle: unknown }).maybeSingle = async () => ({
    data: { full_name: 'オーナー個人名' },
  })
  return { from: () => builder }
})
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => createServiceClient(),
}))

import { getInviteByToken } from '@/actions/invites'

describe('getInviteByToken salon name', () => {
  beforeEach(() => {
    orgSettingsWithClient.mockReset()
    createServiceClient.mockClear()
  })

  it('returns the org settings salon_name via a client scoped to the invite business', async () => {
    orgSettingsWithClient.mockResolvedValue({ salon_name: '銀座サロン' })
    const r = await getInviteByToken('tok-32-chars')
    expect(r).toEqual({ valid: true, email: 'staff@example.com', salonName: '銀座サロン' })
    // The client handed to the org read is scoped to the INVITE's business.
    expect(orgSettingsWithClient.mock.calls[0][0]).toMatchObject({ businessId: 'business-9' })
    expect(createServiceClient).not.toHaveBeenCalled()
  })

  it('falls back to Karute when the org read fails — join still renders', async () => {
    orgSettingsWithClient.mockRejectedValue(new Error('core down'))
    const r = await getInviteByToken('tok-32-chars')
    expect(r).toEqual({ valid: true, email: 'staff@example.com', salonName: 'Karute' })
    expect(createServiceClient).not.toHaveBeenCalled()
  })

  it('falls back to Karute for an unconfigured salon (null settings / empty name)', async () => {
    orgSettingsWithClient.mockResolvedValue(null)
    expect(await getInviteByToken('tok-32-chars')).toMatchObject({ salonName: 'Karute' })
    orgSettingsWithClient.mockResolvedValue({ salon_name: '' })
    expect(await getInviteByToken('tok-32-chars')).toMatchObject({ salonName: 'Karute' })
    expect(createServiceClient).not.toHaveBeenCalled()
  })
})
