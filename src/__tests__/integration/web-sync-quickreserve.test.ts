// Web 今すぐ同期 route capability + audit parity with its facade twin
// (src/app/api/app/v1/sync/run/route.ts, see app-api-sync-run.test.ts).
// Before this fix ANY signed-in staff could trigger a business-wide
// QuickReserve sync — no capability check, no audit row. Contract §3.1,
// packet PR-M2.
//
// getBusinessId() stays the FIRST gate (anon → 401, exact current shape);
// sync.view is checked only once a session exists, mirroring the facade's
// gate. auditWeb mocked directly (not the console-line auditLines helper) —
// this suite only needs to assert WHICH calls happen, not the sink shape.

jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(),
}))

const capabilities = { current: new Set<string>() }
jest.mock('@/lib/auth/require-permission', () => ({
  getMyCapabilities: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))

const runNow = jest.fn()
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ sync: { runNow } })),
}))

const auditWeb = jest.fn()
jest.mock('@/lib/audit-web', () => ({ auditWeb: (...a: unknown[]) => auditWeb(...(a as [])) }))

import { POST } from '@/app/api/sync/quickreserve/route'
import { getBusinessId } from '@/lib/staff'
import { getMyCapabilities } from '@/lib/auth/require-permission'

const getBusinessIdMock = getBusinessId as jest.Mock
const getMyCapabilitiesMock = getMyCapabilities as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['sync.view'])
  getBusinessIdMock.mockResolvedValue('business-1')
  runNow.mockResolvedValue({
    created: 2,
    updated: 3,
    cancelled: 1,
    skipped_no_staff: 1,
    skipped_deleted: 1,
    duration_ms: 1234,
  })
})

describe('POST /api/sync/quickreserve — capability gate + audit parity', () => {
  it('no sync.view grant → 403 {error:{code:"forbidden"}}, runNow never called, no audit emit', async () => {
    capabilities.current = new Set(['customers.view'])
    const res = await POST()
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toMatchObject({ error: { code: 'forbidden' } })
    expect(runNow).not.toHaveBeenCalled()
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('granted, sync succeeds → 200 success spread + folded skipped, exactly one audit row', async () => {
    const res = await POST()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      success: true,
      created: 2,
      updated: 3,
      cancelled: 1,
      skipped: 2, // skipped_no_staff (1) + skipped_deleted (1)
      duration_ms: 1234,
    })
    expect(runNow).toHaveBeenCalledWith('QUICKRESERVE')
    expect(auditWeb).toHaveBeenCalledTimes(1)
    expect(auditWeb).toHaveBeenCalledWith({
      category: 'settings',
      action: 'settings.sync_run_now',
      targetType: 'business',
    })
  })

  it('not-configured upstream error → friendly 200, audit row still emits (facade 2xx parity)', async () => {
    runNow.mockRejectedValueOnce(new Error('config not found for business'))
    const res = await POST()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toMatch(/QR sync not configured/)
    expect(auditWeb).toHaveBeenCalledTimes(1)
  })

  it('other upstream failure → 502, no audit emit', async () => {
    runNow.mockRejectedValueOnce(new Error('QuickReserve login expired'))
    const res = await POST()
    expect(res.status).toBe(502)
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('anon (getBusinessId throws) → 401, no capability check reached, no audit', async () => {
    getBusinessIdMock.mockRejectedValueOnce(new Error('no session'))
    const res = await POST()
    expect(res.status).toBe(401)
    expect(runNow).not.toHaveBeenCalled()
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('401 body is the flat legacy shape, byte-exact', async () => {
    getBusinessIdMock.mockRejectedValueOnce(new Error('no session'))
    const res = await POST()
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('order pin: anon AND capability-denied together still resolve as 401 with getMyCapabilities never called — kills the order-swap mutant', async () => {
    getBusinessIdMock.mockRejectedValueOnce(new Error('no session'))
    capabilities.current = new Set()
    const res = await POST()
    expect(res.status).toBe(401)
    expect(getMyCapabilitiesMock).not.toHaveBeenCalled()
    expect(runNow).not.toHaveBeenCalled()
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('infra failure resolving capabilities → 500 {error:{code:"internal"}}, never 403; runNow/audit untouched', async () => {
    getMyCapabilitiesMock.mockRejectedValueOnce(new Error('capability service unreachable'))
    const res = await POST()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toMatchObject({ error: { code: 'internal' } })
    expect(runNow).not.toHaveBeenCalled()
    expect(auditWeb).not.toHaveBeenCalled()
  })
})
