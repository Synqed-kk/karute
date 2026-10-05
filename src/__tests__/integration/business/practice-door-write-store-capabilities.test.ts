/**
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
jest.mock('@/business/lib/practice-door/registry', () => {
  const actual = jest.requireActual('@/business/lib/practice-door/registry')
  return { ...actual, samplePolicyFor: (id: string) => (mockPolicyReads.push(id), mockTypelessStores.includes(id) ? { kind: 'none' } : actual.samplePolicyFor(id)) }
})

import * as data from '@/business/lib/data'
import * as doorStoreCaps from '@/business/lib/practice-door/door-store-capabilities'
import { listStoreOptions } from '@/business/lib/practice-door/door'
import { requireBusinessAdmission } from '@/business/lib/admission'
import type { CoreReads } from '@/business/lib/practice-door/core-reach'
import { parseRecord, recordHash, seedRecord, serializeRecord, storeCapabilitiesKeyFor, typeKeyOf, type CapKey, type CapRecord, type WireRecord } from '@/business/lib/store-page/model'
import { PUT } from '@/app/api/business/store-capabilities/route'
import { CARD, LOGIN, SHEETS, STORE, TENANT, recordedReads } from './practice-door-recorded'

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
const loaded = (id: string = S) => recordHash(parseRecord(stored[K(id)] ?? null))
const save = (rec: unknown, o: { reset?: CapKey[]; basedOn?: string; id?: string } = {}) =>
  data.writeStoreCapabilities(o.id ?? S, rec, o.reset ?? [], o.basedOn ?? loaded(o.id ?? S))
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

describe('S49 P2 — the door: data.writeStoreCapabilities → door-store-capabilities.ts', () => {
  it('exports exactly the reader and the writer', () => {
    expect(Object.keys(doorStoreCaps).sort()).toEqual(['readStoreCapabilities', 'readStoreSeedType', 'writeStoreCapabilities'])
  })

  it('ONE upsert of ONE key, `reserve_store_capabilities:<store>`, the 16-key wire record; core’s answer comes back parsed', async () => {
    seed({ business_type: 'beauty', [K(S)]: W(SAVED) })
    const r = await save(toggle(SAVED, 'posts'))
    expect(mockCore.upsert).toHaveBeenCalledTimes(1)
    expect(Object.keys((mockCore.upsert.mock.calls[0][0] as { settings: object }).settings)).toEqual(['reserve_store_capabilities:' + S])
    expect(Object.keys(sentRecord().switches)).toHaveLength(16)
    expect(r).toEqual({ ok: true, record: parseRecord(sentRecord()) })
    expect(mockCore.writerFor).toHaveBeenCalledWith({ businessId: TENANT })
    expect(info).toHaveBeenCalledTimes(1)
  })

  it('R126: the draft speaks INTERNAL (`changed_by`); core receives WIRE (UPPER keys, `changed_by_staff_id`)', async () => {
    seed({ [K(S)]: W(SAVED) })
    await save(toggle(SAVED, 'posts'))
    const sent = sentRecord()
    expect(Object.keys(sent.switches)).toContain('CLASSES')
    expect(Object.keys(sent.switches)).not.toContain('classes')
    expect(sent.switches.CLASSES).toEqual({ on: true, source: 'OWNER', changed_at: '2026-09-01T00:00:00.000Z', changed_by_staff_id: 'someone-else' })
    expect(sent.switches.POSTS).toEqual({ on: false, source: 'OWNER', changed_at: expect.stringMatching(ISO), changed_by_staff_id: CARD.owner })
    // a draft in the wire spelling is not a draft
    expect(await save(W(toggle(SAVED, 'posts')))).toEqual({ ok: false, reason: 'invalid' })
  })

  it('R89: a forged client `source` is ignored — a changed key not in reset_keys becomes OWNER with the server’s stamps', async () => {
    seed({ [K(S)]: W(SAVED) })
    const forged = toggle(SAVED, 'posts')
    const draft = { ...forged, switches: { ...forged.switches, posts: { on: false, source: 'TYPE_DEFAULT' as const, changed_at: '1999-01-01T00:00:00.000Z', changed_by: 'forged' } } }
    await save(draft)
    expect(sentRecord().switches.POSTS).toEqual({ on: false, source: 'OWNER', changed_at: expect.stringMatching(ISO), changed_by_staff_id: CARD.owner })
  })

  it('R89: a false reset_keys entry (an OWNER key flipped back to the type default) stays OWNER', async () => {
    seed({ [K(S)]: W(SAVED) })
    const back = toggle(SAVED, 'classes') // classes OFF = hair_salon's default; its saved source is OWNER
    expect(back.switches.classes.on).toBe(seedRecord('hair_salon').switches.classes.on)
    await save(back, { reset: ['classes'] })
    expect(sentRecord().switches.CLASSES).toEqual({ on: false, source: 'OWNER', changed_at: expect.stringMatching(ISO), changed_by_staff_id: CARD.owner })
  })

  it('A5: changed_by is the acting STAFF id (the sheet’s staff_id, what door-writes.ts sends as acting_staff_id); the log names it', async () => {
    seed({ [K(S)]: W(SAVED) })
    mockCore.reads.answerSheet = jest.fn(async () => ({ ...SHEETS[CARD.owner], staff_id: 'staff-of-the-owner' }))
    await save(toggle(SAVED, 'posts'))
    expect(sentRecord().switches.POSTS.changed_by_staff_id).toBe('staff-of-the-owner')
    expect(JSON.parse(info.mock.calls[0][1] as string)).toMatchObject({ changed_by_staff_id: 'staff-of-the-owner' })
  })

  it('read-before-write: every unchanged key of THIS record keeps its SAVED state, whatever the draft carried for it', async () => {
    seed({ [K(S)]: W(SAVED) })
    const draft = toggle(SAVED, 'posts')
    const tampered = { ...draft, switches: { ...draft.switches, classes: { on: true, source: 'TYPE_DEFAULT' as const } } }
    await save(tampered)
    for (const k of Object.keys(SAVED.switches) as CapKey[]) if (k !== 'posts') expect(parseRecord(sentRecord())!.switches[k]).toEqual(SAVED.switches[k])
  })

  it('R96: a stale based_on (the stored record moved) → stale, NOTHING written', async () => {
    seed({ [K(S)]: W(SAVED) })
    const pageLoaded = recordHash(seedRecord('hair_salon'))
    expect(await save(toggle(SAVED, 'posts'), { basedOn: pageLoaded })).toEqual({ ok: false, reason: 'stale' })
    expect(mockCore.upsert).not.toHaveBeenCalled()
    seed({})
    expect(await save(toggle(SAVED, 'posts'), { basedOn: recordHash(SAVED) })).toEqual({ ok: false, reason: 'stale' })
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it('R96: no saved record + based_on = recordHash(null) → accepted', async () => {
    seed({})
    const r = await save(toggle(SAVED, 'posts'), { basedOn: recordHash(null) })
    expect(r.ok).toBe(true)
    expect(mockCore.upsert).toHaveBeenCalledTimes(1)
  })

  it('R90: an unreadable stored value is ABSENT — based_on = recordHash(null), overwritten, the log carries the raw value (≤ 2 000 chars)', async () => {
    const raw = { v: 1, business_type: 'SALON', note: 'x'.repeat(5000) } // a family name parses as absent (B10)
    seed({ [K(S)]: raw })
    expect(await data.readStoreCapabilities(S)).toBeNull()
    const r = await save(toggle(SAVED, 'posts'), { basedOn: recordHash(null) })
    expect(r.ok).toBe(true)
    expect(stored[K(S)]).toEqual(sentRecord())
    expect(info).toHaveBeenCalledTimes(2)
    expect(info.mock.calls[0][0]).toBe('[business store capabilities] replacing an unreadable stored value')
    const pre = JSON.parse(info.mock.calls[0][1] as string) as { replaced_unreadable: string; store_id: string; key: string }
    expect(pre).toMatchObject({ store_id: S, key: K(S) })
    expect(pre.replaced_unreadable).toBe(JSON.stringify(raw).slice(0, 2000))
    expect(pre.replaced_unreadable).toHaveLength(2000)
    const done = JSON.parse(info.mock.calls[1][1] as string) as { replaced_unreadable: unknown }
    expect(done.replaced_unreadable).toBe(true)
  })

  it('R176: unreadable stored value + the upsert REJECTS → the pre-write line was already emitted, answer `core`', async () => {
    const raw = { v: 1, business_type: 'SALON', note: 'y'.repeat(50) }
    seed({ [K(S)]: raw })
    mockCore.upsert = jest.fn(async () => { throw new Error('core committed, then the socket dropped') })
    expect(await save(toggle(SAVED, 'posts'), { basedOn: recordHash(null) })).toEqual({ ok: false, reason: 'core' })
    expect(mockCore.upsert).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0][0]).toBe('[business store capabilities] replacing an unreadable stored value')
    expect((JSON.parse(info.mock.calls[0][1] as string) as { replaced_unreadable: string }).replaced_unreadable).toBe(JSON.stringify(raw))
  })

  it('R177: a save over an existing record never reads the store list; a first save does', async () => {
    seed({ [K(S)]: W(SAVED) })
    expect((await save(toggle(SAVED, 'posts'))).ok).toBe(true)
    expect(mockCore.upsert).toHaveBeenCalledTimes(1)
    expect(mockPolicyReads).toEqual([])
    seed({})
    expect((await save(toggle(SAVED, 'posts'))).ok).toBe(true)
    expect(mockPolicyReads).toContain(S)
  })

  it('another store’s key and every other setting are never sent and survive the save', async () => {
    const other = W(seedRecord('yoga_studio'))
    seed({ business_type: 'beauty', [K(STORE.yokohama)]: other })
    await save(toggle(SAVED, 'posts'))
    expect(stored[K(STORE.yokohama)]).toEqual(other)
    expect(stored.business_type).toBe('beauty')
  })

  describe('R162 — the seed chain: store type, else the business’s signup type, else `other`', () => {
    const storeTypeOf = async (id: string) => (await listStoreOptions()).find((s) => s.id === id)!.business_type
    it('the store’s own type wins over the business’s', async () => {
      const own = typeKeyOf(await storeTypeOf(S))
      const org = own === 'yoga_studio' ? 'dental_clinic' : 'yoga_studio'
      seed({ business_type: org })
      await save(toggle(seedRecord(own), 'shop'))
      expect(ownerKeys(sentRecord())).toEqual(['SHOP'])
    })
    it('the store has no type → the business’s signup type', async () => {
      mockTypelessStores = [S]
      expect(await storeTypeOf(S)).toBe('')
      seed({ business_type: 'yoga_studio' })
      await save(toggle(seedRecord('yoga_studio'), 'shop'))
      expect(ownerKeys(sentRecord())).toEqual(['SHOP'])
    })
    it.each([['missing', {}], ['junk', { business_type: 'beauty' }], ['empty', { business_type: '' }]])('both empty, business type %s → `other`', async (_l, settings) => {
      mockTypelessStores = [S]
      seed(settings)
      await save(toggle(seedRecord('other'), 'shop'))
      expect(ownerKeys(sentRecord())).toEqual(['SHOP'])
    })
  })

  it('the exact saved record again → ok, NO upsert', async () => {
    seed({ [K(S)]: W(SAVED) })
    expect(await save(SAVED)).toEqual({ ok: true, record: SAVED })
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it('forbidden: no settings.manage; a store the operator cannot see — no upsert', async () => {
    as(LOGIN.goro)
    expect(await save(SAVED)).toEqual({ ok: false, reason: 'forbidden' })
    withReads().answerSheet.mockResolvedValue({ ...SHEETS[CARD.goro], capabilities: ['customers.view', 'settings.manage'] })
    expect(await save(SAVED, { id: STORE.devSalon })).toEqual({ ok: false, reason: 'forbidden' })
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it('REAL MODE is DISCONNECTED: another business, or the door OFF → `disconnected`, nothing read or written', async () => {
    as(LOGIN.owner, '00000000-0000-4000-8000-00000000dead')
    const spy = withReads()
    expect(await save(SAVED)).toEqual({ ok: false, reason: 'disconnected' })
    expect(await data.readStoreCapabilities(S)).toBeNull()
    for (const fn of Object.values(spy)) expect(fn).not.toHaveBeenCalled()
    as(LOGIN.owner)
    delete process.env.BUSINESS_PRACTICE_TENANT
    expect(await save(SAVED)).toEqual({ ok: false, reason: 'disconnected' })
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it('core throws on the PUT → core (reported, not retried)', async () => {
    mockCore.upsert.mockRejectedValueOnce(new Error('503 from core'))
    expect(await save(toggle(SAVED, 'posts'))).toEqual({ ok: false, reason: 'core' })
    expect(mockCore.upsert).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalled()
  })

  it('readStoreCapabilities: the parsed record; null when absent, unreadable, or the store is not visible', async () => {
    seed({ [K(S)]: W(SAVED) })
    expect(await data.readStoreCapabilities(S)).toEqual(SAVED)
    seed({})
    expect(await data.readStoreCapabilities(S)).toBeNull()
    seed({ [K(S)]: 'on' })
    expect(await data.readStoreCapabilities(S)).toBeNull()
    as(LOGIN.goro)
    seed({ [K(STORE.devSalon)]: W(SAVED) })
    expect(await data.readStoreCapabilities(STORE.devSalon)).toBeNull()
  })
})

describe('S68 P2 — R273: ok only when core’s answer holds exactly what was sent (key order is jsonb’s, ignored)', () => {
  /** core answers `answer(sent)` under the store's key, every other stored setting kept. */
  const answering = (answer: (sent: WireRecord) => unknown) => {
    mockCore.upsert = jest.fn(async (input: { settings: Record<string, WireRecord> }) => coreRow({ ...stored, [K(S)]: answer(JSON.parse(JSON.stringify(input.settings[K(S)])) as WireRecord) }))
  }
  /** Every object's keys reversed, at every depth (what jsonb may do to the order). */
  const reversed = (v: unknown): unknown =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).reverse().map(([k, x]) => [k, reversed(x)]))
      : v
  const successLines = () => info.mock.calls.filter((c) => c[0] === '[business store capabilities]')
  const mismatchLine = () => {
    expect(error).toHaveBeenCalledTimes(1)
    expect(error.mock.calls[0][0]).toBe(`[business store capabilities] core's answer does not hold ${K(S)} as sent`)
    return JSON.parse(String(error.mock.calls[0][1])) as Record<string, unknown>
  }

  it('T1 (A1) core answers with the OLD stored record → core; the error line names what was sent and answered; no success line', async () => {
    seed({ business_type: 'beauty', [K(S)]: W(SAVED) })
    answering(() => W(SAVED))
    expect(await save(toggle(SAVED, 'posts'))).toEqual({ ok: false, reason: 'core' })
    expect(mockCore.upsert).toHaveBeenCalledTimes(1)
    expect(mismatchLine()).toEqual({ business_id: TENANT, store_id: S, key: K(S), sent: JSON.stringify(sentRecord()), answered: JSON.stringify(W(SAVED)) })
    expect(successLines()).toHaveLength(0)
  })

  it('T2 (A2) core answers with a different VALID record (another type, every switch off) → core', async () => {
    seed({ [K(S)]: W(SAVED) })
    const yoga = seedRecord('yoga_studio')
    const allOff: CapRecord = { ...yoga, switches: Object.fromEntries(Object.entries(yoga.switches).map(([k, s]) => [k, { ...s, on: false }])) as CapRecord['switches'] }
    expect(parseRecord(W(allOff))).toEqual(allOff)
    answering(() => W(allOff))
    expect(await save(toggle(SAVED, 'posts'))).toEqual({ ok: false, reason: 'core' })
    expect(mismatchLine()).toMatchObject({ answered: JSON.stringify(W(allOff)) })
    expect(successLines()).toHaveLength(0)
  })

  it('T3 core answers what was sent with object keys reversed at EVERY depth → ok, the parse of what was sent', async () => {
    seed({ [K(S)]: W(SAVED) })
    answering((sent) => reversed(sent))
    const r = await save(toggle(SAVED, 'posts'))
    const answered = (await mockCore.upsert.mock.results[0].value as { settings: Record<string, WireRecord> }).settings[K(S)]
    expect(Object.keys(answered)).toEqual(Object.keys(sentRecord()).reverse())
    expect(Object.keys(answered.switches)).toEqual(Object.keys(sentRecord().switches).reverse())
    expect(Object.keys(answered.switches.POSTS)).toEqual(Object.keys(sentRecord().switches.POSTS).reverse())
    expect(r).toEqual({ ok: true, record: parseRecord(sentRecord()) })
    expect(error).not.toHaveBeenCalled()
    expect(successLines()).toHaveLength(1)
  })

  it('T3 the answer carries OTHER top-level settings (another store’s key, business_type) → still ok', async () => {
    seed({ business_type: 'beauty', [K(STORE.yokohama)]: W(seedRecord('yoga_studio')), [K(S)]: W(SAVED) })
    answering((sent) => sent)
    const r = await save(toggle(SAVED, 'posts'))
    const answer = (await mockCore.upsert.mock.results[0].value as { settings: Record<string, unknown> }).settings
    expect(Object.keys(answer).sort()).toEqual(['business_type', K(STORE.yokohama), K(S)].sort())
    expect(r).toEqual({ ok: true, record: parseRecord(sentRecord()) })
  })

  it('T4 the answer is what was sent plus one unknown field inside the record → core', async () => {
    seed({ [K(S)]: W(SAVED) })
    answering((sent) => ({ ...sent, switches: { ...sent.switches, POSTS: { ...sent.switches.POSTS, note: 'x' } } }))
    expect(await save(toggle(SAVED, 'posts'))).toEqual({ ok: false, reason: 'core' })
    mismatchLine()
    expect(successLines()).toHaveLength(0)
  })

  it('T5 the answer is what was sent minus one field → core', async () => {
    seed({ [K(S)]: W(SAVED) })
    answering((sent) => ({ ...sent, switches: { ...sent.switches, POSTS: Object.fromEntries(Object.entries(sent.switches.POSTS).filter(([k]) => k !== 'changed_by_staff_id')) } }))
    expect(await save(toggle(SAVED, 'posts'))).toEqual({ ok: false, reason: 'core' })
    mismatchLine()
    expect(successLines()).toHaveLength(0)
  })

  it('T7 the answer is what was sent except `business_type` → core, the mismatch line, no success line', async () => {
    seed({ [K(S)]: W(SAVED) })
    answering((sent) => ({ ...sent, business_type: sent.business_type === 'yoga_studio' ? 'dental_clinic' : 'yoga_studio' }))
    expect(await save(toggle(SAVED, 'posts'))).toEqual({ ok: false, reason: 'core' })
    mismatchLine()
    expect(successLines()).toHaveLength(0)
  })

  it('T8 the answer is what was sent except `v` (2) → core', async () => {
    seed({ [K(S)]: W(SAVED) })
    answering((sent) => ({ ...sent, v: 2 }))
    expect(await save(toggle(SAVED, 'posts'))).toEqual({ ok: false, reason: 'core' })
    mismatchLine()
    expect(successLines()).toHaveLength(0)
  })

  it('T9 a fully owner-stamped record with 36-char staff ids is logged WHOLE on a mismatch (sent and answered parse back)', async () => {
    const id36 = '00000000-0000-4000-8000-000000000036'
    const stamped: CapRecord = { ...SAVED, switches: Object.fromEntries(Object.entries(SAVED.switches).map(([k, s]) => [k, { ...s, source: 'OWNER', changed_at: '2026-09-01T00:00:00.000Z', changed_by: id36 }])) as CapRecord['switches'] }
    seed({ [K(S)]: W(stamped) })
    mockCore.reads.answerSheet = jest.fn(async () => ({ ...SHEETS[CARD.owner], staff_id: id36 }))
    answering(() => W(stamped))
    expect(await save(toggle(stamped, 'posts'))).toEqual({ ok: false, reason: 'core' })
    const line = mismatchLine() as { sent: string; answered: string }
    expect(JSON.stringify(sentRecord()).length).toBeGreaterThan(2000)
    expect(line.sent).toBe(JSON.stringify(sentRecord()))
    expect(JSON.parse(line.answered)).toEqual(W(stamped))
  })

  it('T6 a first save (no stored record → the seed) round-trips: the matching answer is accepted', async () => {
    seed({})
    answering((sent) => sent)
    const r = await save(toggle(SAVED, 'posts'), { basedOn: recordHash(null) })
    expect(r).toEqual({ ok: true, record: parseRecord(sentRecord()) })
    expect(error).not.toHaveBeenCalled()
  })
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
const without = (key: string) => JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(bodyOf()) as Record<string, unknown>).filter(([k]) => k !== key)))

