/**
 * The WEB door for "this take is complete" (src/actions/recordings.ts
 * #finalizeTake) — the cookie twin of POST /api/app/v1/recordings/finalize.
 * The shared body's logic is proved in recording-finalize-take.test.ts; what
 * only this file can prove is the DOOR:
 *   1. it NEVER throws — finalize runs on the stop path, and a throw would put
 *      an error dialog between the staffer and audio already on the server;
 *   2. records.write gates it, before any core call;
 *   3. every identity the shared body trusts is resolved from the SESSION here
 *      — business, staff, store and reach, never from the argument.
 */
const requireCapability = jest.fn(async (_c: string) => {})
const getMyCapabilities = jest.fn(async () => new Set<string>(['records.write']))
jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: (c: string) => requireCapability(c),
  getMyCapabilities: () => getMyCapabilities(),
}))

const getBusinessId = jest.fn(async () => 'biz-1')
const getCurrentUserStaffId = jest.fn(async (): Promise<string | null> => 'staff-1')
jest.mock('@/lib/staff', () => ({
  getBusinessId: () => getBusinessId(),
  getCurrentUserStaffId: () => getCurrentUserStaffId(),
}))

const resolveStoreScope = jest.fn(async () => ({ storeId: 'store-9' as string | null }))
jest.mock('@/lib/auth/store-scope', () => ({ resolveStoreScope: () => resolveStoreScope() }))
jest.mock('@/lib/audit-web', () => ({ resolveWebAuditContext: jest.fn() }))

const CLIENT = { recordings: {} }
const newSynqedClient = jest.fn((_businessId: string) => CLIENT)
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: (b: string) => newSynqedClient(b),
  getSynqedClient: jest.fn(),
}))

// The shared choke point is mocked ON PURPOSE: this suite is about what the
// door HANDS it (and hands back), not about what it does with it.
const finalizeTakeWithClient = jest.fn(async () => ({ ok: true, recordingSessionId: 'sess-1' }))
jest.mock('@/lib/recording/finalize-take', () => ({
  finalizeTakeWithClient: (...a: unknown[]) => finalizeTakeWithClient(...(a as [])),
}))

import { finalizeTake } from '@/actions/recordings'

const TAKE = '0f8c6c9a-3f2d-4a71-9b5e-2c1d7e4a8b30'
const input = { takeId: TAKE, mimeType: 'audio/webm', durationSeconds: 42.7, byteLength: 1024 }

/** The actor the door composed for the shared body. */
function actorPassed(): Record<string, unknown> {
  const [, actor] = finalizeTakeWithClient.mock.calls[0] as unknown as [unknown, Record<string, unknown>]
  return actor
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  requireCapability.mockImplementation(async () => {})
  getMyCapabilities.mockImplementation(async () => new Set(['records.write']))
  getBusinessId.mockImplementation(async () => 'biz-1')
  getCurrentUserStaffId.mockImplementation(async () => 'staff-1')
  resolveStoreScope.mockImplementation(async () => ({ storeId: 'store-9' }))
  finalizeTakeWithClient.mockResolvedValue({ ok: true, recordingSessionId: 'sess-1' })
})

describe('finalizeTake (web action) — it never throws', () => {
  it.each([
    ['the capability gate throws', () => requireCapability.mockRejectedValue(new Error('forbidden'))],
    ['identity resolution fails (core 503)', () => getBusinessId.mockRejectedValue(new Error('503'))],
    ['the shared body throws', () => finalizeTakeWithClient.mockRejectedValue(new Error('boom'))],
  ])('%s → a settled { error: failed }, never a rejection', async (_label, arrange) => {
    arrange()
    await expect(finalizeTake(input)).resolves.toEqual({ error: 'failed' })
  })

  it('a body that refuses is handed back verbatim — the caller branches on it', async () => {
    finalizeTakeWithClient.mockResolvedValue({ error: 'object_missing' } as never)
    await expect(finalizeTake(input)).resolves.toEqual({ error: 'object_missing' })
  })
})

describe('finalizeTake (web action) — the gate', () => {
  it('gates on records.write, and a denial reaches core with nothing', async () => {
    requireCapability.mockRejectedValue(new Error('forbidden'))
    await expect(finalizeTake(input)).resolves.toEqual({ error: 'failed' })
    expect(requireCapability).toHaveBeenCalledWith('records.write')
    expect(newSynqedClient).not.toHaveBeenCalled()
    expect(finalizeTakeWithClient).not.toHaveBeenCalled()
  })
})

describe('finalizeTake (web action) — the identity is the SESSION’s, never the caller’s', () => {
  it('the happy path returns the shared body’s answer', async () => {
    await expect(finalizeTake(input)).resolves.toEqual({ ok: true, recordingSessionId: 'sess-1' })
    expect(finalizeTakeWithClient).toHaveBeenCalledTimes(1)
    // The argument rides through untouched — the ONE parse lives in the body.
    const [client, , passed] = finalizeTakeWithClient.mock.calls[0] as unknown as [unknown, unknown, unknown]
    expect(client).toBe(CLIENT)
    expect(passed).toEqual(input)
  })

  it('the client and the actor carry the cookie’s business and staff', async () => {
    await finalizeTake(input)
    expect(newSynqedClient).toHaveBeenCalledWith('biz-1')
    expect(actorPassed()).toMatchObject({ staffId: 'staff-1', businessId: 'biz-1', source: 'web' })
  })

  it('the store comes from resolveStoreScope — the store a MINTED row lands in', async () => {
    await finalizeTake(input)
    expect(actorPassed().storeId).toBe('store-9')
  })

  it('a clamped staffer with no resolvable store still reaches the body with null', async () => {
    resolveStoreScope.mockResolvedValue({ storeId: null })
    await finalizeTake(input)
    expect(actorPassed().storeId).toBeNull()
  })

  it.each([
    ['an owner holding recordings.viewAll', ['records.write', 'recordings.viewAll'], true],
    ['a practitioner without it', ['records.write'], false],
  ])('canViewAll follows the capability set: %s', async (_label, caps, expected) => {
    getMyCapabilities.mockResolvedValue(new Set(caps))
    await finalizeTake(input)
    expect(actorPassed().canViewAll).toBe(expected)
  })
})
