/**
 * 'revisit' eligibility, server-side (Greptile #689).
 *
 * The dialog gates the 4th card, but the UI is not a trust boundary — a
 * tampered or buggy client could POST status:'revisit' for a first-visit
 * prospect and quietly remove them from the closing-rate denominator.
 *
 * The rule is enforced at the CHOKEPOINT (setKaruteOutcomeWithClient), which
 * every outcome write on both surfaces routes through — web save ×2, web edit,
 * facade save, facade edit, and processJob. Testing it here therefore covers
 * all six call sites at once; the route-level tests cover only the extra thing
 * routes do, which is translate the rejection into a 4xx.
 */
jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))

import {
  setKaruteOutcomeWithClient,
  REVISIT_NOT_ELIGIBLE,
  REVISIT_CHECK_UNAVAILABLE,
} from '@/lib/karute/outcome'

type CustomerRow = { is_existing_customer: boolean; visit_count: number; has_ticket_pack: boolean }

const NEW_PROSPECT: CustomerRow = {
  is_existing_customer: false,
  visit_count: 0,
  has_ticket_pack: false,
}

const upsert = jest.fn(async (_row: { outcome: string }) => ({}))
const outcomeGet = jest.fn(async (): Promise<{ outcome: string } | null> => null)
const customerGet = jest.fn(async (): Promise<CustomerRow> => NEW_PROSPECT)
const listPacks = jest.fn(async (): Promise<Array<{ status: string; kind: string }>> => [])
type KaruteRow = { id: string; recording_session_id: string | null }
const listKarute = jest.fn(
  async (_opts: { page_size?: number }): Promise<{ karute_records: KaruteRow[] }> => ({
    karute_records: [],
  }),
)

const client = () =>
  ({
    karuteOutcomes: { upsert, get: outcomeGet },
    customers: { get: customerGet },
    packs: { listPacks },
    karuteRecords: { list: listKarute },
  }) as unknown as Parameters<typeof setKaruteOutcomeWithClient>[0]

const write = (status: 'success' | 'no_deal' | 'pending' | 'revisit') =>
  setKaruteOutcomeWithClient(client(), {
    karuteRecordId: 'k-1',
    customerId: 'cust-1',
    status,
    decidedBy: 'staff-1',
  })

beforeEach(() => {
  jest.clearAllMocks()
  outcomeGet.mockResolvedValue(null)
  customerGet.mockResolvedValue(NEW_PROSPECT)
  listPacks.mockResolvedValue([])
  listKarute.mockResolvedValue({ karute_records: [] })
})

