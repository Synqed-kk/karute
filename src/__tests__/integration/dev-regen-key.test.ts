/**
 * canUseDevRegen requires BOTH the dev key (business.manage) and the transcript
 * key (recordings.viewAll). recordings.viewAll is strip-protected owner-only,
 * so the AND pins the dev tools (再学習, 全カルテ再生成) to the owner identity:
 * granting business.manage to a non-owner never re-opens raw-transcript access.
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
