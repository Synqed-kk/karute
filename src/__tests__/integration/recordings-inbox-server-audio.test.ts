/**
 * 録音履歴 — WHAT THE SERVER HOLDS, at the read (build 23 slice ③).
 *
 * The two facts this build teaches the inbox are claims about a customer's
 * audio, so they get the same treatment the state table gets: every branch
 * pinned, and — the load-bearing one — proof that learning them puts NO
 * storage path on the wire. The row facts the derivation reads (the pointer,
 * the status) live in a local map inside readRecordingsInbox precisely so the
 * shape that ships cannot grow a key by accident; the census below is what
 * keeps that honest.
 */
jest.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn() }))

const getCachedCustomerListFor = jest.fn(async () => [{ id: 'cust-1', name: '佐藤 美咲' }])
jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerListFor: () => getCachedCustomerListFor(),
}))

import {
  makeObjectProbe,
  makeSegmentsProbe,
  readRecordingsInbox,
  type ObjectProbe,
  type SegmentsProbe,
} from '@/lib/recordings/inbox-read'
import { SESSION_UNSETTLED_GRACE_MS } from '@/lib/recordings/inbox'
import { RecordingsInboxDTO } from '@/lib/app-api/recordings-inbox-dto'

const NOW = new Date('2026-08-25T04:00:00.000Z')
const MIN = 60_000
const iso = (minsAgo: number) => new Date(NOW.getTime() - minsAgo * MIN).toISOString()
const BIZ = 'biz-1'
const TAKE = '4f9b2c1e-8a7d-4e0f-b3c6-a1d25e8f0937'
const KEY = `app_${BIZ}_${TAKE}.webm`

/** The PRODUCTION row shape: born reserved (session-mint.ts writes the pointer
 *  and UPLOADING at create), no store_id, duration written only by a finalize
 *  or a reasoned discard. */
type Rec = {
  id: string
  customer_id: string | null
  duration_seconds: number | null
  created_at: string
  audio_storage_path: string | null
  status: string
}
function rec(over: Partial<Rec> & { id: string }): Rec {
  return {
    customer_id: 'cust-1',
    duration_seconds: null,
    created_at: iso(SESSION_UNSETTLED_GRACE_MS / MIN + 60),
    audio_storage_path: KEY,
    status: 'UPLOADING',
    ...over,
  }
}

const recordings = { current: [] as Rec[] }
const karuteRows = { current: [] as Array<{ id: string; recording_session_id: string }> }
const discardEvents = { current: [] as Array<{ recording_session_id: string }> }
const jobProbe = jest.fn(
  async (_id?: string): Promise<{ status: string; last_error: string | null }> => {
    throw Object.assign(new Error('no job'), { status: 404 })
  },
)
const discardList = jest.fn(async () => ({
  events: discardEvents.current,
  total: discardEvents.current.length,
  page: 1,
  page_size: 200,
}))

const client = {
  recordings: {
    list: jest.fn(async () => ({ recordings: recordings.current, total: recordings.current.length })),
  },
  karuteRecords: {
    list: jest.fn(async () => ({ karute_records: karuteRows.current, total: karuteRows.current.length })),
  },
  recordingJobs: { getByRecordingSession: (id: string) => jobProbe(id) },
  recordingDiscards: { list: discardList },
} as unknown as Parameters<typeof readRecordingsInbox>[0]['synqed']

const probe = jest.fn<ReturnType<SegmentsProbe>, Parameters<SegmentsProbe>>(async () => true)
const objectProbe = jest.fn<ReturnType<ObjectProbe>, Parameters<ObjectProbe>>(async () => false)

const read = (over: Partial<Parameters<typeof readRecordingsInbox>[0]> = {}) =>
  readRecordingsInbox({
    synqed: client,
    staffId: 'staff-1',
    businessId: BIZ,
    now: NOW,
    segmentsProbe: probe,
    objectProbe,
    ...over,
  })

beforeEach(() => {
  jest.clearAllMocks()
  recordings.current = []
  karuteRows.current = []
  discardEvents.current = []
  probe.mockImplementation(async () => true)
  objectProbe.mockImplementation(async () => false)
  discardList.mockImplementation(async () => ({
    events: discardEvents.current,
    total: discardEvents.current.length,
    page: 1,
    page_size: 200,
  }))
  jobProbe.mockImplementation(async () => {
    throw Object.assign(new Error('no job'), { status: 404 })
  })
})

