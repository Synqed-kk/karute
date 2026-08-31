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

const DISCARDED_AT = '2026-08-31T05:33:00.000Z'
const RECORDED_AT = '2026-08-31T05:28:00.000Z'

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

  it('asks for a window that OPENS BEFORE the oldest discard — a recording always precedes it', async () => {
    seedOneDiscard()
    await onlyRow()

    expect(seen.recordings.length).toBeGreaterThan(0)
    const { from, to } = seen.recordings[0] as { from: string; to: string }
    // 48h of margin, and the assertion is on the RELATIONSHIP rather than a
    // literal: a take left running overnight is discarded the next morning, so
    // a window that opened AT the discard would miss its own recording.
    expect(Date.parse(from)).toBe(Date.parse(DISCARDED_AT) - 48 * 60 * 60 * 1000)
    expect(Date.parse(to)).toBeGreaterThanOrEqual(Date.parse(DISCARDED_AT))
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
    expect(seen.customers[0].ids).toEqual(['cus-1'])
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

  it('a row past the recordings page cap degrades to nulls instead of borrowing another row\'s take', async () => {
    seedOneDiscard()
    // The endpoint reports more than the read will ever fetch (20 pages × 200),
    // and rs-1 sits past the last page it reaches.
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

    const row = await onlyRow()

    expect(seen.recordings).toHaveLength(20)
    expect(row.reason).toBe('お客様を間違えて録音を開始してしまいました')
    expect(row.recordingCreatedAt).toBeNull()
    expect(row.durationSeconds).toBeNull()
  })
})