describe("chokepoint — 'revisit' requires a real returning customer", () => {
  it('returning by ANY single signal → the row is written', async () => {
    const signals: Array<[string, () => void]> = [
      ['QuickReserve existing-customer flag', () =>
        customerGet.mockResolvedValue({ ...NEW_PROSPECT, is_existing_customer: true })],
      ['QR lifetime visit count', () =>
        customerGet.mockResolvedValue({ ...NEW_PROSPECT, visit_count: 4 })],
      ['cached 回数券 flag', () =>
        customerGet.mockResolvedValue({ ...NEW_PROSPECT, has_ticket_pack: true })],
      ['a LIVE active pack (cache still cold)', () =>
        listPacks.mockResolvedValue([{ status: 'active', kind: 'pack' }])],
      ['prior karute on file', () =>
        listKarute.mockResolvedValue({
          karute_records: [{ id: 'k-0', recording_session_id: 'sess-0' }],
        })],
    ]
    for (const [label, arrange] of signals) {
      jest.clearAllMocks()
      outcomeGet.mockResolvedValue(null)
      customerGet.mockResolvedValue(NEW_PROSPECT)
      listPacks.mockResolvedValue([])
      listKarute.mockResolvedValue({ karute_records: [] })
      arrange()
      const res = await write('revisit')
      expect([label, res]).toEqual([label, {}])
      expect(upsert).toHaveBeenCalledTimes(1)
      expect(upsert.mock.calls[0][0].outcome).toBe('revisit')
    }
  })

  it('first-visit prospect → rejected, and NOTHING is written', async () => {
    expect(await write('revisit')).toEqual({ error: REVISIT_NOT_ELIGIBLE })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('UNKNOWN (every read fails) → the UNVERIFIABLE code, not the ineligible one', async () => {
    // A failed read is not evidence of a first-time visitor. Callers must be
    // able to tell "we know they're new" from "we could not find out".
    customerGet.mockRejectedValue(new Error('core down'))
    listPacks.mockRejectedValue(new Error('core down'))
    listKarute.mockRejectedValue(new Error('core down'))
    expect(await write('revisit')).toEqual({ error: REVISIT_CHECK_UNAVAILABLE })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('an inactive / non-pack ticket row is NOT proof of a returning customer', async () => {
    listPacks.mockResolvedValue([
      { status: 'expired', kind: 'pack' },
      { status: 'active', kind: 'single' },
    ])
    expect(await write('revisit')).toEqual({ error: REVISIT_NOT_ELIGIBLE })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('editing a row ALREADY stored as revisit is allowed regardless of derivation', async () => {
    // The stored row is its own proof — same rationale as the 編集 one-liner.
    // A first-visit-looking customer here would otherwise be un-editable.
    outcomeGet.mockResolvedValue({ outcome: 'revisit' })
    expect(await write('revisit')).toEqual({})
    expect(upsert).toHaveBeenCalledTimes(1)
    // Short-circuits: the existing row answers it, so the three derivation
    // reads never fire.
    expect(customerGet).not.toHaveBeenCalled()
    expect(listPacks).not.toHaveBeenCalled()
    expect(listKarute).not.toHaveBeenCalled()
  })

  it('a DIFFERENT stored outcome is not a free pass', async () => {
    outcomeGet.mockResolvedValue({ outcome: 'pending' })
    expect(await write('revisit')).toEqual({ error: REVISIT_NOT_ELIGIBLE })
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('the other three statuses are untouched by the guard', () => {
  it.each(['success', 'no_deal', 'pending'] as const)(
    "%s writes through with ZERO extra reads",
    async (status) => {
      expect(await write(status)).toEqual({})
      expect(upsert).toHaveBeenCalledTimes(1)
      expect(outcomeGet).not.toHaveBeenCalled()
      expect(customerGet).not.toHaveBeenCalled()
      expect(listPacks).not.toHaveBeenCalled()
      expect(listKarute).not.toHaveBeenCalled()
    },
  )
})

// The hole delta-verify found: every outcome write runs AFTER this session's
// karute record exists, so an unfiltered count is the save proving its own
// prior history. These are the two tests that were missing while 16 others
// stayed green over a vacuous guard.
describe('self-inclusion — a session may not be its own proof of prior history', () => {
  it('the ONLY karute on file is THIS save\'s own record → rejected', async () => {
    listKarute.mockResolvedValue({
      karute_records: [{ id: 'k-1', recording_session_id: 'sess-1' }],
    })
    expect(await write('revisit')).toEqual({ error: REVISIT_NOT_ELIGIBLE })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('one karute with a DIFFERENT id → allowed (real prior history still counts)', async () => {
    listKarute.mockResolvedValue({
      karute_records: [{ id: 'k-0', recording_session_id: 'sess-0' }],
    })
    expect(await write('revisit')).toEqual({})
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it("this save's record sitting ON TOP of real history → allowed", async () => {
    listKarute.mockResolvedValue({
      karute_records: [
        { id: 'k-1', recording_session_id: 'sess-1' },
        { id: 'k-0', recording_session_id: 'sess-0' },
      ],
    })
    expect(await write('revisit')).toEqual({})
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('asks for more than one row — a page_size of 1 could only ever return our own', async () => {
    await write('revisit')
    expect(listKarute.mock.calls[0][0].page_size).toBeGreaterThan(1)
  })
})

it('the two rejection codes are the literals the worker and routes compare against', () => {
  expect(REVISIT_NOT_ELIGIBLE).toBe('revisit_not_eligible')
  expect(REVISIT_CHECK_UNAVAILABLE).toBe('revisit_check_unavailable')
  expect(REVISIT_NOT_ELIGIBLE).not.toBe(REVISIT_CHECK_UNAVAILABLE)
})

// Tri-state: 'unknown' is its own answer, and the retry is what makes it rare.
describe('tri-state — a failed read is never mistaken for a negative', () => {
  const failAll = () => {
    customerGet.mockRejectedValue(new Error('core down'))
    listPacks.mockRejectedValue(new Error('core down'))
    listKarute.mockRejectedValue(new Error('core down'))
  }

  it('a TRUE signal wins even when the other reads fail — no retry spent', async () => {
    customerGet.mockResolvedValue({ ...NEW_PROSPECT, visit_count: 9 })
    listPacks.mockRejectedValue(new Error('core down'))
    listKarute.mockRejectedValue(new Error('core down'))
    expect(await write('revisit')).toEqual({})
    expect(upsert).toHaveBeenCalledTimes(1)
    // Answered on the first pass, so the failed reads are never re-tried.
    expect(listPacks).toHaveBeenCalledTimes(1)
    expect(listKarute).toHaveBeenCalledTimes(1)
  })

  it('a transient failure RECOVERED by the retry → returning', async () => {
    listKarute
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValue({ karute_records: [{ id: 'k-0', recording_session_id: 'sess-0' }] })
    expect(await write('revisit')).toEqual({})
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('the retry re-runs ONLY the reads that failed', async () => {
    customerGet.mockResolvedValue(NEW_PROSPECT) // succeeds first time
    listPacks.mockResolvedValue([]) // succeeds first time
    listKarute.mockRejectedValue(new Error('core down')) // never recovers
    await write('revisit')
    expect(listKarute).toHaveBeenCalledTimes(2) // retried
    expect(customerGet).toHaveBeenCalledTimes(1) // NOT retried
    expect(listPacks).toHaveBeenCalledTimes(1) // NOT retried
  })

  it('still UNKNOWN after the retry → unverifiable, nothing written', async () => {
    failAll()
    expect(await write('revisit')).toEqual({ error: REVISIT_CHECK_UNAVAILABLE })
    expect(upsert).not.toHaveBeenCalled()
  })

  it("a post-persist caller (onUnverifiable:'write') WRITES the label and warns loudly", async () => {
    failAll()
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await setKaruteOutcomeWithClient(client(), {
      karuteRecordId: 'k-1',
      customerId: 'cust-1',
      status: 'revisit',
      decidedBy: 'staff-1',
      onUnverifiable: 'write',
    })
    expect(res).toEqual({})
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('eligibility unverifiable after retry'),
      expect.objectContaining({ karuteRecordId: 'k-1', customerId: 'cust-1' }),
    )
    warn.mockRestore()
  })

  it("onUnverifiable:'write' does NOT rescue a genuine not_returning verdict", async () => {
    // All reads healthy, answer is simply no — fail-open is for infra faults only.
    const res = await setKaruteOutcomeWithClient(client(), {
      karuteRecordId: 'k-1',
      customerId: 'cust-1',
      status: 'revisit',
      decidedBy: 'staff-1',
      onUnverifiable: 'write',
    })
    expect(res).toEqual({ error: REVISIT_NOT_ELIGIBLE })
    expect(upsert).not.toHaveBeenCalled()
  })
})