describe("serverAudio 'object' — STORAGE answers, not the row (⚖ D8')", () => {
  it('THE RESCUE: no duration, but the object is in the bucket → object', async () => {
    // Exactly the take the nightly assembler rebuilt: it wrote the object and
    // could NOT write a length (core fences that behind a human actor). The old
    // finalizedBefore reading would have called this row unfinalized and shown
    // 失敗 — the bug this amendment closes.
    objectProbe.mockResolvedValue(true)
    recordings.current = [rec({ id: 's1' })]
    const [row] = await read()
    expect(row.serverAudio).toBe('object')
    expect(objectProbe).toHaveBeenCalledWith(KEY)
    // No object → no segment listing. One call, not two.
    expect(probe).not.toHaveBeenCalled()
  })

  it('⚖ R1: a DURATION IS NOT A PROOF — a stamped row is still probed', async () => {
    // discard.ts's stampRecordingDuration writes a client-reported length with
    // NO object behind it, so trusting the duration would paint 復元可能 over
    // nothing. Storage is the only witness, for every candidate.
    objectProbe.mockResolvedValue(true)
    recordings.current = [rec({ id: 's1', duration_seconds: 1380 })]
    const [row] = await read()
    expect(row.serverAudio).toBe('object')
    expect(objectProbe).toHaveBeenCalledWith(KEY)
  })

  it('⚖ R1: duration SET but the object ABSENT is NOT object, and is not counted', async () => {
    // The reasoned-discard shape exactly. Before the fix this row read 復元可能
    // with a live 保存する, the door answered no_audio, and the 要対応 count was
    // one a staffer could never clear.
    objectProbe.mockResolvedValue(false)
    probe.mockResolvedValue(false)
    recordings.current = [rec({ id: 's1', duration_seconds: 1380 })]
    const [row] = await read()
    expect(row.serverAudio).toBeUndefined()
    const { deriveInboxRows, countNeedsAttention } =
      jest.requireActual<typeof import('@/lib/recordings/inbox')>('@/lib/recordings/inbox')
    const folded = deriveInboxRows({ sessions: [row], takes: [], now: NOW.getTime() })
    expect(countNeedsAttention(folded)).toBe(0)
  })

  it("the object probe answering 'unknown' leaves the row alone — and asks nothing else", async () => {
    objectProbe.mockResolvedValue('unknown')
    recordings.current = [rec({ id: 's1' })]
    const [row] = await read()
    expect(row.serverAudio).toBeUndefined()
    expect(probe).not.toHaveBeenCalled()
  })

  it('a pointer that is not THIS business’s take is never probed at all', async () => {
    objectProbe.mockResolvedValue(true)
    recordings.current = [
      rec({ id: 'other-tenant', audio_storage_path: `app_biz-2_${TAKE}.webm` }),
      rec({ id: 'a-segment', audio_storage_path: `seg/app_${BIZ}_${TAKE}/000000.webm` }),
      rec({ id: 'staged', audio_storage_path: `stg/${BIZ}_${TAKE}_${TAKE}.webm` }),
      rec({ id: 'no-pointer', audio_storage_path: null }),
    ]
    const rows = await read()
    expect(rows.map((r) => r.serverAudio)).toEqual([undefined, undefined, undefined, undefined])
    expect(objectProbe).not.toHaveBeenCalled()
  })

  it('a duration-set row BELOW the grace is still nothing — the row reads 処理中', async () => {
    recordings.current = [rec({ id: 's1', duration_seconds: 1380, created_at: iso(30) })]
    const [row] = await read()
    expect(row.serverAudio).toBeUndefined()
    expect(objectProbe).not.toHaveBeenCalled()
  })
})

