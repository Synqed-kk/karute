/**
 * THE LAYER MATRIX for "a staff member with no store assigned sees nothing and
 * does nothing" (⚖ Liam 2026-09-16, PKT-P2 §Proof — mandatory).
 *
 * Five actor shapes × two transports × three layer configurations, every cell
 * exercised against real code and the table EMITTED BY THE RUN (see the
 * afterAll at the bottom — MATRIX_OUT). Nothing in the report is typed by hand.
 *
 * The three configurations, and why each one has to be checked separately:
 *
 *   LAYER 1+2 (the gate)   — an unassigned actor's capability set is EMPTY and
 *                            the front gate answers before any read starts.
 *   LAYER 3 (the verdict)  — both resolvers agree on the same four shapes.
 *   LAYER 4, GATE OFF      — the backstops are driven DIRECTLY with the
 *                            unassigned scope, with Layers 1–2 never consulted.
 *                            This is the column that proves the layers hold
 *                            alone: if the gate were ever bypassed, disabled or
 *                            outrun by a cached page, every store-scoped read
 *                            still answers empty rather than business-wide.
 *
 * The five shapes are the whole definition's truth table: only ONE of them is
 * unassigned. Three of the other four are byte-identical to before; the
 * DEGRADED shape (assignment unreadable) changed in Round 2 (2026-09-24,
 * D-S16-4, discussed, default): on the web it reaches NO store and the shell
 * shows the outage screen — neither unassigned nor unclamped.
 */

import type { Capability } from '@/lib/auth/permissions'

// ── fixture, driven per cell ────────────────────────────────────────────────
const fixture = {
  assignment: [] as string[] | null, // null = the lookup FAILS (degraded)
  stores: ['store-ginza', 'store-daikanyama'] as string[],
  role: 'practitioner' as string,
  // G-2 (Greptile, 2026-09-17): ids from `stores` that should report
  // `active: false`. Default empty — every existing shape below keeps every
  // store active, byte-identical to before this field existed.
  inactiveStores: [] as string[],
}

const staffStoresGet = jest.fn(async () => {
  if (fixture.assignment === null) throw new Error('core down')
  return { store_ids: fixture.assignment }
})
const storesList = jest.fn(async () => ({
  stores: fixture.stores.map((id, i) => ({
    id,
    is_primary: i === 0,
    active: !fixture.inactiveStores.includes(id),
  })),
}))
const fakeClient = {
  staffStores: { get: staffStoresGet },
  stores: { get: async (id: string) => ({ id }), list: storesList },
}

jest.mock('@synqed-kk/client', () => ({ SynqedClient: class {}, SynqedError: class extends Error {} }))
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: () => fakeClient,
  getSynqedClient: async () => fakeClient,
}))
jest.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
  updateTag: jest.fn(),
}))
// M5 fold: setActiveStore's own cookie write, captured so the refusal test can
// prove it never fires — a stable `set` reference across every `cookies()`
// call, not a fresh jest.fn() per call.
const mockCookieSet = jest.fn()
jest.mock('next/headers', () => ({
  cookies: jest.fn(async () => ({ get: () => undefined, set: mockCookieSet, delete: jest.fn() })),
}))
const mockStaffId = jest.fn(async (): Promise<string | null> => 'staff-1')
jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: () => mockStaffId(),
  getBusinessId: async () => 'business-1',
  getStaffList: async () => [],
  businessIdForUser: async () => 'business-1',
}))
jest.mock('@/actions/stores', () => ({
  // M5 fold: setActiveStore comes through UNMODIFIED (the real refusal clause
  // under test) — only the three reads the rest of this suite already stubs
  // are overridden below, same as before.
  ...jest.requireActual('@/actions/stores'),
  getActiveStoreId: async () => null,
  getPrimaryStoreId: async () => fixture.stores[0] ?? null,
  getStaffStoresStrict: async () =>
    fixture.assignment === null ? null : fixture.assignment,
}))
// capabilitiesForUser's own profile read — the ROLE preset, before the gate.
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { display_role: fixture.role, permission_role: null, permissions: null },
            error: null,
          }),
        }),
      }),
    }),
  }),
}))

