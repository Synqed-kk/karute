/**
 * S61 P7B-1 (DECISIONS-S61 R220, R222) — お店ページ's switches: the client call `putStoreCapabilities`
 * (store-page/save-client.ts, the twin of the room's putCardColor) and the line chooser `saveFailLines`
 * (store-page/save-lines.ts). fetch is stubbed as `global.fetch = jest.fn(...)` and restored (the room tests' seam).
 * t5 is the round trip through the REAL door `writeStoreCapabilities`, core stubbed exactly as
 * practice-door-write-store-capabilities.test.ts stubs it (its core-reach + registry mocks and recorded reads).
 * The six Japanese lines in t6 are LITERALS script-copied from LANE/s49-2026-10-01/COPY-S49.md by id.
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
    clientFor: (admitted: { businessId: string }) => (guard(admitted), mockCore.reads),
    orgSettingsWriterFor: (admitted: { businessId: string }) => (guard(admitted), { orgSettings: { upsert: mockCore.upsert } }),
  }
})

import { putStoreCapabilities, type CapsSaveReason } from '@/business/lib/store-page/save-client'
import { saveFailLines, type CardReason } from '@/business/lib/store-page/save-lines'
import { writeStoreCapabilities } from '@/business/lib/practice-door/door-store-capabilities'
import { requireBusinessAdmission } from '@/business/lib/admission'
import type { CoreReads } from '@/business/lib/practice-door/core-reach'
import { parseInternalRecord, parseRecord, recordHash, seedRecord, serializeRecord, storeCapabilitiesKeyFor, type CapRecord } from '@/business/lib/store-page/model'
import { LOGIN, STORE, TENANT, recordedReads } from './practice-door-recorded'

const mockCore: { reads: CoreReads; upsert: jest.Mock } = { reads: recordedReads(), upsert: jest.fn() }
const admission = requireBusinessAdmission as jest.MockedFunction<typeof requireBusinessAdmission>

const BIZ = 'biz-under-test'
const SID = 'store-under-test'
const toggle = (rec: CapRecord, key: keyof CapRecord['switches']): CapRecord =>
  ({ ...rec, switches: { ...rec.switches, [key]: { ...rec.switches[key], on: !rec.switches[key].on } } })
const DRAFT: CapRecord = toggle(seedRecord('hair_salon'), 'posts')
/** core's answer: the draft, stamped by the server (differs from the draft). */
const STAMPED: CapRecord = { ...DRAFT, switches: { ...DRAFT.switches, posts: { ...DRAFT.switches.posts, source: 'OWNER', changed_at: '2026-10-03T00:00:00.000Z', changed_by: 'staff-1' } } }
const wire = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

const realFetch = global.fetch
let fetchMock: jest.Mock
const answer = (status: number, body: unknown) => {
  fetchMock = jest.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
  global.fetch = fetchMock as unknown as typeof fetch
}
afterEach(() => {
  global.fetch = realFetch
})
const call = (o: { record?: CapRecord; resetKeys?: readonly ('posts' | 'shop')[]; basedOn?: string } = {}) =>
  putStoreCapabilities(BIZ, { storeId: SID, record: o.record ?? DRAFT, resetKeys: o.resetKeys ?? [], basedOn: o.basedOn ?? 'hash-loaded' })