describe("serverAudio 'segments' — the one storage listing, asked narrowly", () => {
  it('NO object, but seq 0 is in the folder → segments', async () => {
    recordings.current = [rec({ id: 's1' })]
    const [row] = await read()
    expect(row.serverAudio).toBe('segments')
    expect(objectProbe).toHaveBeenCalledWith(KEY)
    expect(probe).toHaveBeenCalledWith(BIZ, KEY)
  })

  it('BELOW the grace nothing is probed — the row already reads 処理中', async () => {
    recordings.current = [rec({ id: 's1', created_at: iso(30) })]
    const [row] = await read()
    expect(row.serverAudio).toBeUndefined()
    expect(probe).not.toHaveBeenCalled()
  })

  it('exactly AT the grace is still not probed (>, matching the fold’s <=)', async () => {
    recordings.current = [rec({ id: 's1', created_at: new Date(NOW.getTime() - SESSION_UNSETTLED_GRACE_MS).toISOString() })]
    await read()
    expect(objectProbe).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
  })

  it('false leaves the row exactly as it was', async () => {
    probe.mockResolvedValue(false)
    recordings.current = [rec({ id: 's1' })]
    const [row] = await read()
    expect(row.serverAudio).toBeUndefined()
  })

  it("'unknown' is NOT an answer — a storage blip changes nothing on the row", async () => {
    probe.mockResolvedValue('unknown')
    recordings.current = [rec({ id: 's1' })]
    const [row] = await read()
    expect(row.serverAudio).toBeUndefined()
  })

  it('the probes are capped at 100 and spend the cap on the NEWEST rows', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    // Distinct take per row so the probe's own argument says which row it was
    // asked about; created_at descends with the index, so s0 is the newest.
    const takeOf = (i: number) => `4f9b2c1e-8a7d-4e0f-b3c6-${String(i).padStart(12, '0')}`
    recordings.current = Array.from({ length: 105 }, (_, i) =>
      rec({
        id: `s${i}`,
        created_at: iso(SESSION_UNSETTLED_GRACE_MS / MIN + 60 + i),
        audio_storage_path: `app_${BIZ}_${takeOf(i)}.webm`,
      }),
    )
    await read()
    expect(objectProbe).toHaveBeenCalledTimes(100)
    expect(probe).toHaveBeenCalledTimes(100)
    const asked = new Set(probe.mock.calls.map((c) => c[1]))
    expect(asked.has(`app_${BIZ}_${takeOf(0)}.webm`)).toBe(true)
    expect(asked.has(`app_${BIZ}_${takeOf(99)}.webm`)).toBe(true)
    // The five oldest are never asked about — since R3 they are dropped one
    // step earlier, by the JOB cap, and the drop is said out loud there.
    expect(asked.has(`app_${BIZ}_${takeOf(100)}.webm`)).toBe(false)
    expect(asked.has(`app_${BIZ}_${takeOf(104)}.webm`)).toBe(false)
    expect(warn.mock.calls.some((c) => String(c[0]).includes('left unprobed'))).toBe(true)
    warn.mockRestore()
  })
})

describe('the rows the derivation deliberately never asks about', () => {
  it('a session with a karute record is skipped', async () => {
    recordings.current = [rec({ id: 's1' })]
    karuteRows.current = [{ id: 'rec-1', recording_session_id: 's1' }]
    const [row] = await read()
    expect(row.serverAudio).toBeUndefined()
    expect(objectProbe).not.toHaveBeenCalled()
  })

  it('a discarded session is skipped — the fold outranks this anyway', async () => {
    recordings.current = [rec({ id: 's1' })]
    discardEvents.current = [{ recording_session_id: 's1' }]
    const [row] = await read()
    expect(row.serverAudio).toBeUndefined()
    expect(objectProbe).not.toHaveBeenCalled()
  })

  it.each(['QUEUED', 'RUNNING', 'DONE'])(
    'a session with a %s job is skipped — the fold answers it higher up',
    async (status) => {
      recordings.current = [rec({ id: 's1' })]
      jobProbe.mockResolvedValue({ status, last_error: null })
      const [row] = await read()
      expect(row.jobStatus).toBe(status)
      expect(row.serverAudio).toBeUndefined()
      expect(objectProbe).not.toHaveBeenCalled()
    },
  )

  it('⚖ R10b: a FAILED job IS admitted — the row must keep its one affordance', async () => {
    // A job that failed (consent, an empty transcript, a Deepgram outage) used
    // to make the row permanently inert: no take on this device meant no
    // 再試行, and the derivation stopped offering anything the moment a job row
    // existed. The audio is still on the server, and core re-arms per session.
    objectProbe.mockResolvedValue(true)
    recordings.current = [rec({ id: 's1' })]
    jobProbe.mockResolvedValue({ status: 'FAILED', last_error: 'CONSENT_REQUIRED' })
    const [row] = await read()
    expect(row.jobStatus).toBe('FAILED')
    expect(row.serverAudio).toBe('object')
  })

  it('a session whose job probe FAILED is skipped — we do not know anything yet', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    recordings.current = [rec({ id: 's1' })]
    jobProbe.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }))
    const [row] = await read()
    expect(row.jobProbeFailed).toBe(true)
    expect(row.serverAudio).toBeUndefined()
    expect(objectProbe).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

/**
 * THE KEY CENSUS. The read now touches the storage pointer and the recording's
 * status; neither may leave this function, and the DTO strips unknown keys on
 * parse so a leak would be invisible at the facade door. Both ends are checked:
 * what the read RETURNS, and what survives the parse.
 */