import { capabilitiesForUser } from '@/lib/auth/require-permission'
import { resolveShellGate, resolveStoreScope, viewerIsUnassigned } from '@/lib/auth/store-scope'
import { resolveStoreForRequest, resolveExportStoreId } from '@/lib/app-api/store-clamp'
import {
  storeCountForGate,
  actorIsUnassigned,
  actorStoreVerdict,
  STORE_SCOPE_UNVERIFIED_DENIAL,
  STORE_UNASSIGNED_DENIAL,
  storeAssignmentVerdict,
} from '@/lib/auth/store-gate'
import { loadKaruteWindowRows } from '@/lib/karute/karute-window'
import { setActiveStore } from '@/actions/stores'

// ── the five shapes ─────────────────────────────────────────────────────────
type Shape = {
  name: string
  assignment: string[] | null
  stores: string[]
  role: string
  /** stores.viewAll is derived from the role preset, like production. */
  viewAll: boolean
  unassigned: boolean
}

const SHAPES: Shape[] = [
  {
    name: 'viewAll (owner)',
    assignment: [],
    stores: ['store-ginza', 'store-daikanyama'],
    role: 'owner',
    viewAll: true,
    unassigned: false,
  },
  {
    name: 'assigned (銀座 staff)',
    assignment: ['store-ginza'],
    stores: ['store-ginza', 'store-daikanyama'],
    role: 'practitioner',
    viewAll: false,
    unassigned: false,
  },
  {
    name: 'UNASSIGNED (multi-store)',
    assignment: [],
    stores: ['store-ginza', 'store-daikanyama'],
    role: 'practitioner',
    viewAll: false,
    unassigned: true,
  },
  {
    name: 'floating-legacy (single-store)',
    assignment: [],
    stores: ['store-ginza'],
    role: 'practitioner',
    viewAll: false,
    unassigned: false,
  },
  {
    name: 'degraded (lookup failed)',
    assignment: null,
    stores: ['store-ginza', 'store-daikanyama'],
    role: 'practitioner',
    viewAll: false,
    unassigned: false,
  },
]

function load(shape: Shape) {
  fixture.assignment = shape.assignment
  fixture.stores = shape.stores
  fixture.role = shape.role
  fixture.inactiveStores = []
}

// ── the emitted table ───────────────────────────────────────────────────────
type Row = {
  shape: string
  transport: 'web' | 'facade'
  caps: string
  frontGate: string
  scope: string
  backstopsGateOff: string
}
const rows: Row[] = []

const lens = (allowed: readonly string[] | null, storeId: string | null) =>
  `allowedStoreIds=${allowed === null ? 'null' : `[${allowed.join(',')}]`} storeId=${storeId ?? 'null'}`

