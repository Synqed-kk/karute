/**
 * 破棄の記録 — the RECORDING behind each discard row (the 8/31 redesign).
 *
 * The ledger row carries ids and a sentence: who threw a take away and why. The
 * redesign puts the take itself on the screen — which customer, when it was
 * recorded, how long it ran, which store — and every one of those facts comes
 * from a JOIN this file is about.
 *
 * THE PROPERTY UNDER TEST is not "the fields are filled". It is that filling
 * them can never cost the manager the list. Each join is best-effort by
 * construction, so every failure mode here has the same expected answer: the
 * rows still arrive, the reasons still read, and only the unreadable fact is
 * missing — stated as an absence, never as a guess. A suite that only proved
 * the happy path would be green on the day core's recordings endpoint went down
 * and the whole screen went with it.
 *
 * The read is also DATE-RANGED and page-capped, which buys the two remaining
 * cases: a window that is asked for correctly, and rows past the cap that
 * degrade instead of lying.
 *
 * FIXTURE INSTANTS ARE RELATIVE TO NOW, deliberately. The recordings walk reads
 * BACKWARDS from the present in bounded slices, so an absolute fixture date
 * stops being reachable as the calendar moves and this suite would rot green
 * into red for no reason anyone could see. The route suite beside this one
 * already learned that lesson for its month counts.
 */
process.env.SYNQED_CORE_URL ??= 'https://core.test'
process.env.SYNQED_CORE_API_KEY ??= 'test-core-key'

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  unstable_cache: (fn: unknown) => fn,
}))

interface LedgerRow {
  id: string
  recording_session_id: string
  source: 'STAFF' | 'SYSTEM'
  discarded_by: string | null
  reason: string | null
  created_at: string
}
interface RecordingRow {
  id: string
  created_at: string
  duration_seconds: number | null
  customer_id: string | null
  store_id: string | null
}

const ledger: LedgerRow[] = []
const recordings: RecordingRow[] = []
const customers: { id: string; name: string }[] = []
const stores: { id: string; name: string }[] = []

/** Set to make one seam fail the way core actually fails it. */
const fail = {
  recordings: false,
  stores: false,
  /** Reject a customers batch when it contains this id — the #743 shape: ONE
   *  bad id takes its whole batch down, never the others. */
  customerBatchContaining: null as string | null,
}
/** Every options object each endpoint was called with — the window assertions
 *  read the request, not just the answer. */
const seen = {
  recordings: [] as Record<string, unknown>[],
  customers: [] as Record<string, unknown>[],
  stores: 0,
}
/** Total the recordings endpoint REPORTS, independent of what it serves — that
 *  gap is how a real page cap is reached. */
const reportedRecordingTotal = { current: null as number | null }

const fakeClient = {
  recordingDiscards: {
    async list(q: Record<string, unknown> = {}) {
      const all = ledger.filter((r) => !q.source || r.source === q.source)
      const page = Number(q.page ?? 1)
      const size = Number(q.page_size ?? 200)
      return {
        events: all.slice((page - 1) * size, page * size),
        total: all.length,
        page,
        page_size: size,
      }
    },
  },
  recordings: {
    async list(q: Record<string, unknown> = {}) {
      seen.recordings.push(q)
      if (fail.recordings) throw new Error('core recordings unreachable')
      const from = typeof q.from === 'string' ? Date.parse(q.from) : -Infinity
      const to = typeof q.to === 'string' ? Date.parse(q.to) : Infinity
      // The range is applied FOR REAL: a caller that sends a window missing its
      // own rows must see them missing, not be handed everything anyway.
      const all = recordings.filter((r) => {
        const at = Date.parse(r.created_at)
        return at >= from && at <= to
      })
      const page = Number(q.page ?? 1)
      const size = Number(q.page_size ?? 200)
      return {
        recordings: all.slice((page - 1) * size, page * size),
        total: reportedRecordingTotal.current ?? all.length,
        page,
        page_size: size,
      }
    },
  },
  customers: {
    async list(q: Record<string, unknown> = {}) {
      seen.customers.push(q)
      const ids = (q.ids as string[] | undefined) ?? []
      if (fail.customerBatchContaining && ids.includes(fail.customerBatchContaining)) {
        throw new Error('core rejected the batch')
      }
      const hit = customers.filter((c) => ids.includes(c.id))
      return { customers: hit, total: hit.length, page: 1, page_size: 200, total_pages: 1 }
    },
  },
  stores: {
    async list() {
      seen.stores += 1
      if (fail.stores) throw new Error('core stores unreachable')
      return { stores }
    },
  },
}