describe('nothing about WHERE the audio is reaches the wire', () => {
  it('the returned rows carry no path, key, status or raw duration field', async () => {
    recordings.current = [
      rec({ id: 's1', duration_seconds: 1380 }),
      rec({ id: 's2' }),
    ]
    const rows = await read()
    const keys = new Set(rows.flatMap((r) => Object.keys(r)))
    expect([...keys].sort()).toEqual([
      'createdAt',
      'customerId',
      'customerName',
      'discardedByStaff',
      'durationSeconds',
      'jobLastError',
      'jobProbeFailed',
      'jobStatus',
      'karuteRecordId',
      'recordingSessionId',
      'serverAudio',
    ])
    for (const r of rows) {
      expect(JSON.stringify(r)).not.toContain(TAKE)
      expect(JSON.stringify(r)).not.toContain('app_')
      expect(JSON.stringify(r)).not.toContain('seg/')
    }
  })

  it('the DTO parse keeps serverAudio and nothing else new', async () => {
    objectProbe.mockResolvedValue(true)
    recordings.current = [rec({ id: 's1', duration_seconds: 1380 })]
    const parsed = RecordingsInboxDTO.parse({ sessions: await read() })
    expect(parsed.sessions[0].serverAudio).toBe('object')
    expect(Object.keys(parsed.sessions[0])).not.toContain('audio_storage_path')
    expect(Object.keys(parsed.sessions[0])).not.toContain('status')
  })

  it('a payload naming a value this build never heard of still PARSES', async () => {
    // Phones run a baked bundle: the day a third value lands, an old phone must
    // keep rendering its inbox. The fold narrows the literal; the DTO does not.
    const parsed = RecordingsInboxDTO.parse({
      sessions: [
        {
          recordingSessionId: 's1',
          customerId: null,
          createdAt: iso(10),
          durationSeconds: null,
          karuteRecordId: null,
          jobStatus: null,
          jobProbeFailed: false,
          jobLastError: null,
          serverAudio: 'reassembling',
        },
      ],
    })
    expect(parsed.sessions[0].serverAudio).toBe('reassembling')
  })
})

/**
 * ⚖ R3 — "NEVER ASKED" IS NOT "NO JOB".
 *
 * The job probe is capped at 100 and leaves everything past it with
 * `jobStatus: null, jobProbeFailed: false` — the exact shape of a real 404. If
 * the derivation admitted those it would offer 保存する over audio a live job
 * may already be turning into a record, which is the double-write the whole
 * pipeline exists to avoid.
 */
describe('rows past the job-probe cap are never derived', () => {
  it('⚖ the oldest, un-probed session is not asked about and never reads 復元可能', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    objectProbe.mockResolvedValue(true)
    const takeOf = (i: number) => `4f9b2c1e-8a7d-4e0f-b3c6-${String(i).padStart(12, '0')}`
    // ⚖ THE TWO CAPS MUST DIVERGE (fix round 2, R3). The first cut of this pin
    // pushed 101 rows over BOTH caps, which are the same number and sort the
    // same way — so the audio cap dropped the oldest row for its own, unrelated
    // reason and every assertion still passed with the fence removed. The
    // mutant survived a cold battery run. Here the JOB cap is two and the audio
    // cap is its default 100, so an excluded row has exactly one explanation.
    recordings.current = Array.from({ length: 3 }, (_, i) =>
      rec({
        id: `s${i}`,
        created_at: iso(SESSION_UNSETTLED_GRACE_MS / MIN + 60 + i),
        audio_storage_path: `app_${BIZ}_${takeOf(i)}.webm`,
      }),
    )
    // …and the un-probed one is the very row whose job is LIVE.
    jobProbe.mockImplementation(async (id?: string) => {
      if (id === 's2') return { status: 'QUEUED', last_error: null }
      throw Object.assign(new Error('no job'), { status: 404 })
    })
    const rows = await read({ maxJobProbes: 2 })
    const oldest = rows.find((r) => r.recordingSessionId === 's2')!
    expect(oldest.jobStatus).toBeNull()
    expect(oldest.serverAudio).toBeUndefined()
    const asked = new Set(objectProbe.mock.calls.map((c) => c[0]))
    expect(asked.has(`app_${BIZ}_${takeOf(2)}.webm`)).toBe(false)
    // The two that WERE probed are derived as usual — and NOTHING else is
    // asked about, which is the assertion the audio cap used to reproduce.
    expect(objectProbe).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})

/**
 * ⚖ R9b — A LEDGER WE COULD NOT READ MEANS NO SERVER SAVE THIS RENDER.
 *
 * `readStaffDiscardedSessions` degrades to an empty set on any error, so every
 * discarded session in the window looks un-discarded. That was harmless while
 * the worst such a row could do was read 失敗; the offer to SAVE it is not.
 */
describe('a degraded discard ledger stands the whole derivation down', () => {
  it('no row reads serverAudio, and storage is never asked', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    objectProbe.mockResolvedValue(true)
    discardList.mockRejectedValue(new Error('core down'))
    recordings.current = [rec({ id: 's1' }), rec({ id: 's2', duration_seconds: 1380 })]
    const rows = await read()
    expect(rows.map((r) => r.serverAudio)).toEqual([undefined, undefined])
    expect(objectProbe).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
    // …and it says so, once.
    expect(
      warn.mock.calls.some((c) => String(c[0]).includes('server-audio derivation skipped')),
    ).toBe(true)
    warn.mockRestore()
  })

  it('a READABLE ledger derives as usual — the guard is the failure, not the read', async () => {
    objectProbe.mockResolvedValue(true)
    recordings.current = [rec({ id: 's1' })]
    const [row] = await read()
    expect(row.serverAudio).toBe('object')
  })
})

