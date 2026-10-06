/**
 * S57 P2 fix round (DECISIONS-S57 R188 · R190 · the P2 dispositions SF1, N1, N2). Header = lines 1-101 + 296-310 of
 * practice-door-write-store-capabilities.test.ts, copied; the registry mock also answers mockStoreTypes (a store's own 業種).
 * Copied header text follows.
 *
 * S49 P2 (DECISIONS-S49 R86) — お店ページ's switches writer and route, mirrored from
 * practice-door-write-booking-colors.test.ts: the same recorded answer set (no network), the same core-reach mock
 * (both guards' throws kept exactly) and a write-only handle so every core call is visible here.
 * ONE KEY PER STORE: a save sends `reserve_store_capabilities:<storeId>` alone; stamps are the server's.
 * FX-P2 (S55): R89 server-decided source + reset_keys · R96 based_on → 409 stale · R90 unreadable = absent,
 * overwritten and logged · A4 strict body · A5 acting staff = the sheet's staff_id · R126 internal draft, wire to
 * core · R162 the seed chain (store type, else the business's signup type, else `other`).
 */

jest.mock('@synqed-kk/client', () => ({ SynqedClient: class {} }))
jest.mock('@/business/lib/admission', () => ({ requireBusinessAdmission: jest.fn() }))
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
    // a FRESH reads object per request: door.ts keeps its once-per-actor org read on it, so a shared one would carry between saves
    clientFor: (admitted: { businessId: string }) => (guard(admitted), { ...mockCore.reads }),
    orgSettingsWriterFor: (admitted: { businessId: string }) => (guard(admitted), mockCore.writerFor(admitted), { orgSettings: { upsert: mockCore.upsert } }),
  }
})

/** R162: stores this suite answers as having NO own type (door.ts's `none` branch: business_type ''). */
let mockTypelessStores: string[] = []
/** R177: every store id listStoreOptions reads a policy for (it reads through samplePolicyFor). */
let mockPolicyReads: string[] = []
/** S57: a store's own 業種 as the registry names it (overrides the twin's type; '' or junk allowed). */
let mockStoreTypes: Record<string, string> = {}
jest.mock('@/business/lib/practice-door/registry', () => {
  const actual = jest.requireActual('@/business/lib/practice-door/registry')
  return { ...actual, samplePolicyFor: (id: string) => (mockPolicyReads.push(id), mockTypelessStores.includes(id) ? { kind: 'none' } : id in mockStoreTypes ? { ...actual.samplePolicyFor(id), business_type: mockStoreTypes[id] } : actual.samplePolicyFor(id)) }
})

import * as data from '@/business/lib/data'
import * as doorStoreCaps from '@/business/lib/practice-door/door-store-capabilities'
import { listStoreOptions } from '@/business/lib/practice-door/door'
import { requireBusinessAdmission } from '@/business/lib/admission'
import { PracticeTenantMismatch, type CoreReads } from '@/business/lib/practice-door/core-reach'
import { applyReset, lockOff, parseRecord, recordHash, resetDiff, seedRecord, serializeRecord, storeCapabilitiesKeyFor, typeKeyOf, type CapKey, type CapRecord, type WireRecord } from '@/business/lib/store-page/model'
import { PUT } from '@/app/api/business/store-capabilities/route'
import { LOGIN, STORE, TENANT, recordedReads } from './practice-door-recorded'

const mockCore: { reads: CoreReads; upsert: jest.Mock; writerFor: jest.Mock } = { reads: recordedReads(), upsert: jest.fn(), writerFor: jest.fn() }
const admission = requireBusinessAdmission as jest.MockedFunction<typeof requireBusinessAdmission>
type Spied = { [K in keyof CoreReads]: jest.Mock }
function withReads(settings: Record<string, unknown> = {}): Spied {
  const base = recordedReads()
  const spied = Object.fromEntries(Object.entries(base).map(([k, fn]) => [k, jest.fn(fn as (...a: unknown[]) => unknown)])) as unknown as Spied
  spied.orgSettingsGet.mockResolvedValue({ business_id: TENANT, name: 'Dev Salon', settings, created_at: 'x', updated_at: 'x' })
  mockCore.reads = spied as unknown as CoreReads
  return spied
}
const as = (userId: string, businessId: string = TENANT) => admission.mockResolvedValue({ userId, email: null, displayName: null, businessId })
let stored: Record<string, unknown> = {}
const coreRow = (settings: Record<string, unknown>) => ({ business_id: TENANT, name: 'Dev Salon', settings, created_at: 'x', updated_at: 'y' })
const seed = (settings: Record<string, unknown>) => ((stored = settings), withReads(settings))