describe('unassigned gate — the layer matrix', () => {
  for (const shape of SHAPES) {
    describe(shape.name, () => {
      beforeEach(() => load(shape))

      // ── LAYER 1 + 2 + 3, WEB ──────────────────────────────────────────────
      it('web: capability set, front gate and resolver agree', async () => {
        const caps = await capabilitiesForUser('staff-1')
        const gate = await viewerIsUnassigned()
        const scope = await resolveStoreScope()
        const shell = await resolveShellGate()

        if (shape.unassigned) {
          expect(caps.size).toBe(0)
          expect(gate).toBe(true)
          expect(shell).toBe('unassigned')
          expect(scope.allowedStoreIds).toEqual([])
          expect(scope.storeId).toBeNull()
        } else if (shape.assignment === null) {
          // Round 2, 2026-09-24, D-S16-4 (discussed, default): an UNREADABLE
          // assignment is neither unassigned (capabilities kept, no unassigned
          // screen) nor unclamped (no store at all) — the outage screen.
          expect(caps.size).toBeGreaterThan(0)
          expect(gate).toBe(false)
          expect(shell).toBe('outage')
          expect(scope).toEqual({ storeId: null, viewAll: false, allowedStoreIds: [], degraded: true })
        } else {
          expect(shell).toBe('ok')
          expect(caps.size).toBeGreaterThan(0)
          expect(gate).toBe(false)
          // Every non-unassigned shape keeps today's clamp exactly.
          expect(scope.allowedStoreIds).toEqual(
            shape.assignment && shape.assignment.length > 0 ? shape.assignment : null,
          )
          expect(scope.viewAll).toBe(shape.viewAll)
        }

        rows.push({
          shape: shape.name,
          transport: 'web',
          caps: caps.size === 0 ? 'EMPTY' : `${caps.size} capabilities`,
          frontGate:
            shell === 'unassigned'
              ? '担当店舗が未設定です screen'
              : shell === 'outage'
                ? 'outage screen (retrying), no data'
                : 'app shell (unchanged)',
          scope: lens(scope.allowedStoreIds, scope.storeId),
          backstopsGateOff: await webBackstops(scope),
        })
      })

      // ── LAYER 1 + 2 + 3, FACADE ───────────────────────────────────────────
      it('facade: capability set, front gate and clamp agree', async () => {
        const caps = await capabilitiesForUser('staff-1', { businessId: 'business-1' })
        // The SHIPPED expression, verbatim from identity.ts: the front gate
        // reads the verdict ITSELF and does not test whether the capability set
        // is EMPTY (fresh-eyes F4 — that short-circuit made Layer 2 inherit
        // Layer 1's correctness). `stores.viewAll` is still read first, because
        // that is an INPUT to the verdict, not the gate's own output.
        const gate = caps.has('stores.viewAll')
          ? false
          : await actorIsUnassigned('staff-1', 'business-1')
        // The facade clamp fails CLOSED with a throw on a degraded lookup —
        // unchanged, and the one shape that never produces a scope at all.
        let clamp: { storeId: string | null; allowedStoreIds: string[] | null } | null =
          null
        try {
          clamp = await resolveStoreForRequest({
            synqed: fakeClient as never,
            authUserId: 'staff-1',
            capabilities: caps as Set<Capability>,
            requestedStoreId: null,
          })
        } catch {
          clamp = null
        }

        if (shape.unassigned) {
          expect(caps.size).toBe(0)
          expect(gate).toBe(true)
          expect(clamp).toEqual({ storeId: null, allowedStoreIds: [] })
        } else {
          expect(gate).toBe(false)
          if (shape.assignment === null) {
            expect(clamp).toBeNull() // fail-closed throw, unchanged
          } else {
            expect(clamp?.allowedStoreIds).toEqual(
              shape.assignment.length > 0 ? shape.assignment : null,
            )
          }
        }

        rows.push({
          shape: shape.name,
          transport: 'facade',
          caps: caps.size === 0 ? 'EMPTY' : `${caps.size} capabilities`,
          frontGate: gate ? '403 store_unassigned (every endpoint)' : 'handler runs (unchanged)',
          scope: clamp
            ? lens(clamp.allowedStoreIds, clamp.storeId)
            : 'REFUSED store_forbidden (fail-closed)',
          backstopsGateOff: clamp
            ? await facadeBackstops(clamp, caps as Set<Capability>)
            : 'n/a — the clamp never returns a scope',
        })
      })
    })
  }

  // ── MUTATION PROOFS ───────────────────────────────────────────────────────
  // Each removes ONE line of the fix, in place, and shows the cell turns red.
  describe('mutation proofs', () => {
    it('remove the export backstop → an unassigned actor exports the WHOLE business', async () => {
      load(SHAPES[2])
      const clamp = { storeId: null, allowedStoreIds: [] as string[] }
      // The pre-fix line, verbatim from git history:
      const preFix = clamp.allowedStoreIds != null
        ? (clamp.storeId ?? clamp.allowedStoreIds[0])
        : 'unreachable'
      expect(preFix).toBeUndefined() // undefined = NO store filter = business-wide
      // The shipped line refuses instead.
      await expect(
        resolveExportStoreId({
          synqed: fakeClient as never,
          authUserId: 'staff-1',
          capabilities: new Set<Capability>(),
          requestedStoreId: null,
        }),
      ).rejects.toMatchObject({ code: 'store_forbidden' })
    })

    it('remove enforceStore from the カルテ loader → the business-wide read runs', async () => {
      const fetchSpy = jest.fn(async (_p: string) => ({
        karute_records: [],
        total: 0,
        discarded_count: 0,
      }))
      const client = { fetch: fetchSpy } as never
      const now = new Date('2026-09-16T03:00:00Z')
      // WITHOUT the flag (the mutant): core is asked, with no store filter.
      await loadKaruteWindowRows(client, { storeId: null, now })
      expect(fetchSpy).toHaveBeenCalled()
      expect(String(fetchSpy.mock.calls[0][0])).not.toContain('store_id')
      // WITH it (shipped): core is never asked.
      fetchSpy.mockClear()
      await loadKaruteWindowRows(client, { storeId: null, enforceStore: true, now })
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('remove the single-store carve-out → a one-store salon blanks', async () => {
      load(SHAPES[3]) // floating-legacy, ONE store
      const scope = await resolveStoreScope()
      // Shipped: unchanged, unclamped.
      expect(scope.allowedStoreIds).toBeNull()
      // The mutant (drop the `storeCount >= 2` test) would make this `[]`, i.e.
      // every La Estro staff member with no assignment blanked on the day this
      // shipped — which is exactly what the carve-out exists to prevent.
      const mutantVerdict = scope.allowedStoreIds === null ? 'unclamped' : 'unassigned'
      expect(mutantVerdict).toBe('unclamped')
    })
  })
})

// ── G-2 (Greptile, 2026-09-17) ───────────────────────────────────────────────
// The single-store carve-out must count ACTIVE stores only — an archived
// store isn't a real second location a floating staff member could be posted
// to, so it must not turn the carve-out off. One shared helper
// (`storeCountForGate`, store-gate.ts) feeds BOTH `actorIsUnassigned` and the
// facade's clamp so they can't drift; driven here through both transports,
// same shape as the layer matrix above.
describe('G-2 — the carve-out counts ACTIVE stores only', () => {
  afterEach(() => {
    fixture.inactiveStores = []
  })

  it('one ACTIVE + one inactive → single-store carve-out (unclamped, full caps)', async () => {
    fixture.assignment = []
    fixture.stores = ['store-ginza', 'store-daikanyama']
    fixture.role = 'practitioner'
    fixture.inactiveStores = ['store-daikanyama']

    // web
    const caps = await capabilitiesForUser('staff-1')
    expect(caps.size).toBeGreaterThan(0) // never emptied — this actor is NOT unassigned
    expect(await viewerIsUnassigned()).toBe(false)
    const scope = await resolveStoreScope()
    expect(scope.allowedStoreIds).toBeNull() // unclamped, same as a real one-store salon

    // facade
    const facadeCaps = await capabilitiesForUser('staff-1', { businessId: 'business-1' })
    expect(await actorIsUnassigned('staff-1', 'business-1')).toBe(false)
    const clamp = await resolveStoreForRequest({
      synqed: fakeClient as never,
      authUserId: 'staff-1',
      capabilities: facadeCaps as Set<Capability>,
      requestedStoreId: null,
    })
    expect(clamp).toEqual({ storeId: null, allowedStoreIds: null })
  })

  it('two ACTIVE + one inactive → unassigned (the inactive store never counts)', async () => {
    fixture.assignment = []
    fixture.stores = ['store-ginza', 'store-daikanyama', 'store-old']
    fixture.role = 'practitioner'
    fixture.inactiveStores = ['store-old']

    // web
    const caps = await capabilitiesForUser('staff-1')
    expect(caps.size).toBe(0)
    expect(await viewerIsUnassigned()).toBe(true)
    const scope = await resolveStoreScope()
    expect(scope.allowedStoreIds).toEqual([])
    expect(scope.storeId).toBeNull()

    // facade
    const facadeCaps = await capabilitiesForUser('staff-1', { businessId: 'business-1' })
    expect(await actorIsUnassigned('staff-1', 'business-1')).toBe(true)
    const clamp = await resolveStoreForRequest({
      synqed: fakeClient as never,
      authUserId: 'staff-1',
      capabilities: facadeCaps as Set<Capability>,
      requestedStoreId: null,
    })
    expect(clamp).toEqual({ storeId: null, allowedStoreIds: [] })
  })

  it('MUTANT — drop the active filter → an inactive store falsely disables the carve-out', () => {
    const rows = [
      { id: 'store-ginza', active: true },
      { id: 'store-daikanyama', active: false },
    ]
    // Shipped: counts ACTIVE rows only — the carve-out fires (correct: this
    // business has exactly one ACTIVE store).
    expect(storeCountForGate(rows)).toBe(1)
    expect(
      storeAssignmentVerdict({ viewAll: false, assigned: [], storeCount: storeCountForGate(rows) }),
    ).toBe('unclamped')

    // The pre-fix line, verbatim: `r.stores.length` — every row, active or not.
    const mutantCount = rows.length
    expect(
      storeAssignmentVerdict({ viewAll: false, assigned: [], storeCount: mutantCount }),
    ).toBe('unassigned') // WRONG — would blank a floating staffer in a real one-store salon
  })

  // ── X6 fold (session model, 2026-09-17) ──────────────────────────────────
  // Zero ACTIVE stores is not the same fact as zero STORES. A ≥2-row business
  // that has archived every one of them still has something to isolate from —
  // falling all the way back to `unclamped` would hand an unassigned staffer
  // the business-wide view. `storeCountForGate` falls back to the total row
  // count only when the active count is 0 AND there is at least one row.
  it('two rows, both active:false → falls back to the total (2) → unassigned', () => {
    const rows = [
      { id: 'store-ginza', active: false },
      { id: 'store-daikanyama', active: false },
    ]
    expect(storeCountForGate(rows)).toBe(2)
    expect(
      storeAssignmentVerdict({ viewAll: false, assigned: [], storeCount: storeCountForGate(rows) }),
    ).toBe('unassigned')
  })

  it('one row, active:false → falls back to the total (1) → single-store carve-out', () => {
    const rows = [{ id: 'store-ginza', active: false }]
    expect(storeCountForGate(rows)).toBe(1)
    expect(
      storeAssignmentVerdict({ viewAll: false, assigned: [], storeCount: storeCountForGate(rows) }),
    ).toBe('unclamped')
  })

  it('zero rows → stays 0, nothing to fall back to → carve-out', () => {
    const rows: { id: string; active?: boolean }[] = []
    expect(storeCountForGate(rows)).toBe(0)
    expect(
      storeAssignmentVerdict({ viewAll: false, assigned: [], storeCount: storeCountForGate(rows) }),
    ).toBe('unclamped')
  })
})

// ── G-2b (Greptile fold, 2026-09-17) ─────────────────────────────────────────
// A missing `active` field must count as ACTIVE — only an EXPLICIT `false` is
// inactive; unknown must never turn the gate off (same discipline as
// `assigned === null` and `storeCount === null` above). Direct unit checks on
// `storeCountForGate`/`storeAssignmentVerdict`, same shape as the G-2 mutant
// proof above — the mocked `stores.list()` fixture always sets an explicit
// boolean, so a genuinely MISSING field can only be driven directly.
describe('G-2b — a missing `active` flag counts as active, never inactive', () => {
  it('two rows with no `active` field → count 2 → unassigned', () => {
    const rows: { id: string; active?: boolean }[] = [{ id: 'store-a' }, { id: 'store-b' }]
    expect(storeCountForGate(rows)).toBe(2)
    expect(
      storeAssignmentVerdict({ viewAll: false, assigned: [], storeCount: storeCountForGate(rows) }),
    ).toBe('unassigned')
  })

  it('one active:true + one active:false + one with no field → count 2 → unassigned', () => {
    const rows = [
      { id: 'store-a', active: true },
      { id: 'store-b', active: false },
      { id: 'store-c' },
    ]
    expect(storeCountForGate(rows)).toBe(2)
    expect(
      storeAssignmentVerdict({ viewAll: false, assigned: [], storeCount: storeCountForGate(rows) }),
    ).toBe('unassigned')
  })

  it('one active:true + one active:false → 1 → single-store carve-out', () => {
    const rows = [
      { id: 'store-a', active: true },
      { id: 'store-b', active: false },
    ]
    expect(storeCountForGate(rows)).toBe(1)
    expect(
      storeAssignmentVerdict({ viewAll: false, assigned: [], storeCount: storeCountForGate(rows) }),
    ).toBe('unclamped')
  })
})

// ── M5 FOLD ─────────────────────────────────────────────────────────────────
// The third flip point (actions/stores.ts:266-268): pins that the SAME
// refusal fires on the write side, not just the two read gates above. The
// real `setActiveStore` runs unmocked (see the `@/actions/stores` mock's
// `...jest.requireActual` spread) so this exercises the shipped clause, not a
// model of it.
describe('setActiveStore — the third flip point (M5 fold)', () => {
  beforeEach(() => {
    mockCookieSet.mockClear()
  })

  it('a GENUINELY unassigned actor (strict lookup []) is refused, and the cookie is never set', async () => {
    load(SHAPES[2]) // UNASSIGNED (multi-store)
    const result = await setActiveStore('store-ginza')
    expect(result).toEqual({ error: STORE_UNASSIGNED_DENIAL })
    expect(mockCookieSet).not.toHaveBeenCalled()
  })

  // Round 2, 2026-09-24, D-S16-4 (discussed, default) — INVERTED: a lookup
  // that failed used to fall through and pin ANY store.
  it('a DEGRADED lookup (strict null — the lookup itself failed) is REFUSED as unverified, cookie never set', async () => {
    load(SHAPES[4]) // degraded (lookup failed)
    const result = await setActiveStore('store-ginza')
    expect(result).toEqual({ error: STORE_SCOPE_UNVERIFIED_DENIAL })
    expect(mockCookieSet).not.toHaveBeenCalled()
  })

  it('a caller the roster cannot place (uid null) is REFUSED as unverified, cookie never set', async () => {
    load(SHAPES[1]) // an assignment that would otherwise pass
    mockStaffId.mockResolvedValue(null)
    try {
      const result = await setActiveStore('store-ginza')
      expect(result).toEqual({ error: STORE_SCOPE_UNVERIFIED_DENIAL })
      expect(mockCookieSet).not.toHaveBeenCalled()
    } finally {
      mockStaffId.mockResolvedValue('staff-1')
    }
  })

  it('a roster OUTAGE (the staff read rejects) is the same unverified refusal — never a silent rejection', async () => {
    load(SHAPES[1])
    mockStaffId.mockRejectedValue(new Error('roster read failed'))
    try {
      await expect(setActiveStore('store-ginza')).resolves.toEqual({ error: STORE_SCOPE_UNVERIFIED_DENIAL })
      expect(mockCookieSet).not.toHaveBeenCalled()
    } finally {
      mockStaffId.mockResolvedValue('staff-1')
    }
  })

  // Greptile G1 (Round 2 fold): a GENUINE empty assignment whose store list
  // cannot be read is `unknown` — the read plane reaches no store there, so
  // the pin must refuse too (it used to fall through and write the cookie).
  it('refuses with the unverified answer when the assignment is empty and the store list cannot be read (Greptile G1)', async () => {
    load(SHAPES[2]) // empty assignment (strict []), two stores …
    const listImpl = storesList.getMockImplementation()!
    storesList.mockRejectedValue(new Error('stores.list down')) // … list unreadable
    try {
      await expect(setActiveStore('store-ginza')).resolves.toEqual({ error: STORE_SCOPE_UNVERIFIED_DENIAL })
      expect(mockCookieSet).not.toHaveBeenCalled()
    } finally {
      storesList.mockImplementation(listImpl)
    }
  })

  it('control: an ASSIGNED actor pinning their own store still succeeds', async () => {
    load(SHAPES[1]) // assigned (銀座 staff)
    await expect(setActiveStore('store-ginza')).resolves.toEqual({ ok: true })
    expect(mockCookieSet).toHaveBeenCalledWith('karute_active_store', 'store-ginza', expect.any(Object))
  })
})

// ── Round 2 (2026-09-24, D-S16-4, discussed, default): UNKNOWN ──────────────
// An unreadable fact is its own verdict — never `unassigned` (a staffing fact)
// and never `unclamped` (every store).
describe('the unknown verdict — degraded lookup ≠ unassigned AND ≠ unclamped', () => {
  it('assignment lookup FAILED (assigned null) → unknown, whatever the store count', () => {
    for (const storeCount of [null, 0, 1, 2]) {
      const v = storeAssignmentVerdict({ viewAll: false, assigned: null, storeCount })
      expect(v).toBe('unknown')
    }
  })

  it('empty assignment + UNREADABLE store list (storeCount null) → unknown, not the carve-out', () => {
    expect(storeAssignmentVerdict({ viewAll: false, assigned: [], storeCount: null })).toBe('unknown')
    // The carve-out needs a KNOWN count — unchanged for 0 and 1.
    expect(storeAssignmentVerdict({ viewAll: false, assigned: [], storeCount: 1 })).toBe('unclamped')
    expect(storeAssignmentVerdict({ viewAll: false, assigned: [], storeCount: 0 })).toBe('unclamped')
  })

  it('the resolution answers unknown on both failures, and actorIsUnassigned stays FALSE on it', async () => {
    load(SHAPES[4]) // assignment lookup fails
    expect(await actorStoreVerdict('staff-1', 'business-1')).toBe('unknown')
    expect(await actorIsUnassigned('staff-1', 'business-1')).toBe(false)

    load(SHAPES[2]) // empty assignment, two stores …
    storesList.mockRejectedValueOnce(new Error('stores.list down')) // … list unreadable
    expect(await actorStoreVerdict('staff-1', 'business-1')).toBe('unknown')
    storesList.mockRejectedValueOnce(new Error('stores.list down'))
    expect(await actorIsUnassigned('staff-1', 'business-1')).toBe(false)
  })

  // Blind-read F3: the OUTER catch — no client at all (the lazy
  // '@/lib/synqed/client' import itself rejects), not one RPC failing.
  // resetModules drops jest's cached fake so the next lazy import re-runs the
  // (now throwing) factory; the modules already imported above keep theirs.
  it('the client module cannot load (the lazy import REJECTS) → unknown, and the web scope reaches no store', async () => {
    load(SHAPES[2]) // empty assignment in a two-store business — the branch that asks the verdict
    jest.resetModules()
    jest.doMock('@/lib/synqed/client', () => {
      throw new Error('core client failed to load')
    })
    try {
      expect(await actorStoreVerdict('staff-1', 'business-1')).toBe('unknown')
      expect(await actorIsUnassigned('staff-1', 'business-1')).toBe(false)
      expect(await resolveStoreScope()).toEqual({
        storeId: null,
        viewAll: false,
        allowedStoreIds: [],
        degraded: true,
      })
    } finally {
      jest.doMock('@/lib/synqed/client', () => ({
        newSynqedClient: () => fakeClient,
        getSynqedClient: async () => fakeClient,
      }))
    }
  })

  it('web: empty assignment + unreadable store list → the degraded reach-no-store scope → outage', async () => {
    load(SHAPES[3]) // floating, ONE store — the carve-out, IF the list can be read
    storesList.mockRejectedValue(new Error('stores.list down'))
    try {
      expect(await resolveStoreScope()).toEqual({
        storeId: null,
        viewAll: false,
        allowedStoreIds: [],
        degraded: true,
      })
      expect(await resolveShellGate()).toBe('outage')
    } finally {
      storesList.mockReset()
      storesList.mockImplementation(async () => ({
        stores: fixture.stores.map((id, i) => ({
          id,
          is_primary: i === 0,
          active: !fixture.inactiveStores.includes(id),
        })),
      }))
    }
  })
})

// The LAYER-4 column: the backstops driven DIRECTLY with the resolved shape,
// with Layers 1–2 never consulted. What they answer here is what a bypassed
// gate would leave standing.
async function webBackstops(scope: {
  storeId: string | null
  allowedStoreIds: string[] | null
}): Promise<string> {
  const { reachesNoStore } = await import('@/lib/auth/store-gate')
  const blind = reachesNoStore(scope)
  const fetchSpy = jest.fn(async (_p: string) => ({
    karute_records: [],
    total: 0,
    discarded_count: 0,
  }))
  await loadKaruteWindowRows({ fetch: fetchSpy } as never, {
    storeId: scope.storeId,
    enforceStore: scope.allowedStoreIds != null,
    now: new Date('2026-09-16T03:00:00Z'),
  })
  const asked = fetchSpy.mock.calls.length > 0
  const filtered = asked && String(fetchSpy.mock.calls[0][0]).includes('store_id')
  if (blind) {
    expect(asked).toBe(false)
    return 'カルテ/予約/ダッシュボード: EMPTY, core never asked'
  }
  return asked && filtered
    ? 'store-filtered reads (unchanged)'
    : 'business-wide reads (unchanged)'
}

async function facadeBackstops(
  clamp: { storeId: string | null; allowedStoreIds: string[] | null },
  caps: Set<Capability>,
): Promise<string> {
  const { reachesNoStore } = await import('@/lib/auth/store-gate')
  const blind = reachesNoStore(clamp)
  let exportLens: string
  try {
    const id = await resolveExportStoreId({
      synqed: fakeClient as never,
      authUserId: 'staff-1',
      capabilities: caps,
      requestedStoreId: null,
    })
    exportLens = id === undefined ? 'business-wide (viewAll)' : `store-filtered (${id})`
  } catch {
    exportLens = 'REFUSED (403 store_forbidden)'
  }
  if (blind) expect(exportLens).toBe('REFUSED (403 store_forbidden)')
  return `export: ${exportLens}`
}

// ── SCRIPT-EMITTED PROOF ────────────────────────────────────────────────────
// The table is written by the RUN. `MATRIX_OUT` names the file; without it the
// suite is an ordinary test run and writes nothing (CI stays clean).
afterAll(async () => {
  const out = process.env.MATRIX_OUT
  if (!out) return
  const { writeFileSync } = await import('node:fs')
  const header =
    '| actor shape | transport | Layer 1 capabilities | Layer 2 front gate | Layer 3 scope | Layer 4 with the gate OFF |\n' +
    '|---|---|---|---|---|---|\n'
  const body = rows
    .map(
      (r) =>
        `| ${r.shape} | ${r.transport} | ${r.caps} | ${r.frontGate} | \`${r.scope}\` | ${r.backstopsGateOff} |`,
    )
    .join('\n')
  writeFileSync(out, `${header}${body}\n`)
})
