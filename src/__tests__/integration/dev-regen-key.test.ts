/**
 * canUseDevRegen requires BOTH the dev key (business.manage) and the transcript
 * key (recordings.viewAll). recordings.viewAll spreads only from the owner's
 * hand (⚖ 9/3 named grant) and business.manage rides no non-owner preset, so
 * the AND means the owner, or a person the owner gave BOTH keys by hand:
 * granting business.manage ALONE never re-opens raw-transcript access. It is
 * no longer a proxy for the owner IDENTITY — see business/lib/admission.ts.
 *
 * AND THE STORE REACH (fix round 7; ⚖ 8/17 store isolation): these tools read a
 * customer's WHOLE history, which spans stores by construction, so the pair
 * alone is not enough — the holder must also see every store. A store-clamped
 * pair-holder is not offered them, and a degraded scope lookup fails closed.
 */

jest.mock('@/lib/auth/require-permission', () => ({ getMyCapabilities: jest.fn() }))
/** The caller's store scope. Default: unrestricted (stores.viewAll / floating). */
const scope = {
  current: {
    storeId: null as string | null,
    viewAll: true,
    allowedStoreIds: null as string[] | null,
    degraded: false,
  },
}
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(async () => scope.current),
  viewerScopeForActs: jest.fn(async () =>
    scope.current.degraded ? [] : scope.current.allowedStoreIds,
  ),
}))

import { canUseDevRegen } from '@/actions/dev-tools'

const rp = jest.requireMock('@/lib/auth/require-permission') as { getMyCapabilities: jest.Mock }

describe('canUseDevRegen — BOTH keys', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    scope.current = { storeId: null, viewAll: true, allowedStoreIds: null, degraded: false }
  })

  it('both keys (the owner, or a person the owner gave both) → true', async () => {
    rp.getMyCapabilities.mockResolvedValue(new Set(['business.manage', 'recordings.viewAll']))
    await expect(canUseDevRegen()).resolves.toBe(true)
  })

  // ⚖ THE HALF THE ⚖ 9/3 GRANT CREATES (fix round 4). The file's own header
  // claims "the named grant ALONE never reaches a dev tool"; until now nothing
  // asserted that sentence, and mutating the helper to viewAll-alone left every
  // dev-tool suite green (blind round 2, L2 F4).
  it('recordings.viewAll alone (the named grant) → false — a read grant is not a dev key', async () => {
    rp.getMyCapabilities.mockResolvedValue(new Set(['recordings.viewAll']))
    await expect(canUseDevRegen()).resolves.toBe(false)
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

// ── ⚖ THE PAIR IS NOT ENOUGH WITHOUT STORE REACH (fix round 7) ──────────────
// Greptile #848 review 2, point 2. A hand-granted both-keys branch manager is
// the first person to hold the pair WITHOUT stores.viewAll; 再学習 and
// 全カルテ再生成 read a customer's whole cross-store history, so she is not
// offered them at all.
describe('canUseDevRegen — the store half', () => {
  const bothKeys = () =>
    rp.getMyCapabilities.mockResolvedValue(new Set(['business.manage', 'recordings.viewAll']))

  it('both keys + an UNRESTRICTED scope (stores.viewAll / floating) → true', async () => {
    bothKeys()
    scope.current = { storeId: null, viewAll: true, allowedStoreIds: null, degraded: false }
    await expect(canUseDevRegen()).resolves.toBe(true)
  })

  it('both keys but CLAMPED to store-a → false — the tools read across stores', async () => {
    bothKeys()
    scope.current = { storeId: 'store-a', viewAll: false, allowedStoreIds: ['store-a'], degraded: false }
    await expect(canUseDevRegen()).resolves.toBe(false)
  })

  it('both keys + a DEGRADED scope → false (fails closed, never widened)', async () => {
    bothKeys()
    scope.current = { storeId: null, viewAll: false, allowedStoreIds: null, degraded: true }
    await expect(canUseDevRegen()).resolves.toBe(false)
  })
})
