// /join salon name = the shared business-name truth chain (business-name.ts):
// configured org 事業所名 first (NEVER the owner's editable profile name —
// renaming the owner retitled the join screen), the signup-captured profile
// name second (pre-onboarding tenants: bootstrap sets full_name TO the
// entered salon name and nothing else holds it until /welcome), 'Karute'
// last. A failed org read degrades and never blocks the pre-auth join page.
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

// Tier 2: the signup-captured owner-profile name (bootstrap wrote the entered
// salon name into full_name). Reached ONLY when org settings has no name.
let signupName: string | null = 'エストロ表参道'
const createServiceClient = jest.fn(() => {
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit']) builder[m] = () => builder
  ;(builder as { maybeSingle: unknown }).maybeSingle = async () => ({
    data: signupName === null ? null : { full_name: signupName },
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
    signupName = 'エストロ表参道'
  })

  it('configured business: org settings 事業所名 wins and the profile is never consulted', async () => {
    orgSettingsWithClient.mockResolvedValue({ salon_name: '銀座サロン' })
    const r = await getInviteByToken('tok-32-chars')
    expect(r).toEqual({ valid: true, email: 'staff@example.com', salonName: '銀座サロン' })
    // The client handed to the org read is scoped to the INVITE's business.
    expect(orgSettingsWithClient.mock.calls[0][0]).toMatchObject({ businessId: 'business-9' })
    expect(createServiceClient).not.toHaveBeenCalled()
  })

  it('pre-onboarding business (org settings null): the signup-captured name shows, not Karute', async () => {
    orgSettingsWithClient.mockResolvedValue(null)
    const r = await getInviteByToken('tok-32-chars')
    expect(r).toEqual({ valid: true, email: 'staff@example.com', salonName: 'エストロ表参道' })
  })

  it('core down: degrades to Karute — NEVER the personal profile name, join still renders', async () => {
    // Failure contract: a transient core failure must not expose the
    // (personally editable) profile name — only a definitive "unconfigured"
    // answer unlocks that tier.
    orgSettingsWithClient.mockRejectedValue(new Error('core down'))
    const r = await getInviteByToken('tok-32-chars')
    expect(r).toEqual({ valid: true, email: 'staff@example.com', salonName: 'Karute' })
    expect(createServiceClient).not.toHaveBeenCalled()
  })

  it('both sources empty: falls back to Karute', async () => {
    orgSettingsWithClient.mockResolvedValue({ salon_name: '' })
    signupName = null
    expect(await getInviteByToken('tok-32-chars')).toMatchObject({ salonName: 'Karute' })
  })
})
