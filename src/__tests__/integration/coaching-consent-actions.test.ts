/** @jest-environment node */
import { getCoachingConsent, decideCoachingConsent } from '@/actions/coaching-consent'
import { getSynqedClient } from '@/lib/synqed/client'
import { SynqedError } from '@synqed-kk/client'

jest.mock('@synqed-kk/client', () => ({ SynqedError: class extends Error {
  constructor(public status: number, message: string) { super(message) }
} }))
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn() }))
const fetchMock = jest.fn()
beforeEach(() => {
  jest.clearAllMocks()
  // The existing actor-bearer-forwarding suite covers this factory's actual
  // headers. Here prove actions always use that authenticated factory.
  jest.mocked(getSynqedClient).mockResolvedValue({ fetch: fetchMock } as unknown as Awaited<ReturnType<typeof getSynqedClient>>)
  fetchMock.mockResolvedValue({ current_policy_version: 'one', status: 'unset', decision: null })
})

it('uses the authenticated session client for private reads and writes', async () => {
  expect((await getCoachingConsent()).ok).toBe(true)
  expect(getSynqedClient).toHaveBeenCalledTimes(1)
  expect(fetchMock).toHaveBeenCalledWith('/coaching-consent/me', { cache: 'no-store' })
  fetchMock.mockResolvedValueOnce({ id: 'decision', status: 'declined', policy_version: 'one', decided_at: 'now' })
  expect((await decideCoachingConsent({ status: 'declined', policy_version: 'one' })).ok).toBe(true)
  expect(getSynqedClient).toHaveBeenCalledTimes(2)
  expect(fetchMock).toHaveBeenLastCalledWith('/coaching-consent/me', {
    method: 'POST', body: JSON.stringify({ status: 'declined', policy_version: 'one' }), cache: 'no-store',
  })
})

it('refuses forged subject fields and never calls Core without a session', async () => {
  const forged = { status: 'granted' as const, policy_version: 'one', staff_id: 'other-person' }
  expect(await decideCoachingConsent(forged)).toEqual({ ok: false, error: 'failed' })
  expect(getSynqedClient).not.toHaveBeenCalled()
  jest.mocked(getSynqedClient).mockRejectedValueOnce(new Error('Not authenticated'))
  expect(await getCoachingConsent()).toEqual({ ok: false, error: 'failed' })
  expect(fetchMock).not.toHaveBeenCalled()
})

it('preserves policy conflicts and returns failures without leaking upstream details', async () => {
  fetchMock.mockRejectedValueOnce(new SynqedError(409, 'Policy changed'))
  expect(await decideCoachingConsent({ status: 'granted', policy_version: 'v1.0-2026-05' })).toEqual({ ok: false, error: 'policyChanged' })
  fetchMock.mockRejectedValueOnce(new Error('Secret internal upstream detail'))
  expect(await getCoachingConsent()).toEqual({ ok: false, error: 'failed' })
})

it('rejects a direct grant for an undisplayed policy but forwards withdrawal', async () => {
  expect(await decideCoachingConsent({ status: 'granted', policy_version: 'future-policy' })).toEqual({ ok: false, error: 'policyChanged' })
  expect(fetchMock).not.toHaveBeenCalled()
  expect(getSynqedClient).not.toHaveBeenCalled()
  expect((await decideCoachingConsent({ status: 'declined', policy_version: 'future-policy' })).ok).toBe(true)
  expect(fetchMock).toHaveBeenCalledWith('/coaching-consent/me', expect.objectContaining({
    body: JSON.stringify({ status: 'declined', policy_version: 'future-policy' }),
  }))
})