/** Swapped for the one test that needs a client MISSING a resource. Explicit
 *  state rather than a spy: a spied implementation survives clearAllMocks and
 *  would silently cripple every test that ran after it. */
const clientOverride = { current: null as unknown }
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: () => clientOverride.current ?? fakeClient,
  getSynqedClient: async () => clientOverride.current ?? fakeClient,
}))
// The staff join has its own suite (discard-reasons-read.test.ts). Stubbed flat
// here so a name-side failure can never be mistaken for a recording-side one.
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'business-1'),
  getCurrentUserStaffId: jest.fn(async () => 'staff-A'),
  staffListByBusinessOrThrow: jest.fn(async () => [{ id: 'staff-A', full_name: '原 奏恵' }]),
}))
jest.mock('@/lib/synqed/staff-map', () => ({
  synqedStaffCardsForBusiness: jest.fn(async () => []),
}))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, getMyCapabilities: jest.fn(async () => new Set(['staff.manage'])) }
})

import { listDiscardReasons } from '@/actions/recording-discards'

const MIN_MS = 60 * 1000
const DAY_MS = 24 * 60 * MIN_MS
/** The margin the action derives (INBOX_WINDOW_MS + one day). Written out here
 *  rather than imported, so a change to the constant has to be a change to this
 *  number too — an assertion that imports its own expectation proves nothing. */
const WINDOW_MARGIN_MS = 8 * DAY_MS
/** One step of the newest-first walk — 録音履歴's own window. */
const SLICE_MS = 7 * DAY_MS

const NOW = Date.now()
const at = (agoMs: number) => new Date(NOW - agoMs).toISOString()
const DISCARDED_AT = at(5 * MIN_MS)
const RECORDED_AT = at(10 * MIN_MS)

function seedOneDiscard() {
  ledger.push({
    id: 'd1',
    recording_session_id: 'rs-1',
    source: 'STAFF',
    discarded_by: 'staff-A',
    reason: 'お客様を間違えて録音を開始してしまいました',
    created_at: DISCARDED_AT,
  })
  recordings.push({
    id: 'rs-1',
    created_at: RECORDED_AT,
    duration_seconds: 252,
    customer_id: 'cus-1',
    store_id: 'store-1',
  })
  customers.push({ id: 'cus-1', name: '田中 恵子' })
  stores.push({ id: 'store-1', name: '代官山店' })
}

/** One discard and, unless `recordedAt` is omitted, the recording behind it.
 *  Every instant is a PARAMETER: the fixtures that all shared `DISCARDED_AT`
 *  made `Math.min`, `Math.max`, `events[0]` and `events.at(-1)` indistinguishable
 *  to this suite, so the window anchor was unproven however green it looked. */
function seedDiscard(o: {
  id: string
  sessionId: string
  createdAt: string
  recordedAt?: string
  customerId?: string | null
  storeId?: string | null
  durationSeconds?: number | null
  customerName?: string
}) {
  ledger.push({
    id: o.id,
    recording_session_id: o.sessionId,
    source: 'STAFF',
    discarded_by: 'staff-A',
    reason: 'お客様を間違えて録音を開始してしまいました',
    created_at: o.createdAt,
  })
  if (o.recordedAt === undefined) return
  const customerId = o.customerId === undefined ? 'cus-1' : o.customerId
  const storeId = o.storeId === undefined ? 'store-1' : o.storeId
  recordings.push({
    id: o.sessionId,
    created_at: o.recordedAt,
    duration_seconds: o.durationSeconds === undefined ? 252 : o.durationSeconds,
    customer_id: customerId,
    store_id: storeId,
  })
  if (customerId && !customers.some((c) => c.id === customerId))
    customers.push({ id: customerId, name: o.customerName ?? '田中 恵子' })
  if (storeId && !stores.some((s) => s.id === storeId))
    stores.push({ id: storeId, name: '代官山店' })
}

