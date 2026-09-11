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

import {
  listAuditLog,
  listAuditLogWithClient,
  type AuditLogFilters,
} from '@/actions/audit-log'
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
  // PR B2 §4: the read gate is audit.view AND stores.viewAll now — the
  // default fixture carries both so every OTHER test in this file (feed
  // filtering, paging, the privacy row) keeps exercising what it always
  // tested. The authz describe block below overrides this per case.
  getMyCapabilities.mockImplementation(async () => new Set(['audit.view', 'stores.viewAll']))
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

  // PR B2 §4 (⚖ 8/17 STORE ISOLATION LAW): audit.view ALONE is no longer
  // enough — rows carry no store yet, so a branch-restricted audit.view
  // holder must not read every store's log.
  it('denies with audit.view but WITHOUT stores.viewAll (store isolation law) and never queries core', async () => {
    getMyCapabilities.mockImplementation(async () => new Set(['audit.view']))
    const res = await listAuditLog({})
    expect(res).toEqual({ ok: false, error: 'forbidden' })
    expect(list).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('allows with BOTH audit.view and stores.viewAll', async () => {
    getMyCapabilities.mockImplementation(async () => new Set(['audit.view', 'stores.viewAll']))
    const res = await listAuditLog({})
    expect(res.ok).toBe(true)
    expect(list).toHaveBeenCalled()
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
    expect(res.criticalTotal).toBeNull()
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
    expect(res.criticalTotal).toBeNull()
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

  it('警告/重大 exact per view state, counted SEPARATELY (G2, round-4): views hidden → nvWarn/nvCrit (matches the visible feed); views shown → warnAll/critAll', async () => {
    mockProbes()
    const hidden = await listAuditLog({})
    if (!hidden.ok) throw new Error('expected ok')
    expect(hidden.warningsTotal).toBe(3)
    expect(hidden.criticalTotal).toBe(2)

    mockProbes()
    const shown = await listAuditLog({ includeViews: true })
    if (!shown.ok) throw new Error('expected ok')
    expect(shown.warningsTotal).toBe(8)
    expect(shown.criticalTotal).toBe(4)
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

  it('ONE probe failing (nvCrit) nulls ALL THREE totals — never a partial read, even though warnAll/critAll both succeeded', async () => {
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
    expect(res.criticalTotal).toBeNull()
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
  // UUID-shaped (root-cause fix, 2026-08-29 packet): resolveTargetLabels only
  // batches UUID-shaped ids into customers.list (the same cast core's Prisma
  // findMany applies) — every id this describe block resolves successfully
  // has to be one; poison-tolerance itself is covered by the dedicated test
  // below.
  const CUS_1 = '00000000-0000-4000-8000-000000000001'
  const CUS_OLD = '00000000-0000-4000-8000-00000000001d'
  const CUS_LIVE = '00000000-0000-4000-8000-00000000001e'

  it('resolves customer targets in ONE batch call including soft-deleted', async () => {
    const customersList = jest.fn(async () => ({
      customers: [{ id: CUS_1, name: '鈴木 一郎' }],
    }))
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      customers: { list: customersList },
    }))
    list.mockImplementation(async () => ({
      events: [coreEvent({ target_id: CUS_1 })],
      total: 1,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.targetLabels).toEqual({ [CUS_1]: '鈴木 一郎' })
    expect(customersList).toHaveBeenCalledTimes(1)
    expect(customersList).toHaveBeenCalledWith({ ids: [CUS_1], include_deleted: true })
  })

  // Root-cause fix (2026-08-29 packet): thin/ports/actions.vite.ts's
  // MEMORY_ITEM_ID_SENTINEL ('-') fills the memory routes' decorative
  // customer segment, and logFacadeAudit used to stamp it verbatim — real
  // poisoned rows (target_type:'customer', target_id:'-') exist in prod
  // since 2026-08-18. Un-filtered, that id in the customers.list ids batch
  // 500'd core's WHOLE findMany (UUID cast), dropping every label on the
  // page — reproduced live this session. The mock below throws on ANY
  // non-UUID id, mirroring that cast exactly, so this red-runs genuinely red
  // without the UUID_RE filter.
  it("a poisoned target_id ('-') never reaches customers.list — that row stays unresolved, valid customer AND karute rows still resolve", async () => {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const customersList = jest.fn(async (q: { ids: string[] }) => {
      if (q.ids.some((id) => !UUID_RE.test(id))) {
        throw new Error('Error creating UUID, invalid group count: expected 5, found 2')
      }
      return { customers: [{ id: CUS_1, name: '鈴木 一郎' }] }
    })
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      customers: { list: customersList },
    }))
    list.mockImplementation(async () => ({
      events: [
        coreEvent({ id: 'evt-good', target_id: CUS_1 }),
        coreEvent({ id: 'evt-poison', action: 'customer.memory_delete', target_id: '-' }),
        coreEvent({
          id: 'evt-kar',
          category: 'karute',
          action: 'karute.save',
          target_type: 'karute',
          target_id: 'kar-1',
          detail: { customer_id: CUS_1 },
        }),
      ],
      total: 3,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    // Only the UUID-shaped id reaches the batch — never '-'.
    expect(customersList).toHaveBeenCalledWith({ ids: [CUS_1], include_deleted: true })
    expect(res.targetLabels).toEqual({ [CUS_1]: '鈴木 一郎', 'kar-1': '鈴木 一郎' })
    expect(res.targetLabels['-']).toBeUndefined()
  })

  it('a failed lookup degrades to empty labels — the feed never fails', async () => {
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      customers: { list: jest.fn(async () => { throw new Error('core down') }) },
    }))
    // UUID-shaped so the batch call actually happens (and actually throws) —
    // this test is pinning the CATCH branch, not the UUID filter's own guard.
    list.mockImplementation(async () => ({
      events: [coreEvent({ target_id: CUS_1 })],
      total: 1,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.targetLabels).toEqual({})
    expect(res.events).toHaveLength(1)
  })

  it('a karute row resolves its CUSTOMER label off detail.customer_id, keyed by the karute target_id (packet 30 §4)', async () => {
    const customersList = jest.fn(async () => ({
      customers: [{ id: CUS_1, name: '鈴木 一郎' }],
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
          detail: { customer_id: CUS_1 },
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
    expect(customersList).toHaveBeenCalledWith({ ids: [CUS_1], include_deleted: true })
    expect(res.targetLabels).toEqual({ 'kar-1': '鈴木 一郎' })
  })

  // 2026-07-29 field find (ぴあそん りえむ raw-UUID row): karute rows written
  // before customer_id rode in detail — the whole historical backlog — now
  // fall back to a bounded karuteRecords.get so old rows heal at read time.
  it('a karute row WITHOUT detail.customer_id heals via the record lookup (historical-row fallback)', async () => {
    const karGet = jest.fn(async (id: string) => ({ id, customer_id: CUS_OLD }))
    const customersList = jest.fn(async () => ({
      customers: [{ id: CUS_OLD, name: 'ぴあそん りえむ' }],
    }))
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      customers: { list: customersList },
      karuteRecords: { get: karGet },
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
    expect(karGet).toHaveBeenCalledTimes(1)
    // include_entries:false pinned — this lookup may only ever read
    // customer_id, never ship the clinical entry set (blind-round P2).
    expect(karGet).toHaveBeenCalledWith('kar-2', { include_entries: false })
    expect(customersList).toHaveBeenCalledWith({ ids: [CUS_OLD], include_deleted: true })
    expect(res.targetLabels).toEqual({ 'kar-2': 'ぴあそん りえむ' })
  })

  it('record lookup unavailable (no karuteRecords surface, a SYNC throw): id fallback stays honest, feed never crashes', async () => {
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

  it('record lookup REJECTS (deleted/cross-tenant karute): that id stays raw, siblings still resolve', async () => {
    const karGet = jest.fn(async (id: string) => {
      if (id === 'kar-dead') throw Object.assign(new Error('nope'), { status: 404 })
      return { id, customer_id: CUS_LIVE }
    })
    const customersList = jest.fn(async () => ({
      customers: [{ id: CUS_LIVE, name: '鈴木 一郎' }],
    }))
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      customers: { list: customersList },
      karuteRecords: { get: karGet },
    }))
    list.mockImplementation(async () => ({
      events: [
        coreEvent({
          id: 'evt-kar3',
          category: 'karute',
          action: 'karute.save',
          target_type: 'karute',
          target_id: 'kar-dead',
          detail: {},
        }),
        coreEvent({
          id: 'evt-kar4',
          category: 'karute',
          action: 'karute.save',
          target_type: 'karute',
          target_id: 'kar-live',
          detail: {},
        }),
      ],
      total: 2,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.targetLabels).toEqual({ 'kar-live': '鈴木 一郎' })
  })

  // Recording-labels fix (2026-08-25 packet): session_cleanup.ts hard-deletes
  // the recording_sessions row it audits, so detail.customer_id (stamped at
  // write time) is the only surviving context — same structural twin as the
  // karute branch test above, just target_type:'recording'.
  it("a recording row resolves its CUSTOMER label off detail.customer_id, keyed by the recording target_id, via the SHARED batch", async () => {
    const customersList = jest.fn(async () => ({
      customers: [{ id: CUS_1, name: '鈴木 一郎' }],
    }))
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      customers: { list: customersList },
    }))
    list.mockImplementation(async () => ({
      events: [
        coreEvent({
          id: 'evt-rec',
          category: 'recording',
          action: 'recording.session_cleanup',
          target_type: 'recording',
          target_id: 'sess-1',
          detail: { customer_id: CUS_1, had_audio_path: true, duration_seconds: 42 },
        }),
      ],
      total: 1,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    // ONE batch call for the whole page, not a per-row lookup.
    expect(customersList).toHaveBeenCalledTimes(1)
    expect(customersList).toHaveBeenCalledWith({ ids: [CUS_1], include_deleted: true })
    expect(res.targetLabels).toEqual({ 'sess-1': '鈴木 一郎' })
  })

  it('a recording row with no customer_id (or an unresolvable one) leaves target_id unresolved — honest state, no crash', async () => {
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      customers: { list: jest.fn(async () => ({ customers: [] })) },
    }))
    list.mockImplementation(async () => ({
      events: [
        coreEvent({
          id: 'evt-rec-none',
          category: 'recording',
          action: 'recording.session_cleanup',
          target_type: 'recording',
          target_id: 'sess-2',
          detail: { customer_id: null, had_audio_path: false, duration_seconds: null },
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

  // F3 (round-2 line-audit): #865 put staff_id into recording.capture_resumed's
  // detail — resolveTargetLabels must widen the SAME staff batch to include it
  // (same idiom as the customer_id widen two tests up), or a departed staffer
  // (not in the component's live roster, and no OTHER row on the page has
  // target_type:'staff' to trigger the batch) never resolves at all.
  it("a recording row's detail.staff_id resolves via the SAME staff batch, even with no target_type:'staff' row on the page (departed staffer)", async () => {
    const staffList = jest.fn(async () => ({
      staff: [{ id: 'staff-42', user_id: null, name: 'departed staffer', is_active: false }],
      total: 1,
      page: 1,
      page_size: 200,
    }))
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      customers: { list: jest.fn(async () => ({ customers: [] })) },
      staff: { list: staffList },
    }))
    list.mockImplementation(async () => ({
      events: [
        coreEvent({
          id: 'evt-rec-staff',
          category: 'recording',
          action: 'recording.capture_resumed',
          target_type: 'recording',
          target_id: 'sess-3',
          detail: { staff_id: 'staff-42', had_audio_path: true },
        }),
      ],
      total: 1,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    // ONE batch call for the whole page, not a per-row lookup.
    expect(staffList).toHaveBeenCalledTimes(1)
    expect(res.targetLabels['staff-42']).toBe('departed staffer')
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

  it('page count derives from the server total — no fixed cap leaves retained staff unresolvable (Greptile #639 r2)', async () => {
    // 2001 staff: the target sits on page 11, past any 10-page/2000 bound.
    const filler = (page: number) =>
      Array.from({ length: 200 }, (_, i) => ({
        id: `syn-${page}-${i}`,
        user_id: null,
        name: `staff ${page}-${i}`,
        is_active: true,
      }))
    const staffList = jest.fn(async ({ page }: { page: number }) => ({
      staff: page <= 10 ? filler(page) : [{ id: 'syn-2001', user_id: null, name: '2001人目', is_active: true }],
      total: 2001,
      page,
      page_size: 200,
    }))
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      staff: { list: staffList },
    }))
    list.mockImplementation(async () => ({
      events: [
        coreEvent({ id: 'e-2001', category: 'staff', action: 'staff.update', target_type: 'staff', target_id: 'syn-2001' }),
      ],
      total: 1,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(staffList).toHaveBeenCalledTimes(11) // ceil(2001/200)
    expect(res.targetLabels['syn-2001']).toBe('2001人目')
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
      customers: { list: jest.fn(async () => ({ customers: [{ id: CUS_1, name: '鈴木 一郎' }] })) },
      staff: { list: jest.fn(async () => { throw new Error('core down') }) },
    }))
    list.mockImplementation(async () => ({
      events: [
        coreEvent({ target_id: CUS_1 }),
        coreEvent({ id: 'e-stf', category: 'staff', action: 'staff.update', target_type: 'staff', target_id: 'syn-kita' }),
      ],
      total: 2,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.events).toHaveLength(2)
    expect(res.targetLabels).toEqual({ [CUS_1]: '鈴木 一郎' })
  })

  // stress-audit F5c (8/17, PACKET-AUDITUI-ALLOWLIST): 'menu' was a valid
  // targetType (src/lib/audit.ts:51) never resolved — menu rows showed a
  // bare UUID. Same unfiltered-list shape as the store branch: menus.list()
  // returns the WHOLE catalog including retired rows (listMenus's contract).
  it("resolves a settings.menu_update row's own target (target_type 'menu') to the menu's name", async () => {
    const menusList = jest.fn(async () => ({
      menus: [{ id: 'menu-1', name: 'カット', active: true }],
    }))
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      menus: { list: menusList },
    }))
    list.mockImplementation(async () => ({
      events: [
        coreEvent({
          id: 'e-menu',
          category: 'settings',
          action: 'settings.menu_update',
          target_type: 'menu',
          target_id: 'menu-1',
          detail: { duration_minutes_old: 60, duration_minutes_new: 90 },
        }),
      ],
      total: 1,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(menusList).toHaveBeenCalledTimes(1)
    expect(res.targetLabels).toEqual({ 'menu-1': 'カット' })
  })

  it('a retired menu still resolves (menus.list() returns the whole catalog, retired included)', async () => {
    const menusList = jest.fn(async () => ({
      menus: [{ id: 'menu-retired', name: '旧メニュー', active: false }],
    }))
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      menus: { list: menusList },
    }))
    list.mockImplementation(async () => ({
      events: [
        coreEvent({
          id: 'e-menu-r',
          category: 'settings',
          action: 'settings.menu_retire',
          target_type: 'menu',
          target_id: 'menu-retired',
          detail: null,
        }),
      ],
      total: 1,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.targetLabels).toEqual({ 'menu-retired': '旧メニュー' })
  })

  it('an unknown/deleted menu id falls back to the raw id — same honest-state fallback as customers/staff', async () => {
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      menus: { list: jest.fn(async () => ({ menus: [] })) },
    }))
    list.mockImplementation(async () => ({
      events: [
        coreEvent({
          id: 'e-menu-gone',
          category: 'settings',
          action: 'settings.menu_update',
          target_type: 'menu',
          target_id: 'menu-purged',
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

  it('no menu-target rows on the page → menus.list is never queried', async () => {
    const menusList = jest.fn(async () => ({ menus: [] }))
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      customers: { list: jest.fn(async () => ({ customers: [] })) },
      menus: { list: menusList },
    }))
    const res = await listAuditLog({}) // default coreEvent targets a customer, no detail store ids
    if (!res.ok) throw new Error('expected ok')
    expect(menusList).not.toHaveBeenCalled()
  })

  // settings.menu_update's detail carries store_id_old/_new (the menu's
  // store REASSIGNMENT, not the event's own target) — these ids need the
  // same store-name join the eventSub() chip rendering reads from
  // targetLabels, so they must widen the store fetch even with zero
  // target_type:'store' rows on the page.
  it("a menu_update row's detail store_id_old/_new resolve via the SAME stores.list() fetch, even with no store-target rows on the page", async () => {
    const storesList = jest.fn(async () => ({
      stores: [
        { id: 'store-a', name: '銀座店' },
        { id: 'store-b', name: '渋谷店' },
      ],
    }))
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      stores: { list: storesList },
    }))
    list.mockImplementation(async () => ({
      events: [
        coreEvent({
          id: 'e-menu-store',
          category: 'settings',
          action: 'settings.menu_update',
          target_type: 'menu',
          target_id: 'menu-1',
          detail: { store_id_old: 'store-a', store_id_new: 'store-b' },
        }),
      ],
      total: 1,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(storesList).toHaveBeenCalledTimes(1)
    expect(res.targetLabels).toEqual({ 'store-a': '銀座店', 'store-b': '渋谷店' })
  })

  it('no store-target rows AND no menu_update detail store ids → stores.list is never queried', async () => {
    const storesList = jest.fn(async () => ({ stores: [] }))
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      customers: { list: jest.fn(async () => ({ customers: [] })) },
      stores: { list: storesList },
    }))
    const res = await listAuditLog({}) // default coreEvent targets a customer
    if (!res.ok) throw new Error('expected ok')
    expect(storesList).not.toHaveBeenCalled()
  })
})

// R7-1 (Liam's phone review, 8/23 — "extremely important"): the reassign
// row's from_customer_id/to_customer_id widen the SAME batch resolver above
// (never a second resolver, no new read pattern) and get composed into a
// read-time-only reassign_customer_line field, shared by web AND facade
// (both call listAuditLogWithClient). Same test shape as the menu_update
// store_id_old/_new describe block above.
describe('listAuditLog — R7-1 reassign from→to display line', () => {
  const CUS_FROM = '00000000-0000-4000-8000-0000000000f1'
  const CUS_TO = '00000000-0000-4000-8000-0000000000f2'

  function reassignEvent(overrides: Record<string, unknown> = {}) {
    return coreEvent({
      id: 'e-reassign',
      category: 'karute',
      action: 'karute.customer_reassign',
      target_type: 'karute',
      target_id: 'kar-1',
      detail: {
        from_customer_id: CUS_FROM,
        to_customer_id: CUS_TO,
        same_day_burn_count: 0,
        photo_count: 0,
      },
      ...overrides,
    })
  }

  it("a reassign row's from/to ids resolve via the SAME customers.list() batch (pin 2), composed into reassign_customer_line (pin 1's data)", async () => {
    const customersList = jest.fn(async () => ({
      customers: [
        { id: CUS_FROM, name: '田中 美咲' },
        { id: CUS_TO, name: '佐藤 花子' },
      ],
    }))
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      customers: { list: customersList },
    }))
    list.mockImplementation(async () => ({ events: [reassignEvent()], total: 1, page: 1, page_size: 100 }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    // ONE batch call, not two separate lookups.
    expect(customersList).toHaveBeenCalledTimes(1)
    expect(customersList).toHaveBeenCalledWith({
      ids: expect.arrayContaining([CUS_FROM, CUS_TO]),
      include_deleted: true,
    })
    expect(res.events[0].reassign_customer_line).toBe('田中 美咲 → 佐藤 花子')
    expect(res.targetLabels[CUS_FROM]).toBe('田中 美咲')
    expect(res.targetLabels[CUS_TO]).toBe('佐藤 花子')
  })

  it('pin 3: a deleted/unknown to-customer id falls back to the raw id — no crash, honest state', async () => {
    const customersList = jest.fn(async () => ({
      customers: [{ id: CUS_FROM, name: '田中 美咲' }], // CUS_TO purged/unresolved
    }))
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      customers: { list: customersList },
    }))
    list.mockImplementation(async () => ({ events: [reassignEvent()], total: 1, page: 1, page_size: 100 }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.events[0].reassign_customer_line).toBe(`田中 美咲 → ${CUS_TO}`)
  })

  it('pin 5: a non-reassign row never gets reassign_customer_line set, even carrying the same detail key names', async () => {
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      customers: { list: jest.fn(async () => ({ customers: [] })) },
    }))
    list.mockImplementation(async () => ({
      events: [
        coreEvent({
          action: 'customer.edit',
          detail: { from_customer_id: CUS_FROM, to_customer_id: CUS_TO },
        }),
      ],
      total: 1,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.events[0].reassign_customer_line).toBeUndefined()
  })

  it('a reassign row missing either id in detail (malformed/historical) leaves the field undefined — no crash', async () => {
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      customers: { list: jest.fn(async () => ({ customers: [] })) },
    }))
    list.mockImplementation(async () => ({
      events: [reassignEvent({ detail: { from_customer_id: CUS_FROM } })],
      total: 1,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.events[0].reassign_customer_line).toBeUndefined()
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

// G2 (round-4 line-audit): the 警告/重大 tiles are two real server filters —
// core's severity param passed straight through, ONE feed at a time. No
// merge, no virtual OR, no second read: Greptile round 2's chronology
// finding (an older critical row from page 1 outliving newer warn rows once
// paging continued) is gone because there is nothing left to merge. The T1
// strip probes still run under either lens (F1 stands); the break-glass
// COUNT probe is untouched (a different dimension entirely).
describe('listAuditLog — G2 severity filter (round-4: two single-severity feeds)', () => {
  type ProbeOpts = {
    page_size?: number
    page?: number
    severity?: string
    break_glass?: boolean
  }

  function mainCall() {
    const call = list.mock.calls.find(([opts]) => (opts as ProbeOpts).page_size === 100)
    if (!call) throw new Error('expected a page_size:100 main call')
    return call[0] as ProbeOpts
  }

  function mockProbesAnd(mainEvent: ReturnType<typeof coreEvent>) {
    list.mockImplementation(async (opts: ProbeOpts & { exclude_views?: boolean }) => {
      if (opts.page_size === 100) return { events: [mainEvent], total: 1, page: 1, page_size: 100 }
      if (opts.break_glass) return { events: [], total: 0, page: 1, page_size: 1 }
      if (opts.exclude_views && opts.severity === 'warn')
        return { events: [], total: 3, page: 1, page_size: 1 } // nvWarn
      if (opts.exclude_views && opts.severity === 'critical')
        return { events: [], total: 2, page: 1, page_size: 1 } // nvCrit
      if (opts.exclude_views) return { events: [], total: 20, page: 1, page_size: 1 } // nvAll
      if (opts.severity === 'warn') return { events: [], total: 8, page: 1, page_size: 1 } // warnAll
      if (opts.severity === 'critical') return { events: [], total: 4, page: 1, page_size: 1 } // critAll
      throw new Error('unexpected probe call: ' + JSON.stringify(opts))
    })
  }

  it('severity:"warn" — the main call carries severity "warn", NO second read, warningsTotal = nvWarn, criticalTotal = nvCrit', async () => {
    mockProbesAnd(coreEvent({ severity: 'warn' }))
    const res = await listAuditLog({ severity: 'warn' })
    if (!res.ok) throw new Error('expected ok')
    expect(mainCall().severity).toBe('warn')
    expect(res.warningsTotal).toBe(3)
    expect(res.criticalTotal).toBe(2)
    // main(warn) + break-glass + warnAll + critAll + nvWarn + nvCrit + nvAll
    // — no second severity read (the round-3 critical read is deleted).
    expect(list).toHaveBeenCalledTimes(7)
  })

  it('severity:"critical" — the main call carries severity "critical" straight through, same T1 pairing', async () => {
    mockProbesAnd(coreEvent({ severity: 'critical' }))
    const res = await listAuditLog({ severity: 'critical' })
    if (!res.ok) throw new Error('expected ok')
    expect(mainCall().severity).toBe('critical')
    expect(res.warningsTotal).toBe(3)
    expect(res.criticalTotal).toBe(2)
    expect(list).toHaveBeenCalledTimes(7)
  })

  it('breakGlass + a severity filter together — severity is normalized away, breakGlassTotal is the main total (R1 stands)', async () => {
    list.mockImplementation(async () => ({
      events: [coreEvent({ break_glass: true })],
      total: 7,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({ breakGlass: true, severity: 'critical' })
    if (!res.ok) throw new Error('expected ok')
    expect(list).toHaveBeenCalledTimes(1)
    const [call] = list.mock.calls[0] as [ProbeOpts]
    expect(call.break_glass).toBe(true)
    expect(call.severity).toBeUndefined()
    expect(res.breakGlassTotal).toBe(7)
  })
})

// PR D1 §1: request_id/store_id are pure pass-through from the SDK event —
// same actor_label idiom (T3) as the existing describe block above.
describe('listAuditLog — PR D1 wire fields (request_id/store_id pass-through)', () => {
  it('request_id and store_id ride the event through verbatim when core sends them', async () => {
    list.mockImplementation(async () => ({
      events: [coreEvent({ request_id: 'req-1', store_id: 'store-9' })],
      total: 1,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.events[0].request_id).toBe('req-1')
    expect(res.events[0].store_id).toBe('store-9')
  })

  it('an old cached response missing request_id/store_id entirely does not crash the read', async () => {
    list.mockImplementation(async () => ({
      events: [coreEvent()], // coreEvent() never sets these — key absent
      total: 1,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.events[0].request_id).toBeUndefined()
    expect(res.events[0].store_id).toBeUndefined()
  })
})

// PR D1 §2 (amendment 1 F3): the reader-side belt. Core has no
// Idempotency-Key yet (CORE-19 item 3), so a retried write can land twice
// sharing (action, target_type, target_id, request_id) — fold to the
// earliest `at`, never touch a null request_id, and report the drop count.
describe('listAuditLog — PR D1 belt (dedupe retried writes on request_id)', () => {
  it('two rows sharing (action, target, request_id) fold to the EARLIER row; folded counts the drop', async () => {
    list.mockImplementation(async () => ({
      events: [
        coreEvent({
          id: 'e-late',
          at: '2026-07-18T00:05:00.000Z',
          action: 'karute.save',
          target_type: 'karute',
          target_id: 'kar-1',
          request_id: 'req-dup',
        }),
        coreEvent({
          id: 'e-early',
          at: '2026-07-18T00:00:00.000Z',
          action: 'karute.save',
          target_type: 'karute',
          target_id: 'kar-1',
          request_id: 'req-dup',
        }),
      ],
      total: 2,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.events.map((e) => e.id)).toEqual(['e-early'])
    expect(res.folded).toBe(1)
  })

  it('a different request_id on an otherwise-matching pair keeps BOTH rows — folded stays 0', async () => {
    list.mockImplementation(async () => ({
      events: [
        coreEvent({ id: 'e1', action: 'karute.save', target_type: 'karute', target_id: 'kar-1', request_id: 'req-a' }),
        coreEvent({ id: 'e2', action: 'karute.save', target_type: 'karute', target_id: 'kar-1', request_id: 'req-b' }),
      ],
      total: 2,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.events.map((e) => e.id)).toEqual(['e1', 'e2'])
    expect(res.folded).toBe(0)
  })

  it('a null request_id is NEVER folded, even against an otherwise-identical sibling', async () => {
    list.mockImplementation(async () => ({
      events: [
        coreEvent({ id: 'e1', action: 'karute.save', target_type: 'karute', target_id: 'kar-1', request_id: null }),
        coreEvent({ id: 'e2', action: 'karute.save', target_type: 'karute', target_id: 'kar-1', request_id: null }),
      ],
      total: 2,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.events.map((e) => e.id)).toEqual(['e1', 'e2'])
    expect(res.folded).toBe(0)
  })

  it('a normal single-row page reports folded:0', async () => {
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.folded).toBe(0)
  })

  // Fix round 1, subject 7 (D1-7/F-4): "earliest" must compare the actual
  // INSTANT (Date.parse), not the raw string. '2026-07-18T00:30:00.000Z' is
  // 00:30 UTC; '2026-07-18T09:00:00.000+09:00' is 00:00 UTC — an hour+
  // EARLIER instant, but a LEXICALLY LARGER string ('09' > '00' at the hour
  // digits), so a naive string compare picks the wrong row.
  it('picks the EARLIER instant under mixed UTC-offset serialisation, not the lexically smaller string', async () => {
    list.mockImplementation(async () => ({
      events: [
        coreEvent({
          id: 'e-utc-0030',
          at: '2026-07-18T00:30:00.000Z',
          action: 'karute.save',
          target_type: 'karute',
          target_id: 'kar-1',
          request_id: 'req-dup',
        }),
        coreEvent({
          id: 'e-offset-earlier',
          at: '2026-07-18T09:00:00.000+09:00', // = 00:00 UTC, actually earlier
          action: 'karute.save',
          target_type: 'karute',
          target_id: 'kar-1',
          request_id: 'req-dup',
        }),
      ],
      total: 2,
      page: 1,
      page_size: 100,
    }))
    const res = await listAuditLog({})
    if (!res.ok) throw new Error('expected ok')
    expect(res.events.map((e) => e.id)).toEqual(['e-offset-earlier'])
  })
})

// PR D1 §3 (amendment 4 F5): targetType defaults to 'customer' — byte-
// identical to today's behaviour — and types both the core query and the
// view receipt when set explicitly.
describe('listAuditLog — PR D1 targetType (amendment 4 F5)', () => {
  it("defaults to 'customer' when targetId is set and targetType is absent", async () => {
    await listAuditLog({ targetId: 'cus-9' })
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ target_type: 'customer', target_id: 'cus-9' }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ targetType: 'customer', targetId: 'cus-9' }),
    )
  })

  it("targetType:'recording' reaches core AND types the view receipt 'recording' — never 'customer'", async () => {
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      recordings: { get: jest.fn(async () => { throw new Error('not needed for this pin') }) },
    }))
    list.mockImplementation(async () => ({
      events: [coreEvent({ target_type: 'recording', target_id: 'sess-1' })],
      total: 1,
      page: 1,
      page_size: 100,
    }))
    await listAuditLog({ targetId: 'sess-1', targetType: 'recording' })
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ target_type: 'recording', target_id: 'sess-1' }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ targetType: 'recording', targetId: 'sess-1' }),
    )
  })

  // Fix round 1, subject 6 (D1-6): the union type is erased at the 'use
  // server' boundary — a caller (or a future refactor) can still send
  // something outside the four literals. The web action must reject it the
  // SAME way the facade already does (route.ts's TARGET_TYPES): ignore →
  // default 'customer', never let it reach core or the receipt.
  it("an unrecognized targetType (e.g. 'order') never reaches core or the receipt — falls back to the customer default", async () => {
    await listAuditLog({ targetId: 'cus-9', targetType: 'order' as AuditLogFilters['targetType'] })
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ target_type: 'customer', target_id: 'cus-9' }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ targetType: 'customer', targetId: 'cus-9' }),
    )
  })
})

// PR D1 §4 (amendment 1 F6): the recording thread join. Core has no detail
// filter, so the reader walks category:'karute' (+ 'customer' pack_redeem
// once an appointment is known) client-side and merges with the recording's
// own target rows.
describe('listAuditLog — PR D1 recording thread join (amendment 1 F6)', () => {
  const RECORDING_ID = 'sess-1'
  const APPOINTMENT_ID = 'appt-1'
  const CREATED_AT = '2026-09-01T00:00:00.000Z'

  function mockClientWithRecording(overrides: Record<string, unknown> = {}) {
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      recordings: {
        get: jest.fn(async () => ({
          appointment_id: APPOINTMENT_ID,
          created_at: CREATED_AT,
          ...overrides,
        })),
      },
    }))
  }

  it("merges the recording's own rows with a karute.save (detail.recording_session_id) and a pack_redeem (detail.appointment_id), sorted newest-first", async () => {
    mockClientWithRecording()
    list.mockImplementation(async (opts: { target_type?: string; category?: string }) => {
      if (opts.target_type === 'recording') {
        return {
          events: [
            coreEvent({
              id: 'e-own',
              at: '2026-09-01T00:01:00.000Z',
              category: 'recording',
              action: 'recording.session_cleanup',
              target_type: 'recording',
              target_id: RECORDING_ID,
              detail: { customer_id: null },
            }),
          ],
          total: 1,
          page: 1,
          page_size: 100,
        }
      }
      if (opts.category === 'karute') {
        return {
          events: [
            coreEvent({
              id: 'e-save',
              at: '2026-09-01T00:02:00.000Z',
              category: 'karute',
              action: 'karute.save',
              target_type: 'karute',
              target_id: 'kar-1',
              detail: { recording_session_id: RECORDING_ID, appointment_id: null },
            }),
          ],
          total: 1,
          page: 1,
          page_size: 200,
        }
      }
      if (opts.category === 'customer') {
        return {
          events: [
            coreEvent({
              id: 'e-redeem',
              at: '2026-09-01T00:00:30.000Z',
              category: 'customer',
              action: 'customer.pack_redeem',
              target_type: 'customer',
              target_id: 'cus-1',
              detail: { appointment_id: APPOINTMENT_ID },
            }),
          ],
          total: 1,
          page: 1,
          page_size: 200,
        }
      }
      throw new Error('unexpected call: ' + JSON.stringify(opts))
    })
    const res = await listAuditLog({ targetId: RECORDING_ID, targetType: 'recording' })
    if (!res.ok) throw new Error('expected ok')
    expect(res.events.map((e) => e.id)).toEqual(['e-save', 'e-own', 'e-redeem'])
    expect(res.total).toBe(3)
    expect(res.hasMore).toBe(false)
    expect(res.threadPartial).toBe(false)
    // Fix round 1, subject 8 (lens m9b): the one-receipt-per-thread-read
    // property, pinned with a RUNTIME spy across a full read that exercises
    // BOTH inner walks (karute + customer) — the inner reads call
    // synqed.audit.list directly (source-pinned separately), never a nested
    // listAuditLogWithClient that would mint its own receipt per call.
    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'privacy.audit_log.view',
        targetType: 'recording',
        targetId: RECORDING_ID,
      }),
    )
  })

  it('a failed recordings.get degrades to target rows only, with threadPartial:true', async () => {
    newSynqedClient.mockImplementation(() => ({
      audit: mockAudit(),
      recordings: { get: jest.fn(async () => { throw new Error('404') }) },
    }))
    list.mockImplementation(async (opts: { target_type?: string }) => {
      if (opts.target_type === 'recording') {
        return {
          events: [
            coreEvent({
              id: 'e-own',
              category: 'recording',
              action: 'recording.session_cleanup',
              target_type: 'recording',
              target_id: RECORDING_ID,
            }),
          ],
          total: 1,
          page: 1,
          page_size: 100,
        }
      }
      throw new Error('unexpected call: ' + JSON.stringify(opts))
    })
    const res = await listAuditLog({ targetId: RECORDING_ID, targetType: 'recording' })
    if (!res.ok) throw new Error('expected ok')
    expect(res.events.map((e) => e.id)).toEqual(['e-own'])
    expect(res.threadPartial).toBe(true)
  })

  // Fix round 1, subject 2 (D1-2): a throwing inner walk must degrade the
  // THREAD, not the whole read — the target rows already fetched (and any
  // sibling walk) must still come back, with threadPartial:true, never
  // { ok: false }.
  it('the karute walk throwing degrades to target rows + threadPartial:true, never ok:false', async () => {
    mockClientWithRecording({ appointment_id: null })
    list.mockImplementation(async (opts: { target_type?: string; category?: string }) => {
      if (opts.target_type === 'recording') {
        return {
          events: [
            coreEvent({
              id: 'e-own',
              category: 'recording',
              action: 'recording.session_cleanup',
              target_type: 'recording',
              target_id: RECORDING_ID,
            }),
          ],
          total: 1,
          page: 1,
          page_size: 200,
        }
      }
      if (opts.category === 'karute') {
        throw new Error('core unavailable')
      }
      throw new Error('unexpected call: ' + JSON.stringify(opts))
    })
    const res = await listAuditLog({ targetId: RECORDING_ID, targetType: 'recording' })
    if (!res.ok) throw new Error('expected ok, got ' + JSON.stringify(res))
    expect(res.events.map((e) => e.id)).toEqual(['e-own'])
    expect(res.threadPartial).toBe(true)
  })

  // Fix round 1, subject 3 (D1-3): the dedupe belt must cover the MERGED set
  // (target rows ∪ joined rows) — a retried karute.save is exactly the row
  // the thread joins, and it must fold there too, not just in the ordinary
  // feed.
  it('two karute.save rows sharing request_id in the JOINED set fold to one row; folded counts it', async () => {
    mockClientWithRecording({ appointment_id: null })
    list.mockImplementation(async (opts: { target_type?: string; category?: string }) => {
      if (opts.target_type === 'recording') {
        return { events: [], total: 0, page: 1, page_size: 200 }
      }
      if (opts.category === 'karute') {
        return {
          events: [
            coreEvent({
              id: 'k-late',
              at: '2026-09-01T00:05:00.000Z',
              category: 'karute',
              action: 'karute.save',
              target_type: 'karute',
              target_id: 'kar-1',
              request_id: 'req-dup',
              detail: { recording_session_id: RECORDING_ID },
            }),
            coreEvent({
              id: 'k-early',
              at: '2026-09-01T00:00:00.000Z',
              category: 'karute',
              action: 'karute.save',
              target_type: 'karute',
              target_id: 'kar-1',
              request_id: 'req-dup',
              detail: { recording_session_id: RECORDING_ID },
            }),
          ],
          total: 2,
          page: 1,
          page_size: 200,
        }
      }
      throw new Error('unexpected call: ' + JSON.stringify(opts))
    })
    const res = await listAuditLog({ targetId: RECORDING_ID, targetType: 'recording' })
    if (!res.ok) throw new Error('expected ok')
    expect(res.events.map((e) => e.id)).toEqual(['k-early'])
    expect(res.folded).toBe(1)
  })

  // Fix round 1, subject 5 (D1-5): both inner walks (karute AND customer)
  // must pass exclude_views:true — a view row is never a valid join key, and
  // the karute category is view-dominated (one row per record open), eating
  // the walk's own page cap otherwise.
  it('a karute.view row carrying the join key is NOT joined — both inner walks pass exclude_views:true', async () => {
    mockClientWithRecording({ appointment_id: null })
    list.mockImplementation(
      async (opts: { target_type?: string; category?: string; exclude_views?: boolean }) => {
        if (opts.target_type === 'recording') {
          return { events: [], total: 0, page: 1, page_size: 200 }
        }
        if (opts.category === 'karute') {
          // Mirrors core's own exclude_views filtering (same idiom as the
          // main-feed test above) — a view row only survives when the walk
          // omits the param.
          const rows = [
            coreEvent({
              id: 'k-view',
              category: 'karute',
              action: 'karute.view',
              target_type: 'karute',
              target_id: 'kar-1',
              detail: { recording_session_id: RECORDING_ID },
            }),
          ]
          const filtered = opts.exclude_views ? [] : rows
          return { events: filtered, total: filtered.length, page: 1, page_size: 200 }
        }
        throw new Error('unexpected call: ' + JSON.stringify(opts))
      },
    )
    const res = await listAuditLog({ targetId: RECORDING_ID, targetType: 'recording' })
    if (!res.ok) throw new Error('expected ok')
    expect(res.events.map((e) => e.id)).toEqual([])
  })

  it('a walk hitting its page cap reports threadPartial:true even though the merge otherwise succeeds', async () => {
    mockClientWithRecording()
    list.mockImplementation(async (opts: { target_type?: string; category?: string; page?: number }) => {
      if (opts.target_type === 'recording') {
        return { events: [], total: 0, page: 1, page_size: 100 }
      }
      if (opts.category === 'karute') {
        // 10 full pages of 200 (MAX_THREAD_PAGES), total says there's more —
        // the walk stops at the cap, never seeing the rest.
        return {
          events: Array.from({ length: 200 }, (_, i) => coreEvent({ id: `k-${opts.page}-${i}`, category: 'karute' })),
          total: 999_999,
          page: opts.page,
          page_size: 200,
        }
      }
      if (opts.category === 'customer') {
        return { events: [], total: 0, page: opts.page, page_size: 200 }
      }
      throw new Error('unexpected call: ' + JSON.stringify(opts))
    })
    const res = await listAuditLog({ targetId: RECORDING_ID, targetType: 'recording' })
    if (!res.ok) throw new Error('expected ok')
    expect(res.threadPartial).toBe(true)
  })

  // Fix round 1, subject 1 (D1-1 / lens m8): the reader must walk ALL of the
  // thread's OWN target rows to completion, not just the core page matching
  // this call's `page` — otherwise page 2 re-merges the FULL joined set with
  // an EMPTY (or wrong) target page and `total`/reachability shift under the
  // reader. 150 target rows + 20 joined = 170 merged rows; PAGE_SIZE=100
  // means two client pages must be disjoint, cover every row exactly once,
  // and report the SAME total both times.
  it('walks ALL target rows to completion (not one core page) so paging a large thread stays complete and total stays stable (subject 1)', async () => {
    mockClientWithRecording()
    const baseMs = Date.parse(CREATED_AT)
    const targetEvents = Array.from({ length: 150 }, (_, i) =>
      coreEvent({
        id: `t-${i}`,
        at: new Date(baseMs + i * 1000).toISOString(),
        category: 'recording',
        action: 'recording.session_cleanup',
        target_type: 'recording',
        target_id: RECORDING_ID,
        detail: { customer_id: null },
      }),
    )
    const joinedEvents = Array.from({ length: 20 }, (_, i) =>
      coreEvent({
        id: `k-${i}`,
        at: new Date(baseMs + (150 + i) * 1000).toISOString(),
        category: 'karute',
        action: 'karute.save',
        target_type: 'karute',
        target_id: `kar-${i}`,
        detail: { recording_session_id: RECORDING_ID },
      }),
    )
    list.mockImplementation(
      async (opts: { target_type?: string; category?: string; page?: number; page_size?: number }) => {
        // Respects the REQUESTED page/page_size like a real core would — the
        // old code asked for one PAGE_SIZE=100 page of target rows per call
        // (via `res`); only a full walk-to-completion (page_size=THREAD_PAGE_SIZE)
        // returns everything in one shot.
        if (opts.target_type === 'recording') {
          const p = opts.page ?? 1
          const ps = opts.page_size ?? 100
          const start = (p - 1) * ps
          return { events: targetEvents.slice(start, start + ps), total: 150, page: p, page_size: ps }
        }
        if (opts.category === 'karute') {
          return { events: joinedEvents, total: 20, page: 1, page_size: 200 }
        }
        if (opts.category === 'customer') {
          return { events: [], total: 0, page: 1, page_size: 200 }
        }
        throw new Error('unexpected call: ' + JSON.stringify(opts))
      },
    )
    const allIds = new Set([...targetEvents, ...joinedEvents].map((e) => e.id))

    const page1 = await listAuditLog({ targetId: RECORDING_ID, targetType: 'recording', page: 1 })
    const page2 = await listAuditLog({ targetId: RECORDING_ID, targetType: 'recording', page: 2 })
    if (!page1.ok || !page2.ok) throw new Error('expected ok')

    expect(page1.events).toHaveLength(100)
    expect(page2.events).toHaveLength(70)
    expect(page1.total).toBe(170)
    expect(page2.total).toBe(170)

    const ids1 = page1.events.map((e) => e.id)
    const ids2 = page2.events.map((e) => e.id)
    // disjoint
    expect(ids1.filter((id) => ids2.includes(id))).toEqual([])
    // full coverage, no duplicates, every row reachable exactly once
    expect(new Set([...ids1, ...ids2])).toEqual(allIds)
    expect(ids1.length + ids2.length).toBe(allIds.size)
  })
})
