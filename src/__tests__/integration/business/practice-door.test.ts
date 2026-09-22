/**
 * The practice-salon door, PR-1 (DESIGN-PRACTICE-DOOR.md §1, §2, §4, §8): the
 * switch, the tenant throw, the registry parser + generated map, the sample
 * facade, the not-built door, and data.ts's one-line seam. Unit-level: no
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
import { sampleFor } from '@/business/lib/practice-door/sample-facade'
import { appointments, customers, menus, staff, stores, STORE_A, STORE_B } from '@/business/lib/fixtures'
import { businessProfiles } from '@/business/lib/fixtures-settings'

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
})