describe('S61 P7B-1 — putStoreCapabilities (R222)', () => {
  it('t1 the request: PUT, the route, exactly the two headers, exactly the four body keys, values passed through', async () => {
    answer(200, { ok: true, record: STAMPED })
    await call({ resetKeys: Object.freeze(['posts'] as const), basedOn: 'abc123' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/business/store-capabilities')
    expect(init.method).toBe('PUT')
    expect(init.headers).toEqual({ 'content-type': 'application/json', 'x-expected-business': BIZ })
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['based_on', 'record', 'reset_keys', 'storeId'])
    expect(body.storeId).toBe(SID)
    expect(body.record).toEqual(wire(DRAFT))
    expect(Array.isArray(body.reset_keys)).toBe(true)
    expect(body.reset_keys).toEqual(['posts'])
    expect(body.based_on).toBe('abc123')
  })

  it("t2 200 + a valid record → ok, core's PARSED record, basedOn = recordHash(that record), never the draft's", async () => {
    answer(200, { ok: true, record: STAMPED })
    const r = await call()
    const parsed = parseInternalRecord(wire(STAMPED))
    expect(parsed).not.toBeNull()
    expect(r).toEqual({ ok: true, record: parsed, basedOn: recordHash(parsed) })
    expect(recordHash(STAMPED)).not.toBe(recordHash(DRAFT))
    if (!r.ok) throw new Error('not ok')
    expect(r.basedOn).toBe(recordHash(STAMPED))
    expect(r.basedOn).not.toBe(recordHash(DRAFT))
  })

  it.each([
    [403, 'forbidden'], [409, 'tenant'], [400, 'invalid'], [409, 'stale'], [503, 'core'], [501, 'disconnected'],
  ] as const)('t3 %i {ok:false, reason:%s} → that reason', async (status, reason) => {
    answer(status, { ok: false, reason })
    expect(await call()).toEqual({ ok: false, reason })
  })

  it("t4 anything the room cannot read → 'core'", async () => {
    fetchMock = jest.fn(async () => { throw new TypeError('Failed to fetch') })
    global.fetch = fetchMock as unknown as typeof fetch
    expect(await call()).toEqual({ ok: false, reason: 'core' })
    answer(404, '<!DOCTYPE html><html><body>404</body></html>')
    expect(await call()).toEqual({ ok: false, reason: 'core' })
    const missing = wire(STAMPED) as unknown as { switches: Record<string, unknown> }
    delete missing.switches.posts
    answer(200, { ok: true, record: missing })
    expect(await call()).toEqual({ ok: false, reason: 'core' })
    answer(200, { ok: false })
    expect(await call()).toEqual({ ok: false, reason: 'core' })
    answer(409, { ok: false, reason: 'conflict' })
    expect(await call()).toEqual({ ok: false, reason: 'core' })
  })
})

describe("S61 P7B-1 — t5 THE ROUND TRIP: the client's basedOn is the door's hash on the NEXT write (R222)", () => {
  const S = STORE.tokyo
  const K = storeCapabilitiesKeyFor
  let stored: Record<string, unknown> = {}
  const savedEnv = process.env.BUSINESS_PRACTICE_TENANT
  let info: jest.SpyInstance
  let error: jest.SpyInstance
  const SAVED: CapRecord = {
    ...seedRecord('hair_salon'),
    switches: { ...seedRecord('hair_salon').switches, classes: { on: true, source: 'OWNER', changed_at: '2026-09-01T00:00:00.000Z', changed_by: 'someone-else' } },
  }
  beforeEach(() => {
    process.env.BUSINESS_PRACTICE_TENANT = TENANT
    stored = { business_type: 'beauty', [K(S)]: serializeRecord(SAVED) }
    mockCore.upsert = jest.fn(async (input: { settings: Record<string, unknown> }) => ((stored = { ...stored, ...input.settings }), { business_id: TENANT, name: 'Dev Salon', settings: stored, created_at: 'x', updated_at: 'y' }))
    admission.mockResolvedValue({ userId: LOGIN.owner, email: null, displayName: null, businessId: TENANT })
    info = jest.spyOn(console, 'info').mockImplementation(() => {})
    error = jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.BUSINESS_PRACTICE_TENANT
    else process.env.BUSINESS_PRACTICE_TENANT = savedEnv
    info.mockRestore()
    error.mockRestore()
  })

  /** A NEW request: fresh bound reads over what core holds now — door.ts's orgSettingsOf keeps one answer per
   *  actor's reads (as the door suite's seed() does between writes). */
  const request = () => {
    mockCore.reads = { ...recordedReads(), orgSettingsGet: jest.fn(async () => ({ business_id: TENANT, name: 'Dev Salon', settings: stored, created_at: 'x', updated_at: 'x' })) } as unknown as CoreReads
  }
  const write = (record: unknown, basedOn: string) => (request(), writeStoreCapabilities(S, record, [], basedOn))

  it('write → the wire → the client → a second write with the client’s basedOn is accepted; another basedOn is stale', async () => {
    const loaded = recordHash(parseRecord(stored[K(S)]))
    const draft = toggle(SAVED, 'posts')
    const first = await write(draft, loaded)
    expect(first.ok).toBe(true)
    answer(200, JSON.parse(JSON.stringify(first)))
    const client = await putStoreCapabilities(TENANT, { storeId: S, record: draft, resetKeys: [], basedOn: loaded })
    if (!client.ok) throw new Error('client refused: ' + client.reason)
    expect(client.basedOn).not.toBe(recordHash(draft)) // core stamped the switch: its answer differs from the draft
    const next = toggle(client.record, 'shop')
    const upserts = mockCore.upsert.mock.calls.length
    expect(await write(next, recordHash(draft))).toEqual({ ok: false, reason: 'stale' })
    expect(await write(next, loaded)).toEqual({ ok: false, reason: 'stale' })
    expect(mockCore.upsert.mock.calls.length).toBe(upserts)
    const second = await write(next, client.basedOn)
    expect(second.ok).toBe(true)
    expect(mockCore.upsert.mock.calls.length).toBe(upserts + 1)
  })
})

describe('S61 P7B-1 — t6 saveFailLines, the whole table (R220)', () => {
  const X4_ALT = 'この店舗のお店ページの設定が、このページを開いたあとにほかの画面や端末で保存されたため、保存できませんでした。変更した内容はこの画面に残っていますが、再読み込みすると消えます。最新の設定を確認してから、もう一度変更してください。'
  const X1 = '設定を変更できる権限がないため保存できず、お客様のアプリに出る機能はこれまでのままです。'
  const X2 = 'ここからはこの事業の設定を保存できないため、お客様のアプリに出る機能はこれまでのままです。'
  const X3 = 'いまは保存できないため、時間をおいてもう一度保存してください（お客様のアプリに出る機能はこれまでのままです）。'
  const L9 = 'カードの色は保存しましたが、業種と機能の設定は保存できませんでした。時間をおいてもう一度保存してください（お客様のアプリに出る機能はこれまでのままです）。'
  const L10 = '業種と機能の設定は保存しましたが、カードの色は保存できませんでした。時間をおいてもう一度保存してください（お客様のアプリのカードはこれまでの色のままです）。'
  const CARD_LINES: Record<CardReason, string> = { forbidden: 'card:forbidden', tenant: 'card:tenant', invalid: 'card:invalid', core: 'card:core' }
  const CARDS = ['unsent', 'ok', 'forbidden', 'tenant', 'invalid', 'core'] as const
  const CAPS = ['unsent', 'ok', 'forbidden', 'tenant', 'invalid', 'stale', 'core', 'disconnected'] as const
  /** the switches' line: [when the colour was saved, otherwise] */
  const CAPS_LINE: Record<(typeof CAPS)[number], [string | null, string | null]> = {
    unsent: [null, null], ok: [null, null],
    stale: [X4_ALT, X4_ALT], forbidden: [X1, X1], tenant: [X2, X2],
    core: [L9, X3], invalid: [L9, X3], disconnected: [L9, X3],
  }
  /** the colour's line: [when the switches were saved, otherwise] */
  const CARD_LINE: Record<(typeof CARDS)[number], [string | null, string | null]> = {
    unsent: [null, null], ok: [null, null],
    forbidden: ['card:forbidden', 'card:forbidden'], tenant: ['card:tenant', 'card:tenant'], invalid: ['card:invalid', 'card:invalid'],
    core: [L10, 'card:core'],
  }
  const pairs = CARDS.flatMap((card) => CAPS.map((caps) => [card, caps] as const))
  it('covers all 48 pairs', () => expect(pairs).toHaveLength(48))
  it.each(pairs)('t6 card=%s caps=%s', (card, caps) => {
    expect(saveFailLines(card, caps as 'unsent' | 'ok' | CapsSaveReason, CARD_LINES)).toEqual({
      card: CARD_LINE[card][caps === 'ok' ? 0 : 1],
      caps: CAPS_LINE[caps][card === 'ok' ? 0 : 1],
    })
  })
})

// ---- S61 P7B-R1 (attack F2, X222b; adapted from L61/attack-p7b/attack-p7b-room-s61.test.tsx:331 'w 200 + {ok:false, reason:stale}')
describe('S61 P7B-R1 — r5 a 200 that says no', () => {
  it("r5 200 + {ok:false, reason:'stale'} → reason 'stale', never ok", async () => {
    answer(200, { ok: false, reason: 'stale' })
    expect(await call()).toEqual({ ok: false, reason: 'stale' })
  })
})
