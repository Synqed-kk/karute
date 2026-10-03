/**
 * ⚖ S53-B — THE WEB FALLBACK'S MINTED ROW IS ADOPTED BEFORE THE READ-URL MINT
 * (structural review S53 LEG 2, Finding 10).
 *
 * With RECORDING_SWITCHES.bindUnboundUploads ON, the in-tab fallback's
 * 'no_session' mint creates a row X and signs a key U for it. The web port
 * then PUTs the take to U and mints a read URL over U before the transcribe
 * POST. Until this round the take adopted X only AFTER the port answered — so
 * a read-URL mint that failed after a landed PUT threw first, and X was left
 * holding real audio with nothing naming it: a 復元可能 row whose 保存する paid
 * for the same audio again and made a second karute, while the 再試行 minted X2.
 *
 * The port now hands X over (`onUploaded`) between the PUT and the read-URL
 * mint, and the pipeline adopts it there. What this file pins:
 *   · the order on the port: PUT → hand-over → read-URL mint;
 *   · the Finding 10 case end to end: PUT ok + read-URL mint fails → the take is
 *     on X at U, and the 再試行 mints nothing new and makes ONE paid call;
 *   · a failed PUT is unchanged from before: nothing handed over, nothing
 *     adopted, and the 再試行 mints X2 (Finding 9's empty row — not closed here);
 *   · one adoption per mint, never two.
 *
 * Real ai-pipeline + real webRecordingPort + real secure-take; the take store,
 * the server actions and the network are faked. Every id is invented; nothing
 * leaves jest.
 */
jest.mock('@/lib/global-recorder', () => ({
  globalRecorder: { awaitTakeSecured: async () => {} },
}))

type Meta = {
  recordingSessionId?: string
  mimeType?: string
  durationMs?: number
  finalizedAt?: number
  finalizedPath?: string
  startedAt: number
  updatedAt: number
  transcript?: unknown
}
const store = { meta: null as Meta | null }
// First stamp wins, and the take is secured at the minted key in the same
// write — the real one's rule (take-store.ts adoptTakeSession).
const adoptTakeSession = jest.fn(async (_id: string, session: string, path: string) => {
  if (!store.meta || store.meta.recordingSessionId || store.meta.finalizedAt) return false
  store.meta = { ...store.meta, recordingSessionId: session, finalizedAt: 1, finalizedPath: path }
  return true
})
jest.mock('@/lib/karute/take-store', () => ({
  readTakeSecureMeta: async () => (store.meta ? { ...store.meta } : null),
  // No stored bytes: the attach has nothing to send, so a row-less take is 'no_session'.
  loadTakeBlob: async () => null,
  ensureFinalizedPath: async (_id: string, meta: Meta) => meta.finalizedPath ?? null,
  readTakeTranscript: async () => null,
  stampTakeTranscript: async () => {},
  adoptTakeSession: (id: string, session: string, path: string) => adoptTakeSession(id, session, path),
  isStoppedTake: () => false,
  markTakeFinalized: async () => {},
  markTakeSecureError: async () => {},
  markTakeStartBoundAttempted: async () => {},
  stampTakeSession: async () => false,
  settleTakeAfterSave: async () => {},
  TERMINAL_SECURE_ERRORS: new Set(['reserved_elsewhere', 'exists', 'size_mismatch']),
}))

