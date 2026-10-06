/**
 * S58 P3-R4 (DECISIONS-S57 R188 page half, R189 payload half) — the お店ページ payload seeds an unsaved record from
 * the SAVE PATH's own answer (data.readStoreSeedType) when connected, and from seedTypeOf(storeType, undefined) when
 * disconnected; startFamily is that seed's family; the read sits behind the settings.manage gate. One flip saved
 * from the payload's own record keeps exactly ONE key OWNER (the shown harm, ATTACK-S57-P3 F1: seven).
 * Harness: practice-door-store-capabilities-s57.test.ts (core-reach + registry mocks, the write) joined with
 * store-page-payload-s57.test.ts (settingsProps, the counted data read).
 */
const mockCore: { reaches: number; settings: Record<string, unknown>; upsert: jest.Mock } = { reaches: 0, settings: {}, upsert: jest.fn() }
jest.mock('@synqed-kk/client', () => ({ SynqedClient: class {} }))
jest.mock('@/business/lib/admission', () => ({ requireBusinessAdmission: jest.fn() }))
jest.mock('@/business/lib/data', () => {
  const actual = jest.requireActual('@/business/lib/data')
  return { ...actual, readStoreSeedType: jest.fn(actual.readStoreSeedType) }
})
jest.mock('@/business/lib/practice-door/core-reach', () => {
  const actual = jest.requireActual('@/business/lib/practice-door/core-reach')
  const { practiceTenant } = jest.requireActual('@/business/lib/practice-door/switch')
  const guard = (admitted: { businessId: string }) => {
    const tenant = practiceTenant()
    if (tenant === null) throw new Error('practice door called with the switch unset')
    if (admitted.businessId !== tenant) throw new actual.PracticeTenantMismatch(admitted.businessId)
  }
  return {
    ...actual,
    clientFor: (admitted: { businessId: string }) => {
      mockCore.reaches++
      guard(admitted)
      const r = jest.requireActual('./practice-door-recorded').recordedReads()
      return {
        ...r,
        orgSettingsGet: async () => {
          const got = await r.orgSettingsGet()
          return got && { ...got, settings: { ...got.settings, ...mockCore.settings } }
        },
      }
    },
    orgSettingsWriterFor: (admitted: { businessId: string }) => (guard(admitted), { orgSettings: { upsert: mockCore.upsert } }),
    storeDaysWriterFor: () => { throw new Error('no store-days writes in this suite') },
    auditWriterFor: () => { throw new Error('no audit writes in this suite') },
  }
})
/** A store's own 業種 as the registry names it ('' = typeless), overriding the twin's type. */
let mockStoreTypes: Record<string, string> = {}
jest.mock('@/business/lib/practice-door/registry', () => {
  const actual = jest.requireActual('@/business/lib/practice-door/registry')
  return { ...actual, samplePolicyFor: (id: string) => (id in mockStoreTypes ? { ...actual.samplePolicyFor(id), business_type: mockStoreTypes[id] } : actual.samplePolicyFor(id)) }
})

import * as data from '@/business/lib/data'
import { requireBusinessAdmission } from '@/business/lib/admission'
import { settingsProps } from '@/app/[locale]/(business)/business/settings/settings-props'
import { familyOf, parseRecord, seedRecord, seedTypeOf, serializeRecord, storeCapabilitiesKeyFor, type CapRecord, type WireRecord } from '@/business/lib/store-page/model'
import { STORES } from '@/business/lib/reserve-card/store-page-sample'
import { LOGIN, STORE, TENANT } from './practice-door-recorded'

const admission = requireBusinessAdmission as jest.MockedFunction<typeof requireBusinessAdmission>
const seedRead = data.readStoreSeedType as jest.MockedFunction<typeof data.readStoreSeedType>
const as = (userId: string) => admission.mockResolvedValue({ userId, email: null, displayName: null, businessId: TENANT })
const S = STORE.tokyo
const K = storeCapabilitiesKeyFor
const storePage = async (store: string = S) =>
  (await settingsProps({ locale: 'ja', store, section: 'reserve-store-page' })).props.sections.find((x) => x.id === 'reserve-store-page')!
const toggle = (rec: CapRecord, key: keyof CapRecord['switches']): CapRecord =>
  ({ ...rec, switches: { ...rec.switches, [key]: { ...rec.switches[key], on: !rec.switches[key].on } } })
/** The OWNER keys of the stored (wire) record, read back through the parser (internal keys, R126). */
const ownerKeys = (rec: WireRecord) => Object.entries(parseRecord(rec)!.switches).filter(([, v]) => v.source === 'OWNER').map(([k]) => k)