const S = STORE.tokyo
const K = storeCapabilitiesKeyFor
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const toggle = (rec: CapRecord, key: keyof CapRecord['switches']): CapRecord =>
  ({ ...rec, switches: { ...rec.switches, [key]: { ...rec.switches[key], on: !rec.switches[key].on } } })
/** A saved hair_salon record where `classes` (default OFF) is the owner's ON (stamped 9/1 by someone else). */
const SAVED: CapRecord = {
  ...seedRecord('hair_salon'),
  switches: { ...seedRecord('hair_salon').switches, classes: { on: true, source: 'OWNER', changed_at: '2026-09-01T00:00:00.000Z', changed_by: 'someone-else' } },
}
/** What core holds = the WIRE record (R121). */
const W = serializeRecord
/** The value the door sent to core for store `id` (wire). */
const sentRecord = (id: string = S) => (mockCore.upsert.mock.calls[0][0] as { settings: Record<string, WireRecord> }).settings[K(id)]
/** based_on as the page computes it: the hash of the record it loaded (the door's own reader). */
// S75 (S68's seed case): no readable record → the hash of the seed the page showed (settings-props: storeCaps ?? seedRecord(storeSeedType))
const loaded = async (id: string = S) =>
  recordHash(parseRecord(stored[K(id)] ?? null) ?? seedRecord((await data.readStoreSeedType(id)) ?? 'other'))
const save = async (rec: unknown, o: { reset?: CapKey[]; basedOn?: string; id?: string } = {}) =>
  data.writeStoreCapabilities(o.id ?? S, rec, o.reset ?? [], o.basedOn ?? (await loaded(o.id ?? S)))
const ownerKeys = (rec: WireRecord) => Object.entries(rec.switches).filter(([, v]) => v.source === 'OWNER').map(([k]) => k)

const savedEnv = process.env.BUSINESS_PRACTICE_TENANT
let info: jest.SpyInstance
let error: jest.SpyInstance
beforeEach(() => {
  process.env.BUSINESS_PRACTICE_TENANT = TENANT
  seed({ business_type: 'beauty', reserve_card_color: '#1C2247' })
  mockCore.upsert = jest.fn(async (input: { settings: Record<string, unknown> }) => ((stored = { ...stored, ...input.settings }), coreRow(stored)))
  mockCore.writerFor = jest.fn()
  admission.mockClear()
  mockTypelessStores = []
  mockPolicyReads = []
  mockStoreTypes = {}
  as(LOGIN.owner)
  info = jest.spyOn(console, 'info').mockImplementation(() => {})
  error = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  if (savedEnv === undefined) delete process.env.BUSINESS_PRACTICE_TENANT
  else process.env.BUSINESS_PRACTICE_TENANT = savedEnv
  info.mockRestore()
  error.mockRestore()
})

// ── the route: PUT /api/business/store-capabilities ─────────────────────────────────────────
const HOST = 'business.example.test'
const bodyOf = (o: Record<string, unknown> = {}) =>
  JSON.stringify({ storeId: S, record: toggle(SAVED, 'posts'), reset_keys: [], based_on: recordHash(SAVED), ...o })
