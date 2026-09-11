/**
 * 監査ログ round 2, PR C2 — F-e: `probeIncomplete` on `InboxServerSession`.
 *
 * A row this read could not fully judge (a job probe past MAX_JOB_PROBES, an
 * audio candidate dropped by maxAudioProbes, or a storage probe that threw or
 * answered 'unknown') reads `failed`/`processing` shape-identically to a real
 * miss — see find-karute-missing.ts's own ponytail note. The audit-watch cron
 * (run.ts) drops such rows before treating them as evidence; this file pins
 * ONLY that the read marks them, reusing recordings-inbox-server-audio.test.ts's
 * fixture shape (rec(), the injectable probes) rather than mocking storage.
 */
jest.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn() }))
jest.mock('@/lib/customers/cached', () => ({ getCachedCustomerListFor: async () => [] }))

import {
  readRecordingsInbox,
  type SegmentsProbe,
  type TakeAudioProbe,
} from '@/lib/recordings/inbox-read'
import { SESSION_UNSETTLED_GRACE_MS } from '@/lib/recordings/inbox'

const NOW = new Date('2026-08-25T04:00:00.000Z')
const MIN = 60_000
const iso = (minsAgo: number) => new Date(NOW.getTime() - minsAgo * MIN).toISOString()
const BIZ = 'biz-1'
const takeOf = (i: number) => `4f9b2c1e-8a7d-4e0f-b3c6-${String(i).padStart(12, '0')}`
const keyOf = (i: number) => `app_${BIZ}_${takeOf(i)}.webm`

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
    audio_storage_path: null,
    status: 'UPLOADING',
    ...over,
  }
}

const recordings = { current: [] as Rec[] }
const karuteRecords = { current: [] as { id: string; recording_session_id: string }[] }
const jobProbe = jest.fn(
  async (_id?: string): Promise<{ status: string; last_error: string | null }> => {
    throw Object.assign(new Error('no job'), { status: 404 })
  },
)

const client = {
  recordings: {
    list: jest.fn(async () => ({ recordings: recordings.current, total: recordings.current.length })),
  },
  karuteRecords: {
    list: jest.fn(async () => ({ karute_records: karuteRecords.current, total: karuteRecords.current.length })),
  },
  recordingJobs: { getByRecordingSession: (id: string) => jobProbe(id) },
  recordingDiscards: { list: jest.fn(async () => ({ events: [], total: 0, page: 1, page_size: 200 })) },
} as unknown as Parameters<typeof readRecordingsInbox>[0]['synqed']

const probe = jest.fn<ReturnType<SegmentsProbe>, Parameters<SegmentsProbe>>(async () => true)
const takeAudio = jest.fn<ReturnType<TakeAudioProbe>, Parameters<TakeAudioProbe>>(
  async () => 'absent',
)

const read = (over: Partial<Parameters<typeof readRecordingsInbox>[0]> = {}) =>
  readRecordingsInbox({
    synqed: client,
    staffId: null,
    businessId: BIZ,
    now: NOW,
    segmentsProbe: probe,
    takeAudioProbe: takeAudio,
    ...over,
  })

beforeEach(() => {
  jest.clearAllMocks()
  recordings.current = []
  karuteRecords.current = []
  probe.mockImplementation(async () => true)
  takeAudio.mockImplementation(async () => 'absent')
  jobProbe.mockImplementation(async () => {
    throw Object.assign(new Error('no job'), { status: 404 })
  })
})

