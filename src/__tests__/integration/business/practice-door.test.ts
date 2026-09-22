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
