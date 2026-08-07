/**
 * Photo upload retry-on-network-error (8/1 field bug: intermittent 502 where
 * core never saw the POST — network-level failure between karute and core).
 *
 * Contracts under test:
 *  - fetch()'s network rejection (TypeError('fetch failed') — no response
 *    headers ever arrived) gets exactly one immediate retry; a retry success
 *    is the caller's success.
 *  - An error carrying an HTTP status (SynqedError shape = core answered) is
 *    thrown immediately — no retry.
 *  - A response-body failure AFTER a 2xx (SyntaxError from truncated JSON,
 *    or undici's TypeError('terminated')) is thrown immediately — the write
 *    already landed; a retry would silently double-save the photo.
 *  - A second network failure propagates — no infinite retry.
 */

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: jest.fn(async () => undefined),
}))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(),
  newSynqedClient: jest.fn(),
}))
jest.mock('@/lib/audit-web', () => ({ auditWeb: jest.fn() }))
// customers.ts pulls this in at module scope for other actions.
jest.mock('next-intl/server', () => ({
  getTranslations: jest.fn(async () => (k: string) => k),
}))

import { uploadCustomerPhotoWithClient } from '@/actions/customers'

const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' })

// Same shape the SDK's SynqedError carries — the code under test detects it
// structurally, so the test builds it structurally too.
function coreAnswered(status: number, message: string): Error {
  return Object.assign(new Error(message), { status })
}

function clientWith(uploadPhoto: jest.Mock) {
  return { customers: { uploadPhoto } } as unknown as Parameters<
    typeof uploadCustomerPhotoWithClient
  >[0]
}

describe('uploadCustomerPhotoWithClient retry', () => {
  it('retries once on a network-level error and returns the retry result', async () => {
    const uploadPhoto = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({ id: 'photo-1' })
    const result = await uploadCustomerPhotoWithClient(clientWith(uploadPhoto), 'cust-1', file)
    expect(result).toEqual({ id: 'photo-1' })
    expect(uploadPhoto).toHaveBeenCalledTimes(2)
  })

  it('does not retry when core answered (error carries an HTTP status)', async () => {
    const uploadPhoto = jest.fn().mockRejectedValue(coreAnswered(422, 'bad image'))
    await expect(
      uploadCustomerPhotoWithClient(clientWith(uploadPhoto), 'cust-1', file),
    ).rejects.toThrow('bad image')
    expect(uploadPhoto).toHaveBeenCalledTimes(1)
  })

  it('does not retry a truncated response body after a 2xx (SyntaxError)', async () => {
    const uploadPhoto = jest
      .fn()
      .mockRejectedValue(new SyntaxError('Unexpected end of JSON input'))
    await expect(
      uploadCustomerPhotoWithClient(clientWith(uploadPhoto), 'cust-1', file),
    ).rejects.toThrow('Unexpected end of JSON input')
    expect(uploadPhoto).toHaveBeenCalledTimes(1)
  })

  it("does not retry undici's body-read abort (TypeError('terminated'))", async () => {
    const uploadPhoto = jest.fn().mockRejectedValue(new TypeError('terminated'))
    await expect(
      uploadCustomerPhotoWithClient(clientWith(uploadPhoto), 'cust-1', file),
    ).rejects.toThrow('terminated')
    expect(uploadPhoto).toHaveBeenCalledTimes(1)
  })

  it('propagates a second consecutive network failure (no infinite retry)', async () => {
    const uploadPhoto = jest.fn().mockRejectedValue(new TypeError('fetch failed'))
    await expect(
      uploadCustomerPhotoWithClient(clientWith(uploadPhoto), 'cust-1', file),
    ).rejects.toThrow('fetch failed')
    expect(uploadPhoto).toHaveBeenCalledTimes(2)
  })
})
