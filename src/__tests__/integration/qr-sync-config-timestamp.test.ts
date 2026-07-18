/**
 * QR-sync status timestamp: the config GET must return last_run_at as a RAW
 * ISO instant — the client formats it in the device's timezone. The old route
 * baked toLocaleString() into lastStatus on the server, which rendered
 * UTC/en-US dates on JST phones ("7/17/2026, 4:56:08 PM" at 01:56 JST 7/18).
 */

jest.mock('@/lib/staff', () => ({ getBusinessId: jest.fn().mockResolvedValue('biz-A') }))
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn() }))

import { GET } from '@/app/api/sync/quickreserve/config/route'

const client = jest.requireMock('@/lib/synqed/client') as { getSynqedClient: jest.Mock }

function mockConfig(config: Record<string, unknown> | null) {
  client.getSynqedClient.mockResolvedValue({
    sync: { getConfig: jest.fn().mockResolvedValue(config) },
  })
}

describe('quickreserve config GET — timestamp stays a raw instant', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns lastRunAt as the untouched ISO string and lastStatus without a baked date', async () => {
    mockConfig({
      username: 'velune',
      enabled: true,
      last_run_status: 'OK',
      last_run_error: null,
      last_run_at: '2026-07-17T16:56:08.000Z',
    })
    const body = await (await GET()).json()
    expect(body.lastRunAt).toBe('2026-07-17T16:56:08.000Z')
    expect(body.lastStatus).toBe('OK')
  })

  it('folds the error text into lastStatus; missing run time is null, not "never"', async () => {
    mockConfig({
      username: 'velune',
      enabled: true,
      last_run_status: 'ERROR',
      last_run_error: 'login failed',
      last_run_at: null,
    })
    const body = await (await GET()).json()
    expect(body.lastStatus).toBe('ERROR: login failed')
    expect(body.lastRunAt).toBeNull()
  })
})