/** The one row, or a failure that names itself. */
async function onlyRow() {
  const res = await listDiscardReasons()
  if (!res.ok) throw new Error(`expected ok, got ${res.error}`)
  expect(res.rows).toHaveLength(1)
  return res.rows[0]
}

beforeEach(() => {
  ledger.length = 0
  recordings.length = 0
  customers.length = 0
  stores.length = 0
  fail.recordings = false
  fail.stores = false
  fail.customerBatchContaining = null
  seen.recordings.length = 0
  seen.customers.length = 0
  seen.stores = 0
  reportedRecordingTotal.current = null
  clientOverride.current = null
  jest.clearAllMocks()
})

describe('破棄の記録 — the recording behind the row', () => {
  it('carries the customer, the recording time, the length and the store', async () => {
    seedOneDiscard()

    expect(await onlyRow()).toMatchObject({
      id: 'd1',
      customerId: 'cus-1',
      customerName: '田中 恵子',
      recordingCreatedAt: RECORDED_AT,
      durationSeconds: 252,
      storeName: '代官山店',
    })
  })

  it('the recording time is the RECORDING\'s, never the discard\'s', async () => {
    seedOneDiscard()
    const row = await onlyRow()

    // The two are minutes apart here and days apart in the field. A join that
    // copied createdAt would look right on every screenshot and be a lie about
    // when the session happened — which is the one thing a manager checking a
    // take is trying to establish.
    expect(row.recordingCreatedAt).toBe(RECORDED_AT)
    expect(row.createdAt).toBe(DISCARDED_AT)
    expect(row.recordingCreatedAt).not.toBe(row.createdAt)
  })

  it('the window floor is 8 days before the OLDEST discard, never the newest', async () => {
    // TWO discards at DIFFERENT instants, and neither one's recording seeded —
    // so the walk runs all the way to the floor and the floor is observable.
    // With one discard (or with every fixture sharing an instant, as this file
    // used to) `Math.min`, `Math.max`, `events[0]` and `events.at(-1)` are all
    // the same value and the anchor is unproven: a `max` anchors the window at
    // the NEWEST discard, and every older row on a real ledger loses its
    // customer, time, length and store while the list still renders.
    const OLDEST = at(30 * DAY_MS)
    seedDiscard({ id: 'd-old', sessionId: 'rs-old', createdAt: OLDEST })
    seedDiscard({ id: 'd-new', sessionId: 'rs-new', createdAt: DISCARDED_AT })

    const res = await listDiscardReasons()
    expect(res.ok).toBe(true)

    const floor = Math.min(...seen.recordings.map((r) => Date.parse(r.from as string)))
    expect(floor).toBe(Date.parse(OLDEST) - WINDOW_MARGIN_MS)
  })

  it('a recording a WEEK older than its discard is still inside the window', async () => {
    // The margin the 48h guess could not cover. 録音履歴 lists sessions for
    // seven days and every one of them is discardable from that list, so a
    // staffer clearing a six-day-old session out of the inbox is an ordinary
    // Monday — and under 48h that row rendered with no customer, no time and
    // no store, which the screen then read out as a fact about the staffer.
    const DISCARD = at(1 * 60 * MIN_MS)
    const RECORD = at(1 * 60 * MIN_MS + 7 * DAY_MS)
    seedDiscard({ id: 'd1', sessionId: 'rs-1', createdAt: DISCARD, recordedAt: RECORD })

    expect(await onlyRow()).toMatchObject({ recordingCreatedAt: RECORD, durationSeconds: 252 })
  })

  it('walks NEWEST-FIRST and stops as soon as every session is resolved', async () => {
    // Which rows keep their detail used to depend on core's own default sort,
    // which this app neither sends nor can read. Walking back from now in
    // slices settles it here: the newest sessions — the rows at the top of a
    // manager's list — are the ones the budget is spent on first.
    const DISCARD = at(20 * DAY_MS)
    seedDiscard({
      id: 'd1',
      sessionId: 'rs-1',
      createdAt: DISCARD,
      recordedAt: at(20 * DAY_MS + 60 * MIN_MS),
    })

    expect(await onlyRow()).toMatchObject({ customerName: '田中 恵子' })

    // Slice 1 is the most recent seven days and each slice steps backwards.
    const from = seen.recordings.map((r) => Date.parse(r.from as string))
    const to = seen.recordings.map((r) => Date.parse(r.to as string))
    expect(to[0]).toBeGreaterThan(NOW - MIN_MS)
    expect(from[0]).toBeGreaterThan(from[1])
    expect(from[0] - (to[0] - SLICE_MS)).toBeLessThan(MIN_MS)

    // THREE slices reach a 20-day-old session, and the walk stops there. The
    // window floor is 28 days back, so a walk that did not early-exit would
    // have asked for a fourth.
    expect(seen.recordings).toHaveLength(3)
  })

  it('pages the recordings read at 200 — the cap this endpoint family REJECTS above', async () => {
    seedOneDiscard()
    await onlyRow()

    expect(seen.recordings[0].page_size).toBe(200)
  })

  it('a business with no discards pays for NO enrichment reads at all', async () => {
    const res = await listDiscardReasons()

    expect(res.ok).toBe(true)
    expect(seen.recordings).toHaveLength(0)
    expect(seen.customers).toHaveLength(0)
    expect(seen.stores).toBe(0)
  })

  it('only the customers these rows REFERENCE are asked for — never the roster', async () => {
    seedOneDiscard()
    customers.push({ id: 'cus-99', name: '別のお客様' })
    recordings.push({
      id: 'rs-unrelated',
      created_at: RECORDED_AT,
      duration_seconds: 60,
      customer_id: 'cus-99',
      store_id: 'store-1',
    })
    await onlyRow()

    // rs-unrelated is inside the date window but no discard names it, so its
    // customer must never leave core (the maps rule, store-scope.ts).
    expect(seen.customers).toHaveLength(1)
    // The WHOLE options object, the shape audit-log-action.test.ts already
    // asserts. `include_deleted` is the one flag this screen cannot lose: a
    // customer removed since the discard is still the customer that take was
    // attached to, and dropping the flag would silently blank the name on every
    // one of those rows — a population this screen specifically exists to serve.
    expect(seen.customers[0]).toEqual({
      ids: ['cus-1'],
      include_deleted: true,
      page_size: 200,
    })
  })

  it('chunks the ids by REQUEST-LINE budget (100), not by the page-size cap', async () => {
    // 200 uuids join to ~7.8KB of `ids=` alone, against nginx's 8k default
    // request-line buffer — a 414 that costs its whole batch its names. The
    // page-size cap is an unrelated limit that merely looked like this one.
    for (let i = 0; i < 150; i++) {
      seedDiscard({
        id: `d-${i}`,
        sessionId: `rs-${i}`,
        createdAt: DISCARDED_AT,
        recordedAt: RECORDED_AT,
        customerId: `cus-${i}`,
      })
    }
    const res = await listDiscardReasons()
    expect(res.ok).toBe(true)

    expect(seen.customers).toHaveLength(2)
    expect((seen.customers[0].ids as string[]).length).toBe(100)
    expect((seen.customers[1].ids as string[]).length).toBe(50)
  })

  it('a resolved recording with per-field nulls keeps the fact it HAS', async () => {
    // The mixed row. The suite proved "the whole read failed → all five null"
    // but never "the read succeeded and THIS one field was null", so a `?? 0`
    // on the length (「録音 0分00秒」 for an unmeasured take) or a `?? '本店'`
    // store fallback would have passed the entire twin suite. The SDK declares
    // all three nullable and the 顧客未選択 population is one of them.
    seedDiscard({
      id: 'd1',
      sessionId: 'rs-1',
      createdAt: DISCARDED_AT,
      recordedAt: RECORDED_AT,
      customerId: null,
      storeId: null,
      durationSeconds: null,
    })

    expect(await onlyRow()).toMatchObject({
      recordingCreatedAt: RECORDED_AT,
      customerId: null,
      customerName: null,
      durationSeconds: null,
      storeName: null,
    })
  })

  it('a BLANK customer name resolves to null, not to an empty name', async () => {
    // `'' ?? null` is `''`, so a whitespace-only name survived every `??`
    // downstream and put a nameless row under a 「？」 avatar. Real population:
    // an import artifact, a half-filled walk-in. The staff join thirty lines
    // away already guards this; the customer join did not.
    seedDiscard({
      id: 'd1',
      sessionId: 'rs-1',
      createdAt: DISCARDED_AT,
      recordedAt: RECORDED_AT,
      customerId: 'cus-blank',
      customerName: '   ',
    })

    expect(await onlyRow()).toMatchObject({ customerId: 'cus-blank', customerName: null })
  })

  it('a ledger whose every timestamp is unparseable degrades instead of throwing', async () => {
    // The anchor comes out Infinity, which is not finite, so the enrichment is
    // skipped and the rows still read. Correct, and previously untested — the
    // empty-ledger case covers a different branch.
    seedDiscard({ id: 'd1', sessionId: 'rs-1', createdAt: 'yesterday-ish' })

    const row = await onlyRow()
    expect(row.reason).toBe('お客様を間違えて録音を開始してしまいました')
    expect(row.recordingCreatedAt).toBeNull()
    expect(seen.recordings).toHaveLength(0)
  })
})