// The unbound door with the switch ON: a NEW key and a NEW row per mint
// (mint-take-url.ts draws a uuid per server-named mint and creates the row for
// 'no_session'). `rowNamed = false` models the switch OFF.
let mintSeq = 0
let rowNamed = true
const key = (n: number) => `app_biz-1_server-named-${n}.webm`
const row = (n: number) => `rs-minted-${n}`
const mintRecordingUploadUrl = jest.fn<Promise<unknown>, [Record<string, unknown>?]>(async () => {
  const n = ++mintSeq
  return {
    path: key(n),
    url: `https://proj.supabase.co/storage/v1/object/upload/sign/recordings/${key(n)}?token=up`,
    token: 'up',
    contentType: 'audio/webm',
    recordingSessionId: rowNamed ? row(n) : null,
  }
})
/** Read-URL mints that answer an error before one answers a URL. */
let readUrlFailures = 0
const mintRecordingReadUrl = jest.fn<Promise<{ url: string } | { error: string }>, [string, (string | null)?]>(async (p) =>
  readUrlFailures-- > 0
    ? { error: 'upstream' }
    : { url: `https://proj.supabase.co/storage/v1/object/sign/recordings/${p}?token=read` },
)
jest.mock('@/actions/recording-upload', () => ({
  mintRecordingUploadUrl: (i?: Record<string, unknown>) => mintRecordingUploadUrl(i),
  mintRecordingReadUrl: (p: string, r?: string | null) => mintRecordingReadUrl(p, r),
  recordingFinalizedKey: async () => null,
  mintRecordingSegmentUrls: async () => ({ error: 'upstream' }),
}))

// The doors. Every /transcribe POST is a paid call.
const transcribeBodies: unknown[] = []
jest.mock('@/lib/ports/data-port', () => ({
  getDataPort: () => ({
    apiFetch: async (url: string, init?: { body?: string }) => {
      if (url.endsWith('/transcribe')) {
        transcribeBodies.push(JSON.parse(init?.body ?? '{}'))
        return { ok: true, json: async () => ({ transcript: 'こんにちは' }) } as unknown as Response
      }
      const body = url.endsWith('/extract') ? { entries: [] } : { summary: 'まとめ' }
      return { ok: true, json: async () => body } as unknown as Response
    },
  }),
}))

// The storage PUT. `putStatus` answers every PUT.
let putStatus = 200
const put = jest.fn<Promise<Response>, [string, unknown?]>(
  async () => ({ ok: putStatus < 300, status: putStatus }) as Response,
)
global.fetch = put as unknown as typeof fetch

import { withContainerHead } from './helpers/container-head-fetch'
import { runAIPipeline } from '@/lib/ai-pipeline'
import { webRecordingPort } from '@/lib/ports/recording-port'

const TAKE = '5e1d2c3b-4a59-4687-9a0b-c1d2e3f4a5b6'
// B-S66-2 (PR-B): a real container head, so the phone's sniff reads this mock as the recording it stands for.
const memory = new Blob(withContainerHead('in-memory: every chunk the recorder captured', 'webm'), { type: 'audio/webm' })
const run = () => runAIPipeline(memory, TAKE, 'ja', () => {}, { durationSeconds: 42 })
const outcome = (p: Promise<unknown>) => p.then(() => 'ok' as const, (e: unknown) => e)
/** A take the store holds, with no row and no finalized key — the 'no_session' cohort. */
const rowlessTake = () => {
  store.meta = { mimeType: 'audio/webm', durationMs: 42_000, startedAt: 0, updatedAt: 1 }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
  store.meta = null
  mintSeq = 0
  rowNamed = true
  readUrlFailures = 0
  putStatus = 200
  transcribeBodies.length = 0
})

