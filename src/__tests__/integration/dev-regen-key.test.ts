/**
 * canUseDevRegen requires BOTH the dev key (business.manage) and the transcript
 * key (recordings.viewAll). recordings.viewAll spreads only from the owner's
 * hand (⚖ 9/3 named grant) and business.manage rides no non-owner preset, so
 * the AND means the owner, or a person the owner gave BOTH keys by hand:
 * granting business.manage ALONE never re-opens raw-transcript access. It is
 * no longer a proxy for the owner IDENTITY — see business/lib/admission.ts.
 */

jest.mock('@/lib/auth/require-permission', () => ({ getMyCapabilities: jest.fn() }))

import { canUseDevRegen } from '@/actions/dev-tools'

const rp = jest.requireMock('@/lib/auth/require-permission') as { getMyCapabilities: jest.Mock }

describe('canUseDevRegen — owner-identity key', () => {
  beforeEach(() => jest.clearAllMocks())

  it('owner (both keys) → true', async () => {
    rp.getMyCapabilities.mockResolvedValue(new Set(['business.manage', 'recordings.viewAll']))
    await expect(canUseDevRegen()).resolves.toBe(true)
  })

  it('business.manage alone (granted to a non-owner) → false', async () => {
    rp.getMyCapabilities.mockResolvedValue(new Set(['business.manage']))
    await expect(canUseDevRegen()).resolves.toBe(false)
  })

  it('capability read failure → fails closed', async () => {
    rp.getMyCapabilities.mockRejectedValue(new Error('boom'))
    await expect(canUseDevRegen()).resolves.toBe(false)
  })
})