describe('破棄の記録 — a failed join costs the FACT, never the list', () => {
  it('the recordings read failing leaves every recording field null and the row intact', async () => {
    seedOneDiscard()
    fail.recordings = true

    const row = await onlyRow()

    expect(row.reason).toBe('お客様を間違えて録音を開始してしまいました')
    expect(row.staffName).toBe('原 奏恵')
    expect(row).toMatchObject({
      customerId: null,
      customerName: null,
      recordingCreatedAt: null,
      durationSeconds: null,
      storeName: null,
    })
  })

  it('the stores read failing costs the STORE NAME and nothing else', async () => {
    seedOneDiscard()
    fail.stores = true

    expect(await onlyRow()).toMatchObject({
      storeName: null,
      customerName: '田中 恵子',
      durationSeconds: 252,
    })
  })

  it('a client with no recordings resource at all still answers the ledger', async () => {
    // Not a hypothetical shape: a synchronous TypeError from a missing resource
    // throws BEFORE any per-read catch can attach, which is why the enrichment
    // carries an outer guard as well as inner ones.
    seedOneDiscard()
    clientOverride.current = { recordingDiscards: fakeClient.recordingDiscards }

    const row = await onlyRow()

    expect(row.reason).toBe('お客様を間違えて録音を開始してしまいました')
    expect(row.recordingCreatedAt).toBeNull()
  })

  it('ONE bad customer batch drops only ITS OWN names (#743)', async () => {
    // Two chunks' worth of ids, so "the batch failed" and "everything failed"
    // are actually distinguishable — with a single chunk they are the same
    // outcome and the per-chunk catch proves nothing.
    stores.push({ id: 'store-1', name: '代官山店' })
    // A full chunk of ids seeded FIRST, so the bad one lands at index 200 — the
    // start of the SECOND batch. Chunk membership follows this seeding order.
    for (let i = 0; i < 200; i++) {
      const cid = `cus-fill-${i}`
      ledger.push({
        id: `d-fill-${i}`,
        recording_session_id: `rs-fill-${i}`,
        source: 'STAFF',
        discarded_by: 'staff-A',
        reason: 'うっかり',
        created_at: DISCARDED_AT,
      })
      recordings.push({
        id: `rs-fill-${i}`,
        created_at: RECORDED_AT,
        duration_seconds: 30,
        customer_id: cid,
        store_id: 'store-1',
      })
      customers.push({ id: cid, name: `お客様${i}` })
    }
    ledger.push({
      id: 'd-bad',
      recording_session_id: 'rs-bad',
      source: 'STAFF',
      discarded_by: 'staff-A',
      reason: '誤操作です',
      created_at: DISCARDED_AT,
    })
    recordings.push({
      id: 'rs-bad',
      created_at: RECORDED_AT,
      duration_seconds: 8,
      customer_id: 'cus-bad',
      store_id: 'store-1',
    })
    customers.push({ id: 'cus-bad', name: '巻き込まれない人' })
    fail.customerBatchContaining = 'cus-bad'

    const res = await listDiscardReasons()
    if (!res.ok) throw new Error('expected ok')

    expect(seen.customers.length).toBeGreaterThan(1)
    const bad = res.rows.find((r) => r.id === 'd-bad')
    const filler = res.rows.find((r) => r.id === 'd-fill-0')
    // The failed chunk loses its NAMES only — the id, the length and the store
    // came from the recording and are untouched.
    expect(bad).toMatchObject({ customerId: 'cus-bad', customerName: null, durationSeconds: 8 })
    expect(filler?.customerName).toBe('お客様0')
  })

  it('a row past the recordings page budget degrades to nulls AND the result SAYS so', async () => {
    seedOneDiscard()
    // The endpoint reports more than the budget will ever fetch (20 pages ×
    // 200) inside the newest slice, and rs-1 sits past the last page reached.
    for (let i = 0; i < 4000; i++) {
      recordings.push({
        id: `rs-filler-${i}`,
        created_at: RECORDED_AT,
        duration_seconds: 60,
        customer_id: null,
        store_id: 'store-1',
      })
    }
    // rs-1 was seeded FIRST, so move it to the end of the served order.
    recordings.push(recordings.splice(0, 1)[0])
    reportedRecordingTotal.current = 4200

    const res = await listDiscardReasons()
    if (!res.ok) throw new Error('expected ok')

    expect(seen.recordings).toHaveLength(20)
    expect(res.rows[0].reason).toBe('お客様を間違えて録音を開始してしまいました')
    expect(res.rows[0].recordingCreatedAt).toBeNull()
    expect(res.rows[0].durationSeconds).toBeNull()
    // The signal the build threw away. `truncated` describes the discard LEDGER
    // only, so a 300-discard salon whose recordings window overflows renders
    // bare rows beside complete ones with the screen saying nothing — which a
    // manager reads as a system fault rather than a boundary.
    expect(res.detailTruncated).toBe(true)
    expect(res.truncated).toBe(false)
  })

  it('a session simply NOT in the window is an absence, not a partial load', async () => {
    // The walk reached the window floor with budget to spare and did not find
    // it. That is the row's own absence, which it already states — claiming a
    // failed load there would be the mirror image of the claim B1 removed.
    seedDiscard({ id: 'd1', sessionId: 'rs-1', createdAt: at(60 * MIN_MS) })

    const res = await listDiscardReasons()
    if (!res.ok) throw new Error('expected ok')

    expect(res.rows[0].recordingCreatedAt).toBeNull()
    expect(res.detailTruncated).toBe(false)
  })

  it('a fully resolved read reports no partial detail (control)', async () => {
    seedOneDiscard()

    const res = await listDiscardReasons()
    if (!res.ok) throw new Error('expected ok')

    expect(res.rows[0].customerName).toBe('田中 恵子')
    expect(res.detailTruncated).toBe(false)
  })

  it('a recordings read that FAILED is not "some records" — it is every record', async () => {
    seedOneDiscard()
    fail.recordings = true

    const res = await listDiscardReasons()
    if (!res.ok) throw new Error('expected ok')

    expect(res.rows[0].recordingCreatedAt).toBeNull()
    expect(res.detailTruncated).toBe(false)
  })
})