describe('webRecordingPort — the minted row is handed over between the PUT and the read-URL mint', () => {
  it('PUT → onUploaded(row, key) → read-URL mint, in that order', async () => {
    const onUploaded = jest.fn(async () => {})
    const r = await webRecordingPort.prepareTranscription(memory, null, { attachOutcome: 'no_session' }, onUploaded)
    expect(onUploaded).toHaveBeenCalledTimes(1)
    expect(onUploaded).toHaveBeenCalledWith(row(1), key(1))
    const [putAt] = put.mock.invocationCallOrder
    const [handedAt] = onUploaded.mock.invocationCallOrder
    const [readAt] = mintRecordingReadUrl.mock.invocationCallOrder
    expect(putAt).toBeLessThan(handedAt)
    expect(handedAt).toBeLessThan(readAt)
    // The answer is unchanged: the caller still learns the row from it.
    expect(r).toEqual({
      body: { audioUrl: expect.stringContaining(key(1)), recordingSessionId: row(1) },
      path: key(1),
      recordingSessionId: row(1),
    })
  })

  it('the read-URL mint fails AFTER the hand-over — the row was already handed over', async () => {
    readUrlFailures = 1
    const onUploaded = jest.fn(async () => {})
    await expect(
      webRecordingPort.prepareTranscription(memory, null, { attachOutcome: 'no_session' }, onUploaded),
    ).rejects.toThrow('could not mint a read URL')
    expect(onUploaded).toHaveBeenCalledWith(row(1), key(1))
  })

  it('a failed PUT hands nothing over and asks for no read URL (unchanged)', async () => {
    putStatus = 500
    const onUploaded = jest.fn(async () => {})
    await expect(
      webRecordingPort.prepareTranscription(memory, null, { attachOutcome: 'no_session' }, onUploaded),
    ).rejects.toThrow('Upload failed (500)')
    expect(onUploaded).not.toHaveBeenCalled()
    expect(mintRecordingReadUrl).not.toHaveBeenCalled()
  })

  it('no row named (switch OFF) or the finalized path (nothing minted) → never called', async () => {
    const onUploaded = jest.fn(async () => {})
    rowNamed = false
    await webRecordingPort.prepareTranscription(memory, null, { attachOutcome: 'no_session' }, onUploaded)
    await webRecordingPort.prepareTranscription(memory, 'app_biz-1_take-9.webm', { takeRow: 'rs-take' }, onUploaded)
    expect(onUploaded).not.toHaveBeenCalled()
  })

  it('a throw in the hand-over fails the leg before the read-URL mint', async () => {
    const onUploaded = jest.fn(async () => {
      throw new Error('IndexedDB closed')
    })
    await expect(
      webRecordingPort.prepareTranscription(memory, null, { attachOutcome: 'no_session' }, onUploaded),
    ).rejects.toThrow('IndexedDB closed')
    expect(mintRecordingReadUrl).not.toHaveBeenCalled()
  })
})

describe('⚖ Finding 10 — a landed upload whose read-URL mint fails is never an unadopted stray', () => {
  it('PUT ok + read-URL mint fails → the take is on X at U; the 再試行 mints nothing new and makes ONE paid call', async () => {
    rowlessTake()
    readUrlFailures = 1

    expect(await outcome(run())).toEqual(new Error('could not mint a read URL'))
    // The row the mint created is ADOPTED — the take names it and is secured at its key.
    expect(store.meta).toMatchObject({ recordingSessionId: row(1), finalizedPath: key(1) })
    expect(transcribeBodies).toHaveLength(0)

    // The 再試行: the take now has a finalized key, so no mint, no PUT, no X2.
    expect(await outcome(run())).toBe('ok')
    expect(mintRecordingUploadUrl).toHaveBeenCalledTimes(1)
    expect(put).toHaveBeenCalledTimes(1)
    expect(mintRecordingReadUrl.mock.calls.at(-1)).toEqual([key(1), row(1)])
    // Exactly one paid call, on X's own key and row.
    expect(transcribeBodies).toEqual([
      { audioUrl: expect.stringContaining(key(1)), recordingSessionId: row(1), locale: 'ja' },
    ])
    expect(adoptTakeSession).toHaveBeenCalledTimes(1)
  })

  it('a failed PUT is unchanged: nothing adopted, and the 再試行 mints X2 (the per-attempt empty row, Finding 9)', async () => {
    rowlessTake()
    putStatus = 500

    expect(await outcome(run())).toEqual(new Error('Upload failed (500)'))
    expect(adoptTakeSession).not.toHaveBeenCalled()
    expect(store.meta?.recordingSessionId).toBeUndefined()
    expect(mintRecordingReadUrl).not.toHaveBeenCalled()
    expect(transcribeBodies).toHaveLength(0)

    putStatus = 200
    expect(await outcome(run())).toBe('ok')
    expect(mintRecordingUploadUrl).toHaveBeenCalledTimes(2)
    expect(store.meta).toMatchObject({ recordingSessionId: row(2), finalizedPath: key(2) })
    expect(transcribeBodies).toHaveLength(1)
  })

  it('the happy path adopts ONCE per mint — the hand-over, never a second write after the answer', async () => {
    rowlessTake()
    const ctx = { durationSeconds: 42, onSessionAdopted: jest.fn() }
    expect(await outcome(runAIPipeline(memory, TAKE, 'ja', () => {}, ctx))).toBe('ok')
    expect(adoptTakeSession).toHaveBeenCalledTimes(1)
    expect(adoptTakeSession).toHaveBeenCalledWith(TAKE, row(1), key(1))
    expect(ctx.onSessionAdopted.mock.calls).toEqual([[row(1)]])
    // Adopted before the read URL was asked for.
    const [adoptedAt] = adoptTakeSession.mock.invocationCallOrder
    const [readAt] = mintRecordingReadUrl.mock.invocationCallOrder
    expect(adoptedAt).toBeLessThan(readAt)
    expect(transcribeBodies).toHaveLength(1)
  })

  it('switch OFF (no row named): nothing to adopt, the fallback runs exactly as before', async () => {
    rowlessTake()
    rowNamed = false
    expect(await outcome(run())).toBe('ok')
    expect(adoptTakeSession).not.toHaveBeenCalled()
    expect(transcribeBodies).toEqual([{ audioUrl: expect.stringContaining(key(1)), locale: 'ja' }])
  })
})