/**
 * ⚖ R2 — THE PRODUCTION PROBES THEMSELVES.
 *
 * Until fix round 1 these were defaults nothing could call: every test injected
 * a stub, so the load-bearing line — seq 000000 must be the FIRST leaf — had no
 * pin at all, and `data.length > 0` would have passed every gate while painting
 * 「途中まで届いています」 over a folder the assembler can never seal.
 */
describe('makeSegmentsProbe — the real rule, over a fake list', () => {
  const leaf = (name: string) => ({ data: [{ name }], error: null })

  it('seq 000000 first → true, and it lists the take’s OWN folder', async () => {
    const list = jest.fn(async () => leaf('000000.webm'))
    await expect(makeSegmentsProbe(list)(BIZ, KEY)).resolves.toBe(true)
    expect(list).toHaveBeenCalledWith(`seg/app_${BIZ}_${TAKE}`, {
      limit: 1,
      sortBy: { column: 'name', order: 'asc' },
    })
  })

  it('a non-empty folder whose first leaf is NOT seq 0 → false', async () => {
    const list = jest.fn(async () => leaf('000001.webm'))
    await expect(makeSegmentsProbe(list)(BIZ, KEY)).resolves.toBe(false)
  })

  it('the right seq but the WRONG container → false', async () => {
    const list = jest.fn(async () => leaf('000000.mp4'))
    await expect(makeSegmentsProbe(list)(BIZ, KEY)).resolves.toBe(false)
  })

  it('an empty folder → false', async () => {
    const list = jest.fn(async () => ({ data: [], error: null }))
    await expect(makeSegmentsProbe(list)(BIZ, KEY)).resolves.toBe(false)
  })

  it('a storage error → unknown, not false', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const list = jest.fn(async () => ({ data: null, error: new Error('down') }))
    await expect(makeSegmentsProbe(list)(BIZ, KEY)).resolves.toBe('unknown')
    warn.mockRestore()
  })

  it('a thrown list → unknown too', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const list = jest.fn(async () => {
      throw new Error('network dark')
    })
    await expect(makeSegmentsProbe(list)(BIZ, KEY)).resolves.toBe('unknown')
    warn.mockRestore()
  })

  it.each([
    ['another tenant’s take', `app_biz-2_${TAKE}.webm`],
    ['a segment leaf', `seg/app_${BIZ}_${TAKE}/000000.webm`],
    ['a staged copy', `stg/${BIZ}_${TAKE}_${TAKE}.webm`],
  ])('a pointer at %s → false WITHOUT a listing', async (_l, key) => {
    const list = jest.fn(async () => leaf('000000.webm'))
    await expect(makeSegmentsProbe(list)(BIZ, key)).resolves.toBe(false)
    expect(list).not.toHaveBeenCalled()
  })
})

describe('makeObjectProbe — the pointer, verbatim', () => {
  it('forwards the key it was given and returns the answer unchanged', async () => {
    const exists = jest.fn(async () => true as const)
    await expect(makeObjectProbe(exists)(KEY)).resolves.toBe(true)
    expect(exists).toHaveBeenCalledWith(KEY)
  })

  it("passes 'unknown' straight through", async () => {
    const exists = jest.fn(async () => 'unknown' as const)
    await expect(makeObjectProbe(exists)(KEY)).resolves.toBe('unknown')
  })
})
