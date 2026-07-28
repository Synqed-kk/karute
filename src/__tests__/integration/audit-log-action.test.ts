/**
 * 監査ログ viewer read path (actions/audit-log.ts, fix-plan P1-D).
 *
 * Contracts under test:
 *  - audit.view is enforced server-side (the tab filter is only exposure
 *    reduction) — denial returns {ok:false,'forbidden'} and never hits core.
 *  - Default feed hides view-kind events (.view / _view suffix); the
 *    includeViews toggle opts them in.
 *  - Every invocation writes its own privacy.audit_log.view row — page 1,
 *    paging, and filtered calls alike (contract §3.1, PR-M1: per-invocation,
 *    not per-open — logOpen is gone, the server no longer trusts a client
 *    flag to decide whether a read gets disclosed).
 *  - The per-customer deep-link scopes the query to that customer.
 */

jest.mock('@/lib/auth/require-permission', () => ({
  getMyCapabilities: jest.fn(async () => new Set<string>()),
  ensureCapability: (caps: Set<string>, cap: string) => {
    if (!caps.has(cap)) throw new Error('forbidden: ' + cap)
  },
}))
jest.mock('@/lib/synqed/client', () => ({
  // Placeholder only — jest hoists this factory above the
  // ThisSensitiveAuditClient class declared further down this file, so it
  // can't build a real this-sensitive mock here. Every test overrides this
  // via the top-level beforeEach's newSynqedClient.mockImplementation(...)
  // before it's ever read, so this initial value is never actually
  // exercised; kept as an inert empty object rather than a `{ list }`
  // literal so it can't be mistaken for the forbidden shape the class
  // comment below warns against.
  newSynqedClient: jest.fn(() => ({})),
}))
jest.mock('@/lib/audit', () => ({ audit: jest.fn() }))
jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
  getBusinessId: jest.fn(async () => 'biz-1'),
}))

import { listAuditLog, listAuditLogWithClient } from '@/actions/audit-log'
import { getMyCapabilities as getMyCapabilitiesImport } from '@/lib/auth/require-permission'
import { newSynqedClient as newSynqedClientImport } from '@/lib/synqed/client'
import { audit as auditImport } from '@/lib/audit'
import { getBusinessId as getBusinessIdImport } from '@/lib/staff'

const getMyCapabilities = getMyCapabilitiesImport as jest.Mock
const newSynqedClient = newSynqedClientImport as unknown as jest.Mock
const getBusinessId = getBusinessIdImport as unknown as jest.Mock
const audit = auditImport as jest.Mock

const list = jest.fn()

/** Mirrors the real SDK: AuditClient.list is a PROTOTYPE method that reads
 *  `this` — so a bare method extraction breaks here exactly like it does in
 *  prod (the silently-dead-probes bug this fidelity upgrade pins against).
 *  Every mock client below MUST build audit via this class, never a plain
 *  `{ list }` literal. */
class ThisSensitiveAuditClient {
  constructor(private impl: jest.Mock) {}
  // async like the real method: an unbound call REJECTS (caught by the
  // probes' .catch → null totals), it never throws synchronously.
  async list(q: unknown) {
    return this.impl(q)
  }
}
const mockAudit = () => new ThisSensitiveAuditClient(list)

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
  newSynqedClient.mockImplementation(() => ({ audit: mockAudit() }))
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
    newSynqedClient.mockImplementation(() => {
      throw new Error('no session')
    })
    await expect(listAuditLog({})).resolves.toEqual({ ok: false, error: 'failed' })
  })

  // Blind-round security find (M1 ledger #8): businessId is resolved ONCE and
  // feeds both the client and the audit row — a resolve failure must fail the
  // whole read CLOSED (no client built, no core read, no row), never proceed
  // to a read whose durable row would silently skip on a null businessId.
  it('getBusinessId failure fails closed: failed envelope, no core read, no audit row', async () => {
    getBusinessId.mockImplementationOnce(async () => {
      throw new Error('session gone')
    })
    await expect(listAuditLog({})).resolves.toEqual({ ok: false, error: 'failed' })
    expect(newSynqedClient).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })
})