describe('S49 P2 — the route: body exactly { storeId, record, reset_keys, based_on }', () => {
  beforeEach(() => { seed({ [K(S)]: W(SAVED) }) })

  it('200: same origin, the admitted business → the door → the stamped record (internal spelling back to the page)', async () => {
    const r = await answer(await put())
    expect(r.status).toBe(200)
    expect(r.body.record.switches.posts).toEqual({ on: false, source: 'OWNER', changed_at: expect.stringMatching(ISO), changed_by: CARD.owner })
    seed({ [K(S)]: W(SAVED) })
    expect((await put({ origin: null, site: 'same-origin' })).status).toBe(200)
  })

  it('409 stale — based_on is not the stored record’s hash; nothing written', async () => {
    expect(await answer(await put({ body: bodyOf({ based_on: recordHash(null) }) }))).toEqual({ status: 409, body: { ok: false, reason: 'stale' } })
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it.each([
    ['another origin', { origin: 'https://evil.example' }],
    ['no Origin and no Sec-Fetch-Site', { origin: null }],
  ])('403 before admission (%s)', async (_l, opts) => {
    expect(await answer(await put(opts))).toEqual({ status: 403, body: { ok: false, reason: 'forbidden' } })
    expect(admission).not.toHaveBeenCalled()
  })

  it('409 — X-Expected-Business is not the admitted business, before any read', async () => {
    const spy = withReads()
    expect(await answer(await put({ expected: '00000000-0000-4000-8000-00000000dead' }))).toEqual({ status: 409, body: { ok: false, reason: 'tenant' } })
    for (const fn of Object.values(spy)) expect(fn).not.toHaveBeenCalled()
  })

  const sw = SAVED.switches
  it.each([
    ['not JSON', '{storeId:'],
    ['a fifth key', bodyOf({ extra: 1 })],
    ['storeId missing', without('storeId')],
    ['storeId a number', bodyOf({ storeId: 7 })],
    ['record missing', without('record')],
    ['record an array', bodyOf({ record: [SAVED] })],
    ['reset_keys missing', without('reset_keys')],
    ['reset_keys not an array', bodyOf({ reset_keys: 'posts' })],
    ['reset_keys an unknown key', bodyOf({ reset_keys: ['sauna'] })],
    ['reset_keys a wire key', bodyOf({ reset_keys: ['POSTS'] })],
    ['reset_keys a duplicate', bodyOf({ reset_keys: ['posts', 'posts'] })],
    ['based_on missing', without('based_on')],
    ['based_on empty', bodyOf({ based_on: '' })],
    ['based_on 65 chars', bodyOf({ based_on: 'a'.repeat(65) })],
    ['based_on a number', bodyOf({ based_on: 7 })],
    ['an unknown record key', bodyOf({ record: { ...SAVED, extra: 1 } })],
    ['v = 2', bodyOf({ record: { ...SAVED, v: 2 } })],
    ['a family name as the type', bodyOf({ record: { ...SAVED, business_type: 'SALON' } })],
    ['an unknown switch key', bodyOf({ record: { ...SAVED, switches: { ...sw, sauna: { on: true, source: 'OWNER' } } } })],
    ['a missing switch key', bodyOf({ record: { ...SAVED, switches: { ...sw, posts: undefined } } })],
    ['on a string', bodyOf({ record: { ...SAVED, switches: { ...sw, posts: { on: 'true', source: 'OWNER' } } } })],
    ['an unknown source', bodyOf({ record: { ...SAVED, switches: { ...sw, posts: { on: true, source: 'ADMIN' } } } })],
    ['an unknown switch field', bodyOf({ record: { ...SAVED, switches: { ...sw, posts: { on: true, source: 'OWNER', by: 'x' } } } })],
    ['the wire spelling', bodyOf({ record: W(SAVED) })],
  ])('400 — junk (%s), nothing written', async (_l, body) => {
    expect(await answer(await put({ body }))).toEqual({ status: 400, body: { ok: false, reason: 'invalid' } })
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it('a 64-char based_on is a well-formed body (stale here, not 400)', async () => {
    expect((await answer(await put({ body: bodyOf({ based_on: 'a'.repeat(64) }) }))).body.reason).toBe('stale')
  })

  it('403 — no settings.manage; 403 — a store the operator cannot see', async () => {
    as(LOGIN.goro)
    expect(await answer(await put())).toEqual({ status: 403, body: { ok: false, reason: 'forbidden' } })
    as(LOGIN.owner)
    expect(await answer(await put({ body: bodyOf({ storeId: '__proto__' }) }))).toEqual({ status: 403, body: { ok: false, reason: 'forbidden' } })
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it('501 — real mode DISCONNECTED: a non-practice business admitted (and expected)', async () => {
    const other = '00000000-0000-4000-8000-00000000dead'
    as(LOGIN.owner, other)
    expect(await answer(await put({ expected: other }))).toEqual({ status: 501, body: { ok: false, reason: 'disconnected' } })
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it('503 — core failed (reported, not swallowed)', async () => {
    mockCore.upsert.mockRejectedValueOnce(new Error('503 from core'))
    expect(await answer(await put())).toEqual({ status: 503, body: { ok: false, reason: 'core' } })
  })
})
