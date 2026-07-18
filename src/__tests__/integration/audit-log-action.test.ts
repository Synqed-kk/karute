/**
 * 監査ログ viewer read path (actions/audit-log.ts, fix-plan P1-D).
 *
 * Contracts under test:
 *  - audit.view is enforced server-side (the tab filter is only exposure
 *    reduction) — denial returns {ok:false,'forbidden'} and never hits core.
 *  - Default feed hides view-kind events (.view / _view suffix); the
 *    includeViews toggle opts them in.
 *  - Opening the log writes its own privacy.audit_log_view row — page 1 only.
 *  - The per-customer deep-link scopes the query to that customer.
 */

jest.mock('@/lib/auth/require-permission', () => ({
  getMyCapabilities: jest.fn(async () => new Set<string>()),
  ensureCapability: (caps: Set<string>, cap: string) => {
    if (!caps.has(cap)) throw new Error('forbidden: ' + cap)
  },
}))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ audit: { list: jest.fn() } })),
}))
jest.mock('@/lib/audit', () => ({ audit: jest.fn() }))
jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
  getBusinessId: jest.fn(async () => 'biz-1'),
}))

import { listAuditLog } from '@/actions/audit-log'
import { getMyCapabilities as getMyCapabilitiesImport } from '@/lib/auth/require-permission'
import { getSynqedClient as getSynqedClientImport } from '@/lib/synqed/client'
import { audit as auditImport } from '@/lib/audit'

const getMyCapabilities = getMyCapabilitiesImport as jest.Mock
const getSynqedClient = getSynqedClientImport as unknown as jest.Mock
const audit = auditImport as jest.Mock

const list = jest.fn()

function coreEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    at: '2026-07-18T00:00:00.000Z',
    actor_id: 'staff-1',
    actor_type: 'staff',
    category: 'customer',
    action: 'customer.edit',
    target_type: 'customer',
    target_id: 'cus-1',
    target_label: null,
    detail: null,
    break_glass: false,
    severity: 'info',
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  getMyCapabilities.mockImplementation(async () => new Set(['audit.view']))
  getSynqedClient.mockImplementation(async () => ({ audit: { list } }))
  list.mockImplementation(async () => ({
    events: [coreEvent()],
    total: 1,
    page: 1,
    page_size: 100,
  }))
})

describe('listAuditLog — authz', () => {
  it('denies without audit.view and never queries core', async () => {
    getMyCapabilities.mockImplementation(async () => new Set(['customers.view']))
    const res = await listAuditLog({})
    expect(res).toEqual({ ok: false, error: 'forbidden' })
    expect(list).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })
})

describe('listAuditLog — feed', () => {
  it('default feed hides view-kind events; includeViews opts them in', async () => {
    list.mockImplementation(async () => ({
      events: [
        coreEvent({ id: 'e1', action: 'customer.view' }),
        coreEvent({ id: 'e2', action: 'customer.edit' }),
        coreEvent({ id: 'e3', action: 'privacy.audit_log_view' }),
      ],
      total: 3,
      page: 1,
      page_size: 100,
    }))

    const hidden = await listAuditLog({})
    if (!hidden.ok) throw new Error('expected ok')
    expect(hidden.events.map((e) => e.id)).toEqual(['e2'])

    const shown = await listAuditLog({ includeViews: true })
    if (!shown.ok) throw new Error('expected ok')
    expect(shown.events.map((e) => e.id)).toEqual(['e1', 'e2', 'e3'])
  })

  it('hasMore follows the unfiltered total', async () => {
    list.mockImplementation(async () => ({
      events: [coreEvent({ action: 'customer.view' })],
      total: 250,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.events).toEqual([]) // page filtered empty…
    expect(res.hasMore).toBe(true) // …but more unfiltered pages remain
  })

  it('core failure returns a safe error, never throws', async () => {
    list.mockImplementation(async () => {
      throw new Error('core down')
    })
    await expect(listAuditLog({})).resolves.toEqual({ ok: false, error: 'failed' })
  })
})

describe('listAuditLog — the log logs its own opens', () => {
  it('logOpen writes privacy.audit_log_view once; filter/page fetches do not', async () => {
    await listAuditLog({ logOpen: true })
    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'privacy',
        action: 'privacy.audit_log_view',
        actorId: 'staff-1',
        businessId: 'biz-1',
        source: 'web',
      }),
    )

    audit.mockClear()
    // The section clears logOpen after its first fetch — same open, no row.
    await listAuditLog({ category: 'staff' })
    await listAuditLog({ page: 2 })
    expect(audit).not.toHaveBeenCalled()
  })
})

describe('listAuditLog — per-customer deep-link', () => {
  it('scopes the core query to the customer and stamps the open row', async () => {
    await listAuditLog({ targetId: 'cus-9', includeViews: true, logOpen: true })
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ target_type: 'customer', target_id: 'cus-9' }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ targetType: 'customer', targetId: 'cus-9' }),
    )
  })
})

describe('listAuditLog — person filter (§10 cause-based, raw events only)', () => {
  it('passes actorId as actor_id on the feed and SKIPS the strip query (I7: no per-staff counts)', async () => {
    const res = await listAuditLog({ actorId: 'staff-7' })
    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ actor_id: 'staff-7' }))
    if (!res.ok) throw new Error('expected ok')
    expect(res.breakGlassTotal).toBeNull()
  })
})

describe('listAuditLog — summary strip count', () => {
  it('breakGlassTotal comes from a dedicated break_glass=true page_size=1 query', async () => {
    list.mockImplementation(async (opts: { break_glass?: boolean }) =>
      opts.break_glass
        ? { events: [], total: 3, page: 1, page_size: 1 }
        : { events: [coreEvent()], total: 40, page: 1, page_size: 100 },
    )
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.breakGlassTotal).toBe(3)
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ break_glass: true, page_size: 1 }),
    )
  })

  it('with the break-glass filter ON, the main total IS the count — one query only', async () => {
    list.mockImplementation(async () => ({
      events: [coreEvent({ break_glass: true })],
      total: 5,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({ breakGlass: true })
    if (!res.ok) throw new Error('expected ok')
    expect(res.breakGlassTotal).toBe(5)
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('a failed strip query degrades to null — the feed itself survives', async () => {
    list.mockImplementation(async (opts: { break_glass?: boolean }) => {
      if (opts.break_glass) throw new Error('rate limited')
      return { events: [coreEvent()], total: 1, page: 1, page_size: 100 }
    })
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.events).toHaveLength(1)
    expect(res.breakGlassTotal).toBeNull()
  })
})

describe('listAuditLog — target name resolution (read-time join, PII stays out of rows)', () => {
  it('resolves customer targets in ONE batch call including soft-deleted', async () => {
    const customersList = jest.fn(async () => ({
      customers: [{ id: 'cus-1', name: '鈴木 一郎' }],
    }))
    getSynqedClient.mockImplementation(async () => ({
      audit: { list },
      customers: { list: customersList },
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.targetLabels).toEqual({ 'cus-1': '鈴木 一郎' })
    expect(customersList).toHaveBeenCalledTimes(1)
    expect(customersList).toHaveBeenCalledWith({ ids: ['cus-1'], include_deleted: true })
  })

  it('a failed lookup degrades to empty labels — the feed never fails', async () => {
    getSynqedClient.mockImplementation(async () => ({
      audit: { list },
      customers: { list: jest.fn(async () => { throw new Error('core down') }) },
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.targetLabels).toEqual({})
    expect(res.events).toHaveLength(1)
  })
})
