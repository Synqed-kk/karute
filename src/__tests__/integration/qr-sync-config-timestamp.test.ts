/**
 * QR-sync status timestamp: the config GET must return last_run_at as a RAW
 * ISO instant — the client formats it in the device's timezone. The old route
 * baked toLocaleString() into lastStatus on the server, which rendered
 * UTC/en-US dates on JST phones ("7/17/2026, 4:56:08 PM" at 01:56 JST 7/18).
 */

jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn().mockResolvedValue('biz-A'),
  resolveUserId: jest.fn().mockResolvedValue('user-1'),
}))
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn() }))

// PR-M2 fix round: config now carries the same sync.view capability gate as
// the sibling run-now route. Default-granted here so every pre-existing test
// below (which predates the gate) keeps exercising exactly what it tested;
// the dedicated "capability gate" describe block below flips it off.
const capabilities = { current: new Set<string>(['sync.view']) }
jest.mock('@/lib/auth/require-permission', () => ({
  getMyCapabilities: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))

import { GET, POST } from '@/app/api/sync/quickreserve/config/route'
import { auditLines } from './helpers/audit-lines'

const client = jest.requireMock('@/lib/synqed/client') as { getSynqedClient: jest.Mock }

// Runs before every test in this file (outer beforeEach fires before each
// describe's own jest.clearAllMocks()) — keeps the grant at its default
// regardless of what an earlier test in the "capability gate" block below
// left it at.
beforeEach(() => {
  capabilities.current = new Set(['sync.view'])
})

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

describe('quickreserve config POST — audit writer (wave A part 3)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('a saved config emits settings.sync_config_update with flags only — never the credentials', async () => {
    const upsertConfig = jest.fn(async () => ({}))
    client.getSynqedClient.mockResolvedValue({ sync: { upsertConfig } })
    const req = new Request('https://app.test/api/sync/quickreserve/config', {
      method: 'POST',
      body: JSON.stringify({ username: 'velune', password: 'hunter2', enabled: true }),
    })
    const lines = await auditLines(async () => {
      expect((await POST(req)).status).toBe(200)
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      category: 'settings',
      action: 'settings.sync_config_update',
      severity: 'notice',
      business_id: 'biz-A',
      detail: { enabled: true, password_changed: true },
    })
    expect(JSON.stringify(lines[0])).not.toContain('hunter2')
    expect(JSON.stringify(lines[0])).not.toContain('velune')
  })

  it('a failed core write emits nothing', async () => {
    client.getSynqedClient.mockResolvedValue({
      sync: { upsertConfig: jest.fn(async () => { throw new Error('core down') }) },
    })
    const req = new Request('https://app.test/api/sync/quickreserve/config', {
      method: 'POST',
      body: JSON.stringify({ username: 'velune', enabled: false }),
    })
    const lines = await auditLines(async () => {
      expect((await POST(req)).status).toBe(502)
    })
    expect(lines).toHaveLength(0)
  })
})

// PR-M2 fix round, blind-round finding #1 (BLOCKER): before this fix, ANY
// signed-in staff could read the QR username (GET) or rewrite credentials /
// flip enabled (POST) — no capability check at all. Same gate + error
// classification as the sibling run-now route.
describe('quickreserve config — capability gate (PR-M2 fix round)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    client.getSynqedClient.mockResolvedValue({
      sync: {
        getConfig: jest.fn().mockResolvedValue(null),
        upsertConfig: jest.fn().mockResolvedValue({}),
      },
    })
  })

  it('GET without sync.view → 403 {error:{code:"forbidden"}}, core never touched', async () => {
    capabilities.current = new Set(['customers.view'])
    const res = await GET()
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toMatchObject({ error: { code: 'forbidden' } })
    expect(client.getSynqedClient).not.toHaveBeenCalled()
  })

  it('POST without sync.view → 403, core never touched, no audit emit', async () => {
    capabilities.current = new Set(['customers.view'])
    const req = new Request('https://app.test/api/sync/quickreserve/config', {
      method: 'POST',
      body: JSON.stringify({ username: 'velune', password: 'hunter2', enabled: true }),
    })
    const lines = await auditLines(async () => {
      const res = await POST(req)
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body).toMatchObject({ error: { code: 'forbidden' } })
    })
    expect(client.getSynqedClient).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('anon (getBusinessId throws) → 401, capability never checked', async () => {
    const { getBusinessId } = jest.requireMock('@/lib/staff') as { getBusinessId: jest.Mock }
    const { getMyCapabilities } = jest.requireMock('@/lib/auth/require-permission') as {
      getMyCapabilities: jest.Mock
    }
    getBusinessId.mockRejectedValueOnce(new Error('no session'))
    const res = await GET()
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'Unauthorized' })
    expect(getMyCapabilities).not.toHaveBeenCalled()
  })
})