describe('probeIncomplete — a row this read could not fully judge', () => {
  it('a row past the job-probe cap is marked, and otherwise unchanged', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    recordings.current = [0, 1].map((i) =>
      rec({ id: `s${i}`, created_at: iso(SESSION_UNSETTLED_GRACE_MS / MIN + 60 + i) }),
    )
    const rows = await read({ maxJobProbes: 1 })
    // s0 is newest (smallest minsAgo) and gets the one job-probe slot; s1 is
    // the residue past the cap.
    const s0 = rows.find((r) => r.recordingSessionId === 's0')!
    const s1 = rows.find((r) => r.recordingSessionId === 's1')!
    expect(s0.probeIncomplete).toBeUndefined()
    expect(s1.probeIncomplete).toBe(true)
    // Otherwise unchanged: same "never asked" shape a real 404 has.
    expect(s1.jobStatus).toBeNull()
    expect(s1.jobProbeFailed).toBe(false)
    warn.mockRestore()
  })

  it('an audio candidate dropped by maxAudioProbes is marked', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    recordings.current = [0, 1].map((i) =>
      rec({
        id: `s${i}`,
        created_at: iso(SESSION_UNSETTLED_GRACE_MS / MIN + 60 + i),
        audio_storage_path: keyOf(i),
      }),
    )
    const rows = await read({ maxAudioProbes: 1 })
    const s0 = rows.find((r) => r.recordingSessionId === 's0')!
    const s1 = rows.find((r) => r.recordingSessionId === 's1')!
    expect(s0.probeIncomplete).toBeUndefined()
    expect(s1.probeIncomplete).toBe(true)
    expect(s1.serverAudio).toBeUndefined()
    warn.mockRestore()
  })

  it("the resolver answering 'unknown' marks the row", async () => {
    recordings.current = [rec({ id: 's1', audio_storage_path: keyOf(1) })]
    takeAudio.mockResolvedValue('unknown')
    const [row] = await read()
    expect(row.probeIncomplete).toBe(true)
    expect(row.serverAudio).toBeUndefined()
  })

  it("the segments listing answering 'unknown' marks the row", async () => {
    recordings.current = [rec({ id: 's1', audio_storage_path: keyOf(1) })]
    takeAudio.mockResolvedValue('absent')
    probe.mockResolvedValue('unknown')
    const [row] = await read()
    expect(row.probeIncomplete).toBe(true)
    expect(row.serverAudio).toBeUndefined()
  })

  it('the resolver throwing marks the row (and only that row)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    recordings.current = [
      rec({ id: 's0', audio_storage_path: keyOf(0), created_at: iso(SESSION_UNSETTLED_GRACE_MS / MIN + 61) }),
      rec({ id: 's1', audio_storage_path: keyOf(1), created_at: iso(SESSION_UNSETTLED_GRACE_MS / MIN + 60) }),
    ]
    takeAudio.mockImplementation(async (_b, takeId) => {
      if (takeId === takeOf(1)) throw new Error('boom')
      return 'absent'
    })
    const rows = await read()
    const s0 = rows.find((r) => r.recordingSessionId === 's0')!
    const s1 = rows.find((r) => r.recordingSessionId === 's1')!
    expect(s0.probeIncomplete).toBeUndefined()
    expect(s1.probeIncomplete).toBe(true)
    warn.mockRestore()
  })

  it('the segments listing throwing marks the row', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    recordings.current = [rec({ id: 's1', audio_storage_path: keyOf(1) })]
    takeAudio.mockResolvedValue('absent')
    probe.mockImplementation(async () => {
      throw new Error('storage dark')
    })
    const [row] = await read()
    expect(row.probeIncomplete).toBe(true)
    warn.mockRestore()
  })

  it('a fully-judged row (definitive false) is never marked', async () => {
    recordings.current = [rec({ id: 's1', audio_storage_path: keyOf(1) })]
    takeAudio.mockResolvedValue('absent')
    probe.mockResolvedValue(false)
    const [row] = await read()
    expect(row.probeIncomplete).toBeUndefined()
  })
})

describe('probeIncomplete — P1-1 a degraded discard ledger', () => {
  it('marks every record-less row when recordingDiscards.list throws; a row WITH a karute record is untouched; nothing else about the rows changes', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    recordings.current = [rec({ id: 's0' }), rec({ id: 's1' })]
    karuteRecords.current = [{ id: 'kr-1', recording_session_id: 's1' }]

    const control = await read()
    ;(client.recordingDiscards.list as jest.Mock).mockImplementationOnce(async () => {
      throw new Error('ledger down')
    })
    const degraded = await read()

    const find = (rows: typeof control, id: string) => rows.find((r) => r.recordingSessionId === id)!
    const c0 = find(control, 's0')
    const c1 = find(control, 's1')
    const d0 = find(degraded, 's0')
    const d1 = find(degraded, 's1')

    expect(c0.probeIncomplete).toBeUndefined()
    expect(d0.probeIncomplete).toBe(true)
    // s1 carries a karute record — the degraded pass must not touch it.
    expect(c1.probeIncomplete).toBeUndefined()
    expect(d1.probeIncomplete).toBeUndefined()

    // Nothing else about the rows changes.
    expect({ ...d0, probeIncomplete: undefined }).toEqual({ ...c0, probeIncomplete: undefined })
    expect(d1).toEqual(c1)

    warn.mockRestore()
  })
})
