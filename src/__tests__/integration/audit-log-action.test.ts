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
  // The main feed call is the only `list` invocation with page_size:100 — the
  // break-glass probe and T1's five strip-count probes all use page_size:1.
  function mainFeedCall() {
    const call = list.mock.calls.find(([opts]) => (opts as { page_size?: number }).page_size === 100)
    if (!call) throw new Error('expected a page_size:100 call')
    return call[0] as { exclude_views?: boolean }
  }

  it('passes exclude_views to core by default; includeViews omits it — core does the filtering now, no client re-filter either way (T2)', async () => {
    list.mockImplementation(async (opts: { exclude_views?: boolean }) => ({
      events: opts.exclude_views
        ? [coreEvent({ id: 'e2', action: 'customer.edit' })]
        : [
            coreEvent({ id: 'e1', action: 'customer.view' }),
            coreEvent({ id: 'e2', action: 'customer.edit' }),
            coreEvent({ id: 'e3', action: 'privacy.audit_log_view' }),
          ],
      total: opts.exclude_views ? 1 : 3,
      page: 1,
      page_size: 100,
    }))

    const hidden = await listAuditLog({})
    if (!hidden.ok) throw new Error('expected ok')
    // Server already excluded views — the action no longer re-filters, so
    // whatever core returned comes back verbatim.
    expect(hidden.events.map((e) => e.id)).toEqual(['e2'])
    expect(mainFeedCall().exclude_views).toBe(true)

    list.mockClear()
    const shown = await listAuditLog({ includeViews: true })
    if (!shown.ok) throw new Error('expected ok')
    expect(shown.events.map((e) => e.id)).toEqual(['e1', 'e2', 'e3'])
    expect(mainFeedCall().exclude_views).toBeUndefined()
  })

  it('hasMore follows res.total — exact now that core pre-filters views (T2), no client re-filter to distort the count', async () => {
    list.mockImplementation(async () => ({
      events: [coreEvent({ action: 'customer.edit' })],
      total: 250,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.events).toHaveLength(1) // events pass through verbatim
    expect(res.hasMore).toBe(true)
  })

  it('core failure returns a safe error, never throws', async () => {
    list.mockImplementation(async () => {
      throw new Error('core down')
    })
    await expect(listAuditLog({})).resolves.toEqual({ ok: false, error: 'failed' })
  })

  // Added at packet 17 §S3 (add-only — every pin above is untouched): the
  // twin extraction hoisted client construction out of the read's try; this
  // pins that a failed construction still resolves the 'failed' envelope.
  it('client-construction failure returns the same safe error, never throws', async () => {
    getSynqedClient.mockImplementation(async () => {
      throw new Error('no session')
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
    // ONE call total: I7 skips the break-glass probe AND all five T1
    // strip-count probes the same way — actorId scope means no aux queries.
    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ actor_id: 'staff-7' }))
    if (!res.ok) throw new Error('expected ok')
    expect(res.breakGlassTotal).toBeNull()
    expect(res.warningsTotal).toBeNull()
    expect(res.changesTotal).toBeNull()
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
    // breakGlass on skips the T1 probes too — the break-glass feed IS the
    // count strip then, same reasoning as I7.
    expect(list).toHaveBeenCalledTimes(1)
    expect(res.warningsTotal).toBeNull()
    expect(res.changesTotal).toBeNull()
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

describe('listAuditLog — T1 exact strip-count probes (severity/exclude_views)', () => {
  // Every probe is page_size:1 — only the main feed call uses page_size:100.
  function mockProbes() {
    list.mockImplementation(async (opts: {
      page_size?: number
      break_glass?: boolean
      severity?: string
      exclude_views?: boolean
    }) => {
      if (opts.page_size === 100) return { events: [coreEvent()], total: 999, page: 1, page_size: 100 }
      if (opts.break_glass) return { events: [], total: 0, page: 1, page_size: 1 }
      if (opts.exclude_views && opts.severity === 'warn') return { events: [], total: 3, page: 1, page_size: 1 } // nvWarn
      if (opts.exclude_views && opts.severity === 'critical') return { events: [], total: 2, page: 1, page_size: 1 } // nvCrit
      if (opts.exclude_views) return { events: [], total: 20, page: 1, page_size: 1 } // nvAll
      if (opts.severity === 'warn') return { events: [], total: 8, page: 1, page_size: 1 } // warnAll
      if (opts.severity === 'critical') return { events: [], total: 4, page: 1, page_size: 1 } // critAll
      throw new Error('unexpected probe call: ' + JSON.stringify(opts))
    })
  }

  it('warningsTotal = warnAll + critAll; changesTotal = nvAll - nvWarn - nvCrit (meaning preserved exactly)', async () => {
    mockProbes()
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.warningsTotal).toBe(8 + 4)
    expect(res.changesTotal).toBe(20 - 3 - 2)
  })

  it('ONE probe failing (nvCrit) nulls BOTH totals — never a partial sum, even though warnAll/critAll both succeeded', async () => {
    list.mockImplementation(async (opts: {
      page_size?: number
      break_glass?: boolean
      severity?: string
      exclude_views?: boolean
    }) => {
      if (opts.page_size === 100) return { events: [coreEvent()], total: 999, page: 1, page_size: 100 }
      if (opts.break_glass) return { events: [], total: 0, page: 1, page_size: 1 }
      if (opts.exclude_views && opts.severity === 'critical') throw new Error('rate limited') // nvCrit only
      return { events: [], total: 5, page: 1, page_size: 1 }
    })
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.warningsTotal).toBeNull() // warnAll+critAll both succeeded — still null
    expect(res.changesTotal).toBeNull()
  })

  it('probes carry the active category/from/to/target scope, same as the main feed', async () => {
    mockProbes()
    const res = await listAuditLog({ category: 'staff', from: '2026-01-01T00:00:00.000Z' })
    if (!res.ok) throw new Error('expected ok')
    const probeCalls = list.mock.calls.filter(([opts]) => (opts as { page_size?: number }).page_size === 1)
    expect(probeCalls.length).toBeGreaterThan(0)
    for (const [opts] of probeCalls) {
      expect(opts).toEqual(expect.objectContaining({ category: 'staff', from: '2026-01-01T00:00:00.000Z' }))
    }
  })

  it('probes never carry logOpen — only the main call writes the open row', async () => {
    mockProbes()
    await listAuditLog({ logOpen: true })
    expect(audit).toHaveBeenCalledTimes(1) // the write path, unrelated to probe params
    for (const [opts] of list.mock.calls) {
      expect(opts).not.toHaveProperty('logOpen')
    }
  })
})

describe('listAuditLog — T3 actor_label pass-through (SDK 1.14 write-time snapshot)', () => {
  it('actor_label rides the event through verbatim when core sends it', async () => {
    list.mockImplementation(async () => ({
      events: [coreEvent({ actor_label: '田中 美香' })],
      total: 1,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.events[0].actor_label).toBe('田中 美香')
  })

  it('an old cached response missing actor_label entirely does not crash the read', async () => {
    list.mockImplementation(async () => ({
      events: [coreEvent()], // coreEvent() never sets actor_label — key absent
      total: 1,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.events[0].actor_label).toBeUndefined()
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
