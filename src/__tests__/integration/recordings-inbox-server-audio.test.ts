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

/** The REAL resolver, mocked at the module the read's DEFAULT seam imports —
 *  so the wiring of that default (which nothing else in this file exercises)
 *  has a pin of its own. Its precedence is take-audio.ts's own suite's job. */
const resolveTakeAudio = jest.fn(
  async (_b: string, _t: string, _e: string): Promise<'absent'> => 'absent',
)
jest.mock('@/lib/recording/take-audio', () => ({
  resolveTakeAudio: (b: string, t: string, e: string) => resolveTakeAudio(b, t, e),
}))

/** The service client the segments DEFAULT reaches for, mocked at its own
 *  module — the twin of the resolver mock above. Without it the production
 *  wiring of `listFirstSegment` (which folder string it builds, and in which
 *  order it forwards its two same-typed arguments) is executed by nothing. */
const storageList = jest.fn(async () => ({
  data: [{ name: '000000.webm' }] as Array<{ name: string }> | null,
  error: null as unknown,
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ storage: { from: () => ({ list: storageList }) } }),
}))

import {
  makeSegmentsProbe,
  readRecordingsInbox,
  type SegmentsProbe,
  type TakeAudioProbe,
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
/** The resolver seam (amendment 9). `'absent'` by default = the segments are
 *  in the folder and no audio has been sealed yet — the stranded take on any
 *  night before its rescue. */
const takeAudio = jest.fn<ReturnType<TakeAudioProbe>, Parameters<TakeAudioProbe>>(
  async () => 'absent',
)
/** What the resolver answers when the bytes are at the phone's OWN key… */
const PHONE = { key: KEY, rescued: false } as const
/** …and when only the nightly rescue holds them, at the side key. To the inbox
 *  these two are the same news: the server has audio for this session. */
const RESCUE = { key: `rsc/${KEY}`, rescued: true } as const

const read = (over: Partial<Parameters<typeof readRecordingsInbox>[0]> = {}) =>
  readRecordingsInbox({
    synqed: client,
    staffId: 'staff-1',
    businessId: BIZ,
    now: NOW,
    segmentsProbe: probe,
    takeAudioProbe: takeAudio,
    ...over,
  })

beforeEach(() => {
  jest.clearAllMocks()
  recordings.current = []
  karuteRows.current = []
  discardEvents.current = []
  probe.mockImplementation(async () => true)
  takeAudio.mockImplementation(async () => 'absent')
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
  it('THE RESCUE: no duration, and the audio is at the SIDE key → object', async () => {
    // Exactly the take the nightly assembler rebuilt: it wrote the object — at
    // its own `rsc/` key since amendment 9 — and could NOT write a length (core
    // fences that behind a human actor). The old finalizedBefore reading would
    // have called this row unfinalized and shown 失敗, and a bare objectExists
    // on the POINTER would answer false for it: the rescue is not there.
    takeAudio.mockResolvedValue(RESCUE)
    recordings.current = [rec({ id: 's1' })]
    const [row] = await read()
    expect(row.serverAudio).toBe('object')
    // Asked as the PARSED take — the business, the take id and the container —
    // never as the pointer string the row happens to carry.
    expect(takeAudio).toHaveBeenCalledWith(BIZ, TAKE, 'webm')
    // …and the listing is never reached (ADDENDUM 9.4): the resolver already
    // named the bytes, so there is nothing left for the folder to gate.
    expect(probe).not.toHaveBeenCalled()
  })

  it('the PHONE’s own object is the same news to the inbox — object, no flag', async () => {
    // The take a phone finalized at stop and then died before 録音を使用. The
    // resolver prefers this key; the row says only that the server has audio.
    takeAudio.mockResolvedValue(PHONE)
    recordings.current = [rec({ id: 's1' })]
    const [row] = await read()
    expect(row.serverAudio).toBe('object')
    expect(JSON.stringify(row)).not.toContain('rescued')
    // ⚖ ADDENDUM 9.4 — the cohort the old order lost: every take from a shell
    // older than the segment pump has this exact shape, a whole object with no
    // seq 0 anywhere. One call answers it; the listing is never asked.
    expect(probe).not.toHaveBeenCalled()
  })

  it("⚖ 9.4: 'absent' at BOTH keys and NO seq 0 → nothing at all", async () => {
    // The listing gates only the half it can speak for. Nothing is on the
    // server for this take, so the row keeps today's 失敗 — which is the truth.
    takeAudio.mockResolvedValue('absent')
    probe.mockResolvedValue(false)
    recordings.current = [rec({ id: 's1' })]
    const [row] = await read()
    expect(row.serverAudio).toBeUndefined()
    // Both were asked, in the ruled order: the resolver, then the folder.
    expect(takeAudio).toHaveBeenCalledWith(BIZ, TAKE, 'webm')
    expect(probe).toHaveBeenCalledWith(BIZ, KEY)
  })

  it('⚖ R1: a DURATION IS NOT A PROOF — a stamped row is still probed', async () => {
    // discard.ts's stampRecordingDuration writes a client-reported length with
    // NO object behind it, so trusting the duration would paint 復元可能 over
    // nothing. Storage is the only witness, for every candidate.
    takeAudio.mockResolvedValue(PHONE)
    recordings.current = [rec({ id: 's1', duration_seconds: 1380 })]
    const [row] = await read()
    expect(row.serverAudio).toBe('object')
    expect(takeAudio).toHaveBeenCalledWith(BIZ, TAKE, 'webm')
  })

  it('⚖ R1: duration SET but NO audio anywhere is never object, and is not counted', async () => {
    // The reasoned-discard shape exactly. Before the fix this row read 復元可能
    // with a live 保存する, the door answered no_audio, and the 要対応 count was
    // one a staffer could never clear. Neither key holds bytes, so the honest
    // answer is what the folder holds — segments, 処理中, uncounted.
    takeAudio.mockResolvedValue('absent')
    recordings.current = [rec({ id: 's1', duration_seconds: 1380 })]
    const [row] = await read()
    expect(row.serverAudio).toBe('segments')
    const { deriveInboxRows, countNeedsAttention } =
      jest.requireActual<typeof import('@/lib/recordings/inbox')>('@/lib/recordings/inbox')
    const folded = deriveInboxRows({ sessions: [row], takes: [], now: NOW.getTime() })
    expect(countNeedsAttention(folded)).toBe(0)
  })

  it("the resolver answering 'unknown' leaves the row alone", async () => {
    // A blip at the phone's key stops the whole question in take-audio.ts —
    // falling through to the rescue would hand the staffer the PARTIAL object
    // while the real take sat there unseen.
    takeAudio.mockResolvedValue('unknown')
    recordings.current = [rec({ id: 's1' })]
    const [row] = await read()
    expect(row.serverAudio).toBeUndefined()
    // …and it stops the whole question: a blip must not spend a listing and
    // must never let the row read 'segments' on the way past.
    expect(probe).not.toHaveBeenCalled()
  })

  it('a pointer that is not THIS business’s take is never probed at all', async () => {
    takeAudio.mockResolvedValue(PHONE)
    recordings.current = [
      rec({ id: 'other-tenant', audio_storage_path: `app_biz-2_${TAKE}.webm` }),
      rec({ id: 'a-segment', audio_storage_path: `seg/app_${BIZ}_${TAKE}/000000.webm` }),
      rec({ id: 'staged', audio_storage_path: `stg/${BIZ}_${TAKE}_${TAKE}.webm` }),
      rec({ id: 'no-pointer', audio_storage_path: null }),
    ]
    const rows = await read()
    expect(rows.map((r) => r.serverAudio)).toEqual([undefined, undefined, undefined, undefined])
    expect(takeAudio).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
  })

  it('a duration-set row BELOW the grace is still nothing — the row reads 処理中', async () => {
    recordings.current = [rec({ id: 's1', duration_seconds: 1380, created_at: iso(30) })]
    const [row] = await read()
    expect(row.serverAudio).toBeUndefined()
    expect(takeAudio).not.toHaveBeenCalled()
  })
})

describe("serverAudio 'segments' — the one storage listing, asked narrowly", () => {
  it('NO object, but seq 0 is in the folder → segments', async () => {
    recordings.current = [rec({ id: 's1' })]
    const [row] = await read()
    expect(row.serverAudio).toBe('segments')
    expect(takeAudio).toHaveBeenCalledWith(BIZ, TAKE, 'webm')
    // One listing, and only because the resolver proved 'absent' first.
    expect(probe).toHaveBeenCalledWith(BIZ, KEY)
    expect(probe).toHaveBeenCalledTimes(1)
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
    expect(takeAudio).not.toHaveBeenCalled()
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
    expect(probe).toHaveBeenCalledTimes(100)
    expect(takeAudio).toHaveBeenCalledTimes(100)
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
    expect(takeAudio).not.toHaveBeenCalled()
  })

  it('a discarded session is skipped — the fold outranks this anyway', async () => {
    recordings.current = [rec({ id: 's1' })]
    discardEvents.current = [{ recording_session_id: 's1' }]
    const [row] = await read()
    expect(row.serverAudio).toBeUndefined()
    expect(takeAudio).not.toHaveBeenCalled()
  })

  it.each(['QUEUED', 'RUNNING', 'DONE'])(
    'a session with a %s job is skipped — the fold answers it higher up',
    async (status) => {
      recordings.current = [rec({ id: 's1' })]
      jobProbe.mockResolvedValue({ status, last_error: null })
      const [row] = await read()
      expect(row.jobStatus).toBe(status)
      expect(row.serverAudio).toBeUndefined()
      expect(takeAudio).not.toHaveBeenCalled()
    },
  )

  it('⚖ R10b: a FAILED job IS admitted — the row must keep its one affordance', async () => {
    // A job that failed (consent, an empty transcript, a Deepgram outage) used
    // to make the row permanently inert: no take on this device meant no
    // 再試行, and the derivation stopped offering anything the moment a job row
    // existed. The audio is still on the server, and core re-arms per session.
    takeAudio.mockResolvedValue(PHONE)
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
    expect(takeAudio).not.toHaveBeenCalled()
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
    takeAudio.mockResolvedValue(PHONE)
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
    takeAudio.mockResolvedValue(PHONE)
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
    const asked = new Set(takeAudio.mock.calls.map((c) => c[1]))
    expect(asked.has(takeOf(2))).toBe(false)
    // The two that WERE probed are derived as usual — and NOTHING else is
    // asked about, which is the assertion the audio cap used to reproduce.
    expect(takeAudio).toHaveBeenCalledTimes(2)
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
    takeAudio.mockResolvedValue(PHONE)
    discardList.mockRejectedValue(new Error('core down'))
    recordings.current = [rec({ id: 's1' }), rec({ id: 's2', duration_seconds: 1380 })]
    const rows = await read()
    expect(rows.map((r) => r.serverAudio)).toEqual([undefined, undefined])
    expect(takeAudio).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
    // …and it says so, once.
    expect(
      warn.mock.calls.some((c) => String(c[0]).includes('server-audio derivation skipped')),
    ).toBe(true)
    warn.mockRestore()
  })

  it('a READABLE ledger derives as usual — the guard is the failure, not the read', async () => {
    takeAudio.mockResolvedValue(PHONE)
    recordings.current = [rec({ id: 's1' })]
    const [row] = await read()
    expect(row.serverAudio).toBe('object')
  })
})

/**
 * ⚖ R1 (fix round 4) — A PROBE THAT THROWS COSTS ONE ROW, NEVER THE SCREEN.
 *
 * Every other test here answers a probe with a VALUE. Both PRODUCTION probes
 * can reject instead: `listFirstSegment` builds the service client outside
 * `makeSegmentsProbe`'s own try, so a missing or rotated SUPABASE env throws on
 * construction, and `resolveTakeAudio` throws by design when a key fails its
 * grammar. Without a guard that rejection escapes Promise.all, escapes
 * readRecordingsInbox, and the WHOLE 録音履歴 server half goes dark for that
 * render — a 502 at the facade, 「サーバー側の読み込みに失敗」 on the web —
 * which is the exact opposite of the derivation's own rule that a probe we
 * could not ask leaves the row as it was.
 */
describe('a probe that REJECTS takes its own row down and nothing else', () => {
  const takeOf = (i: number) => `4f9b2c1e-8a7d-4e0f-b3c6-${String(i).padStart(12, '0')}`
  const threeRows = () =>
    [0, 1, 2].map((i) =>
      rec({ id: `s${i}`, audio_storage_path: `app_${BIZ}_${takeOf(i)}.webm` }),
    )

  it('the RESOLVER throwing on two rows leaves those two alone; the third still derives', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    recordings.current = threeRows()
    takeAudio.mockImplementation(async (_b, takeId) => {
      if (takeId === takeOf(2)) return PHONE
      throw new Error('boom')
    })
    const rows = await read()
    expect(rows.map((r) => r.serverAudio)).toEqual([undefined, undefined, 'object'])
    expect(
      warn.mock.calls.some((c) => String(c[0]).includes('server-audio probe failed for s0')),
    ).toBe(true)
    warn.mockRestore()
  })

  it('the LISTING throwing does the same — the healthy row still reads segments', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    recordings.current = threeRows()
    probe.mockImplementation(async (_b, key) => {
      if (key === `app_${BIZ}_${takeOf(2)}.webm`) return true
      throw new Error('storage dark')
    })
    const rows = await read()
    expect(rows.map((r) => r.serverAudio)).toEqual([undefined, undefined, 'segments'])
    expect(
      warn.mock.calls.some((c) => String(c[0]).includes('server-audio probe failed for s1')),
    ).toBe(true)
    warn.mockRestore()
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
describe('the DEFAULT resolver seam — the one wiring no injected probe covers', () => {
  it('forwards the business, the take and the container, IN THAT ORDER', async () => {
    // All three are plain strings, so a transposition type-checks and would
    // ask storage about a key that cannot exist — a rescued take would read
    // 失敗 for ever and nothing would fail. This is the only pin on it.
    recordings.current = [rec({ id: 's1' })]
    const [row] = await readRecordingsInbox({
      synqed: client,
      staffId: 'staff-1',
      businessId: BIZ,
      now: NOW,
      segmentsProbe: probe,
    })
    expect(resolveTakeAudio).toHaveBeenCalledWith(BIZ, TAKE, 'webm')
    expect(row.serverAudio).toBe('segments')
  })

  it('the SEGMENTS default lists the take’s own folder — business and take in place', async () => {
    // The twin hole, one seam over. `listFirstSegment` forwards two same-typed
    // strings into makeSegmentsProbe, so `(takeKey, businessId)` type-checks —
    // and would make the seq-0 gate answer false for every take on the
    // platform, silently, with nothing failing. The folder string carries the
    // business id and the take id in fixed positions, so a transposed forward
    // cannot produce it. Neither probe is injected here: this is the one test
    // that runs the production wiring of both defaults.
    recordings.current = [rec({ id: 's1' })]
    const [row] = await readRecordingsInbox({
      synqed: client,
      staffId: 'staff-1',
      businessId: BIZ,
      now: NOW,
    })
    expect(storageList).toHaveBeenCalledWith(`seg/app_${BIZ}_${TAKE}`, {
      limit: 1,
      sortBy: { column: 'name', order: 'asc' },
    })
    expect(row.serverAudio).toBe('segments')
  })
})

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