const savedEnv = process.env.BUSINESS_PRACTICE_TENANT
beforeEach(() => {
  process.env.BUSINESS_PRACTICE_TENANT = TENANT
  mockCore.reaches = 0
  mockCore.settings = {}
  mockCore.upsert = jest.fn(async (input: { settings: Record<string, unknown> }) => {
    mockCore.settings = { ...mockCore.settings, ...input.settings }
    return { business_id: TENANT, name: 'Dev Salon', settings: mockCore.settings, created_at: 'x', updated_at: 'y' }
  })
  mockStoreTypes = {}
  seedRead.mockClear()
  as(LOGIN.owner)
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => {
  if (savedEnv === undefined) delete process.env.BUSINESS_PRACTICE_TENANT
  else process.env.BUSINESS_PRACTICE_TENANT = savedEnv
  jest.restoreAllMocks()
})

/** Load the payload, flip ONE key of its own record, save it with its own basedOn; answer the stored record. */
async function oneFlipSave() {
  const p = (await storePage()).storePage!
  const result = await data.writeStoreCapabilities(S, toggle(p.saved, 'posts'), [], p.basedOn)
  expect(result).toMatchObject({ ok: true })
  return { p, stored: mockCore.settings[K(S)] as WireRecord }
}

/** The three seed cases (a, b, c), each answering the payload and the seed it must carry. */
const CASES = {
  a: async () => {
    mockStoreTypes = { [S]: 'hair_salon' }
    mockCore.settings = { business_type: 'yoga_studio' }
    return { p: (await storePage()).storePage!, seed: 'hair_salon' }
  },
  b: async () => {
    mockStoreTypes = { [S]: '' }
    mockCore.settings = { business_type: 'yoga_studio' }
    return { p: (await storePage()).storePage!, seed: 'yoga_studio' }
  },
  c: async () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    const ginza = (await data.listStoreOptions()).find((s) => s.id === 'store-test-ginza')
    return { p: (await storePage('store-test-ginza')).storePage!, seed: seedTypeOf(ginza?.business_type, undefined) }
  },
}

describe('S58 P3-R4 (R188) — the page seeds from the save path\'s own answer', () => {
  it('a. connected, no saved record, the store has its own type → the record type is that type = readStoreSeedType; one flip saves ONE owner key', async () => {
    const { p } = await CASES.a()
    expect(p).toMatchObject({ hasSaved: false, disconnected: false })
    expect(p.saved.business_type).toBe('hair_salon')
    expect(await data.readStoreSeedType(S)).toBe('hair_salon')
    const { stored } = await oneFlipSave()
    expect(ownerKeys(stored)).toEqual(['posts'])
    expect(parseRecord(stored)?.business_type).toBe('hair_salon')
  })

  it('b. connected, the store typeless, signup type yoga_studio → seed yoga_studio; one flip saves ONE owner key', async () => {
    const { p } = await CASES.b()
    expect(p.saved.business_type).toBe('yoga_studio')
    expect(await data.readStoreSeedType(S)).toBe('yoga_studio')
    const { stored } = await oneFlipSave()
    expect(ownerKeys(stored)).toEqual(['posts'])
    expect(parseRecord(stored)?.business_type).toBe('yoga_studio')
  })

  it('c. disconnected → seedTypeOf(storeType, undefined), zero core reaches, readStoreSeedType never called', async () => {
    const { p, seed } = await CASES.c()
    expect(p.disconnected).toBe(true)
    expect(p.saved.business_type).toBe(seed)
    expect(mockCore.reaches).toBe(0)
    expect(seedRead).toHaveBeenCalledTimes(0)
  })

  it('d. a reader WITHOUT settings.manage → readStoreSeedType called ZERO times; control: the owner → once, for the lens store', async () => {
    as(LOGIN.perry)
    const shut = await storePage()
    expect(mockCore.reaches).toBeGreaterThan(0)
    expect(shut.storePage).toBeUndefined()
    expect(seedRead).toHaveBeenCalledTimes(0)
    as(LOGIN.owner)
    expect((await storePage()).storePage).toBeDefined()
    expect(seedRead).toHaveBeenCalledTimes(1)
    expect(seedRead).toHaveBeenCalledWith(S)
  })

  it.each(['a', 'b', 'c'] as const)('e. startFamily is the family of the seed type (case %s)', async (c) => {
    const { p, seed } = await CASES[c]()
    expect(p.saved.business_type).toBe(seed)
    expect(p.startFamily).toBe(familyOf(seed as Parameters<typeof familyOf>[0]))
  })
})

describe('S58 P3-R4 (R189) — the payload names the sample its counts were computed for', () => {
  it('f. a gym-family type → the gym sample (force) and its counts', async () => {
    mockStoreTypes = { [S]: 'personal_gym' }
    const p = (await storePage()).storePage!
    expect(p.saved.business_type).toBe('personal_gym')
    expect(p.sampleKey).toBe('force')
    expect(p.counts).toEqual(STORES[p.sampleKey].counts)
  })

  it('f. a salon type → the salon sample (laestro) and its counts', async () => {
    mockStoreTypes = { [S]: 'hair_salon' }
    const p = (await storePage()).storePage!
    expect(p.sampleKey).toBe('laestro')
    expect(p.counts).toEqual(STORES[p.sampleKey].counts)
  })

  it('f. a SAVED record: the sample follows the SAVED type, not the store\'s seed', async () => {
    mockStoreTypes = { [S]: 'hair_salon' }
    mockCore.settings = { [K(S)]: serializeRecord(seedRecord('yoga_studio')) }
    const p = (await storePage()).storePage!
    expect(p.hasSaved).toBe(true)
    expect(p.saved.business_type).toBe('yoga_studio')
    expect(p.startFamily).toBe(familyOf('hair_salon'))
    expect(p.sampleKey).toBe('force')
    expect(p.counts).toEqual(STORES.force.counts)
  })
})