describe('listAuditLog — every invocation logs its own privacy.audit_log.view row (contract §3.1)', () => {
  it('a plain call writes exactly one row', async () => {
    await listAuditLog({})
    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'privacy',
        action: 'privacy.audit_log.view',
        actorId: 'staff-1',
        businessId: 'biz-1',
        source: 'web',
      }),
    )
  })

  it('a filter click and a paging call each write their OWN row too — per-invocation, not per-open', async () => {
    audit.mockClear()
    await listAuditLog({ category: 'staff' })
    await listAuditLog({ page: 2 })
    expect(audit).toHaveBeenCalledTimes(2)
  })
})

describe('listAuditLog — per-customer deep-link', () => {
  it('scopes the core query to the customer and stamps the open row', async () => {
    await listAuditLog({ targetId: 'cus-9', includeViews: true })
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

  it('警告 exact per view state: views hidden → nvWarn + nvCrit (matches the visible feed); views shown → warnAll + critAll', async () => {
    mockProbes()
    const hidden = await listAuditLog({})
    if (!hidden.ok) throw new Error('expected ok')
    expect(hidden.warningsTotal).toBe(3 + 2)

    mockProbes()
    const shown = await listAuditLog({ includeViews: true })
    if (!shown.ok) throw new Error('expected ok')
    expect(shown.warningsTotal).toBe(8 + 4)
  })

  it('変更 exact (Wave V restore): nvAll − nvWarn − nvCrit, identical in both view-toggle states — views are never 変更', async () => {
    mockProbes()
    const hidden = await listAuditLog({})
    if (!hidden.ok) throw new Error('expected ok')
    expect(hidden.changesTotal).toBe(20 - 3 - 2)
    // The bare exclude_views probe (no severity) is back — 5 strip probes +
    // break-glass = 6 page_size:1 calls.
    const probeCalls = list.mock.calls.filter(
      ([opts]) => (opts as { page_size?: number }).page_size === 1,
    )
    expect(probeCalls).toHaveLength(6)

    mockProbes()
    const shown = await listAuditLog({ includeViews: true })
    if (!shown.ok) throw new Error('expected ok')
    expect(shown.changesTotal).toBe(20 - 3 - 2)
  })

  it('変更 clamps at 0 — the three probes are independent reads, a row landing between them must not render a negative count', async () => {
    list.mockImplementation(async (opts: {
      page_size?: number
      break_glass?: boolean
      severity?: string
      exclude_views?: boolean
    }) => {
      if (opts.page_size === 100) return { events: [coreEvent()], total: 999, page: 1, page_size: 100 }
      if (opts.break_glass) return { events: [], total: 0, page: 1, page_size: 1 }
      if (opts.exclude_views && opts.severity === 'warn') return { events: [], total: 3, page: 1, page_size: 1 }
      if (opts.exclude_views && opts.severity === 'critical') return { events: [], total: 2, page: 1, page_size: 1 }
      if (opts.exclude_views) return { events: [], total: 4, page: 1, page_size: 1 } // nvAll < nvWarn + nvCrit
      return { events: [], total: 0, page: 1, page_size: 1 }
    })
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.changesTotal).toBe(0)
  })

  it('BELT: a HISTORICAL privacy.audit_log_view row (pre-respell spelling core cannot exclude) is still hidden from the default feed', async () => {
    list.mockImplementation(async (opts: { page_size?: number }) => {
      if (opts.page_size === 100)
        return {
          events: [
            coreEvent(),
            { ...coreEvent(), id: 'evt-open', action: 'privacy.audit_log_view' },
          ],
          total: 2,
          page: 1,
          page_size: 100,
        }
      return { events: [], total: 0, page: 1, page_size: 1 }
    })
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.events.map((e) => e.id)).not.toContain('evt-open')

    // includeViews keeps it — the belt only guards the default state.
    const shown = await listAuditLog({ includeViews: true })
    if (!shown.ok) throw new Error('expected ok')
    expect(shown.events.map((e) => e.id)).toContain('evt-open')
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

  it('the write path fires once regardless of how many strip probes ran', async () => {
    mockProbes()
    await listAuditLog({})
    expect(audit).toHaveBeenCalledTimes(1)
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
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      customers: { list: customersList },
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.targetLabels).toEqual({ 'cus-1': '鈴木 一郎' })
    expect(customersList).toHaveBeenCalledTimes(1)
    expect(customersList).toHaveBeenCalledWith({ ids: ['cus-1'], include_deleted: true })
  })

  it('a failed lookup degrades to empty labels — the feed never fails', async () => {
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      customers: { list: jest.fn(async () => { throw new Error('core down') }) },
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.targetLabels).toEqual({})
    expect(res.events).toHaveLength(1)
  })

  it('a karute row resolves its CUSTOMER label off detail.customer_id, keyed by the karute target_id (packet 30 §4)', async () => {
    const customersList = jest.fn(async () => ({
      customers: [{ id: 'cus-1', name: '鈴木 一郎' }],
    }))
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      customers: { list: customersList },
    }))
    list.mockImplementation(async () => ({
      events: [
        coreEvent({
          id: 'evt-kar',
          category: 'karute',
          action: 'karute.save',
          target_type: 'karute',
          target_id: 'kar-1',
          detail: { customer_id: 'cus-1' },
        }),
      ],
      total: 1,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    // Batched into ONE customers.list call, not a second query.
    expect(customersList).toHaveBeenCalledTimes(1)
    expect(customersList).toHaveBeenCalledWith({ ids: ['cus-1'], include_deleted: true })
    expect(res.targetLabels).toEqual({ 'kar-1': '鈴木 一郎' })
  })

  it('a karute row WITHOUT detail.customer_id resolves no label — id fallback stays honest, no crash', async () => {
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      customers: { list: jest.fn(async () => ({ customers: [] })) },
    }))
    list.mockImplementation(async () => ({
      events: [
        coreEvent({
          id: 'evt-kar2',
          category: 'karute',
          action: 'karute.save',
          target_type: 'karute',
          target_id: 'kar-2',
          detail: {},
        }),
      ],
      total: 1,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.targetLabels).toEqual({})
  })

  it('resolves staff targets in BOTH id spaces (synqed staff.id + linked profiles.id) incl. deactivated staff — one unfiltered list call', async () => {
    const staffList = jest.fn(async () => ({
      staff: [
        // Deactivated (departed) staff — must still resolve, so the list call
        // must NOT filter on is_active.
        { id: 'syn-kita', user_id: 'prof-kita', name: '北野亮介', is_active: false },
        { id: 'syn-solo', user_id: null, name: '浜野', is_active: true },
      ],
      total: 2,
      page: 1,
      page_size: 200,
    }))
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      staff: { list: staffList },
    }))
    list.mockImplementation(async () => ({
      events: [
        // Pre-signup row: stamped with the synqed-core staff id (the 7/28
        // field find — rendered as a raw UUID before this fix).
        coreEvent({ id: 'e-syn', category: 'staff', action: 'staff.update', target_type: 'staff', target_id: 'syn-kita' }),
        // Post-signup row: same person, stamped with the profiles.id — the
        // user_id link resolves it.
        coreEvent({ id: 'e-prof', category: 'staff', action: 'staff.update', target_type: 'staff', target_id: 'prof-kita' }),
        coreEvent({ id: 'e-solo', category: 'staff', action: 'staff.update', target_type: 'staff', target_id: 'syn-solo' }),
      ],
      total: 3,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(staffList).toHaveBeenCalledTimes(1)
    expect(staffList).toHaveBeenCalledWith({ page: 1, page_size: 200 })
    expect(res.targetLabels).toEqual({
      'syn-kita': '北野亮介',
      'prof-kita': '北野亮介',
      'syn-solo': '浜野',
    })
  })

  it('walks staff pages past the 200 cap — a >200-staff business still resolves late-page targets (Greptile #639)', async () => {
    // 201 staff: page 1 full, the target on page 2.
    const filler = Array.from({ length: 200 }, (_, i) => ({
      id: `syn-${i}`,
      user_id: null,
      name: `staff ${i}`,
      is_active: true,
    }))
    const staffList = jest.fn(async ({ page }: { page: number }) => ({
      staff: page === 1 ? filler : [{ id: 'syn-late', user_id: null, name: '201人目', is_active: true }],
      total: 201,
      page,
      page_size: 200,
    }))
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      staff: { list: staffList },
    }))
    list.mockImplementation(async () => ({
      events: [
        coreEvent({ id: 'e-late', category: 'staff', action: 'staff.update', target_type: 'staff', target_id: 'syn-late' }),
      ],
      total: 1,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(staffList).toHaveBeenCalledTimes(2)
    expect(res.targetLabels['syn-late']).toBe('201人目')
  })

  it('no staff-target rows on the page → staff.list is never queried', async () => {
    const staffList = jest.fn(async () => ({ staff: [] }))
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      customers: { list: jest.fn(async () => ({ customers: [] })) },
      staff: { list: staffList },
    }))
    const res = await listAuditLog({}) // default coreEvent targets a customer
    if (!res.ok) throw new Error('expected ok')
    expect(staffList).not.toHaveBeenCalled()
  })

  it('a failed staff lookup degrades to ids for staff only — other labels survive, the feed never fails', async () => {
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      customers: { list: jest.fn(async () => ({ customers: [{ id: 'cus-1', name: '鈴木 一郎' }] })) },
      staff: { list: jest.fn(async () => { throw new Error('core down') }) },
    }))
    list.mockImplementation(async () => ({
      events: [
        coreEvent(),
        coreEvent({ id: 'e-stf', category: 'staff', action: 'staff.update', target_type: 'staff', target_id: 'syn-kita' }),
      ],
      total: 2,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.events).toHaveLength(2)
    expect(res.targetLabels).toEqual({ 'cus-1': '鈴木 一郎' })
  })
})