function put(opts: { origin?: string | null; site?: string; expected?: string | null; body?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', host: HOST }
  const origin = opts.origin === undefined ? `https://${HOST}` : opts.origin
  if (origin !== null) headers.origin = origin
  if (opts.site) headers['sec-fetch-site'] = opts.site
  const expected = opts.expected === undefined ? TENANT : opts.expected
  if (expected !== null) headers['x-expected-business'] = expected
  return PUT(new Request(`https://${HOST}/api/business/store-capabilities`, { method: 'PUT', headers, body: opts.body ?? bodyOf() }))
}
const answer = async (r: Response) => ({ status: r.status, body: await r.json() })

// ── S57 tests ──────────────────────────────────────────────────────────────────────────────
const json = answer
const DEAD = '00000000-0000-4000-8000-00000000dead'
const lines = () => info.mock.calls.map((c) => String(c[0]) + ' ' + String(c[1] ?? ''))
const successLine = () => JSON.parse(String(info.mock.calls.find((c) => c[0] === '[business store capabilities]')![1])) as Record<string, unknown>

describe('ATTACK S57 P2 — core answer without the key (the door refuses an answer that does not hold what it sent)', () => {
  it('T8 core answers 200 but its settings do not hold the key → core (503), never ok with a null record', async () => {
    seed({ [K(S)]: W(SAVED) })
    mockCore.upsert = jest.fn(async () => coreRow({ business_type: 'beauty' }))
    expect(await save(toggle(SAVED, 'posts'))).toEqual({ ok: false, reason: 'core' })
    seed({ [K(S)]: W(SAVED) })
    mockCore.upsert = jest.fn(async () => coreRow({ [K(S)]: 'garbled' }))
    expect(await json(await put())).toEqual({ status: 503, body: { ok: false, reason: 'core' } })
  })
})

describe('S57 P2 — refusals straight at the door (N1, N2)', () => {
  it('400 storeId empty — nothing written', async () => {
    const body = JSON.stringify({ ...(JSON.parse(bodyOf()) as Record<string, unknown>), storeId: '' })
    expect(await answer(await put({ body }))).toEqual({ status: 400, body: { ok: false, reason: 'invalid' } })
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it('T4 door ON switch unset straight at the door → tenant, no core-reach load, no read, no write', async () => {
    const spy = withReads()
    delete process.env.BUSINESS_PRACTICE_TENANT
    expect(await doorStoreCaps.writeStoreCapabilities(S, SAVED, [], recordHash(null))).toEqual({ ok: false, reason: 'tenant' })
    for (const fn of Object.values(spy)) expect(fn).not.toHaveBeenCalled()
    expect(admission).not.toHaveBeenCalled()
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it('the door refuses the actor of a business that is not the tenant → tenant, nothing read, nothing written', async () => {
    as(LOGIN.owner, DEAD)
    const spy = withReads()
    expect(await doorStoreCaps.writeStoreCapabilities(S, toggle(SAVED, 'posts'), [], recordHash(SAVED))).toEqual({ ok: false, reason: 'tenant' })
    for (const fn of Object.values(spy)) expect(fn).not.toHaveBeenCalled()
    expect(mockCore.upsert).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('the door refuses when the writer handle refuses the tenant after the reads → tenant, nothing written', async () => {
    seed({ [K(S)]: W(SAVED) })
    mockCore.writerFor = jest.fn(() => { throw new PracticeTenantMismatch(DEAD) })
    expect(await doorStoreCaps.writeStoreCapabilities(S, toggle(SAVED, 'posts'), [], recordHash(SAVED))).toEqual({ ok: false, reason: 'tenant' })
    expect(mockCore.writerFor).toHaveBeenCalledTimes(1)
    expect(mockCore.upsert).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })
})

describe('S57 P2 — R190: a value read WITH LOSS is logged raw before it is replaced', () => {
  it('T5c a PARTLY readable value (an unknown switch key) → the raw line first, then the write; success says replaced_lossy', async () => {
    const raw = { v: 1, business_type: 'hair_salon', switches: { POSTS: { on: true, source: 'OWNER' }, classes: { on: true, source: 'OWNER', note: 'n'.repeat(3000) } } }
    seed({ [K(S)]: raw })
    const page = await data.readStoreCapabilities(S) as CapRecord
    withReads(stored)
    const order: string[] = []
    info.mockImplementation((m: unknown) => { order.push(String(m)) })
    const upsert = mockCore.upsert
    mockCore.upsert = jest.fn(async (input: { settings: Record<string, unknown> }) => (order.push('upsert'), upsert(input)))
    expect((await save(toggle(page, 'homecare'), { basedOn: recordHash(page) })).ok).toBe(true)
    expect(lines().some((l) => l.includes('nnnn'))).toBe(true)
    expect(order).toEqual(['[business store capabilities] replacing a stored value read with loss', 'upsert', '[business store capabilities]'])
    const pre = JSON.parse(String(info.mock.calls[0][1])) as Record<string, unknown>
    expect(pre).toEqual({ business_id: TENANT, store_id: S, key: K(S), replaced_lossy: JSON.stringify(raw), replaced_chars: JSON.stringify(raw).length, at: expect.stringMatching(ISO) })
    expect(successLine().replaced_lossy).toBe(true)
    expect(successLine()).not.toHaveProperty('replaced_unreadable')
  })

  it('a top-level key outside v / business_type / switches → the same raw line (cut at 8 000 chars, replaced_chars the full length)', async () => {
    const raw = { ...W(SAVED), extra: 'x'.repeat(9000) }
    seed({ [K(S)]: raw })
    expect((await save(toggle(SAVED, 'posts'), { basedOn: recordHash(SAVED) })).ok).toBe(true)
    const pre = JSON.parse(String(info.mock.calls[0][1])) as { replaced_lossy: string }
    expect(String(info.mock.calls[0][0])).toBe('[business store capabilities] replacing a stored value read with loss')
    expect(pre.replaced_lossy).toBe(JSON.stringify(raw).slice(0, 8000))
    expect(pre.replaced_lossy).toHaveLength(8000)
    expect((pre as { replaced_chars?: number }).replaced_chars).toBe(JSON.stringify(raw).length)
    expect(successLine().replaced_lossy).toBe(true)
  })

  it('an exactly readable value → no pre-write line, and the success line carries no replaced_lossy', async () => {
    seed({ [K(S)]: W(SAVED) })
    expect((await save(toggle(SAVED, 'posts'))).ok).toBe(true)
    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0][0]).toBe('[business store capabilities]')
    expect(successLine()).not.toHaveProperty('replaced_lossy')
  })
})

describe('S57 P2 — R188: readStoreSeedType answers exactly what a first save seeds from', () => {
  const storeTypeOf = async (id: string) => (await listStoreOptions()).find((s) => s.id === id)!.business_type
  /** The read's answer, then a first save from that seed: only the toggled key may become OWNER. */
  async function readThenSave(settings: Record<string, unknown>) {
    seed(settings)
    const t = await data.readStoreSeedType(S)
    expect(t).not.toBeNull()
    seed(settings)
    expect((await save(toggle(seedRecord(t!), 'shop'), { basedOn: recordHash(seedRecord(t!)) })).ok).toBe(true)
    expect(ownerKeys(sentRecord())).toEqual(['SHOP'])
    return t
  }

  it('the store’s own type wins over the signup type', async () => {
    const own = typeKeyOf(await storeTypeOf(S))
    const org = own === 'yoga_studio' ? 'dental_clinic' : 'yoga_studio'
    expect(own).not.toBe('other')
    expect(await readThenSave({ business_type: org })).toBe(own)
  })
  it.each([['typeless (none)', true], ['an empty own type', false]])('the store has no type (%s) → the signup type', async (_l, typeless) => {
    if (typeless) mockTypelessStores = [S]
    else mockStoreTypes = { [S]: '' }
    expect(await readThenSave({ business_type: 'yoga_studio' })).toBe('yoga_studio')
  })
  it.each([['missing', {}], ['junk', { business_type: 'beauty' }], ['empty', { business_type: '' }]])('both empty, business type %s → `other`', async (_l, settings) => {
    mockTypelessStores = [S]
    expect(await readThenSave(settings)).toBe('other')
  })
  it('a non-empty junk store type → `other`, never the signup type (R162 as written)', async () => {
    mockStoreTypes = { [S]: 'beauty' }
    expect(await readThenSave({ business_type: 'yoga_studio' })).toBe('other')
  })

  it('a store the operator may not see → null', async () => {
    as(LOGIN.goro)
    seed({ business_type: 'yoga_studio' })
    expect(await data.readStoreSeedType(STORE.devSalon)).toBeNull()
  })

  it('the off-switch: another business (door OFF) or the switch unset → null, every core read uncalled', async () => {
    as(LOGIN.owner, DEAD)
    let spy = withReads({ business_type: 'yoga_studio' })
    expect(await data.readStoreSeedType(S)).toBeNull()
    for (const fn of Object.values(spy)) expect(fn).not.toHaveBeenCalled()
    as(LOGIN.owner)
    delete process.env.BUSINESS_PRACTICE_TENANT
    spy = withReads({ business_type: 'yoga_studio' })
    expect(await data.readStoreSeedType(S)).toBeNull()
    expect(await doorStoreCaps.readStoreSeedType(S)).toBeNull()
    for (const fn of Object.values(spy)) expect(fn).not.toHaveBeenCalled()
  })
})

describe('S59 P2 — R201: anything the parse does not carry back is logged raw before it is replaced', () => {
  const LOSS = '[business store capabilities] replacing a stored value read with loss'
  /** Save over `raw` (stored for S); the pre-write line must be the raw value, the success line replaced_lossy. */
  async function expectLossLogged(raw: Record<string, unknown>) {
    seed({ [K(S)]: raw })
    const page = await data.readStoreCapabilities(S) as CapRecord
    expect(page).not.toBeNull()
    withReads(stored)
    expect((await save(toggle(page, 'homecare'), { basedOn: recordHash(page) })).ok).toBe(true)
    expect(String(info.mock.calls[0][0])).toBe(LOSS)
    expect((JSON.parse(String(info.mock.calls[0][1])) as { replaced_lossy: string }).replaced_lossy).toBe(JSON.stringify(raw))
    expect(successLine().replaced_lossy).toBe(true)
  }
  const wire = () => JSON.parse(JSON.stringify(W(SAVED))) as { switches: Record<string, Record<string, unknown>> } & Record<string, unknown>

  it('t1 a known switch with an extra inner field (`note`) → the raw line, then replaced_lossy', async () => {
    const raw = wire()
    raw.switches.POSTS.note = 'x'
    await expectLossLogged(raw)
  })

  it('t2 a known switch stamped under the old name `changed_by` → the raw line, then replaced_lossy', async () => {
    const raw = wire()
    raw.switches.CLASSES.changed_by = 'someone-else'
    await expectLossLogged(raw)
  })

  it('t3 both R190 cases stay lossy: a top-level key outside the three · an unknown switch key', async () => {
    await expectLossLogged({ ...wire(), extra: 'x' })
    info.mockClear()
    const raw = wire()
    raw.switches.classes = { on: true, source: 'OWNER' }
    await expectLossLogged(raw)
  })

  it('t4 a record exactly as our own save wrote it → saved again with no raw line and no replaced_lossy', async () => {
    seed({})
    expect((await save(toggle(seedRecord('hair_salon'), 'shop'), { basedOn: await loaded() })).ok).toBe(true)
    const written = stored[K(S)]
    expect(written).toBeDefined()
    seed({ [K(S)]: written as Record<string, unknown> })
    info.mockClear()
    const page = await data.readStoreCapabilities(S) as CapRecord
    expect((await save(toggle(page, 'classes'), { basedOn: recordHash(page) })).ok).toBe(true)
    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0][0]).toBe('[business store capabilities]')
    expect(successLine()).not.toHaveProperty('replaced_lossy')
  })
})

// ── S75 (DECISIONS-S75 ruling 3, 4): the fresh-store seed case, the R269 refusal, defaults_type on the wire ─────────
describe('S75 — the door: seed-type stale, the lock, defaults_type', () => {
  it('D5 fresh store: the seed type moved between load and save → stale, nothing written', async () => {
    seed({ business_type: 'beauty' })
    mockStoreTypes = { [S]: 'hair_salon' }
    const basedOn = await loaded()
    expect(basedOn).toBe(recordHash(seedRecord('hair_salon')))
    mockStoreTypes = { [S]: 'yoga_studio' } // the store's 業種 changed elsewhere before the first save
    expect(await save(toggle(seedRecord('hair_salon'), 'shop'), { basedOn })).toEqual({ ok: false, reason: 'stale' })
    expect(mockCore.upsert).not.toHaveBeenCalled()
    mockStoreTypes = { [S]: 'hair_salon' } // unmoved → accepted, only the toggled key OWNER, defaults_type = the seed type
    expect((await save(toggle(seedRecord('hair_salon'), 'shop'), { basedOn })).ok).toBe(true)
    expect(ownerKeys(sentRecord())).toEqual(['SHOP'])
    expect(sentRecord().defaults_type).toBe('hair_salon')
  })
  it('R269: a draft turning a locked key ON → invalid, nothing written', async () => {
    seed({ [K(S)]: W(seedRecord('dental_clinic')) })
    const draft = toggle(seedRecord('dental_clinic'), 'read_points')
    expect(draft.switches.read_points.on).toBe(true)
    expect(await save(draft)).toEqual({ ok: false, reason: 'invalid', locked: 'read_points' }) // S75 fix 1 (F5): additive — still 'invalid', + the key
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })
  it('S75 fix 1 (F2, door level): an OWNER/ON read_points on a type that becomes locked is written OFF / TYPE_DEFAULT with THIS save\'s stamp', async () => {
    const owned = { ...seedRecord('beauty_chiropractic'), switches: { ...seedRecord('beauty_chiropractic').switches, read_points: { on: true, source: 'OWNER' as const, changed_at: '2026-01-01T00:00:00.000Z', changed_by: 'old-staff' } } }
    seed({ [K(S)]: W(owned) })
    const page = parseRecord(W(owned))!
    expect(page.switches.read_points).toMatchObject({ on: true, source: 'OWNER' })
    const r = await save(lockOff({ ...page, business_type: 'dental_clinic' })) // the page sends the overlay (room-draft)
    expect(r.ok).toBe(true)
    const rp = sentRecord().switches.READ_POINTS
    expect(rp).toMatchObject({ on: false, source: 'TYPE_DEFAULT' })
    expect(rp.changed_at).toBeDefined()
    expect(rp.changed_at).not.toBe('2026-01-01T00:00:00.000Z')
    expect(rp.changed_by_staff_id).not.toBe('old-staff')
    expect(sentRecord().defaults_type).toBe('beauty_chiropractic')
  })
  it('S75 fix 1 (F3, door level): a body without defaults_type takes the SAVED record\'s, never its 業種', async () => {
    seed({ [K(S)]: W(seedRecord('beauty_chiropractic')) })
    const { defaults_type: _d, ...old } = JSON.parse(JSON.stringify({ ...seedRecord('beauty_chiropractic'), business_type: 'hair_salon' })) // eslint-disable-line @typescript-eslint/no-unused-vars
    expect((await save(old as CapRecord)).ok).toBe(true)
    expect(sentRecord()).toMatchObject({ business_type: 'hair_salon', defaults_type: 'beauty_chiropractic' })
    expect(sentRecord().switches.PACKS).toEqual({ on: true, source: 'TYPE_DEFAULT' })
  })
  it('legacy record (no defaults_type) + a 業種 pick, no 戻す → written with defaults_type = the SAVED type, packs kept ON', async () => {
    const legacy = (() => { const { defaults_type: _d, ...w } = JSON.parse(JSON.stringify(W(seedRecord('beauty_chiropractic')))); return w })() // eslint-disable-line @typescript-eslint/no-unused-vars
    seed({ [K(S)]: legacy })
    const page = parseRecord(legacy)!
    const r = await save(lockOff({ ...page, business_type: 'hair_salon' }))
    expect(r.ok).toBe(true)
    expect(sentRecord()).toMatchObject({ business_type: 'hair_salon', defaults_type: 'beauty_chiropractic' })
    expect(sentRecord().switches.PACKS).toEqual({ on: true, source: 'TYPE_DEFAULT' })
    // R273: core's answer (the mock echoes what it stored) holds defaults_type exactly as sent → ok, never 'core'
    expect(stored[K(S)]).toEqual(sentRecord())
  })
  it('the same pick + 戻す → PACKS OFF TYPE_DEFAULT, defaults_type hair_salon', async () => {
    seed({ [K(S)]: W(seedRecord('beauty_chiropractic')) })
    const asked = { ...seedRecord('beauty_chiropractic'), business_type: 'hair_salon' as const }
    const r = await save(applyReset(asked), { reset: resetDiff(asked).flips.map((f) => f.key) })
    expect(r.ok).toBe(true)
    expect(sentRecord()).toMatchObject({ business_type: 'hair_salon', defaults_type: 'hair_salon' })
    expect(sentRecord().switches.PACKS).toEqual({ on: false, source: 'TYPE_DEFAULT' })
  })
  it('R273: an answer that drops defaults_type is not what was sent → core', async () => {
    seed({ [K(S)]: W(seedRecord('beauty_chiropractic')) })
    mockCore.upsert = jest.fn(async (input: { settings: Record<string, { defaults_type?: string }> }) => {
      const { defaults_type: _d, ...rest } = input.settings[K(S)] // eslint-disable-line @typescript-eslint/no-unused-vars
      return coreRow({ ...stored, [K(S)]: rest })
    })
    expect(await save(toggle(seedRecord('beauty_chiropractic'), 'posts'))).toEqual({ ok: false, reason: 'core' })
  })
})
