/**
 * Business foundation (P1.5) under the PLAY-PHASE SEAL (⚖ Liam 2026-08-19).
 * The LOCK is real, the DATA is fake, and territory is sealed: no module in it
 * may import anything that can reach synqed-core, even transitively.
 * Lock: the grants table ships separately and `profiles.is_management` does
 * not exist yet, so "missing table / missing column" is the LIVE state every
 * admission read must deny on. Admission needs a grant row AND a person leg —
 * the grantee named by granted_by, or the 経営メンバー flag — and only ever on
 * a non-production deployment. Door: the lens is required, it drops another store's rows
 * AND storeless bookings, a 全店舗 menu survives the clamp, and no territory
 * file names a client path.
 * Unit-level: no live DB, no network — the data reads hit in-territory fixtures.
 */

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { hasBusinessAdminGrant, isManagementMember } from '@/business/lib/grants'
import { requireBusinessAdmission } from '@/business/lib/admission'
import * as data from '@/business/lib/data'
import { appointments, staffAssignments, staffCards, staff, customers, STORE_A, STORE_B } from '@/business/lib/fixtures'
import { jstDayKey, jstMidnight, jstSlot } from '@/business/lib/clock'
import CustomersPage from '@/app/[locale]/(business)/business/customers/page'
import { toggleColumn } from '@/business/lib/column-config'
import {
  CustomersScreen,
  consentLabel,
  spentLabel,
  ticketLabel,
  walletLabel,
  type CustomerRow,
} from '@/app/[locale]/(business)/business/customers/CustomersScreen'
import { customersProps } from '@/app/[locale]/(business)/business/customers/customers-props'
import { bookingCategory, CATEGORY_LABEL } from '@/business/lib/today-board'
import { priorVisitCounts } from '@/business/lib/analytics'

/** Chainable supabase stub: from(table).select().eq()…maybeSingle() → the
 *  per-table result, or `fallback` for any table not named. Every .eq() lands
 *  in `filters` so a test can prove WHICH row a read asked for. */
const filters: Array<[string, unknown]> = []
function serviceStub(fallback: unknown, byTable: Record<string, unknown> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain = (r: unknown): any => ({
    select: () => chain(r),
    eq: (col: string, val: unknown) => {
      filters.push([col, val])
      return chain(r)
    },
    maybeSingle: async () => r,
  })
  return { from: (table: string) => chain(table in byTable ? byTable[table] : fallback) }
}

const service = createServiceClient as jest.Mock
const supabase = createClient as jest.Mock

/** Every failure shape both admission reads must treat as "no". */
const DENY: Array<[string, unknown]> = [
  ['relation does not exist', { data: null, error: { message: 'relation … does not exist' } }],
  ['column does not exist', { data: null, error: { message: 'column … does not exist' } }],
  ['no row', { data: null, error: null }],
]

beforeEach(() => (filters.length = 0))

describe('admission reads are fail-closed', () => {
  it('grants only on a row that is actually there, keyed by the frozen workspace id', async () => {
    service.mockReturnValue(
      serviceStub({ data: { workspace_id: 'business_admin', granted_by: 'u1' }, error: null }),
    )
    // One read carries both the grant AND the person it is pinned to.
    await expect(hasBusinessAdminGrant('biz-1')).resolves.toEqual({ granted: true, grantedBy: 'u1' })
    // The registry literal is spelled here, not imported (seal) — pin it.
    expect(filters).toContainEqual(['workspace_id', 'business_admin'])
    expect(filters).toContainEqual(['business_id', 'biz-1'])
  })
  it('reads 経営メンバー only from a true flag', async () => {
    service.mockReturnValue(serviceStub({ data: { is_management: true }, error: null }))
    await expect(isManagementMember('user-1')).resolves.toBe(true)
    service.mockReturnValue(serviceStub({ data: { is_management: false }, error: null }))
    await expect(isManagementMember('user-1')).resolves.toBe(false)
  })
  it.each(DENY)('grant denies on %s', async (_l, result) => {
    service.mockReturnValue(serviceStub(result))
    await expect(hasBusinessAdminGrant('biz-1')).resolves.toEqual({ granted: false, grantedBy: null })
  })
  it('a grant row with a null granted_by is still a grant, pinned to nobody', async () => {
    service.mockReturnValue(
      serviceStub({ data: { workspace_id: 'business_admin', granted_by: null }, error: null }),
    )
    await expect(hasBusinessAdminGrant('biz-1')).resolves.toEqual({ granted: true, grantedBy: null })
  })
  it.each(DENY)('management denies on %s', async (_l, result) => {
    service.mockReturnValue(serviceStub(result))
    await expect(isManagementMember('user-1')).resolves.toBe(false)
  })
  it('both deny when the client itself throws (missing service env)', async () => {
    service.mockImplementation(() => {
      throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')
    })
    await expect(hasBusinessAdminGrant('biz-1')).resolves.toEqual({ granted: false, grantedBy: null })
    await expect(isManagementMember('user-1')).resolves.toBe(false)
  })
})