describe('listAuditLogWithClient — per-invocation privacy.audit_log.view (contract §3.1, PR-M1)', () => {
  // Direct calls against the twin — a minimal synqed client (audit only, same
  // ThisSensitiveAuditClient fidelity as every test above) and a manual actor,
  // bypassing the wrapper's cookie/roster resolution entirely.
  const actor = { staffId: 'staff-9', businessId: 'biz-9', source: 'web' as const }
  const fakeSynqed = () => ({ audit: mockAudit() }) as any // eslint-disable-line @typescript-eslint/no-explicit-any -- minimal test double, same idiom as the file under test's own `synqed as any`

  it('① a call with no special flag writes exactly one privacy.audit_log.view row', async () => {
    const res = await listAuditLogWithClient(fakeSynqed(), actor, {})
    expect(res.ok).toBe(true)
    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'privacy',
        action: 'privacy.audit_log.view',
        actorId: 'staff-9',
        actorType: 'staff',
        businessId: 'biz-9',
        source: 'web',
      }),
    )
  })

  it('② a paging call (page 2) and a filtered call EACH write their own row', async () => {
    await listAuditLogWithClient(fakeSynqed(), actor, { page: 2 })
    expect(audit).toHaveBeenCalledTimes(1)

    audit.mockClear()
    await listAuditLogWithClient(fakeSynqed(), actor, { category: 'staff' })
    expect(audit).toHaveBeenCalledTimes(1)
  })

  it('③ a failed core read writes NO row and returns the failed envelope', async () => {
    list.mockImplementation(async () => {
      throw new Error('core down')
    })
    const res = await listAuditLogWithClient(fakeSynqed(), actor, {})
    expect(res).toEqual({ ok: false, error: 'failed' })
    expect(audit).not.toHaveBeenCalled()
  })
})
