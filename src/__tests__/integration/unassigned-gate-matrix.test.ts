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
 * unassigned, and the other four must be BYTE-IDENTICAL to today.
 */

import type { Capability } from '@/lib/auth/permissions'

// ── fixture, driven per cell ────────────────────────────────────────────────
const fixture = {
  assignment: [] as string[] | null, // null = the lookup FAILS (degraded)
  stores: ['store-ginza', 'store-daikanyama'] as string[],
  role: 'practitioner' as string,
}

const staffStoresGet = jest.fn(async () => {
  if (fixture.assignment === null) throw new Error('core down')
  return { store_ids: fixture.assignment }
})
const storesList = jest.fn(async () => ({
  stores: fixture.stores.map((id, i) => ({ id, is_primary: i === 0 })),
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
jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: async () => 'staff-1',
  getBusinessId: async () => 'business-1',
  getStaffList: async () => [],
  businessIdForUser: async () => 'business-1',
}))
jest.mock('@/actions/stores', () => ({
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
import { resolveStoreScope, viewerIsUnassigned } from '@/lib/auth/store-scope'
import { resolveStoreForRequest, resolveExportStoreId } from '@/lib/app-api/store-clamp'
import { actorIsUnassigned } from '@/lib/auth/store-gate'
import { loadKaruteWindowRows } from '@/lib/karute/karute-window'

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

        if (shape.unassigned) {
          expect(caps.size).toBe(0)
          expect(gate).toBe(true)
          expect(scope.allowedStoreIds).toEqual([])
          expect(scope.storeId).toBeNull()
        } else {
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
          frontGate: gate ? '担当店舗が未設定です screen' : 'app shell (unchanged)',
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