describe('requireBusinessAdmission', () => {
  const NONE = { data: null, error: null }
  /** Real grants.ts driven through the service stub; only the auth session is
   *  mocked. Role gate = the play-phase person-leg (user.id === granted_by) OR
   *  the 経営メンバー flag, and production denies everyone either way. */
  function env({
    grant = true,
    grantedBy = null as string | null,
    management = false,
    user = { id: 'u1', email: 'o@x.jp' } as unknown,
  }) {
    supabase.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user }, error: null }) },
    })
    service.mockReturnValue(
      serviceStub(NONE, {
        business_workspace_grants: grant
          ? { data: { workspace_id: 'business_admin', granted_by: grantedBy }, error: null }
          : NONE,
        profiles: { data: { customer_id: 'biz-1', is_management: management }, error: null },
      }),
    )
  }
  it('admits a 経営メンバー of a granted tenant', async () => {
    env({ grant: true, management: true })
    await expect(requireBusinessAdmission()).resolves.toMatchObject({
      userId: 'u1',
      email: 'o@x.jp',
      businessId: 'biz-1',
    })
  })
  it('denies a granted tenant when the actor is not 経営メンバー', async () => {
    env({ grant: true, management: false })
    await expect(requireBusinessAdmission()).rejects.toThrow('NEXT_NOT_FOUND')
  })
  it('denies a 経営メンバー whose tenant holds no grant', async () => {
    env({ grant: false, management: true })
    await expect(requireBusinessAdmission()).rejects.toThrow('NEXT_NOT_FOUND')
  })
  it('denies when there is no authenticated user', async () => {
    env({ grant: true, management: true, user: null })
    await expect(requireBusinessAdmission()).rejects.toThrow('NEXT_NOT_FOUND')
  })
  it('denies when the tenant cannot be resolved from the profile row', async () => {
    env({ grant: true, management: true })
    service.mockReturnValue(serviceStub(NONE)) // profiles has no customer_id
    await expect(requireBusinessAdmission()).rejects.toThrow('NEXT_NOT_FOUND')
  })
  it('turns a failed read into notFound, never a raw throw', async () => {
    env({ grant: true, management: true })
    supabase.mockRejectedValueOnce(new Error('auth backend down'))
    await expect(requireBusinessAdmission()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  // ── door-lite play-phase legs (⚖ Liam 2026-08-19, path B) ────────────────
  it('admits the person the grant row names, with no 経営メンバー flag', async () => {
    env({ grant: true, grantedBy: 'u1', management: false })
    await expect(requireBusinessAdmission()).resolves.toMatchObject({ userId: 'u1' })
  })
  it('denies another signed-in user of the same granted tenant', async () => {
    env({ grant: true, grantedBy: 'someone-else', management: false })
    await expect(requireBusinessAdmission()).rejects.toThrow('NEXT_NOT_FOUND')
  })
  it('denies when granted_by is null — a grant pinned to nobody matches nobody', async () => {
    env({ grant: true, grantedBy: null, management: false })
    await expect(requireBusinessAdmission()).rejects.toThrow('NEXT_NOT_FOUND')
  })
  it('denies the named person on PRODUCTION, grant row or not', async () => {
    env({ grant: true, grantedBy: 'u1', management: true })
    process.env.VERCEL_ENV = 'production'
    try {
      await expect(requireBusinessAdmission()).rejects.toThrow('NEXT_NOT_FOUND')
    } finally {
      delete process.env.VERCEL_ENV
    }
  })
  it('denies an UNEXPECTED environment value — the gate is an allowlist', async () => {
    env({ grant: true, grantedBy: 'u1', management: true })
    process.env.VERCEL_ENV = 'production2'
    try {
      await expect(requireBusinessAdmission()).rejects.toThrow('NEXT_NOT_FOUND')
    } finally {
      delete process.env.VERCEL_ENV
    }
  })
  it('admits on a preview deployment (VERCEL_ENV is exactly preview)', async () => {
    env({ grant: true, grantedBy: 'u1' })
    process.env.VERCEL_ENV = 'preview'
    try {
      await expect(requireBusinessAdmission()).resolves.toMatchObject({ userId: 'u1' })
    } finally {
      delete process.env.VERCEL_ENV
    }
  })
})

describe('the fixture data door', () => {
  it('a single-store lens drops the other store AND any storeless booking', async () => {
    // ⚖ 8/20 data-truth: the demo world no longer contains a storeless row (a
    // booking no store owns is an impossible state), so the rule is asserted
    // structurally — EVERY row that survives the clamp carries this store,
    // which a null store_id can never satisfy. Stronger than naming one id.
    const got = await data.listAppointments(STORE_A)
    expect(got.length).toBeGreaterThan(0)
    expect(got.every((a) => a.store_id === STORE_A)).toBe(true)
  })
  it('viewAll keeps every store', async () => {
    const all = await data.listAppointments({ viewAll: true })
    expect(all.map((a) => a.store_id)).toEqual(expect.arrayContaining([STORE_A, STORE_B]))
    expect(all.length).toBeGreaterThan((await data.listAppointments(STORE_A)).length)
  })
  it('a range narrows without breaking the clamp', async () => {
    const got = await data.listAppointments(STORE_A, { from: '2026-08-20T00:00:00Z' })
    expect(got.every((a) => a.store_id === STORE_A && a.starts_at >= '2026-08-20T00:00:00Z')).toBe(true)
    expect(got.length).toBeGreaterThan(0)
  })
  it('a 全店舗 menu (no store_id) stays visible under a clamped lens', async () => {
    const ids = (await data.listMenus(STORE_A)).map((m) => m.id)
    expect(ids).toContain('menu-06') // null store_id
    expect(ids).not.toContain('menu-04') // STORE_B
  })
  it('a missing or malformed lens throws, never falls through to business-wide', async () => {
    // The capability gate on {viewAll:true} retired with the seal; the
    // REQUIRED-lens contract did not. A JS caller that drops it must fail loud.
    const reads = [data.listCustomers, data.listAppointments, data.listMenus, data.listStaff]
    for (const read of reads) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect((read as any)()).rejects.toThrow('store lens is required')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect((read as any)({ viewAll: false })).rejects.toThrow('store lens is required')
    }
  })
  it('every read requires the store lens as its first argument', () => {
    // Function.length counts parameters BEFORE the first defaulted one: >= 1
    // proves the lens has no default and cannot be omitted.
    for (const read of [data.listCustomers, data.listAppointments, data.listMenus, data.listStaff]) {
      expect(read.length).toBeGreaterThanOrEqual(1)
    }
  })
  it('staff: a clamped lens keeps this store + floating, drops other stores and unknowns', async () => {
    // p-01 email-linked, c-03 floating, p-04 user_id-ONLY link, p-05 both
    // stores, p-06 the operator's own roster row, p-09 the roster member with
    // no shift today (⚖ 8/20: everyone on the roster has a card and a store);
    // p-02 is STORE_B.
    expect((await data.listStaff(STORE_A)).map((m) => m.id)).toEqual(['p-01', 'c-03', 'p-04', 'p-05', 'p-06', 'p-09'])
    expect((await data.listStaff(STORE_B)).map((m) => m.id)).toEqual(['p-02', 'c-03', 'p-05'])
  })
  it('the default lens is the FIRST store, never the business-wide merge', async () => {
    // ⚖ Liam 2026-08-20: すべての店舗 left the sidebar switcher, so the screens
    // must not open merged. defaultStoreId is the one home for that rule.
    const options = await data.listStoreOptions()
    expect(data.defaultStoreId(undefined, options)).toBe(options[0].id)
    expect(data.defaultStoreId('', options)).toBe(options[0].id)
    expect(data.defaultStoreId('no-such-store', options)).toBe(options[0].id)
    expect(options[0].id).toBe(STORE_A)
  })
  it('an explicit ?store= still wins over the default', async () => {
    const options = await data.listStoreOptions()
    expect(data.defaultStoreId(STORE_B, options)).toBe(STORE_B)
  })
  it('only a store-less actor falls through to viewAll — the branch stays honest, not dead', () => {
    expect(data.defaultStoreId(undefined, [])).toBeNull()
    expect(data.defaultStoreId(STORE_A, [])).toBeNull()
  })
  const FORMS = [
    /from\s*'([^'\n]+)'/g,
    /from\s*"([^"\n]+)"/g,
    // ⚠ THE LOOKBEHIND. Without it this pattern once read
    //   `block('io.import', '取り込み', …)`
    // as a side-effect import of 「, 」 — a string that happens to end in the
    // word `import` followed by a quoted argument. That id is now `io.intake`
    // (2026-09-05: the trigger was removed from OUR side so the shared lock
    // outside Business territory could go back to main's bytes), so nothing
    // in the tree needs the lookbehind today. It stays because a real
    // side-effect import is never preceded by a word character or a dot, and
    // the next `…import '…'` string in a Japanese label should not be able to
    // plant a phantom specifier in this inventory.
    /(?<![\w.$])import\s*['"]([^'"\n]+)['"]/g,
    /import\s*\(\s*['"`]([^'"`\n]+)['"`]/g,
    /require\s*\(\s*['"`]([^'"`\n]+)['"`]/g,
  ]
  it('the sealed files import EXACTLY their inventory — any new import goes red', () => {
    // Stronger than a banned-literal list, which an UNLISTED helper reaching
    // core would walk straight past (Greptile P2 on #720): this pins the
    // COMPLETE import set per file, so any new specifier — core-reaching or
    // innocuous — fails until it is deliberately added here. Same-file regex
    // scan, no resolver needed; one regex per import form (never a combined
    // alternation — the #660 spanning-wildcard lesson) and comment lines are
    // stripped first so prose can't plant a phantom specifier.
    const INVENTORY: Record<string, string[]> = {
      // ⟲ PR-2: `renderNow` (React cache()) moved here from data.ts — one memoised clock.
      'src/business/lib/clock.ts': ['react'],
      // Both sides' rows are REAL in the merged tree, so the entry is the union:
      // the stack brought `react` (data.ts wraps its readers in `cache`), #727
      // brought `./fixtures-reservations`. Verified against the file, not
      // reconciled by taking a side — the inventory mirrors reality or it is
      // worth nothing.
      // PR-2: `react` left with `renderNow` (now in ./clock, re-exported).
      // ⚖ A1b · K11 — `./fixtures-settings`: OFF, a store's address is its SAMPLE 店舗情報 dial
      // (`readStoreAddress`); ON it is the door's own core store record.
      // ⚖ R-S39-1 — `./practice-door/door-booking-colors`: 予約の色分け's writer, door.ts's sibling (its own allowlist key).
      'src/business/lib/data.ts': ['./clock', './fixtures', './fixtures-analytics', './fixtures-reservations', './fixtures-settings', './fixtures-today', './practice-door/door', './practice-door/door-booking-colors', './practice-door/switch'],
      // ⚖ R-S39-1 — the second writer's file: the actor and the switch (OFF has no writer), door.ts's two exported
      // helpers (the once-per-actor org read, the one settings.manage truth), the clock (the audit line's time),
      // the import-free palette leaf (never today-board.ts, which would bring the fixtures), and a LAZY ./core-reach.
      'src/business/lib/practice-door/door-booking-colors.ts': ['../booking-colors', '../clock', './actor', './core-reach', './door', './switch'],
      // ⚖ Liam 9/19 — the practice-salon door (DESIGN-PRACTICE-DOOR.md §9). core-reach
      // is the ONE territory file naming the core client factory; the rest are
      // territory-only or import nothing.
      'src/business/lib/practice-door/switch.ts': ['react'],
      'src/business/lib/practice-door/core-reach.ts': ['@/lib/synqed/client', './switch'],
      'src/business/lib/practice-door/registry-manifest.ts': [],
      'src/business/lib/practice-door/registry.generated.ts': [],
      'src/business/lib/practice-door/registry.ts': ['../fixtures', '../fixtures-settings', './registry.generated'],
      'src/business/lib/practice-door/sample-facade.ts': ['../fixtures-settings', '../fixtures-today', '../resource-words', './registry', './switch'],
      'src/business/lib/practice-door/actor.ts': ['../admission', './core-reach', 'react'],
      // ⚖ A1b — `../reserve-card/card-color`: the card colour's ONE normaliser (the
      // port's boundary), so the door's `readReserveCardColor` never grows a second.
      // ⚖ A2 (Liam 9/24) — the ONE writer: `../reserve-card/palette` (the 12 it accepts), `./switch` (OFF has
      // no writer) and a LAZY `./core-reach` (the write-only org-settings handle; the OFF path never loads it).
      'src/business/lib/practice-door/door.ts': ['../clock', '../fixtures', '../fixtures-analytics', '../fixtures-reservations', '../fixtures-settings', '../fixtures-today', '../reserve-card/card-color', '../reserve-card/palette', './actor', './core-reach', './registry', './sample-facade', './switch'],
      'src/business/lib/fixtures.ts': ['./clock'],
      // ⚖ D-15/D-24 (B2) — `./canon-logic/pricing` JOINED this inventory,
      // deliberately: `sellSlotMin` reads `DEFAULT_SELL_SLOT_MIN` from the
      // engine's own default rather than restating the number as a second
      // literal (canon-logic is pure, so nothing about this reaches a door).
      'src/business/lib/fixtures-today.ts': ['./canon-logic/pricing', './fixtures', './resource-words'],
      'src/business/lib/fixtures-reservations.ts': [],
      'src/business/lib/fixtures-analytics.ts': ['./fixtures'],
      // 売上分析's derivations. It reads the board's OWN predicates
      // (`isEarningVisit`, `bookingCategory`) rather than restating them —
      // that shared import is the reconciliation between 日報's 本日 row and
      // the board's 本日の売上.
      'src/business/lib/analytics.ts': ['./clock', './fixtures', './fixtures-analytics', './today-board'],
      // ⚖ Liam 2026-09-12 「I choose B」 — `./canon-logic/availability` JOINED this
      // inventory, deliberately. The month calendar counts the standard-length
      // courses a day's free pockets still hold, and the pockets are the ENGINE's
      // (`freePockets`) packed with the engine's own `kPackCount`. A second
      // pocket formula written in this file is exactly what the import prevents;
      // canon-logic is pure (its own inventory above is `['./pricing']`), so
      // nothing about this reaches a door or the clock.
      // ⚖ PKT-S38 R2 — `./booking-colors`: the four defaults, the closed palette and the resolver moved to an
      // import-free leaf the practice door can import; today-board re-exports them (no call site moved).
      'src/business/lib/today-board.ts': ['./booking-colors', './canon-logic/availability', './clock', './fixtures', './fixtures-today'],
      // ⚖ PKT-S38 R2 — the leaf's EMPTY inventory is its fence: the door imports it, so it may import nothing.
      'src/business/lib/booking-colors.ts': [],
      // A2 fix (Greptile round 1B addendum) — `shiftWarningOf`'s overage half
      // reads real instants (`jstMidnight`/`jstMinuteOfDay`) rather than bare
      // minute-of-day numbers, the same reason `data.ts`/`today-board.ts` above
      // import `./clock`.
      'src/business/lib/reservations.ts': ['./clock', './fixtures', './fixtures-reservations', './fixtures-today', './today-board'],
      // The 表示する列 primitive canon keeps in fable-shared.js. Pure DOM +
      // arrays, shared by 顧客 and 予約一覧, so it imports nothing at all.
      'src/business/lib/column-config.ts': [],
      // ⚖ Liam 8/23 — the 画面の説明 tour's engine, one shared home for every
      // Business page. Carried verbatim out of today-interactions.ts, and the
      // empty inventory is the PIN on what it is: pure functions over rects and
      // nodes. A room's step index, overlay and copy stay in the room; an
      // import here would mean the engine started knowing about one of them.
      'src/business/lib/guide.ts': [],
      // ⚖ THE NUMBER DICTIONARY (the spreadsheet-absorption plan's Layer 2).
      // One registry of named business numbers plus the arithmetic that derives
      // the new ones, and the empty inventory is the PIN on what it is: pure
      // over its arguments. An import here would mean the dictionary started
      // knowing about one room's world.
      'src/business/lib/dictionary.ts': [],
      // canon-logic — the lifted mock behaviour. These four are PURE by design
      // (that is the whole point of lifting them out of canon's inline script),
      // so an empty inventory is not laziness: any import at all here would
      // mean the lift stopped being pure.
      'src/business/lib/canon-logic/pricing.ts': [],
      'src/business/lib/canon-logic/drag-rules.ts': [],
      'src/business/lib/canon-logic/gap-guard.ts': [],
      'src/business/lib/canon-logic/availability.ts': ['./pricing'],
      'src/business/i18n/index.ts': ['./ja.json'],
      // `@/business/i18n` LEFT this list when the day-one <768 viewport gate was
      // deleted (⚖ ALL-SCREEN ADAPTIVITY, Liam 2026-08-23): `desktopOnly` was the
      // only string the shell read, so the import went with the paragraph.
      'src/app/[locale]/(business)/layout.tsx': [
        './BusinessSessionEdits',
        './BusinessSidebar',
        './BusinessTopbar',
        './ShiftsSessionEdits',
        './business-shell.css',
        '@/business/lib/admission',
        '@/business/lib/data',
        'react',
      ],
      // スタッフ・シフト's staged edits, above the screen for the same reason
      // the board's are. Type-only import of the room's own shapes; no data,
      // no clock, nothing that can reach core.
      'src/app/[locale]/(business)/ShiftsSessionEdits.tsx': ['@/business/lib/shifts', 'react'],
      // ⚖ Liam 22 — the session-edit provider. Type-only imports of the board's
      // own shapes; nothing here reads data, and nothing here can reach core.
      'src/app/[locale]/(business)/BusinessSessionEdits.tsx': [
        './business/today/today-interactions',
        '@/business/lib/today-board',
        'react',
      ],
      'src/app/[locale]/(business)/BusinessSidebar.tsx': ['next/link', 'next/navigation', 'react'],
      'src/app/[locale]/(business)/BusinessTopbar.tsx': ['./BusinessSidebar', 'next/navigation', 'react'],
      'src/business/lib/admission.ts': ['./grants', '@/lib/supabase/server', 'next/navigation'],
      'src/business/lib/grants.ts': ['@/lib/supabase/service'],
      'src/app/[locale]/(business)/business/page.tsx': ['next/navigation'],
      // ⚖ THE ROOM-3 F1 LAW — everything between the admission gate and the
      // render moved to `customers-props.ts`, so the evidence harness imports
      // the SAME assembly the route runs. The page keeps the gate, the params,
      // the sheet and the render, and its data door left with the assembly.
      'src/app/[locale]/(business)/business/customers/page.tsx': [
        './CustomersScreen',
        './customers-props',
        './customers.css',
        '@/business/lib/admission',
      ],
      // ⚠ `priorVisitCounts` LIVES IN `analytics.ts`, NOT `today-board.ts` —
      // checked, not assumed. The category itself is the board's own
      // `bookingCategory` with the board's own `CATEGORY_LABEL`, so 顧客 and the
      // board cannot disagree about who is 新規; the COUNT that feeds it is the
      // function 売上分析 already calls, on the same lens-clamped rows.
      'src/app/[locale]/(business)/business/customers/customers-props.ts': [
        './customers-row',
        '@/business/lib/analytics',
        '@/business/lib/clock',
        '@/business/lib/data',
        '@/business/lib/today-board',
      ],
      // PR-2 (Vercel on #992): the pure row rules come from the client-safe
      // `./customers-row`; `./customers-props` is TYPE-only here now.
      'src/app/[locale]/(business)/business/customers/customers-row.ts': ['./customers-props', '@/business/lib/today-board'],
      'src/app/[locale]/(business)/business/customers/CustomersScreen.tsx': [
        './customers-props',
        './customers-row',
        '@/business/lib/column-config',
        // ⚖ Liam 8/23 — the 画面の説明 tour's shared engine.
        '@/business/lib/guide',
        // ⚠ ONE SPRING INTEGRATOR FOR THE WHOLE FAMILY: the accepted mock's own
        // `makeSpring`, ported rather than re-invented and PURE of React and the
        // DOM. A second easing written by hand beside it would be a second
        // motion language on one page.
        '@/business/lib/spring',
        'next/link',
        'react',
      ],
      'src/app/[locale]/(business)/business/customers/loading.tsx': ['@/business/i18n'],
      // ⚖ flag 77 — `fixtures-today` joins the list for `bedSecuredProof` and
      // nothing else: a pure formula, handed the page's OWN lens-clamped
      // `resources`, so the page still reads its data through the door. Same
      // shape as 受信トレイ's prop assembler two entries down, which imports the
      // same module for the same reason.
      // ⚖ PKT-E4 / spec §7 — `today-interactions` joins the list for
      // `overrideLevelFor` and nothing else: a pure function over the store's
      // own dial and this operator's role, so the page still reads its DATA
      // through the door (this import carries none). Same shape as
      // `bedSecuredProof` above.
      'src/app/[locale]/(business)/business/today/page.tsx': [
        './TodayScreen',
        './today-interactions',
        './today.css',
        '@/business/lib/admission',
        '@/business/lib/clock',
        '@/business/lib/data',
        '@/business/lib/fixtures-today',
        // PR-2: the per-store SAMPLE words read (`storeSample`, never a throw on a live uuid).
        '@/business/lib/practice-door/sample-facade',
        // ⚖ D-53 (n) R-N2-1 — DISCLOSED MOVE: the ONE runtime-reader module
        // under today/. `resourceWordsFor`/`chromeWords` live here and
        // nowhere else in this directory (the resource-words census's C5 pin).
        '@/business/lib/resource-words',
        '@/business/lib/today-board',
      ],
      'src/app/[locale]/(business)/business/today/TodayScreen.tsx': [
        '../../BusinessSessionEdits',
        '../../BusinessTopbar',
        // ⚖ D-10 · D-12 · ROUND 2 (2026-09-13) — the bed-aware sales layer, wired
        // HERE for the reason `./honest-held` is: this is where the publication
        // filter, the locked-lane list and the round gate live, and the two files
        // a sellability gate would look natural in are on the forbidden-reader
        // list one test over. It is a pure module whose every import is a TYPE
        // except `honestHeld` and, as of ⚖ D-18 (3), `heldMaskOf` — both from
        // `./honest-held`, whose own imports are all types — so this arrow
        // adds no module to the graph below the screen: everything it names
        // (`./capacity-ledger`, `./honest-held`, `./reserved-mask`,
        // `@/business/lib/today-board`) is already on this list.
        './bed-aware-sales',
        // ⚖ R2 of the layer rebuild — the capacity book, read in SHADOW behind
        // `capacityLedgerShadow` (default OFF). The screen's only new
        // dependency this round, and R3 turns it into the real one.
        './capacity-ledger',
        // ⚖ SPEC-SELLING-ENGINE §12, E3a — THE SELLING ENGINE'S THREE MODULES,
        // wired here at the screen boundary and nowhere else. `reserved-mask` is
        // the ONE derivation home for the held set (§2, built once per world per
        // frame); `fallback-cells` is the §5 fragment pass over what R4's
        // reconcile dropped; `selling-engine-gate` is the round's construction
        // gate, read on this screen and read nowhere below it — every seam takes
        // the mask as a parameter, so the gate has exactly one home. The screen
        // gains no OTHER dependency: this is a wiring round.
        './fallback-cells',
        // ⚖ R5 POST-MERGE — the committed world's held-mask call, lifted out of
        // the memo body into a function the suite can call
        // (POSTMERGE-CHECK-88b7726c.md findings 1-2: a text pin on the inline
        // body let two severe mutants through). A caller-side wrapper over
        // `./reserved-mask`, not a fifth module: it adds no derivation of its
        // own. It IS a new direct import for this screen — one line, this line
        // — and that is the honest accounting; what it is not is a new MODULE
        // in the graph, because everything it reaches (`./reserved-mask`,
        // `./capacity-ledger`, `@/business/lib/today-board`) is already on this
        // list or already reached through it.
        //
        // ⚖ ROUND 1 — and the wrapper builds the committed book itself now,
        // through the screen's `bedViewsFor`, which is R3's ONE DOOR into the
        // capacity book.
        // ⚖ ROUND 2 — AND THE TRAFFIC STILL RUNS ONE WAY ONLY. Round 1 reached
        // that door by IMPORTING it from this screen, which made the two files
        // import each other; it ran (the door is a hoisted declaration, called
        // a render later) but a cycle on a law-bearing seam is a trap for the
        // next edit. The screen hands the door over as a parameter instead, so
        // this entry stays what it says it is: one arrow, this screen → the
        // wrapper, with no arrow back. selling-engine-doors.test.ts §1 pins
        // that held-committed.ts names neither this file nor the book's own
        // producer, and held-committed.ts is where the reasoning lives in full.
        './held-committed',
        // ⚖ HONEST-COUNT ROUND 1 (2026-09-13) — the netting, applied HERE
        // because this is where the publication filter and the locked-lane list
        // live, and `reserved-mask.ts`'s own header forbids it knowing either.
        // It is a pure module whose every import is a TYPE, so this arrow adds
        // no module to the graph below the screen: everything it names
        // (`./reserved-mask`, `./capacity-ledger`, `@/business/lib/today-board`)
        // is already on this list.
        './honest-held',
        './reserved-mask',
        './selling-engine-gate',
        // ⚖ D-11 · ROUND 2 (2026-09-13) — the timed release of a kept 新規用 枠,
        // applied at this boundary for the same reason: it is the caller that
        // knows the board, the clock and the manager's keep-held facts, and the
        // module is forbidden to ask. Pure, every import of its own a TYPE from
        // `./reserved-mask`, which is already on this list.
        './timed-release',
        './today-interactions',
        // ⚖ PR-3 of 予約の色分け — the Business string home, for the 色の意味
        // chip's text (a NEW visible string goes through it, never a literal).
        // It imports only `./ja.json`, so this arrow adds no code module below.
        '@/business/i18n',
        '@/business/lib/canon-logic/drag-rules',
        '@/business/lib/canon-logic/gap-guard',
        '@/business/lib/canon-logic/pricing',
        // The tour engine's new address (⚖ Liam 8/23). The board's own tour is
        // unchanged; only where the four functions live moved.
        '@/business/lib/guide',
        // ⚖ S17 fix round 5 · G2 (D-41) — the ONE link home, reached for the
        // 保護ルール chip and (PR-3 of 予約の色分け) the 色の意味 chip, nothing else. It is a string builder with no
        // imports of its own, so this arrow adds no module to the graph below
        // it.
        // ⚖ D-53 (n) R-N2-1 — DISCLOSED MOVE: a TYPE-only import of
        // `ResourceWords`, so this screen can type the four new props without
        // ever calling `resourceWordsFor` itself (the C5 pin: page.tsx is the
        // ONLY runtime caller under today/).
        '@/business/lib/resource-words',
        '@/business/lib/settings-link',
        // ⚠ ONE SPRING INTEGRATOR FOR THE WHOLE FAMILY: the accepted mock's own
        // `makeSpring`, ported rather than re-invented and PURE of React and the
        // DOM. A second easing written by hand beside it would be a second
        // motion language on one page.
        '@/business/lib/spring',
        '@/business/lib/today-board',
        'next/link',
        'react',
      ],
      'src/app/[locale]/(business)/business/today/today-interactions.ts': [
        // ⚖ E3a — TYPE-ONLY, and the direction matters: the mask imports
        // `laneSpans` from this file as a VALUE, so this entry is erased at
        // compile time and no module cycle exists at runtime. The pin lists it
        // because the scanner reads `from '…'` regardless of `import type`, and
        // a silent extra dependency here is exactly what it is here to catch.
        // ⚖ PIN MIGRATED at the FIX ROUND, WITH the decision (F4): the capacity
        // book joins it, on the same TYPE-ONLY terms and for the same reason —
        // the counter now takes §4.5's emitted `ReservedOffer[]` instead of
        // re-deriving reserved rows from the mask, so this file names that type.
        // The book imports `allocateBed` from here as a VALUE, so this entry is
        // erased at compile time and no cycle exists at runtime either.
        './capacity-ledger',
        './reserved-mask',
        '@/business/lib/canon-logic/availability',
        '@/business/lib/canon-logic/drag-rules',
        '@/business/lib/canon-logic/gap-guard',
        '@/business/lib/canon-logic/pricing',
        // ⚖ STUDIO 2026-09-12 — TYPE-ONLY, and the third one here: the month
        // popover's two motion helpers name `Spring`, and the integrator itself
        // stays the screen's to build (`makeSpring` captures `reduced` at
        // construction). Erased at compile time; no runtime dependency is added.
        '@/business/lib/spring',
        '@/business/lib/today-board',
      ],
      'src/app/[locale]/(business)/business/today/loading.tsx': ['@/business/i18n'],
      // ⚖ THE ROOM-3 F1 LAW, NOW ON THIS ROOM TOO (V2). Everything between the
      // admission gate and the render moved to `reservations-props.ts`, so the
      // evidence harness renders the SAME assembly the route does. The page
      // keeps four imports: the screen, its props, its sheet and the gate.
      'src/app/[locale]/(business)/business/reservations/page.tsx': [
        './ReservationsScreen',
        './reservations-props',
        './reservations.css',
        '@/business/lib/admission',
      ],
      'src/app/[locale]/(business)/business/reservations/reservations-props.ts': [
        './ReservationsScreen',
        '@/business/lib/clock',
        '@/business/lib/data',
        // ⚠ TYPE-ONLY, BOTH OF THEM, and the reason is the harness: the world
        // overrides this assembly accepts are exactly the shapes the fixture
        // modules export, so a synthetic proof world is a compile error when it
        // stops matching the demo world. No fixture VALUE is read here — every
        // row still arrives through the lens-clamped data door.
        '@/business/lib/fixtures',
        '@/business/lib/fixtures-reservations',
        '@/business/lib/reservations',
        '@/business/lib/today-board',
      ],
      'src/app/[locale]/(business)/business/reservations/ReservationsScreen.tsx': [
        '@/business/lib/column-config',
        // ⚖ Liam 8/23 — the 画面の説明 tour's engine, ONE shared home; the room
        // wires its own trigger and its own overlay to it (V2).
        '@/business/lib/guide',
        '@/business/lib/reservations',
        // ⚠ ONE SPRING INTEGRATOR FOR THE WHOLE FAMILY. It is the accepted
        // mock's own `makeSpring`, ported rather than re-invented: the rail's
        // detail, the picker's confirm, the segmented thumb and the phone sheet
        // all ride it, and a second easing written by hand beside them would be
        // a second motion language on one page (V2).
        '@/business/lib/spring',
        '@/business/lib/today-board',
        'next/link',
        'react',
      ],
      'src/app/[locale]/(business)/business/reservations/loading.tsx': ['@/business/i18n'],
      'src/app/[locale]/(business)/business/analytics/page.tsx': [
        './AnalyticsScreen',
        './analytics-props',
        './analytics.css',
        '@/business/lib/admission',
      ],
      // ⚠ THE PROP ASSEMBLY, BESIDE THE PAGE (the room-3 F1 law). The evidence
      // harness imports this function, so an isolated shot is the same assembly
      // the route runs; `page.tsx` keeps admission, params and the sheet.
      'src/app/[locale]/(business)/business/analytics/analytics-props.ts': [
        './AnalyticsScreen',
        '@/business/lib/analytics',
        '@/business/lib/clock',
        '@/business/lib/data',
        // ⚖ THE NUMBER DICTIONARY. Every word this page prints for a business
        // number is read from there, so a tile, a column head, a provenance row
        // and a tour sentence cannot call one figure two things.
        '@/business/lib/dictionary',
        // ⚖ S17 fix round 5 · G2 (D-41) — THE ONE LINK HOME. A hand-written
        // `/business/settings?section=…` here dropped the locale and the store,
        // so the link opened another store's settings (⚖ 8/17). Pure, no
        // imports of its own, and this is the honest accounting: one new arrow
        // per room that points at 設定.
        '@/business/lib/settings-link',
        '@/business/lib/today-board',
      ],
      'src/app/[locale]/(business)/business/analytics/AnalyticsScreen.tsx': [
        '@/business/lib/analytics',
        '@/business/lib/dictionary',
        '@/business/lib/guide',
        // ⚠ ONE SPRING INTEGRATOR FOR THE WHOLE FAMILY. It is the accepted
        // mock's own `makeSpring`, ported rather than re-invented, and PURE.
        '@/business/lib/spring',
        'next/link',
        'react',
      ],
      'src/app/[locale]/(business)/business/analytics/loading.tsx': ['@/business/i18n'],
      // スタッフ・シフト. The room's own plane and derivations, plus the BOARD's
      // own `hhmm`/`yen`/`effectiveShift`/`dayTotals` — borrowed on purpose, so
      // the shift board and 今日の運営 cannot state the same day differently.
      'src/business/lib/fixtures-shifts.ts': [],
      'src/business/lib/shifts.ts': [
        './clock',
        './fixtures',
        './fixtures-shifts',
        './fixtures-today',
        './today-board',
      ],
      'src/app/[locale]/(business)/business/shifts/page.tsx': [
        './ShiftsScreen',
        './shifts.css',
        '@/business/lib/admission',
        '@/business/lib/clock',
        '@/business/lib/data',
        '@/business/lib/fixtures-shifts',
        '@/business/lib/shifts',
        '@/business/lib/today-board',
      ],
      'src/app/[locale]/(business)/business/shifts/ShiftsScreen.tsx': [
        '../../BusinessTopbar',
        '../../ShiftsSessionEdits',
        '@/business/lib/fixtures-today',
        '@/business/lib/shifts',
        '@/business/lib/today-board',
        'next/link',
        'next/navigation',
        'react',
      ],
      'src/app/[locale]/(business)/business/shifts/loading.tsx': ['@/business/i18n'],
      // 受信トレイ. The room's own message plane plus the derivations that BORROW
      // every other fact it shows: 予約一覧's own `deadlineOf`/`lifecycleOf` for
      // the deadline, the board's `customerStoreAffiliation`/`hhmm`/`yen`. The
      // screen imports nothing but its own types — every number and every date
      // is a string by the time it crosses the boundary.
      'src/business/lib/fixtures-inbox.ts': [],
      'src/business/lib/inbox.ts': [
        './fixtures',
        './fixtures-inbox',
        './fixtures-reservations',
        './fixtures-today',
        './reservations',
        './today-board',
      ],
      // The route entry keeps the admission gate, the params and the render;
      // the prop assembly — and therefore every fixture-door read — moved to
      // `inbox-props.ts`, so the evidence harness runs the SAME function the
      // route does instead of a hand-written replica of its output. The
      // inventory follows the reads: the door list below is the page's old one,
      // unchanged, at its new address.
      'src/app/[locale]/(business)/business/inbox/page.tsx': [
        './InboxScreen',
        './inbox-props',
        './inbox.css',
        '@/business/lib/admission',
      ],
      'src/app/[locale]/(business)/business/inbox/inbox-props.ts': [
        './InboxScreen',
        '@/business/lib/clock',
        '@/business/lib/data',
        '@/business/lib/fixtures-inbox',
        '@/business/lib/fixtures-today',
        '@/business/lib/inbox',
      ],
      'src/app/[locale]/(business)/business/inbox/InboxScreen.tsx': [
        // ⚖ Liam 8/23 — the room's ? opens the family's guided tour, so it wires
        // its own trigger and overlay to the shared engine. Pure functions only:
        // this room reads no data on the client and that is unchanged.
        '@/business/lib/guide',
        '@/business/lib/inbox',
        'next/link',
        'react',
      ],
      'src/app/[locale]/(business)/business/inbox/loading.tsx': ['@/business/i18n'],
      // 売上・レジ. The room's own money plane plus the derivations that BORROW
      // every other fact it shows: the booking's 受付価格 and store, the menu's
      // name, the board's own `yen`/`hhmm`, the world's own terminal-held rows
      // and 操作履歴. The plane imports the store ids and nothing else; the
      // screen imports its own types and the shared tour engine.
      'src/business/lib/fixtures-register.ts': ['./fixtures'],
      'src/business/lib/register.ts': ['./fixtures', './fixtures-register', './today-board'],
      'src/app/[locale]/(business)/business/register/page.tsx': [
        './RegisterScreen',
        './register-props',
        './register.css',
        '@/business/lib/admission',
      ],
      'src/app/[locale]/(business)/business/register/register-props.ts': [
        './RegisterScreen',
        '@/business/lib/clock',
        '@/business/lib/data',
        // PR-2 (Greptile on #992): the operator now comes from the door (readShellIdentity).
        '@/business/lib/fixtures-register',
        '@/business/lib/register',
        '@/business/lib/settings-link',
        '@/business/lib/today-board',
      ],
      'src/app/[locale]/(business)/business/register/RegisterScreen.tsx': [
        '@/business/lib/guide',
        '@/business/lib/register',
        'next/link',
        'react',
      ],
      'src/app/[locale]/(business)/business/register/loading.tsx': ['@/business/i18n'],
      // カルテ. The room's own RECORD plane plus the derivations that BORROW
      // every other fact it shows: the booking's date/store/staff/menu, the
      // customer's name and 顧客番号, the world's own day index. The plane
      // imports the store ids and nothing else; the screen imports its own types
      // and the shared tour engine, and reaches into `src/lib/karute/*` NOWHERE
      // — the phone's contract is mirrored by shape in `karute.ts`, with a cite,
      // because Business territory may not import phone runtime.
      // ⚠ THE EMPTY INVENTORY IS THE FENCE, MADE MACHINE-READABLE. A record
      // plane that imported the world could restate a fact the world already
      // states — a customer's name, a store, a date — and that is the W7 breach
      // class this room is pinned against. It imports nothing, so it can only
      // ADD: an appointment id, and what the session itself produced.
      'src/business/lib/fixtures-karute.ts': [],
      'src/business/lib/karute.ts': ['./clock', './fixtures', './fixtures-karute'],
      'src/app/[locale]/(business)/business/karute/page.tsx': [
        './KaruteScreen',
        './karute-props',
        './karute.css',
        '@/business/lib/admission',
      ],
      'src/app/[locale]/(business)/business/karute/karute-props.ts': [
        './KaruteScreen',
        '@/business/lib/clock',
        '@/business/lib/data',
        '@/business/lib/fixtures',
        '@/business/lib/fixtures-karute',
        '@/business/lib/karute',
        '@/business/lib/practice-door/sample-facade',
        '@/business/lib/today-board',
      ],
      'src/app/[locale]/(business)/business/karute/KaruteScreen.tsx': [
        '@/business/lib/guide',
        '@/business/lib/karute',
        'next/link',
        'react',
      ],
      'src/app/[locale]/(business)/business/karute/loading.tsx': ['@/business/i18n'],
      // 設定 (room 9). ⚠ THE PROPS FILE'S INVENTORY IS THE ROOM'S OWN ONE-TRUTH
      // PIN, and it is meant to be long: every plane listed there is a dial value
      // this room READS from the room that ships it, instead of keeping a second
      // copy. `fixtures-settings` is the ADD-only plane for the dials no room
      // owns a value for — its own inventory is `./fixtures` and nothing else,
      // because a plane that imported a derivation could restate a fact.
      'src/business/lib/fixtures-settings.ts': ['./fixtures'],
      // ⚖ D-53 (c) R4, P15 — the words home, beside the mirror. Its whole
      // import inventory is the mirror it reads types and values from.
      'src/business/lib/resource-words.ts': ['./fixtures-settings'],
      // The rules are PURE, and the empty inventory is the pin on that: the gate,
      // the clamps and the refusal table decide things about values they are
      // handed, never values they fetch.
      'src/business/lib/settings.ts': [],
      // ⚖ S17 fix round 5 · G2 — every link into 設定, built in one place. The
      // empty inventory is the PIN on what it is: a string out of three values
      // its caller already resolved. An import here would mean the link builder
      // started knowing about a room.
      'src/business/lib/settings-link.ts': [],
      'src/business/lib/settings-words.ts': ['./resource-words', './settings'],
      'src/app/[locale]/(business)/business/settings/page.tsx': [
        './SettingsScreen',
        './settings-props',
        './settings.css',
        '@/business/lib/admission',
        // ⚖ A2 — `practiceDoorOn()`: カードの見た目's real save is offered only while the door is ON.
        '@/business/lib/data',
      ],
      // ⚖ A2 (Liam 9/24, R-A2-13) — the ONE Business write route: admission (the expected business) and the
      // data seam, nothing else.
      'src/app/api/business/card-color/route.ts': ['@/business/lib/admission', '@/business/lib/data'],
      // ⚖ PKT-S38 R4 — 予約の色分け's route, the card route's twin: admission and the data seam, nothing else.
      'src/app/api/business/booking-colors/route.ts': ['@/business/lib/admission', '@/business/lib/data'],
      'src/app/[locale]/(business)/business/settings/settings-props.ts': [
        // ⚖ S17 FOLD (A1) — ONE ASSEMBLY. 予約と確保's payload is built by the
        // section's own props file and handed through this one, so the route and
        // the evidence harness render the same assembly.
        './store-policy-props',
        // ⚡ R2 BRANCH C — the dial's mapping pair (⚖ D-11); the empty-inventory
        // fence on the seam file itself (below) is unchanged.
        './store-policy-seam',
        // ③ — PRICE_UNIT_YEN, the ¥ unit the Reserve 受付 fact prints from the
        // same constant gapFillPrice and packedPrice round to.
        '@/business/lib/canon-logic/pricing',
        // ⚖ PKT-S38 R2/R6 — 予約の色分け's closed palette + the board's four defaults (one home).
        '@/business/lib/booking-colors',
        // ⚖ PR-2b — `jstSlotEnd` for 「最終同期は…分前」 off the shell's own sync
        // stamp; and `@/business/lib/fixtures` LEFT: the room's stores, staff,
        // menus and business now come through `@/business/lib/data`.
        '@/business/lib/clock',
        '@/business/lib/data',
        '@/business/lib/fixtures-analytics',
        '@/business/lib/fixtures-register',
        '@/business/lib/fixtures-settings',
        '@/business/lib/fixtures-shifts',
        '@/business/lib/fixtures-today',
        '@/business/lib/practice-door/sample-facade',
        // ⚖ A1b — the curated 12 for カードの見た目's payload (one home).
        '@/business/lib/reserve-card/palette',
        '@/business/lib/resource-words',
        '@/business/lib/settings',
        '@/business/lib/settings-words',
      ],
      // ⚖ S17 fix round 1 · F15 (D-20) — THE ROOM'S ONE 詳しく DISCLOSURE, in its
      // own file. Both the shell room and 予約と確保 need it, and the section may
      // not import the screen (the screen already imports the section, so that
      // would be a cycle). Its own inventory is the spring and react — the same
      // one integrator every moving thing in this room runs on.
      'src/app/[locale]/(business)/business/settings/Collapse.tsx': [
        '@/business/lib/spring',
        'react',
      ],
      'src/app/[locale]/(business)/business/settings/SettingsScreen.tsx': [
        './Collapse',
        // ⚖ S17 FOLD (A1) — the rail renders #812's room for its 予約と確保 row.
        './StorePolicySection',
        // ⚖ A1b — …and カードの見た目's picker + ported card for its row.
        './ReserveCardLookSection',
        '@/business/lib/guide',
        '@/business/lib/settings',
        '@/business/lib/settings-words',
        // ⚖ S17 STEP 1 — the room's ONE integrator. Every moving thing on the
        // page (the segment's thumb, the switch's thumb, the 詳しく panel's
        // height, the save card's rise) is driven by `makeSpring`; a second
        // easing written by hand beside it would be a second motion language on
        // one page, which is the thing the Studio standard exists to prevent.
        '@/business/lib/spring',
        'react',
      ],
      // ⚖ S17 FOLD — 予約と確保, #812's room re-homed as ONE section of 設定.
      // ⚠ DERIVED FROM DISK, never remembered. The SECTION reaches the board's own
      // composer (`warnFaceFor` / `overrideLevelFor`) and canon's pricing frame,
      // because the preview IS the shipped warn card rather than a drawing of one;
      // it holds NO data door and NO tour engine — 設定 owns both (A2), and the
      // absence of `@/business/lib/guide` here is the pin on that.
      'src/app/[locale]/(business)/business/settings/StorePolicySection.tsx': [
        '../today/today-interactions',
        // ⚖ S17 fix round 1 · F15 — the room's row grammar includes the room's
        // 詳しく, so the eight dials fold their caveat lines the same way the
        // twenty-two sections do rather than stacking them at every width.
        './Collapse',
        './store-policy-seam',
        '@/business/lib/canon-logic/pricing',
        // ⚖ D-53 (u)/(n2b2) — `RESOURCE_WORDS.other`, the generic row this
        // room hands `guardVerdictAt` until N3 gives it the store's own row.
        '@/business/lib/resource-words',
        // ⚠ D-36 (⚖ S17 fix round 4 · M4) — THE ROOM'S OWN RULES FILE, for the
        // one rule this section shares with the other twenty-two: what a number
        // field does with an empty box. Both used to answer the guardrail's LOW
        // end silently (予約の刻み 30 → clear → 5分), and the honest fallback —
        // the previous value, said out loud — is one decision, so it is one
        // function. A copy of it here would be the second home the room's own
        // architecture rules forbid, and the two would drift the first time one
        // was edited. `settings.ts` is PURE (empty import inventory, pinned
        // above), so nothing follows it in.
        '@/business/lib/settings',
        // ⚖ D-15 — `computeScene` (the free-length scene, ⚡ PKT-BUILD-R3-A1
        // commit 2) lives HERE rather than in `store-policy-props.ts` (SERVER-
        // ONLY — its own `@/business/lib/data` import would follow it into the
        // client bundle) or `store-policy-seam.ts` (its import inventory is
        // pinned EMPTY on purpose, the reconnect fence below). `BoardLane` is
        // the one type its `SceneInput` needs that neither file already carries
        // in.
        '@/business/lib/today-board',
        'react',
      ],
      // …and the ASSEMBLY is #812's own page body: the same doors, the same
      // engines, the same seam. `./StorePolicySection` is its props TYPE, which
      // lives with the component exactly as it did in #812 (`page.tsx` imported
      // `SettingsProps` from `SettingsScreen`); `./settings.css` and the admission
      // gate are gone because the 設定 route already does both, once, for every
      // section.
      'src/app/[locale]/(business)/business/settings/store-policy-props.ts': [
        '../today/today-interactions',
        './StorePolicySection',
        './store-policy-seam',
        '@/business/lib/canon-logic/drag-rules',
        '@/business/lib/canon-logic/gap-guard',
        '@/business/lib/canon-logic/pricing',
        '@/business/lib/clock',
        '@/business/lib/data',
        '@/business/lib/practice-door/sample-facade',
        // ⚖ D-53 (u)/(n2b2) — same reason as StorePolicySection.tsx, above.
        '@/business/lib/resource-words',
        '@/business/lib/today-board',
      ],
      // ⚠ THE SEAM'S EMPTY INVENTORY IS THE FENCE, MADE MACHINE-READABLE: the one
      // file core's reconnect lands in reaches nothing at all today.
      'src/app/[locale]/(business)/business/settings/store-policy-seam.ts': [],
      // ⚖ A1b — カードの見た目: the port is its ONLY card drawing (and its satin the
      // only colour math); the room's spring and the tour's ring helper; no data door.
      'src/app/[locale]/(business)/business/settings/ReserveCardLookSection.tsx': [
        '@/business/lib/guide',
        '@/business/lib/reserve-card/ReserveCardPreview',
        '@/business/lib/reserve-card/satin-material',
        '@/business/lib/settings',
        '@/business/lib/spring',
        'react',
      ],
      'src/business/lib/reserve-card/palette.ts': ['./card-color'],
      'src/app/[locale]/(business)/business/settings/loading.tsx': ['@/business/i18n'],
      // AI相談. The room's own CONSULTATION plane plus the derivations that
      // BORROW every other fact it shows: the booking's customer / staff / menu
      // and its 予約番号, the record's own カルテ番号, the thread's subject and
      // its 回答期限, and the board's `hhmm`. The plane imports NOTHING — the
      // empty inventory is the W7 fence made machine-readable, exactly as it is
      // for the record plane above: a plane that imported the world could restate
      // a fact the world already states, and importing nothing it can only ADD.
      //
      // ⚠ AND THE ROOM REACHES INTO `src/lib/ai/*`, `src/lib/app-api/*`,
      // `src/components/ai/*` AND `src/app/api/ai/*` NOWHERE. The phone's Ask-AI
      // contract — its capability rule, its request/response shape, its context
      // modes, its context label and its ephemerality — is mirrored by SHAPE in
      // `ask-ai.ts` with the file:line it was read at, because Business territory
      // may not import phone runtime.
      'src/business/lib/fixtures-ask-ai.ts': [],
      'src/business/lib/ask-ai.ts': [
        './fixtures',
        './fixtures-ask-ai',
        './fixtures-inbox',
        './fixtures-karute',
        './today-board',
      ],
      'src/app/[locale]/(business)/business/ask-ai/page.tsx': [
        './AskAiScreen',
        './ask-ai-props',
        './ask-ai.css',
        '@/business/lib/admission',
      ],
      'src/app/[locale]/(business)/business/ask-ai/ask-ai-props.ts': [
        './AskAiScreen',
        '@/business/lib/ask-ai',
        '@/business/lib/clock',
        '@/business/lib/data',
        // PR-2 (Greptile on #992): the operator now comes from the door (readShellIdentity).
        '@/business/lib/fixtures-ask-ai',
        '@/business/lib/fixtures-inbox',
        '@/business/lib/fixtures-karute',
      ],
      'src/app/[locale]/(business)/business/ask-ai/AskAiScreen.tsx': [
        '@/business/lib/ask-ai',
        '@/business/lib/guide',
        // ⚠ ONE SPRING INTEGRATOR FOR THE WHOLE FAMILY (S15). It is the accepted
        // 録音 mock's own `makeSpring`, ported rather than re-invented, and it is
        // PURE — no React, no DOM — so a second easing written by hand beside it
        // would be a second motion language on one page.
        '@/business/lib/spring',
        'next/link',
        'react',
      ],
      'src/app/[locale]/(business)/business/ask-ai/loading.tsx': ['@/business/i18n'],
      // 録音. The room's own RECORDING plane plus the derivations that BORROW
      // every other fact it shows: the booking's date/store/customer/staff/menu,
      // the roster's names through the card↔profile bridge, and — through that
      // SAME booking — whether the カルテ room's plane holds a record for the
      // session. The plane imports the world's store constant and nothing else;
      // the screen imports its own types and the shared tour engine, and reaches
      // into `src/lib/recording/*`, `src/lib/recordings/*` and `src/lib/karute/*`
      // NOWHERE — the phone's contracts are mirrored by shape in `recording.ts`,
      // each with a file:line cite, because Business territory may not import
      // phone runtime.
      // ⚠ THE ONE-IMPORT PLANE IS THE FENCE, MADE MACHINE-READABLE. A recording
      // plane that imported the world could restate a fact the world already
      // states — a customer's name, a store, a date — and that is the W7 breach
      // class this room is pinned against. It imports the STORE ID only (an
      // unbound walk-in take has no booking to read one through), so it can
      // otherwise only ADD: an appointment id, and what the session itself
      // produced.
      'src/business/lib/fixtures-recording.ts': ['./fixtures'],
      'src/business/lib/recording.ts': ['./clock', './fixtures', './fixtures-karute', './fixtures-recording'],
      'src/app/[locale]/(business)/business/recording/page.tsx': [
        './RecordingScreen',
        './recording-props',
        './recording.css',
        '@/business/lib/admission',
      ],
      'src/app/[locale]/(business)/business/recording/recording-props.ts': [
        './RecordingScreen',
        '@/business/lib/clock',
        '@/business/lib/data',
        '@/business/lib/fixtures',
        '@/business/lib/fixtures-karute',
        '@/business/lib/fixtures-recording',
        // ⚠ THE カルテ ROOM'S OWN CATEGORY VOCABULARY, BORROWED RATHER THAN
        // FORKED (v5, the 前回の施術メモ block). The briefing prints last
        // session's entries under the labels that room already ships; a copy of
        // those strings in the recording room would be a second home for one
        // vocabulary, and the two would drift the first time one is edited.
        '@/business/lib/karute',
        '@/business/lib/practice-door/sample-facade',
        '@/business/lib/recording',
        '@/business/lib/today-board',
      ],
      'src/app/[locale]/(business)/business/recording/RecordingScreen.tsx': [
        '@/business/lib/guide',
        '@/business/lib/recording',
        // ⚠ ONE SPRING INTEGRATOR FOR THE WHOLE FAMILY (v5). It is the accepted
        // mock's own `makeSpring`, ported rather than re-invented, and it is
        // PURE — no React, no DOM — so a second easing written by hand beside it
        // would be a second motion language on one page.
        '@/business/lib/spring',
        'next/link',
        'react',
      ],
      'src/app/[locale]/(business)/business/recording/loading.tsx': ['@/business/i18n'],
    }
    // P15 — a presence assertion, not just a value pin: without it, deleting
    // the entry above would leave that file invisible to this test rather
    // than red (m5).
    expect(Object.keys(INVENTORY)).toContain('src/business/lib/resource-words.ts')
    expect(Object.keys(INVENTORY)).toContain('src/business/lib/practice-door/registry.generated.ts')
    for (const [file, expected] of Object.entries(INVENTORY)) {
      const src = readFileSync(join(process.cwd(), file), 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n')
      const found = new Set<string>()
      for (const re of FORMS) {
        re.lastIndex = 0
        for (let m = re.exec(src); m; m = re.exec(src)) found.add(m[1])
      }
      expect({ file, imports: [...found].sort() }).toEqual({ file, imports: [...expected].sort() })
    }
  })

  // ⚖ Liam 9/19 — the practice-salon door's two structural pins (DESIGN-PRACTICE-DOOR.md
  // §9). Territory is walked WITHOUT src/__tests__/: practice-door.test.ts imports the
  // door on purpose. Specifiers are read with FORMS above, comment lines stripped.
  const ROOT = process.cwd()
  function territoryFiles(): string[] {
    const prefixes: string[] = JSON.parse(readFileSync(join(ROOT, 'scripts/business/business-territory.json'), 'utf8')).territory
    const out: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(join(ROOT, dir))) {
        const rel = posix.join(dir, name)
        if (name === 'node_modules' || rel.startsWith('src/__tests__/')) continue
        const stat = lstatSync(join(ROOT, rel))
        if (stat.isSymbolicLink()) continue
        if (stat.isDirectory()) walk(rel)
        else if (/\.(ts|tsx|mts|cts|mjs|cjs|jsx|js)$/.test(name)) out.push(rel)
      }
    }
    for (const p of prefixes) {
      if (!p.startsWith('src/__tests__/') && existsSync(join(ROOT, p))) walk(p.slice(0, -1))
    }
    return out
  }
  function specifiersOf(file: string): string[] {
    const src = readFileSync(join(ROOT, file), 'utf8')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n')
    const found: string[] = []
    for (const re of FORMS) {
      re.lastIndex = 0
      for (let m = re.exec(src); m; m = re.exec(src)) found.push(m[1])
    }
    return found
  }
  const resolveSpec = (spec: string, from: string): string | null =>
    spec.startsWith('@/')
      ? posix.join('src', spec.slice(2))
      : /^\.\.?(\/|$)/.test(spec)
        ? posix.join(posix.dirname(from), spec)
        : null
  const PRACTICE_DOOR = 'src/business/lib/practice-door'

  // TRANSITIVE (PR-2, Vercel on #992): a client file that reaches the door through a
  // server helper (CustomersScreen → customers-props → data) put Supabase and core-reach
  // in the browser bundle. The walk follows every VALUE import through territory
  // modules; a type-only import (`import type …` / `export type … from`) is erased at
  // build and is skipped; a mixed `import { type X, y }` counts.
  function valueSpecifiersOf(file: string): string[] {
    const src = readFileSync(join(ROOT, file), 'utf8')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n')
      .replace(/(?:import|export)\s+type\s[^;]*?from\s*['"][^'"\n]+['"]/g, '')
    const found: string[] = []
    for (const re of FORMS) {
      re.lastIndex = 0
      for (let m = re.exec(src); m; m = re.exec(src)) found.push(m[1])
    }
    return found
  }
  // The walk stays INSIDE territory on purpose: an outside module importing territory
  // data is already forbidden by the reverse-direction scanner (scripts/business/check-business-isolation.mjs).
  const TERRITORY_ROOTS = ['src/business/', 'src/app/[locale]/(business)/']
  // A `.js`/`.jsx` specifier names the `.ts`/`.tsx` source (ESM-suffix style), so the stem is tried too.
  function resolveFile(target: string): string | null {
    const stem = target.replace(/\.(ts|tsx|js|jsx)$/, '')
    for (const f of [target, `${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`, `${stem}/index.tsx`]) {
      if (/\.(ts|tsx)$/.test(f) && existsSync(join(ROOT, f)) && lstatSync(join(ROOT, f)).isFile()) return f
    }
    return null
  }
  const isServerOnly = (target: string) =>
    target === 'src/business/lib/data' || target === 'src/business/lib/admission' ||
    target === PRACTICE_DOOR || target.startsWith(`${PRACTICE_DOOR}/`)

  it("server-only, TRANSITIVE: no 'use client' file in territory reaches data, admission or the practice door by any value-import path", () => {
    const offenders: string[] = []
    let clientFiles = 0
    for (const file of territoryFiles()) {
      const first = readFileSync(join(ROOT, file), 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l !== '' && !/^(\/\/|\/\*|\*)/.test(l))
      if (!first || !/^(['"])use client\1;?$/.test(first)) continue
      clientFiles += 1
      const seen = new Set<string>([file])
      const queue: Array<[string, string[]]> = [[file, [file]]]
      while (queue.length) {
        const [at, path] = queue.shift()!
        for (const spec of valueSpecifiersOf(at)) {
          const target = resolveSpec(spec, at)
          if (!target) continue
          const bare = target.replace(/\.(ts|tsx|js|jsx)$/, '')
          if (isServerOnly(bare)) { offenders.push([...path, spec].join(' → ')); continue }
          const next = resolveFile(target)
          if (!next || seen.has(next) || !TERRITORY_ROOTS.some((r) => next.startsWith(r))) continue
          seen.add(next)
          queue.push([next, [...path, next]])
        }
      }
    }
    expect(clientFiles).toBeGreaterThan(0)
    expect(offenders).toEqual([])
    // The walker's own self-check: an ESM `.js` specifier resolves to its `.ts` source.
    expect(resolveFile('src/business/lib/data.js')).toBe('src/business/lib/data.ts')
  })

  // ⚖ R-S39-1 (lead ruling on PKT-S38 D4) — the door's sibling writer file imports door.ts for its two exported
  // helpers; it is itself imported by data.ts alone. Nothing else in territory reaches either.
  it('one importer each: data.ts alone imports the door (plus its sibling writer file), core-reach.ts alone names the core client factory', () => {
    const doorImporters: string[] = []
    const siblingImporters: string[] = []
    const factoryImporters: string[] = []
    for (const file of territoryFiles()) {
      for (const spec of specifiersOf(file)) {
        if (resolveSpec(spec, file) === `${PRACTICE_DOOR}/door`) doorImporters.push(file)
        if (resolveSpec(spec, file) === `${PRACTICE_DOOR}/door-booking-colors`) siblingImporters.push(file)
        if (spec === '@/lib/synqed/client') factoryImporters.push(file)
      }
    }
    expect(doorImporters.sort()).toEqual(['src/business/lib/data.ts', `${PRACTICE_DOOR}/door-booking-colors.ts`])
    expect(siblingImporters).toEqual(['src/business/lib/data.ts'])
    expect(factoryImporters).toEqual([`${PRACTICE_DOOR}/core-reach.ts`])
  })

  // §7 — FORBIDDEN ON THE READ PATH. Comment lines stripped first, as specifiersOf does.
  // ⚖ A2 (Liam 9/24, R-A2-8) — the jest twin of the scanner's write entries: door.ts only, each exact
  // one-key line, once. Every other mutator token stays forbidden everywhere in the folder, door.ts included.
  // ⚖ PKT-S38 R8 (Liam 9/25 「make it work」) + R-S39-1 — the second writer, in its own file; ⚖ PKT-S41 R-S41-1
  // (Liam 9/25 A): its line sends ONE key per store (`booking_colors:<storeId>`), never the shared map.
  const WRITERS = [
    { file: 'door.ts', line: 'orgSettings.upsert({ settings: { reserve_card_color: next } })', count: 1 },
    { file: 'door-booking-colors.ts', line: 'orgSettings.upsert({ settings: { [bookingColorsKeyFor(storeId)]: next } })', count: 1 },
  ]
  const DOOR_FORBIDDEN = [
    'as any', 'as unknown as', '@synqed-kk/client', 'src/actions/stores', 'staff-map', 'getSynqedClient', '@/lib/staff', '@/lib/auth', 'store-gate',
    '.create(', '.update(', '.delete(', '.set(', '.save(', '.upsert(', '.runNow(', '.addClosedDay(', '.removeClosedDay(',
    '.setAssignment(', '.setStaff(', '.grantConsent(', '.revokeConsent(', '.upload',
  ]
  function doorHits(sources: Array<[string, string]>): string[] {
    const hits: string[] = []
    for (const [name, src] of sources) {
      let code = src
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n')
      for (const WRITER of WRITERS) {
        if (name !== WRITER.file) continue
        const uses = code.split(WRITER.line).length - 1
        if (uses > WRITER.count) hits.push(`${name}: the writer line ×${uses} > ${WRITER.count}`)
        code = code.split(WRITER.line).join('') // only the exact line's text is exempt, never its neighbours
      }
      for (const bad of DOOR_FORBIDDEN) if (code.includes(bad)) hits.push(`${name}: ${bad}`)
    }
    return hits
  }
  const doorSources = (): Array<[string, string]> =>
    readdirSync(join(ROOT, PRACTICE_DOOR))
      .filter((n) => n.endsWith('.ts'))
      .map((n) => [n, readFileSync(join(ROOT, PRACTICE_DOOR, n), 'utf8')])

  it('practice-door/: no cast escape, no SDK specifier, no write-capable module, no mutator call but the TWO writer lines', () => {
    const sources = doorSources()
    expect(sources.map(([n]) => n)).toContain('door.ts')
    for (const WRITER of WRITERS) expect(sources.find(([n]) => n === WRITER.file)![1]).toContain(WRITER.line)
    expect(doorHits(sources)).toEqual([])
  })

  it('the writer exemption fails closed: a second copy in door.ts, another upsert in door.ts, or the line elsewhere', () => {
    const line = `  const saved = await writer.orgSettings.upsert({ settings: { reserve_card_color: next } })\n`
    expect(doorHits([['door.ts', line]])).toEqual([])
    expect(doorHits([['door.ts', line + line]])).toEqual(['door.ts: the writer line ×2 > 1'])
    expect(doorHits([['door.ts', line + 'await x.orgSettings.upsert({ settings: {} })\n']])).toEqual(['door.ts: .upsert('])
    expect(doorHits([['actor.ts', line]])).toEqual(['actor.ts: .upsert('])
    expect(doorHits([['core-reach.ts', line]])).toEqual(['core-reach.ts: .upsert('])
    // ⚖ PKT-S38 — the second writer's line fails closed the same way, and never covers the first.
    const line2 = `  const saved = await writer.orgSettings.upsert({ settings: { [bookingColorsKeyFor(storeId)]: next } })\n`
    expect(doorHits([['door-booking-colors.ts', line2]])).toEqual([])
    expect(doorHits([['door-booking-colors.ts', line2 + line2]])).toEqual(['door-booking-colors.ts: the writer line ×2 > 1'])
    // the retired shared-map line is no longer exempt, nor is a bare legacy key
    expect(doorHits([['door-booking-colors.ts', line2.replace('[bookingColorsKeyFor(storeId)]: next', 'booking_colors: { ...map, [storeId]: next }')]])).toEqual(['door-booking-colors.ts: .upsert('])
    expect(doorHits([['door-booking-colors.ts', line2.replace('[bookingColorsKeyFor(storeId)]', 'booking_colors')]])).toEqual(['door-booking-colors.ts: .upsert('])
    expect(doorHits([['door-booking-colors.ts', line + line2]])).toEqual(['door-booking-colors.ts: .upsert(']) // the card line never moves here
    expect(doorHits([['door.ts', line + line2]])).toEqual(['door.ts: .upsert(']) // …nor the booking line back into door.ts
    expect(doorHits([['actor.ts', line2]])).toEqual(['actor.ts: .upsert('])
  })

  // ⚖ PKT-S38 R8 — still ONE bind, now with two callers: door.ts writeReserveCardColor and writeBookingColors,
  // both through orgSettingsWriterFor.
  it('R-A2-7: the one bound mutator is core-reach.ts’s `upsert.bind(` — once, and nowhere else in practice-door/', () => {
    const binds = doorSources().flatMap(([name, src]) =>
      [...src.matchAll(/\.(create|update|delete|set|save|upsert|runNow|addClosedDay|removeClosedDay|setAssignment|setStaff|grantConsent|revokeConsent|upload\w*)\.bind\(/g)].map((m) => `${name}: ${m[1]}.bind(`),
    )
    expect(binds).toEqual(['core-reach.ts: upsert.bind('])
  })
})

describe('the fixture clock (relative dates)', () => {
  // ⚖ L-6: the fixture calendar is DERIVED, so the demo is populated on any
  // real date. These four assertions are the whole contract; each one dies to a
  // different mutation of clock.ts (red-run artifacts in the WO-1 evidence
  // folder).
  const NOON_JST = new Date('2026-08-19T03:00:00Z') // 12:00 JST on 8/19

  it('anchors on JST midnight, not UTC midnight', () => {
    // 2026-08-19T15:30Z is already 00:30 JST on 8/20 — the anchor must be 8/20
    // 00:00 JST (= 2026-08-19T15:00Z). Dropping the offset returns 8/19's.
    expect(new Date(jstMidnight(new Date('2026-08-19T15:30:00Z'))).toISOString()).toBe(
      '2026-08-19T15:00:00.000Z',
    )
  })
  it('places a slot at the JST wall-clock time asked for', () => {
    // 10:00 JST is 01:00Z — never 10:00Z.
    expect(jstSlot(0, 10, 0, NOON_JST)).toBe('2026-08-19T01:00:00.000Z')
    expect(jstSlot(0, 16, 30, NOON_JST)).toBe('2026-08-19T07:30:00.000Z')
  })
  it('a day offset moves exactly one day', () => {
    const a = new Date(jstSlot(0, 10, 0, NOON_JST)).getTime()
    const b = new Date(jstSlot(1, 10, 0, NOON_JST)).getTime()
    const back = new Date(jstSlot(-7, 10, 0, NOON_JST)).getTime()
    expect(b - a).toBe(86_400_000)
    expect(a - back).toBe(7 * 86_400_000)
  })
  it('the same wall-clock day gives the same anchor at any hour of it', () => {
    expect(jstSlot(0, 10, 0, new Date('2026-08-18T15:00:00Z'))).toBe(
      jstSlot(0, 10, 0, new Date('2026-08-19T14:59:00Z')),
    )
  })
})

describe('the fixture day is operationally possible (⚖ 8/9 demo-data-product-truth)', () => {
  const jstParts = (iso: string) => {
    const p = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tokyo',
    }).formatToParts(new Date(iso))
    const get = (t: string) => Number(p.find((x) => x.type === t)!.value)
    return get('hour') * 60 + get('minute')
  }

  it('every booking sits inside 10:00–19:00 JST', () => {
    for (const a of appointments()) {
      expect(jstParts(a.starts_at)).toBeGreaterThanOrEqual(10 * 60)
      // A booking that ends exactly at 19:00 is legal; one that runs past is not.
      const end = jstParts(a.ends_at)
      expect(end === 0 ? 24 * 60 : end).toBeLessThanOrEqual(19 * 60)
      expect(a.ends_at > a.starts_at).toBe(true)
    }
  })

  it('no staff member is double-booked', () => {
    const live = appointments().filter((a) => a.status !== 'cancelled' && a.staff_id)
    for (const a of live) {
      for (const b of live) {
        if (a.id >= b.id || a.staff_id !== b.staff_id) continue
        expect(a.starts_at >= b.ends_at || b.starts_at >= a.ends_at).toBe(true)
      }
    }
  })

  it('no staff member works a store they are not assigned to', () => {
    const cardOf = (staffId: string) => {
      if (staffCards.some((c) => c.id === staffId)) return staffId
      const member = staff.find((m) => m.id === staffId)
      return (
        staffCards.find((c) => c.user_id === staffId)?.id ??
        staffCards.find((c) => c.email && member?.email && c.email === member.email)?.id ??
        null
      )
    }
    for (const a of appointments()) {
      if (!a.staff_id || !a.store_id) continue
      const card = cardOf(a.staff_id)
      const assigned = card ? staffAssignments[card] : undefined
      // No assignment rows = floating (works everywhere), the roster convention.
      if (assigned && assigned.length > 0) expect(assigned).toContain(a.store_id)
    }
  })

  it('every booking points at a customer and a menu that exist', () => {
    const ids = new Set(customers.map((c) => c.id))
    for (const a of appointments()) expect(ids.has(a.customer_id)).toBe(true)
  })

  it('a 確認済み badge is only possible where the fixture says the merge is settled', () => {
    // The screen reads merge_status directly, so the fixture is the only place
    // a wrong badge could come from: the duplicate PAIR must both be open.
    const pair = customers.filter((c) => c.merge_status === 'open')
    expect(pair.length).toBeGreaterThanOrEqual(2)
    for (const c of pair) {
      expect(c.duplicate_of).not.toBeNull()
      expect(customers.some((o) => o.member_number === c.duplicate_of)).toBe(true)
    }
  })

  it('keeps a null-balance customer, and a null balance says 「—」 not ¥0', () => {
    expect(customers.some((c) => c.wallet_balance === null)).toBe(true)
    expect(walletLabel(null)).toBe('—')
    expect(walletLabel(0)).toBe('¥0')
    expect(ticketLabel(null)).toBe('なし')
    expect(consentLabel(null)).toBe('—')
    expect(consentLabel({ line: false, sms: false, email: false })).toBe('同意なし')
    expect(consentLabel({ line: true, sms: true, email: false })).toBe('LINE・SMS')
  })
})

describe('顧客一覧 screen', () => {
  // The calendar is relative now, so the clock is pinned only to make the
  // formatted strings below deterministic — not to keep the data alive.
  beforeAll(() => jest.useFakeTimers().setSystemTime(new Date('2026-08-19T00:00:00Z')))
  afterAll(() => jest.useRealTimers())
  // The page re-asserts admission itself, so the screen renders as an admitted
  // user rather than inheriting whatever the previous describe left behind.
  beforeEach(() => {
    supabase.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'o@x.jp' } }, error: null }) },
    })
    service.mockReturnValue(
      serviceStub(
        { data: null, error: null },
        {
          business_workspace_grants: { data: { workspace_id: 'business_admin', granted_by: 'u1' }, error: null },
          profiles: { data: { customer_id: 'biz-1', is_management: false }, error: null },
        },
      ),
    )
  })

  /** The page returns an element tree; find the props the screen is handed.
   *  No renderer needed (and react-dom is off the import allowlist anyway). */
  function screenProps(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    node: any,
  ): { rows: CustomerRow[]; lensLabel: string; grouped: boolean; inboxHref: string; karuteHref: string } | null {
    if (!node || typeof node !== 'object') return null
    if (node.type === CustomersScreen) return node.props
    const kids = node.props?.children
    for (const kid of Array.isArray(kids) ? kids.flat() : [kids]) {
      const hit = screenProps(kid)
      if (hit) return hit
    }
    return null
  }
  const props = async (store?: string) =>
    screenProps(
      await CustomersPage({
        params: Promise.resolve({ locale: 'ja' }),
        searchParams: Promise.resolve(store ? { store } : {}),
      }),
    )
  const render = async (store?: string) => (await props(store))!.rows

  it('gates itself: a denied session 404s the page, not just the layout', async () => {
    // The layout gates too, but a screen must not depend on a parent's await
    // for its authorization (api/business handlers would get none at all).
    supabase.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    })
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
  })
  it('renders every fixture customer, thin book-cast rows included', async () => {
    const rows = await render()
    // 13 since the Today board arrived: 見本 さくら is the registered-but-never-
    // visited customer the board's 新規 category needs (cus-10 must keep its
    // never-booked-anywhere CM-9 shape, so it could not carry that case).
    expect(rows).toHaveLength(13)
    expect(rows.map((r) => r.name)).toContain('見本 あかり')
    expect(rows.every((r) => r.no.startsWith('C-'))).toBe(true)
    expect(rows.filter((r) => r.thin).map((r) => r.id)).toEqual(['thin-01', 'thin-02'])
  })
  it("respects the store lens: another store's booking never reaches the row", async () => {
    const ginza = (await render(STORE_A)).find((r) => r.id === 'cus-01')!
    const daikanyama = (await render(STORE_B)).find((r) => r.id === 'cus-01')!
    expect(ginza.nextLabel).toBe('8月20日 10:00') // apt-15 lives in 銀座
    expect(daikanyama.hasNext).toBe(false) // …and must not leak into 代官山
    expect((await render(STORE_B)).find((r) => r.id === 'cus-03')!.hasNext).toBe(true)
  })
  it('a cancelled booking is not a next booking', async () => {
    // cus-05's only forward booking (apt-21, 代官山) is cancelled.
    expect((await render(STORE_B)).find((r) => r.id === 'cus-05')!.hasNext).toBe(false)
  })
  it('a SAME-DAY future slot IS a 次回予約 — the anchor is an instant, never a day boundary', async () => {
    // ⚠ THE TRUTH A DAY-GRANULAR FILTER WOULD SILENTLY BREAK. The suite's clock
    // is 2026-08-19T00:00Z = 09:00 JST, so TODAY's 14:05 and 14:30 slots are
    // still ahead: きり's apt-09 and さくら's apt-26 must both read today's date.
    // A `starts_at >= endOfToday`-style filter drops exactly these two rows and
    // nothing else, which is why they are pinned by name.
    const ginza = await render(STORE_A)
    expect(ginza.find((r) => r.id === 'cus-07')!.nextLabel).toBe('8月19日 14:05')
    expect(ginza.find((r) => r.id === 'cus-11')!.nextLabel).toBe('8月19日 14:30')
    expect(ginza.find((r) => r.id === 'cus-07')!.hasNext).toBe(true)
    expect(ginza.find((r) => r.id === 'cus-11')!.hasNext).toBe(true)
    // …and the same instant excludes a slot that has already BEGUN today:
    // cus-06's apt-14 starts 13:00 today, which is ahead of 09:00, so she has
    // one; いつき's only slot today is `done`, so she has none.
    expect(ginza.find((r) => r.id === 'cus-06')!.hasNext).toBe(true)
    expect(ginza.find((r) => r.id === 'cus-02')!.hasNext).toBe(false)
  })
  it('a booking that already started is not a next booking', async () => {
    const ginza = await render(STORE_A)
    // cus-01 holds past bookings AND a future one: the future one wins.
    expect(ginza.find((r) => r.id === 'cus-01')!.nextLabel).toBe('8月20日 10:00')
    // cus-05's only 銀座 booking is 8 days behind us → none.
    expect(ginza.find((r) => r.id === 'cus-05')!.nextLabel).toBe('なし')
  })
  it('formats the slot in JST regardless of the server clock', async () => {
    // The fixture asks for 10:00 JST; the instant is 01:00Z. Never 01:00.
    expect((await render(STORE_A)).find((r) => r.id === 'cus-01')!.nextLabel).toBe('8月20日 10:00')
    expect((await render(STORE_A)).find((r) => r.id === 'cus-01')!.nextDetail).toContain('10:00–11:00')
  })
  it('derives 来店履歴 / 最終来店 / 累計支払 from the same bookings, so they agree', async () => {
    const akari = (await render(STORE_A)).find((r) => r.id === 'cus-01')!
    expect(akari.history.length).toBeGreaterThan(0)
    expect(akari.lastVisitShort).not.toBeNull()
    expect(akari.totalSpent).toBe(6600) // one completed 銀座 booking at ¥6,600
  })
  it('keeps another store name out of the DOM under a clamped lens (isolation law)', async () => {
    const clamped = await props(STORE_A)
    expect(clamped!.grouped).toBe(false)
    expect(clamped!.rows.every((r) => r.storeLabel === null)).toBe(true)
    expect(clamped!.lensLabel).toBe('テスト東京店')
  })
  it('no ?store= opens on the operator’s own store, NOT the merged view (⚖ 8/20)', async () => {
    // すべての店舗 left the sidebar switcher, so the bare URL must land clamped.
    // The page's {viewAll:true} branch survives as unreachable depth for
    // reconnect; the data layer's own viewAll behavior is covered above.
    const bare = await props()
    expect(bare!.grouped).toBe(false)
    expect(bare!.lensLabel).toBe('テスト東京店')
    expect(bare!.rows.every((r) => r.storeLabel === null)).toBe(true)
    expect(bare!.rows).toEqual((await props(STORE_A))!.rows)
  })
  it('⚖ B1-1 — 累計支払 is BOOKING-derived, so a thin row shows it like anyone else', async () => {
    // 回数券 and 預かり残高 are PROFILE facts and stay unknown for a thin row; the
    // money a booking produced is not a profile fact. なぎ (thin-02) has a
    // completed 銀座 visit, so both surfaces that print 累計支払 must agree.
    const ginza = await render(STORE_A)
    const nagi = ginza.find((r) => r.id === 'thin-02')!
    expect(nagi.thin).toBe(true)
    expect(nagi.externalOwner).toBe(false)
    expect(nagi.totalSpent).toBe(6600)
    expect(spentLabel(nagi.totalSpent)).toBe('¥6,600')
    // …and そら, whose 正本 is an external booking source, still states 「—」.
    const sora = ginza.find((r) => r.id === 'thin-01')!
    expect(sora.totalSpent).toBeNull()
    expect(spentLabel(sora.totalSpent)).toBe('—')
    // なぎ's recorded consent reaches the row, so the thin branch has a ledger to
    // render; そら's is null, so it has none.
    expect(nagi.consent).toEqual({ line: false, sms: true, email: false })
    expect(sora.consent).toBeNull()
  })

  it('⚖ V-1 — three shapes of consent, and only the thin one is silent', async () => {
    const ginza = await render(STORE_A)
    // おとは: a REAL customer with nothing recorded. She has a ledger and it is
    // empty — the section renders with 「—」 on all three channels.
    const otoha = ginza.find((r) => r.id === 'cus-05')!
    expect(otoha.thin).toBe(false)
    expect(otoha.consent).toBeNull()
    expect(consentLabel(otoha.consent)).toBe('—')
    // そら: thin, so there is no profile and no ledger to show at all.
    const sora = ginza.find((r) => r.id === 'thin-01')!
    expect(sora.thin).toBe(true)
    expect(sora.consent).toBeNull()
    // なぎ: thin, but a consent WAS recorded — the thin branch shows it.
    const nagi = ginza.find((r) => r.id === 'thin-02')!
    expect(nagi.thin).toBe(true)
    expect(nagi.consent).toEqual({ line: false, sms: true, email: false })
    expect(consentLabel(nagi.consent)).toBe('SMS')
  })

  it('⚖ B1-5b — no completed visit in THIS lens is unknown, never a confident ¥0', async () => {
    const ginza = await render(STORE_A)
    // きり's only completed visit is in 代官山; うみ has none anywhere. A 銀座 desk
    // may not state that either has spent nothing HERE.
    expect(ginza.find((r) => r.id === 'cus-07')!.totalSpent).toBeNull()
    expect(ginza.find((r) => r.id === 'cus-03')!.totalSpent).toBeNull()
    expect(spentLabel(null)).toBe('—')
    // …while a customer who really did spend here keeps her number.
    expect(ginza.find((r) => r.id === 'cus-05')!.totalSpent).toBe(6600)
    // …and a REAL zero still exists: a visit recorded at ¥0 sums to ¥0, not null.
    const zeroPriced = appointments().map((a) =>
      a.id === 'apt-04' ? { ...a, booked_price: 0 } : a,
    )
    const { props } = await customersProps({ locale: 'ja', store: STORE_A, world: { appointments: zeroPriced } })
    expect(props.rows.find((r) => r.id === 'cus-05')!.totalSpent).toBe(0)
    expect(spentLabel(0)).toBe('¥0')
  })

  it('⚖ B1-5c — a world override goes through the SAME lens the door applies', async () => {
    // The harness may hand the room another world; it may not hand it another
    // store. A 代官山 slot injected under 銀座 must never reach a 銀座 row.
    const injected = {
      ...appointments()[0],
      id: 'apt-inject-daikanyama',
      store_id: STORE_B,
      customer_id: 'cus-01',
      starts_at: jstSlot(2, 9, 0),
      ends_at: jstSlot(2, 10, 0),
      status: 'booked' as const,
      booked_price: 9900,
    }
    const world = { appointments: [...appointments(), injected] }
    const ginza = await customersProps({ locale: 'ja', store: STORE_A, world })
    const akariGinza = ginza.props.rows.find((r) => r.id === 'cus-01')!
    const plain = (await render(STORE_A)).find((r) => r.id === 'cus-01')!
    expect(akariGinza.nextLabel).toBe(plain.nextLabel)
    expect(akariGinza.history).toEqual(plain.history)
    expect(akariGinza.bookings).toEqual(plain.bookings)
    expect(JSON.stringify(akariGinza)).not.toContain('9,900')
    // …and under 代官山 the same injected slot IS her next booking.
    const daikanyama = await customersProps({ locale: 'ja', store: STORE_B, world })
    expect(daikanyama.props.rows.find((r) => r.id === 'cus-01')!.hasNext).toBe(true)
    expect(daikanyama.props.rows.find((r) => r.id === 'cus-01')!.nextPrice).toBe('¥9,900')
  })

  it('an external-owner thin row states 「—」 rather than guessing money', async () => {
    const sora = (await render(STORE_A)).find((r) => r.id === 'thin-01')!
    expect(sora.totalSpent).toBeNull()
    expect(sora.consent).toBeNull()
    expect(sora.externalOwner).toBe(true)
    expect(sora.note).not.toBeNull()
  })
  it('表示する列: any column can be hidden, but never the last one', () => {
    // Canon's rule (fable-shared.js:190-193). The four core columns are NOT
    // pinned there — only "one must survive" is.
    expect(toggleColumn(['person', 'next'], 'lastVisit')).toEqual(['person', 'next', 'lastVisit'])
    expect(toggleColumn(['person', 'next'], 'person')).toEqual(['next'])
    expect(toggleColumn(['person'], 'person')).toEqual(['person'])
  })

  it('本人関係 lists only the parties that DEVIATE (⚖ cut #7)', async () => {
    const rows = await render()
    expect(rows.find((r) => r.id === 'cus-01')!.party).toEqual([])
    expect(rows.find((r) => r.id === 'cus-03')!.party.map((p) => p.role)).toEqual(['保護者', '支払者'])
  })

  // ── V2 · the row shape the redesign reads ────────────────────────────────
  it('⚖-ADJ M — duplicateOf returns, and it RESOLVES for all three candidates', async () => {
    // WO-1b removed it because nothing read it; the compare drawer reads it now.
    // It is a member_number, so the drawer's lookup is by 顧客番号 — a lookup by
    // row id would silently find nothing and render an empty partner forever.
    const rows = await render(STORE_A)
    const byNo = new Map(rows.map((r) => [r.no, r]))
    const candidates = rows.filter((r) => r.merge !== 'none')
    expect(candidates.map((r) => r.id).sort()).toEqual(['cus-01', 'cus-04', 'cus-09'])
    expect(candidates.map((r) => [r.no, r.duplicateOf])).toEqual([
      ['C-3001', 'C-3009'],
      ['C-3004', 'C-3010'],
      ['C-3009', 'C-3001'],
    ])
    for (const c of candidates) expect(byNo.get(c.duplicateOf!)).toBeDefined()
  })

  it('⚖ RIDER §3.1 — 空き日数 is whole JST days off the ONE render anchor', async () => {
    const rows = await render(STORE_A)
    const by = (id: string) => rows.find((r) => r.id === id)!
    // apt-04 puts おとは 8 days back inside 銀座
    expect(by('cus-05').daysSinceLastVisit).toBe(8)
    expect(by('cus-05').winBack).toBe('最終来店から 8日')
    // apt-12 is いつき's completed visit TODAY, and she has no future booking
    expect(by('cus-02').daysSinceLastVisit).toBe(0)
    expect(by('cus-02').hasNext).toBe(false)
    expect(by('cus-02').winBack).toBe('本日来店')
    // かなで has never booked anywhere (the CM-9 row)
    expect(by('cus-10').daysSinceLastVisit).toBeNull()
    expect(by('cus-10').winBack).toBe('来店記録なし')
    // …and the inspector's own line carries the same number
    expect(by('cus-05').lastVisitMeta).toMatch(/^最終来店 .+（8日前）$/)
    expect(by('cus-02').lastVisitMeta).toMatch(/（本日）$/)
    expect(by('cus-10').lastVisitMeta).toBe('最終来店 記録なし')
  })

  it('⚖ RIDER §3.1 — the number grows with the clock, and is never negative or NaN', async () => {
    for (const days of [30, 400]) {
      jest.setSystemTime(new Date(Date.now() + days * 86_400_000))
      const rows = await render(STORE_A)
      const seen = rows.map((r) => r.daysSinceLastVisit).filter((n): n is number => n !== null)
      expect(seen.length).toBeGreaterThan(0)
      for (const n of seen) {
        expect(Number.isFinite(n)).toBe(true)
        expect(n).toBeGreaterThanOrEqual(0)
      }
      jest.setSystemTime(new Date('2026-08-19T00:00:00Z'))
    }
  })

  it('⚖ RIDER §3.2 — 使い切り fires at a balance of exactly 1, and no fixture row is at 1', async () => {
    // The world is OUT of fence, so the state is proven on a WORLD OVERRIDE
    // through the REAL derivations rather than by editing four lanes' fixtures.
    const plain = await render(STORE_A)
    expect(plain.every((r) => r.ticketEnding === false)).toBe(true)
    expect(plain.filter((r) => r.ticket === 1)).toHaveLength(0)

    const ticket1 = customers.map((c) => (c.id === 'cus-06' ? { ...c, ticket_balance: 1 } : c))
    const { props } = await customersProps({ locale: 'ja', store: STORE_A, world: { customers: ticket1 } })
    const kaeru = props.rows.find((r) => r.id === 'cus-06')!
    expect(kaeru.ticket).toBe(1)
    expect(kaeru.ticketEnding).toBe(true)
    expect(ticketLabel(kaeru.ticket)).toBe('残 1回')
    // …and 2 is NOT 使い切り
    const ticket2 = customers.map((c) => (c.id === 'cus-06' ? { ...c, ticket_balance: 2 } : c))
    const two = await customersProps({ locale: 'ja', store: STORE_A, world: { customers: ticket2 } })
    expect(two.props.rows.find((r) => r.id === 'cus-06')!.ticketEnding).toBe(false)
  })

  it('⚖ RIDER §3.3 — the lifecycle category is the BOARD’s own, and the chip is 新規/VIP only', async () => {
    const rows = await render(STORE_A)
    const by = (id: string) => rows.find((r) => r.id === id)!
    // INDEPENDENTLY RECOMPUTED, not read back off the same field: the board's
    // own two functions, on the same lens-clamped appointments, must agree with
    // the room row for row. A category from a second function is a red run.
    const clampedBookings = await data.listAppointments(STORE_A)
    const prior = priorVisitCounts(clampedBookings, jstDayKey(new Date()))
    for (const r of rows) {
      const fixture = customers.find((c) => c.id === r.id)
      if (!fixture) continue
      expect({ id: r.id, cat: r.category }).toEqual({
        id: r.id,
        cat: bookingCategory(fixture, prior.get(r.id) ?? 0),
      })
    }
    expect(by('cus-11').category).toBe('new') // さくら — booked today, no completed visit behind her
    expect(by('cus-10').category).toBe('new') // かなで — registered, never booked anywhere
    expect(by('cus-04').category).toBe('vip') // えいた — the one VIP
    // ⚠ THE LITERAL WORDS, NOT A READ-BACK OF THE SAME CONSTANT. Asserting
    // `chip === CATEGORY_LABEL.new` moves with the constant, so a second home
    // for the word (or a rename of it) stays green on both sides — the
    // self-referential-census lesson, in a different costume. The board ships
    // these two words; a change to either is a deliberate act, and this is where
    // it has to be noticed.
    expect(CATEGORY_LABEL.new).toBe('新規')
    expect(CATEGORY_LABEL.vip).toBe('VIP')
    expect(by('cus-11').categoryChip).toBe('新規')
    expect(by('cus-04').categoryChip).toBe('VIP')
    // …and a 再来 or a 回数券 row carries NO chip: a chip that repeats a column
    // is clutter (the big-tech simplicity law).
    expect(by('cus-01').category).toBe('ticket')
    expect(by('cus-01').categoryChip).toBeNull()
    expect(by('cus-02').category).toBe('repeat')
    expect(by('cus-02').categoryChip).toBeNull()
    // ⚠ 新規 IS LENS-SCOPED, AND THAT IS THE POINT (C2-3). うみ and きり have
    // completed visits in 代官山 and NONE in 銀座, so from this desk they are new
    // — which is exactly what 今日の運営's board says about them on the same
    // clamped rows, and the only reading the isolation law allows (a 再来 chip
    // here would be this store learning that another store has served them).
    expect(rows.filter((r) => r.categoryChip !== null).map((r) => r.id).sort()).toEqual([
      'cus-03', 'cus-04', 'cus-07', 'cus-10', 'cus-11',
    ])
    // …and the OTHER store's desk reads them the other way round, which is the
    // same rule seen from the other side of the wall.
    const daikanyama = await render(STORE_B)
    expect(daikanyama.find((r) => r.id === 'cus-07')!.category).toBe('repeat')
    expect(daikanyama.find((r) => r.id === 'cus-07')!.categoryChip).toBeNull()
  })

  it('⚖ G2 — the rendered screen is KEYED by the resolved lens, per store', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const keyOf = (node: any): string | null => {
      if (!node || typeof node !== 'object') return null
      if (node.type === CustomersScreen) return node.key
      const kids = node.props?.children
      for (const kid of Array.isArray(kids) ? kids.flat() : [kids]) {
        const hit = keyOf(kid)
        if (hit) return hit
      }
      return null
    }
    const rendered = async (store?: string) =>
      keyOf(await CustomersPage({
        params: Promise.resolve({ locale: 'ja' }),
        searchParams: Promise.resolve(store ? { store } : {}),
      }))
    expect(await rendered(STORE_A)).toBe(STORE_A)
    expect(await rendered(STORE_B)).toBe(STORE_B)
    // the bare URL clamps, so it keys the same as the store it lands on
    expect(await rendered()).toBe(STORE_A)
  })

  it('⚖-ADJ B — the two live doors carry THIS page’s lens, and are never dropped', async () => {
    const clamped = await props(STORE_A)
    expect(clamped!.inboxHref).toBe(`/ja/business/inbox?store=${STORE_A}`)
    expect(clamped!.karuteHref).toBe(`/ja/business/karute?store=${STORE_A}`)
    // the bare URL clamps, so its doors point at the SAME store rather than at
    // a merged view the switcher no longer offers
    const bare = await props()
    expect(bare!.inboxHref).toBe(clamped!.inboxHref)
    expect(bare!.karuteHref).toBe(clamped!.karuteHref)
  })

  it('the tile predicates count what the tiles promise, on the real plane', async () => {
    const rows = await render(STORE_A)
    expect(rows.filter((r) => r.ticket != null && r.ticket > 0).map((r) => r.id)).toEqual([
      'cus-01', 'cus-04', 'cus-06', 'cus-08',
    ])
    // cus-04 holds ¥0, which is NOT 預かり残高あり
    expect(rows.find((r) => r.id === 'cus-04')!.wallet).toBe(0)
    expect(rows.filter((r) => r.wallet != null && r.wallet > 0).map((r) => r.id)).toEqual([
      'cus-01', 'cus-03', 'cus-06', 'cus-08',
    ])
    expect(rows.filter((r) => r.merge !== 'none')).toHaveLength(3)
  })

  // ── the L-6 promise, stated as a test ────────────────────────────────────
  it.each([30, 400])('is still populated %i days from now', async (days) => {
    jest.setSystemTime(new Date(Date.now() + days * 86_400_000))
    const rows = await render(STORE_A)
    expect(rows.filter((r) => r.hasNext).length).toBeGreaterThan(0)
    expect(rows.filter((r) => r.history.length > 0).length).toBeGreaterThan(0)
    expect(rows.filter((r) => r.lastVisitShort !== null).length).toBeGreaterThan(0)
    jest.setSystemTime(new Date('2026-08-19T00:00:00Z'))
  })
})
