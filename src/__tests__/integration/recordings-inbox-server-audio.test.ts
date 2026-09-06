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
const jobProbe = jest.fn(async (): Promise<{ status: string; last_error: string | null }> => {
  throw Object.assign(new Error('no job'), { status: 404 })
})

const client = {
  recordings: {
    list: jest.fn(async () => ({ recordings: recordings.current, total: recordings.current.length })),
  },
  karuteRecords: {
    list: jest.fn(async () => ({ karute_records: karuteRows.current, total: karuteRows.current.length })),
  },
  recordingJobs: { getByRecordingSession: () => jobProbe() },
  recordingDiscards: {
    list: jest.fn(async () => ({
      events: discardEvents.current,
      total: discardEvents.current.length,
      page: 1,
      page_size: 200,
    })),
  },
} as unknown as Parameters<typeof readRecordingsInbox>[0]['synqed']

const probe = jest.fn<ReturnType<SegmentsProbe>, Parameters<SegmentsProbe>>(async () => true)
const objectProbe = jest.fn<ReturnType<ObjectProbe>, Parameters<ObjectProbe>>(async () => false)

const read = () =>
  readRecordingsInbox({
    synqed: client,
    staffId: 'staff-1',
    businessId: BIZ,
    now: NOW,
    segmentsProbe: probe,
    objectProbe,
  })

beforeEach(() => {
  jest.clearAllMocks()
  recordings.current = []
  karuteRows.current = []
  discardEvents.current = []
  probe.mockImplementation(async () => true)
  objectProbe.mockImplementation(async () => false)
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

  it('a row that ALREADY carries a duration short-circuits — no storage call', async () => {
    // Finalize proves the object before it stamps a length, so that proof was
    // already paid for once; re-asking would spend a probe slot for nothing.
    recordings.current = [rec({ id: 's1', duration_seconds: 1380 })]
    const [row] = await read()
    expect(row.serverAudio).toBe('object')
    expect(objectProbe).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
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

  it('the probe is capped at 100 and spends the cap on the NEWEST rows', async () => {
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
    // The five oldest are the ones dropped, and the drop is said out loud.
    expect(asked.has(`app_${BIZ}_${takeOf(100)}.webm`)).toBe(false)
    expect(asked.has(`app_${BIZ}_${takeOf(104)}.webm`)).toBe(false)
    expect(warn.mock.calls.some((c) => String(c[0]).includes('left un-probed'))).toBe(true)
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

  it('a session with a LIVE job is skipped — the fold answers it higher up', async () => {
    recordings.current = [rec({ id: 's1' })]
    jobProbe.mockResolvedValue({ status: 'QUEUED', last_error: null })
    const [row] = await read()
    expect(row.jobStatus).toBe('QUEUED')
    expect(row.serverAudio).toBeUndefined()
    expect(objectProbe).not.toHaveBeenCalled()
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
