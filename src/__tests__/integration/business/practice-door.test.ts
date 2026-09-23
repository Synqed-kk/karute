/**
 * The practice-salon door, PR-1 (DESIGN-PRACTICE-DOOR.md §1, §2, §4, §8): the
 * switch, the tenant throw, the registry parser + generated map, the sample
 * facade, the door's export list, and data.ts's one-line seam (the door's ON
 * behaviour is practice-door-on.test.ts, against the recorded answer set). Unit-level: no
 * network — the core client is constructed at most with dummy env, never called.
 */

// The SDK ships raw ESM that this jest setup does not transform; every repo test
// that reaches the factory stubs the class the same way (request-correlation.test.ts).
// Nothing is ever called on it: the env check in newSynqedClient stays REAL.
jest.mock('@synqed-kk/client', () => ({ SynqedClient: class {} }))

import { practiceTenant } from '@/business/lib/practice-door/switch'
import { clientFor, PracticeTenantMismatch } from '@/business/lib/practice-door/core-reach'
import { parseManifest } from '@/business/lib/practice-door/registry-manifest'
import { PRACTICE_REGISTRY } from '@/business/lib/practice-door/registry.generated'
import { fixtureIdOf, liveIdOf, samplePolicyFor, STORE_SAMPLE_POLICY } from '@/business/lib/practice-door/registry'
import { sampleFor, sampleSelfId } from '@/business/lib/practice-door/sample-facade'
import { appointments, customers, menus, staff, stores, STORE_A, STORE_B } from '@/business/lib/fixtures'
import { businessProfiles } from '@/business/lib/fixtures-settings'
import * as door from '@/business/lib/practice-door/door'
import * as data from '@/business/lib/data'
import { renderNow as clockRenderNow } from '@/business/lib/clock'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const U = 'FB44DD68-4AF7-44B0-8CC7-4EE10C54491D'
const u = U.toLowerCase()
const ENV_KEYS = ['BUSINESS_PRACTICE_TENANT', 'SYNQED_CORE_URL', 'SYNQED_CORE_API_KEY'] as const
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})
function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  for (const k of ENV_KEYS) {
    const v = values[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

describe('the switch', () => {
  it('unset is OFF', () => {
    setEnv({})
    expect(practiceTenant()).toBeNull()
  })
  it("'' is OFF", () => {
    setEnv({ BUSINESS_PRACTICE_TENANT: '' })
    expect(practiceTenant()).toBeNull()
  })
  it('a UUID in any case is ON, lowercased', () => {
    setEnv({ BUSINESS_PRACTICE_TENANT: U })
    expect(practiceTenant()).toBe(u)
    setEnv({ BUSINESS_PRACTICE_TENANT: u })
    expect(practiceTenant()).toBe(u)
  })
  it('a non-UUID throws — a typo never silently means OFF', () => {
    setEnv({ BUSINESS_PRACTICE_TENANT: 'nope' })
    expect(() => practiceTenant()).toThrow('BUSINESS_PRACTICE_TENANT is set but is not a UUID')
  })
})

const READS = [
  'answerSheet',
  'appointmentsList',
  'customerVisits',
  'customersList',
  'menusList',
  'orgSettingsGet',
  'resourcesList',
  'staffList',
  'staffStoresList',
  'storesList',
]

describe('core-reach: the tenant throw comes before the client', () => {
  it('switch unset → refuses', () => {
    setEnv({})
    expect(() => clientFor({ businessId: u })).toThrow('practice door called with the switch unset')
  })
  it('another business → PracticeTenantMismatch, thrown before the factory runs (core env UNSET)', () => {
    setEnv({ BUSINESS_PRACTICE_TENANT: u })
    let err: unknown
    try {
      clientFor({ businessId: 'other' })
    } catch (e) {
      err = e
    }
    // Had the factory run first it would have thrown 'Missing SYNQED_CORE_URL…'.
    expect(err).toBeInstanceOf(PracticeTenantMismatch)
    expect((err as PracticeTenantMismatch).name).toBe('PracticeTenantMismatch')
    expect((err as PracticeTenantMismatch).businessId).toBe('other')
    expect((err as Error).message).toBe('practice switch refused business other')
  })
  it('the practice tenant → exactly the ten bound reads, nothing else', () => {
    setEnv({ BUSINESS_PRACTICE_TENANT: u, SYNQED_CORE_URL: 'https://dummy.invalid', SYNQED_CORE_API_KEY: 'dummy' })
    const reads = clientFor({ businessId: u })
    expect(Object.keys(reads).sort()).toEqual(READS)
    for (const k of Object.keys(reads)) expect(typeof (reads as Record<string, unknown>)[k]).toBe('function')
  })
  it('no mutator key on the returned object', () => {
    setEnv({ BUSINESS_PRACTICE_TENANT: u, SYNQED_CORE_URL: 'https://dummy.invalid', SYNQED_CORE_API_KEY: 'dummy' })
    const reads = clientFor({ businessId: u })
    for (const bad of ['create', 'update', 'delete', 'set', 'save', 'upsert']) expect(reads).not.toHaveProperty(bad)
  })
})

const SNIPPET = `# MANIFEST
- fixtures commit: abc1234

## Stores
| fixture id | name | core uuid | status |
|---|---|---|---|
| store-a | A店 | 11111111-1111-4111-8111-111111111111 | adopted |
| store-b | B店 | 22222222-2222-4222-8222-222222222222 | created |

## Staff
| fixture id | name | assigned stores | core uuid | status |
|---|---|---|---|---|
| p-01 | はなこ | A店 | 33333333-3333-4333-8333-333333333333 | adopted |

## Menus
| fixture id | name | store | core uuid | status |
|---|---|---|---|---|
| menu-01 | 整体 | A店 | 44444444-4444-4444-8444-444444444444 | adopted |

## Customers
| fixture id | member_number | name | core uuid | status |
|---|---|---|---|---|
| cus-01 | C-1 | あかり | 55555555-5555-4555-8555-555555555555 | adopted |

## Appointments
| fixture id | display_no | JST date-time | customer | staff | store | menu | core uuid | status |
|---|---|---|---|---|---|---|---|---|
| apt-01 | R-1 | 2026-09-07 10:00 JST | あかり | はなこ | A店 | 整体 | 66666666-6666-4666-8666-666666666666 | adopted |

### Store
| name | address | phone | core uuid | status |
|---|---|---|---|---|
| C店 | 東京 | 03 | 77777777-7777-4777-8777-777777777777 | created |

### Staff (addendum)
| name | kana | role | core uuid | status |
|---|---|---|---|---|
| れいな | — | STYLIST | 88888888-8888-4888-8888-888888888888 | created |
`

describe('the manifest parser', () => {
  it('reads both schemas: the twin tables and the addendum store', () => {
    const r = parseManifest(SNIPPET)
    expect(r.source.fixturesCommit).toBe('abc1234')
    expect(Object.fromEntries(Object.entries(r.twins).map(([k, m]) => [k, Object.keys(m).length]))).toEqual({
      stores: 2, staff: 1, menus: 1, customers: 1, appointments: 1,
    })
    expect(r.twins.stores['store-b']).toBe('22222222-2222-4222-8222-222222222222')
    expect(r.twins.staff['p-01']).toBe('33333333-3333-4333-8333-333333333333')
    expect(r.twins.menus['menu-01']).toBe('44444444-4444-4444-8444-444444444444')
    expect(r.twins.customers['cus-01']).toBe('55555555-5555-4555-8555-555555555555')
    expect(r.twins.appointments['apt-01']).toBe('66666666-6666-4666-8666-666666666666')
    expect(r.addendumStores).toEqual({ 'C店': '77777777-7777-4777-8777-777777777777' })
  })
  it('an unknown table header throws', () => {
    expect(() => parseManifest(SNIPPET.replace('| fixture id | name | core uuid | status |', '| fixture id | label | core uuid | status |')))
      .toThrow('manifest: unknown table header')
  })
  it('a duplicate fixture id throws', () => {
    expect(() => parseManifest(SNIPPET.replace('| store-b |', '| store-a |'))).toThrow('duplicate stores fixture id store-a')
  })
  it('a failed row throws', () => {
    expect(() => parseManifest(SNIPPET.replace('| cus-01 | C-1 | あかり | 55555555-5555-4555-8555-555555555555 | adopted |', '| cus-01 | C-1 | あかり | 55555555-5555-4555-8555-555555555555 | failed |')))
      .toThrow('row status is failed')
  })
  it('a table with no separator row throws', () => {
    expect(() => parseManifest('- fixtures commit: abc1234\n\n## Stores\n| fixture id | name | core uuid | status |\n| store-a | A店 | 11111111-1111-4111-8111-111111111111 | adopted |\n'))
      .toThrow('table without a separator row')
  })
  it('a reserved fixture id (__proto__) throws instead of vanishing', () => {
    expect(() => parseManifest(SNIPPET.replace('| store-b |', '| __proto__ |'))).toThrow('reserved key refused')
  })
  it('a reserved addendum store name (constructor) throws', () => {
    expect(() => parseManifest(SNIPPET.replace('| C店 |', '| constructor |'))).toThrow('reserved key refused')
  })
  it('a row whose cell count differs from the header throws', () => {
    expect(() => parseManifest('- fixtures commit: abc1234\n\n## Stores\n| fixture id | name | core uuid | status |\n|---|---|---|---|\n| store-a | A店 | 11111111-1111-4111-8111-111111111111 |\n'))
      .toThrow('row has 3 cells, header 4')
  })
})

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FIXTURE_IDS: Record<keyof typeof PRACTICE_REGISTRY.twins, string[]> = {
  stores: stores.map((s) => s.id),
  staff: staff.map((s) => s.id),
  menus: menus.map((m) => m.id),
  customers: customers.map((c) => c.id),
  appointments: appointments(new Date()).map((a) => a.id),
}

describe('the generated registry', () => {
  const kinds = Object.keys(PRACTICE_REGISTRY.twins) as Array<keyof typeof PRACTICE_REGISTRY.twins>
  it.each(kinds)('%s: every fixture id exists, uuids are v4-shaped and unique, the inverse is bijective', (kind) => {
    const entries = Object.entries(PRACTICE_REGISTRY.twins[kind] as Record<string, string>)
    expect(entries.length).toBeGreaterThan(0)
    for (const [fixtureId, uuid] of entries) {
      expect(FIXTURE_IDS[kind]).toContain(fixtureId)
      expect(uuid).toMatch(V4)
      expect(liveIdOf(kind, fixtureId)).toBe(uuid)
      expect(fixtureIdOf(kind, uuid)).toBe(fixtureId)
    }
    expect(new Set(entries.map(([, v]) => v)).size).toBe(entries.length)
  })
  it('the store sample policy is the three declared uuids and none for everything else', () => {
    expect(Object.keys(STORE_SAMPLE_POLICY).sort()).toEqual([
      '8696b856-11ab-4879-9290-bef40b03ea66',
      '8ac43a4b-7763-4a10-9f73-a662085460af',
      'aa36d5fe-8e35-46bb-8c9b-ac92a8aa816f',
    ])
    expect(samplePolicyFor('aa36d5fe-8e35-46bb-8c9b-ac92a8aa816f')).toEqual({ kind: 'twin', fixtureStoreId: STORE_A })
    expect(samplePolicyFor('8ac43a4b-7763-4a10-9f73-a662085460af')).toEqual({ kind: 'twin', fixtureStoreId: STORE_B })
    expect(samplePolicyFor('8696b856-11ab-4879-9290-bef40b03ea66')).toEqual({
      kind: 'named', business_type: 'esthetic_salon', words: null, dials: null,
    })
    expect(samplePolicyFor('5a171878-0000-0000-0000-000000000000')).toEqual({ kind: 'none' })
    expect(samplePolicyFor('')).toEqual({ kind: 'none' })
    const twinStores = Object.values(PRACTICE_REGISTRY.twins.stores) as string[]
    const addendum = Object.values(PRACTICE_REGISTRY.addendumStores) as string[]
    const profiles = businessProfiles.map((p) => p.value as string)
    for (const [uuid, policy] of Object.entries(STORE_SAMPLE_POLICY)) {
      if (policy.kind === 'twin') {
        expect(twinStores).toContain(uuid)
        expect(liveIdOf('stores', policy.fixtureStoreId)).toBe(uuid)
      }
      if (policy.kind === 'named') {
        expect(addendum).toContain(uuid)
        expect(profiles).toContain(policy.business_type)
      }
    }
    // …and the reverse: 設定's D1 gate reads "is this store a twin?" from the
    // registry (sampleSelfId) but takes the dials from this policy, so a
    // registry-only twin would bring 店舗を選んでください back under ON silently.
    for (const uuid of twinStores) {
      expect({ uuid, policy: samplePolicyFor(uuid) }).toEqual({ uuid, policy: { kind: 'twin', fixtureStoreId: fixtureIdOf('stores', uuid) } })
    }
  })
})

describe('the sample facade', () => {
  const live = (kind: keyof typeof PRACTICE_REGISTRY.twins, id: string) => liveIdOf(kind, id)!
  it('rewrites typed id fields by exact match and nothing else', () => {
    const input = { id: 'p-01', staff_id: 'c-03', store_id: STORE_A, member_number: 'C-3001', duplicate_of: 'C-3002', note: 'p-01 mentioned' }
    const before = JSON.stringify(input)
    const out = sampleFor(input, 'staff')
    expect(out).toEqual({
      id: live('staff', 'p-01'),
      staff_id: live('staff', 'c-03'),
      store_id: live('stores', STORE_A),
      member_number: 'C-3001',
      duplicate_of: 'C-3002',
      note: 'p-01 mentioned',
    })
    expect(JSON.stringify(input)).toBe(before)
  })
  it("a decision's owner_staff_id becomes the manifest uuid; null stays null", () => {
    expect(sampleFor([{ id: 'dec-1', owner_staff_id: 'p-06' }, { id: 'dec-2', owner_staff_id: null }], null)).toEqual([
      { id: 'dec-1', owner_staff_id: 'd27c76c4-eda7-4b12-9491-4eb6d9edaee5' },
      { id: 'dec-2', owner_staff_id: null },
    ])
  })
  it('sampleSelfId: OFF passes the id through; ON a live uuid → its fixture twin, an unknown uuid → null', () => {
    setEnv({})
    expect(sampleSelfId('staff', 'p-06')).toBe('p-06')
    setEnv({ BUSINESS_PRACTICE_TENANT: u })
    expect(sampleSelfId('staff', 'd27c76c4-eda7-4b12-9491-4eb6d9edaee5')).toBe('p-06')
    expect(sampleSelfId('staff', '00000000-0000-4000-8000-000000000000')).toBeNull()
  })
  it('leaves unknown ids alone, walks nested planes, keeps Date instances', () => {
    const when = new Date()
    const out = sampleFor(
      { rows: [{ id: 'apt-01', customer_id: 'cus-01', menu_id: 'no-such-menu', at: when }], held: { appointment_id: 'apt-02' } },
      'appointments',
    )
    expect(out.rows[0].id).toBe(live('appointments', 'apt-01'))
    expect(out.rows[0].customer_id).toBe(live('customers', 'cus-01'))
    expect(out.rows[0].menu_id).toBe('no-such-menu')
    expect(out.rows[0].at).toBe(when)
    expect(out.held.appointment_id).toBe(live('appointments', 'apt-02'))
    expect(sampleFor({ id: 'p-01' }, null)).toEqual({ id: 'p-01' })
  })
  it('colliding ids: untyped fields stay put even when every value IS a real fixture id', () => {
    const input = { id: STORE_A, member_number: 'cus-01', duplicate_of: 'cus-02', display_no: 'apt-01', note: 'p-01' }
    for (const [kind, id] of [['stores', STORE_A], ['customers', 'cus-01'], ['customers', 'cus-02'], ['appointments', 'apt-01'], ['staff', 'p-01']] as const) {
      expect(liveIdOf(kind, id)).not.toBeNull()
    }
    expect(sampleFor(input, null)).toEqual(input)
  })
  it("ownKind 'staff' rewrites the outer id only; the nested store id is not a staff id", () => {
    expect(sampleFor({ id: 'p-01', store: { id: STORE_A } }, 'staff')).toEqual({ id: live('staff', 'p-01'), store: { id: STORE_A } })
  })
  it("ownKind 'stores' rewrites to the manifest uuid", () => {
    expect(sampleFor({ id: STORE_A }, 'stores')).toEqual({ id: 'aa36d5fe-8e35-46bb-8c9b-ac92a8aa816f' })
  })
  it.each(['__proto__', 'constructor', 'prototype'])('a %s key is refused loud and never reaches Object.prototype', (key) => {
    const plane = JSON.parse(`{"${key}":{"x":1}}`)
    expect(() => sampleFor(plane, null)).toThrow(`refused key "${key}"`)
    const result = sampleFor({ a: 1 }, null)
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
  })
})

const DOOR_READERS = [
  'listStoreOptions', 'listCustomers', 'listAppointments', 'listVisits', 'readShellIdentity', 'listMenus',
  'readUnresolvedCounts', 'listResources', 'listShiftsByDay', 'listAbsenceByDay', 'listBlocksByDay',
  'readDayPlanes', 'readReservationPlanes', 'readAnalyticsPlanes', 'listStaff', 'readStaffStores',
] as const

describe('the door', () => {
  it('exports exactly the sixteen readers', () => {
    expect(Object.keys(door).sort()).toEqual([...DOOR_READERS].sort())
  })
})

describe('the data.ts seam', () => {
  it('OFF: the fixture path answers, unchanged', async () => {
    setEnv({})
    const off = await data.listMenus('store-test-ginza')
    expect(off.length).toBeGreaterThan(0)
    expect(off).toEqual(menus.filter((m) => m.store_id == null || m.store_id === 'store-test-ginza'))
    expect(await data.listStoreOptions()).toEqual(stores)
  })
  it('renderNow and defaultStoreId never delegate', () => {
    for (const env of [{}, { BUSINESS_PRACTICE_TENANT: u }]) {
      setEnv(env)
      expect(data.renderNow()).toBeInstanceOf(Date)
      expect(data.renderNow).toBe(clockRenderNow) // one memoised clock, re-exported
      expect(data.defaultStoreId(undefined, stores)).toBe(stores[0].id)
      expect(data.defaultStoreId(STORE_B, stores)).toBe(STORE_B)
    }
  })
})

describe('PR-2b — the rooms read ROW data only through the door', () => {
  const ROOMS = join(process.cwd(), 'src/app/[locale]/(business)')
  /** Core holds these: a room takes them from data.ts, never from a fixtures module. */
  const ROW_NAMES = new Set(['business', 'menus', 'staff', 'stores', 'reserveSync', 'resources'])
  const isFixtures = (spec: string) => /(^|\/)fixtures(-[\w-]+)?$/.test(spec)
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  /** Every VALUE a file takes from a fixtures module (`file: name`); a form whose
   *  names cannot be read off the statement (namespace, `export *`, dynamic,
   *  require) is reported whole, so it can never slip a ROW name past the pin. */
  function fixtureValues(file: string, src: string): string[] {
    const code = strip(src)
    const out: string[] = []
    // A default binding may stand before the braces (`import def, { menus } from …`).
    for (const m of code.matchAll(/\b(?:import|export)\s+(type\s+)?(?:\w+\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
      if (m[1] || !isFixtures(m[3])) continue
      for (const spec of m[2].split(',')) {
        const name = spec.trim()
        if (name !== '' && !name.startsWith('type ')) out.push(`${file}: ${name.split(/\s+as\s+/)[0]}`)
      }
    }
    for (const m of code.matchAll(/\bimport\s+\*\s+as\s+\w+\s+from\s*['"]([^'"]+)['"]/g)) if (isFixtures(m[1])) out.push(`${file}: * namespace`)
    for (const m of code.matchAll(/\bexport\s+\*\s+(?:as\s+\w+\s+)?from\s*['"]([^'"]+)['"]/g)) if (isFixtures(m[1])) out.push(`${file}: * namespace`)
    for (const m of code.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g)) if (isFixtures(m[1])) out.push(`${file}: * dynamic`)
    return out
  }
  const forbidden = (taken: string[]) => taken.filter((t) => ROW_NAMES.has(t.split(': ')[1]) || t.includes(': * '))

  it('the scan catches every import form and passes the honest ones', () => {
    for (const decoy of [
      "import { menus } from '@/business/lib/fixtures'",
      "import {\n  analyticsPolicy,\n  staff as roster,\n} from '@/business/lib/fixtures'",
      "import { type FixtureMenu, resources } from '@/business/lib/fixtures-today'",
      "export { stores } from '../../../business/lib/fixtures'",
      "import { business, reserveSync } from '@/business/lib/fixtures'",
      "import * as fx from '@/business/lib/fixtures'",
      "const fx = await import('@/business/lib/fixtures')",
      "import def, { menus } from '@/business/lib/fixtures'",
      "export * from '@/business/lib/fixtures'",
      "export * as fx from '../../../business/lib/fixtures-today'",
    ]) expect({ decoy, caught: forbidden(fixtureValues('decoy', decoy)).length > 0 }).toEqual({ decoy, caught: true })
    for (const honest of [
      "import type { FixtureStaff } from '@/business/lib/fixtures'",
      "// import { menus } from '@/business/lib/fixtures'",
      "import { staffCards, type FixtureAppointment } from '@/business/lib/fixtures'",
      "import { menus } from '@/business/lib/menu-catalog'",
      "export * from '@/business/lib/menu-catalog'",
    ]) expect({ honest, caught: forbidden(fixtureValues('honest', honest)) }).toEqual({ honest, caught: [] })
  })

  it('no room file imports business | menus | staff | stores | reserveSync | resources from a fixtures module', () => {
    const files = (readdirSync(ROOMS, { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f))
    expect(files.length).toBeGreaterThan(20)
    const taken = files.flatMap((f) => fixtureValues(f, readFileSync(join(ROOMS, f), 'utf8')))
    // The scan is reading real imports: the rooms' OTHER fixture reads (staffCards, bedSecuredProof …) are seen.
    expect(taken.length).toBeGreaterThan(0)
    expect(forbidden(taken)).toEqual([])
  })
})