describe('⚖ fold 1 — the hand-over counts only when the adoption write landed (Greptile P1)', () => {
  it('the early write is lost (the store answers false) → the attempt after the answer still puts the take on X at U; the 再試行 mints nothing and pays once, on X', async () => {
    rowlessTake()
    // The real store never throws here: a thrown write is retried inside
    // patchTakeMeta (STAMP_WRITE_TRIES) and then answered false.
    adoptTakeSession.mockResolvedValueOnce(false)
    const ctx = { durationSeconds: 42, onSessionAdopted: jest.fn() }

    expect(await outcome(runAIPipeline(memory, TAKE, 'ja', () => {}, ctx))).toBe('ok')
    // Asked twice: the hand-over (lost), then from the port's answer (landed).
    expect(adoptTakeSession.mock.calls).toEqual([
      [TAKE, row(1), key(1)],
      [TAKE, row(1), key(1)],
    ])
    const [, secondAt] = adoptTakeSession.mock.invocationCallOrder
    const [readAt] = mintRecordingReadUrl.mock.invocationCallOrder
    expect(readAt).toBeLessThan(secondAt)
    expect(store.meta).toMatchObject({ recordingSessionId: row(1), finalizedPath: key(1) })
    expect(ctx.onSessionAdopted.mock.calls).toEqual([[row(1)]])
    expect(transcribeBodies).toHaveLength(1)

    // The 再試行 of the same take: its finalized key is X's — no mint, no PUT, no X2 …
    expect(await outcome(run())).toBe('ok')
    expect(mintRecordingUploadUrl).toHaveBeenCalledTimes(1)
    expect(put).toHaveBeenCalledTimes(1)
    // … and its one paid call is on X's own key and row.
    expect(transcribeBodies).toHaveLength(2)
    expect(transcribeBodies.at(-1)).toEqual({
      audioUrl: expect.stringContaining(key(1)),
      recordingSessionId: row(1),
      locale: 'ja',
    })
  })

  it('a first-stamp-wins false is asked once more from the answer and refused again — the row the take already names is never written over', async () => {
    rowlessTake()
    // Another writer stamped the take first; the store's brace refuses this one.
    adoptTakeSession.mockImplementationOnce(async () => {
      store.meta = { ...store.meta!, recordingSessionId: 'rs-other', finalizedAt: 1, finalizedPath: 'app_biz-1_other.webm' }
      return false
    })
    const ctx = { durationSeconds: 42, onSessionAdopted: jest.fn() }

    expect(await outcome(runAIPipeline(memory, TAKE, 'ja', () => {}, ctx))).toBe('ok')
    expect(adoptTakeSession).toHaveBeenCalledTimes(2)
    expect(store.meta).toMatchObject({ recordingSessionId: 'rs-other', finalizedPath: 'app_biz-1_other.webm' })
    expect(ctx.onSessionAdopted).not.toHaveBeenCalled()
  })
})
