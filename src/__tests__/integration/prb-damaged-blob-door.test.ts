/**
 * PR-B commit 2 (build 32) — a damaged or incomplete blob never seals the take
 * key. Pins R-2 on EACH port (the thin phone port and the web port), through
 * the shared secureTake → secureBlob branch split:
 *   (i)   damaged + session → exactly one staged PUT with `partial: true`,
 *         zero take-key mints/PUTs, zero finalize; staged path + terminal code
 *         written only after the staged door answered;
 *   (ii)  damaged + no session → zero uploads, a retryable mark, local hold;
 *   (iii) ok → today's path (take-key mint → PUT → finalize), no staged mint.
 * Plus: the thin staged door's typed error (B-S66-5), the K-1 refine pin, the
 * verdict itself (B7), and the discard sweep's refusal per damaged code (B3).
 */
import { setDataPort } from '@/lib/ports/data-port'
import { UploadUrlMintSchema } from '@/lib/app-api/record-schemas'
import { RECORDING_SWITCHES } from '@/lib/recording/recording-switches'
import { blobFate, decideBlobFate, readBlobHead, StagedDoorError } from '@/lib/recording/blob-fate'
import { WEBM_HEAD } from './helpers/container-head-fetch'
import { DIAG_RING_MAX_ENTRIES, foldDiagEvent, validTakeDiag } from '@/lib/recording/take-diag'
import * as store from '@/lib/karute/take-store'
import { secureTake } from '@/lib/recording/secure-take'
import { sweepDiscardTranscripts } from '@/lib/recording/discard-transcript'
import {
  setRecordingPipelinePort,
  webRecordingPort,
  type RecordingPipelinePort,
} from '@/lib/ports/recording-port'
import { viteRecordingPort } from '../../../thin/ports/recording.vite'

jest.mock('@/lib/karute/take-store', () => ({
  ...jest.requireActual('@/lib/karute/take-store'),
  readTakeSecureMeta: jest.fn(),
  loadTakeBlob: jest.fn(),
  // PR-B 5b (R-S74-10): secureTake reads the blob with its seq facts — here the mocked loadTakeBlob's blob, no facts.
  loadTakeBlobFacts: jest.fn(async (id: string) => {
    const blob = await (jest.requireMock('@/lib/karute/take-store') as { loadTakeBlob: (id: string) => Promise<Blob | null> }).loadTakeBlob(id)
    return blob ? { blob } : null
  }),
  markTakeSecureError: jest.fn(async () => undefined),
  markTakeStaged: jest.fn(async () => undefined),
  markTakeStagedDamaged: jest.fn(async () => undefined),
  markTakeFinalized: jest.fn(async () => undefined),
  markTakeStartBoundAttempted: jest.fn(async () => undefined),
  stampTakeSession: jest.fn(async () => true),
  listPendingDiscardTakes: jest.fn(async () => []),
  markDiscardTranscriptDone: jest.fn(async () => undefined),
  ensureFinalizedPath: jest.fn(async () => null),
}))

// The discard run first waits on the take's stop leg; this suite has no recorder.
jest.mock('@/lib/global-recorder', () => ({
  globalRecorder: { awaitTakeSecured: jest.fn(async () => undefined), isActiveTake: () => false },
}))

jest.mock('@/actions/recording-upload', () => ({
  mintRecordingUploadUrl: jest.fn(),
  mintRecordingReadUrl: jest.fn(),
}))

const m = store as jest.Mocked<typeof store>
// eslint-disable-next-line @typescript-eslint/no-require-imports
const webActions = require('@/actions/recording-upload') as { mintRecordingUploadUrl: jest.Mock }

const TAKE = '11111111-2222-4333-8444-555555555555'
const SESSION = '99999999-2222-4333-8444-555555555555'
const STAGED_PATH = `stg/biz_${SESSION}_${TAKE}.webm`
const TAKE_PATH = `biz/${TAKE}.webm`

const GOOD = new Blob([WEBM_HEAD, new Uint8Array(50)], { type: 'audio/webm' })
const HEADLESS = new Blob([new Uint8Array(64)], { type: 'audio/webm' })

function meta(extra: Record<string, unknown> = {}) {
  return {
    mimeType: 'audio/webm',
    recordingSessionId: SESSION,
    durationMs: 5_000,
    startedAt: 1,
    updatedAt: 2,
    lastSeq: 0,
    ...extra,
  } as unknown as Awaited<ReturnType<typeof store.readTakeSecureMeta>>
}

let fetchMock: jest.Mock
let stagedBodies: Record<string, unknown>[]

/** The take-key doors are stubbed on BOTH ports (their counts are the proof);
 *  prepareTranscription is each port's REAL staged door. */
function withTakeDoors(base: RecordingPipelinePort): RecordingPipelinePort & {
  mintTakeUrl: jest.Mock
  finalizeTake: jest.Mock
  startSession: jest.Mock
} {
  return {
    ...base,
    mintTakeUrl: jest.fn(async () => ({ path: TAKE_PATH, url: 'https://put/take', contentType: 'audio/webm' })),
    finalizeTake: jest.fn(async () => ({ ok: true })),
    startSession: jest.fn(async () => null),
  } as never
}

const PORTS: Array<[string, () => void, RecordingPipelinePort]> = [
  [
    'thin',
    () => {
      const apiFetch = jest.fn(async (path: string, init?: RequestInit) => {
        if (path === '/api/app/v1/recordings/upload-url') {
          stagedBodies.push(JSON.parse(String(init?.body)))
          return new Response(
            JSON.stringify({ path: STAGED_PATH, url: 'https://put/staged', contentType: 'audio/webm' }),
            { status: 200 },
          )
        }
        throw new Error(`unexpected door ${path}`)
      })
      setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
    },
    viteRecordingPort,
  ],
  [
    'web',
    () => {
      webActions.mintRecordingUploadUrl.mockImplementation(async (body: Record<string, unknown>) => {
        stagedBodies.push(body)
        return { path: STAGED_PATH, url: 'https://put/staged', contentType: 'audio/webm', recordingSessionId: null }
      })
    },
    webRecordingPort,
  ],
]

beforeEach(() => {
  jest.clearAllMocks()
  stagedBodies = []
  fetchMock = jest.fn(async () => new Response(null, { status: 200 }))
  global.fetch = fetchMock as unknown as typeof fetch
  m.loadTakeBlob.mockResolvedValue(GOOD)
  m.readTakeSecureMeta.mockResolvedValue(meta())
})

describe.each(PORTS)('R-2 on the %s port', (_name, wire, base) => {
  beforeEach(() => wire())

  it.each([
    ['unreadable (no container head)', () => HEADLESS, {}, 'audio_unreadable'],
    ['partial (fewer bytes than the recorder emitted)', () => GOOD, { bytesEmitted: GOOD.size + 10 }, 'audio_partial'],
  ])('(i) damaged + session, %s → one staged PUT with partial:true, no take key, no finalize', async (_l, blob, extra, code) => {
    m.loadTakeBlob.mockResolvedValue(blob())
    m.readTakeSecureMeta.mockResolvedValue(meta(extra))
    const port = withTakeDoors(base)
    await secureTake(port, TAKE, 5)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://put/staged')
    expect(stagedBodies).toHaveLength(1)
    expect(stagedBodies[0]).toMatchObject({ stagedFor: SESSION, stagedTake: TAKE, partial: true })
    expect(port.mintTakeUrl).not.toHaveBeenCalled()
    expect(port.finalizeTake).not.toHaveBeenCalled()
    // PR-B Wn (W-4): the staged path and the damaged code land in ONE write.
    expect(m.markTakeStagedDamaged).toHaveBeenCalledTimes(1)
    expect(m.markTakeStagedDamaged).toHaveBeenCalledWith(TAKE, STAGED_PATH, code, expect.objectContaining({ arm: 'stored' }))
    expect(m.markTakeStaged).not.toHaveBeenCalled()
    expect(m.markTakeSecureError).not.toHaveBeenCalled()
    expect(m.markTakeFinalized).not.toHaveBeenCalled()
  })

  // B11 + RULING-S72-PRB-C2-STOPS STOP 1: a take whose tail never landed goes
  // through the same staged door (no stop stamp needed — it never finalizes).
  it('(i) tailIncomplete + session → one staged PUT with partial:true, zero take-key PUTs, audio_partial', async () => {
    m.readTakeSecureMeta.mockResolvedValue(meta({ tailIncomplete: true, durationMs: undefined }))
    const port = withTakeDoors(base)
    await secureTake(port, TAKE)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://put/staged')
    expect(stagedBodies).toHaveLength(1)
    expect(stagedBodies[0]).toMatchObject({ stagedFor: SESSION, stagedTake: TAKE, partial: true })
    expect(port.mintTakeUrl).not.toHaveBeenCalled()
    expect(port.finalizeTake).not.toHaveBeenCalled()
    // PR-B Wn (W-4): one write.
    expect(m.markTakeStagedDamaged).toHaveBeenCalledTimes(1)
    expect(m.markTakeStagedDamaged).toHaveBeenCalledWith(TAKE, STAGED_PATH, 'audio_partial', expect.objectContaining({ arm: 'stored' }))
    expect(m.markTakeStaged).not.toHaveBeenCalled()
    expect(m.markTakeSecureError).not.toHaveBeenCalled()
    expect(m.markTakeFinalized).not.toHaveBeenCalled()
  })

  // PR-B Wn (W-4 FOLD, M-S78-8): securing waits for the one write — held
  // pending, secureTake has not answered; released, it answers null.
  it('(i) damaged + session → secureTake stays pending until the one staged+damaged write resolves', async () => {
    m.loadTakeBlob.mockResolvedValue(HEADLESS)
    m.readTakeSecureMeta.mockResolvedValue(meta({}))
    let release!: () => void
    m.markTakeStagedDamaged.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve)),
    )
    const port = withTakeDoors(base)
    let answered = false
    const run = secureTake(port, TAKE, 5).then((r) => {
      answered = true
      return r
    })
    for (let i = 0; i < 50 && m.markTakeStagedDamaged.mock.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 0))
    expect(m.markTakeStagedDamaged).toHaveBeenCalledWith(TAKE, STAGED_PATH, 'audio_unreadable', expect.objectContaining({ arm: 'stored' }))
    for (let i = 0; i < 20; i++) await Promise.resolve()
    expect(answered).toBe(false)
    release()
    await expect(run).resolves.toBeUndefined()
    expect(answered).toBe(true)
  })

  it('(ii) tailIncomplete + no session → the local hold (B4): no door, no session mint, no mark', async () => {
    m.readTakeSecureMeta.mockResolvedValue(meta({ tailIncomplete: true, recordingSessionId: undefined }))
    const port = withTakeDoors(base)
    await secureTake(port, TAKE, 5)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(stagedBodies).toHaveLength(0)
    expect(port.startSession).not.toHaveBeenCalled()
    expect(port.mintTakeUrl).not.toHaveBeenCalled()
    expect(m.markTakeSecureError).not.toHaveBeenCalled()
    expect(m.markTakeStagedDamaged).not.toHaveBeenCalled()
  })

  it('(i) a staged refusal → today\'s retry path: no staged path, no terminal code', async () => {
    m.loadTakeBlob.mockResolvedValue(HEADLESS)
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }))
    const port = withTakeDoors(base)
    await secureTake(port, TAKE, 5)
    expect(m.markTakeStaged).not.toHaveBeenCalled()
    expect(m.markTakeStagedDamaged).not.toHaveBeenCalled()
    expect(m.markTakeSecureError).toHaveBeenCalledWith(TAKE, 'network')
    expect(store.TERMINAL_SECURE_ERRORS.has('network')).toBe(false)
    expect(port.mintTakeUrl).not.toHaveBeenCalled()
  })

  it('(ii) damaged + no session → zero uploads, retryable, the local copy held', async () => {
    m.loadTakeBlob.mockResolvedValue(HEADLESS)
    m.readTakeSecureMeta.mockResolvedValue(meta({ recordingSessionId: undefined }))
    const port = withTakeDoors(base)
    await secureTake(port, TAKE, 5)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(stagedBodies).toHaveLength(0)
    expect(port.mintTakeUrl).not.toHaveBeenCalled()
    expect(m.markTakeStaged).not.toHaveBeenCalled()
    expect(m.markTakeStagedDamaged).not.toHaveBeenCalled()
    expect(m.markTakeSecureError).toHaveBeenCalledWith(TAKE, 'session')
    expect(store.TERMINAL_SECURE_ERRORS.has('session')).toBe(false)
  })

  it('(iii) ok → today\'s path: take-key mint, one PUT, the same finalize body, no staged mint', async () => {
    const port = withTakeDoors(base)
    await secureTake(port, TAKE, 5)
    expect(stagedBodies).toHaveLength(0)
    expect(port.mintTakeUrl).toHaveBeenCalledWith(TAKE, 'audio/webm', SESSION)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://put/take')
    expect(port.finalizeTake).toHaveBeenCalledWith({
      takeId: TAKE,
      mimeType: 'audio/webm',
      durationSeconds: 5,
      byteLength: GOOD.size,
      recordingSessionId: SESSION,
      // PR-B commit 5: the 12-key diag only (lastSeq 0, no ring events yet).
      diag: { arm: 'stored', blob_bytes: GOOD.size, first_byte: WEBM_HEAD[0], seq_max: 0 },
    })
    expect(m.markTakeFinalized).toHaveBeenCalledWith(TAKE, TAKE_PATH)
  })

  it('switch OFF → a headless blob takes today\'s path (the take key), never the staged door', async () => {
    const off = jest.replaceProperty(RECORDING_SWITCHES as { stagedPartialDoor: boolean }, 'stagedPartialDoor', false)
    try {
      m.loadTakeBlob.mockResolvedValue(HEADLESS)
      const port = withTakeDoors(base)
      await secureTake(port, TAKE, 5)
      expect(stagedBodies).toHaveLength(0)
      expect(port.mintTakeUrl).toHaveBeenCalledTimes(1)
      expect(port.finalizeTake).toHaveBeenCalledTimes(1)
    } finally {
      off.restore()
    }
  })

  it('a staged body without partial never carries partial:false (N2)', async () => {
    await base.prepareTranscription(GOOD, null, { stagedFor: SESSION, stagedTake: TAKE })
    expect(stagedBodies).toHaveLength(1)
    expect('partial' in stagedBodies[0]).toBe(false)
  })
})

describe('the thin staged door throws ONE typed error (B-S66-5)', () => {
  it('a refused mint → StagedDoorError with the facade code and the status; the message unchanged', async () => {
    setDataPort({
      apiFetch: jest.fn(async () =>
        new Response(JSON.stringify({ error: { code: 'forbidden', message: 'no' } }), { status: 403 }),
      ),
    } as unknown as Parameters<typeof setDataPort>[0])
    const err = await viteRecordingPort
      .prepareTranscription(HEADLESS, null, { stagedFor: SESSION, stagedTake: TAKE, partial: true })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StagedDoorError)
    expect(err).toMatchObject({ code: 'forbidden', status: 403, message: 'Upload URL failed (403)' })
  })

  it('a refused PUT → StagedDoorError upload + status', async () => {
    PORTS[0][1]()
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }))
    const err = await viteRecordingPort
      .prepareTranscription(HEADLESS, null, { stagedFor: SESSION, stagedTake: TAKE, partial: true })
      .catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'StagedDoorError', code: 'upload', status: 403 })
  })
})

describe('K-1: the phone\'s actual staged body passes the mint refine', () => {
  it('{stagedFor, stagedTake, mimeType, partial:true} (no diag yet) → safeParse success', async () => {
    PORTS[0][1]()
    await viteRecordingPort.prepareTranscription(HEADLESS, null, { stagedFor: SESSION, stagedTake: TAKE, partial: true })
    expect(stagedBodies[0]).toEqual({ stagedFor: SESSION, stagedTake: TAKE, mimeType: 'audio/webm', partial: true })
    expect(UploadUrlMintSchema.safeParse(stagedBodies[0]).success).toBe(true)
  })
})

describe('the verdict (B1, B7)', () => {
  it('two facts decide; unknown is never a refusal', async () => {
    const head = await readBlobHead(GOOD)
    expect(decideBlobFate({ head, size: 64 })).toBe('ok')
    expect(decideBlobFate({ head, size: 64, bytesEmitted: 64 })).toBe('ok')
    expect(decideBlobFate({ head, size: 63, bytesEmitted: 64 })).toBe('partial')
    expect(decideBlobFate({ head: new Uint8Array(12), size: 64 })).toBe('unreadable')
    expect(decideBlobFate({ head: null, size: 64 })).toBe('ok')
  })

  it('a blob shorter than PROBE_MIN_HEAD_BYTES, or a head read that throws, is unknown', async () => {
    expect(await readBlobHead(new Blob(['aaaTAIL']))).toBeNull()
    const throwing = { size: 64, slice: () => ({ arrayBuffer: () => Promise.reject(new Error('io')) }) }
    expect(await readBlobHead(throwing as unknown as Blob)).toBeNull()
    expect(await blobFate(throwing as unknown as Blob)).toBe('ok')
    expect(await blobFate(new Blob(['aaaTAIL']))).toBe('ok')
  })
})

describe('the discard sweep refuses a damaged take (B3)', () => {
  it('control: the same take with no damaged code IS staged by the sweep (the gate is reached)', async () => {
    const port = { ...webRecordingPort, prepareTranscription: jest.fn(async () => ({ body: {}, path: STAGED_PATH, recordingSessionId: null })) } as RecordingPipelinePort
    setRecordingPipelinePort(port)
    try {
      m.listPendingDiscardTakes.mockResolvedValue([
        { takeId: TAKE, discardPending: { recordingSessionId: SESSION } },
      ] as never)
      m.readTakeSecureMeta.mockResolvedValue(meta({ tailIncomplete: true }))
      await sweepDiscardTranscripts()
      expect(port.prepareTranscription).toHaveBeenCalledTimes(1)
    } finally {
      setRecordingPipelinePort(webRecordingPort)
    }
  })

  it.each(['audio_unreadable', 'audio_partial', 'unreadable_object'])(
    '%s → never staged, never transcribed, never marked done',
    async (code) => {
      const port = { ...webRecordingPort, prepareTranscription: jest.fn() } as RecordingPipelinePort
      setRecordingPipelinePort(port)
      try {
        m.listPendingDiscardTakes.mockResolvedValue([
          { takeId: TAKE, discardPending: { recordingSessionId: SESSION } },
        ] as never)
        m.readTakeSecureMeta.mockResolvedValue(
          meta({ secureError: code, tailIncomplete: true, stagedPath: STAGED_PATH }),
        )
        await sweepDiscardTranscripts()
        expect(m.readTakeSecureMeta).toHaveBeenCalledWith(TAKE)
        expect(port.prepareTranscription).not.toHaveBeenCalled()
        expect(m.ensureFinalizedPath).not.toHaveBeenCalled()
        expect(m.markDiscardTranscriptDone).not.toHaveBeenCalled()
        expect(store.serverHoldsTake({ ...meta({ secureError: code }), stagedPath: STAGED_PATH, discardTranscriptDoneAt: 1, tailIncomplete: true } as never)).toBe(false)
      } finally {
        setRecordingPipelinePort(webRecordingPort)
      }
    },
  )
})

// PR-B commit 4 (AMB-2): endedBySystem is LOCAL — a system-ended take's
// finalize body and staged mint body carry no endedBySystem (and no diag yet).
describe.each(PORTS)('endedBySystem is never sent — %s port', (_name, wire, base) => {
  beforeEach(() => wire())
  const ended = { endedBySystem: { at: 1, why: 'track_ended' } }

  it('ok take → the finalize body is today\'s exact shape', async () => {
    m.readTakeSecureMeta.mockResolvedValue(meta(ended))
    const port = withTakeDoors(base)
    await secureTake(port, TAKE, 5)
    expect(port.finalizeTake).toHaveBeenCalledWith({
      takeId: TAKE,
      mimeType: 'audio/webm',
      durationSeconds: 5,
      byteLength: GOOD.size,
      recordingSessionId: SESSION,
      // PR-B commit 5: the 12-key diag only (lastSeq 0, no ring events yet).
      diag: { arm: 'stored', blob_bytes: GOOD.size, first_byte: WEBM_HEAD[0], seq_max: 0 },
    })
  })
  it('damaged take → the staged mint body has no endedBySystem; its diag is the 12-key facts only', async () => {
    m.loadTakeBlob.mockResolvedValue(HEADLESS)
    m.readTakeSecureMeta.mockResolvedValue(meta(ended))
    await secureTake(withTakeDoors(base), TAKE, 5)
    expect(stagedBodies).toHaveLength(1)
    expect(stagedBodies[0]).not.toHaveProperty('endedBySystem')
    // PR-B commit 5: the diag rides now — exactly the 12-key facts, nothing local.
    expect(stagedBodies[0].diag).toEqual({ arm: 'stored', blob_bytes: HEADLESS.size, first_byte: 0, seq_max: 0 })
    expect(JSON.stringify(stagedBodies[0])).not.toContain('track_ended')
  })
})

// PR-B commit 5 (K-1 extended, B5, A13): the phone's staged body WITH its diag
// passes the mint refine; an invalid diag is refused by the server, so the
// phone omits it and the body is still accepted. takeDiag OFF → nothing sent.
describe.each(PORTS)('the flight record on the wire — %s port', (_name, wire, base) => {
  beforeEach(() => wire())
  const ring = { diagCounts: { hidden: 2, freeze: 1, store_error: 0 } }

  it('K-1 extended: the staged body with its diag → safeParse success; ring counts ride, nothing local', async () => {
    m.loadTakeBlob.mockResolvedValue(HEADLESS)
    m.readTakeSecureMeta.mockResolvedValue(meta({ ...ring, endedBySystem: { at: 1, why: 'freeze' } }))
    await secureTake(withTakeDoors(base), TAKE, 5)
    expect(stagedBodies[0].diag).toEqual({
      arm: 'stored', blob_bytes: HEADLESS.size, first_byte: 0, seq_max: 0,
      hidden_count: 2, freeze_count: 1, store_error_count: 0,
    })
    expect(UploadUrlMintSchema.safeParse(stagedBodies[0]).success).toBe(true)
    expect(JSON.stringify(stagedBodies[0])).not.toMatch(/endedBySystem|diagRing|bytesEmitted/)
  })
  it('an invalid diag is refused by the schema → the phone sends none, the body is accepted', async () => {
    const body = { stagedFor: SESSION, stagedTake: TAKE, mimeType: 'audio/webm', partial: true }
    expect(UploadUrlMintSchema.safeParse({ ...body, diag: { first_byte: 300 } }).success).toBe(false)
    expect(validTakeDiag({ first_byte: 300 })).toBeUndefined()
    expect(UploadUrlMintSchema.safeParse(body).success).toBe(true)
  })
  it('takeDiag OFF → no diag on the finalize body or the staged body', async () => {
    const restore = RECORDING_SWITCHES.takeDiag
    ;(RECORDING_SWITCHES as { takeDiag: boolean }).takeDiag = false
    try {
      m.readTakeSecureMeta.mockResolvedValue(meta(ring))
      const port = withTakeDoors(base)
      await secureTake(port, TAKE, 5)
      expect(port.finalizeTake.mock.calls[0][0]).not.toHaveProperty('diag')
      m.loadTakeBlob.mockResolvedValue(HEADLESS)
      await secureTake(withTakeDoors(base), TAKE, 5)
      expect(stagedBodies.at(-1)).not.toHaveProperty('diag')
    } finally {
      ;(RECORDING_SWITCHES as { takeDiag: boolean }).takeDiag = restore
    }
  })
})

// PR-B commit 5b (R-S74-10): all twelve keys — the stored copy's seq facts,
// the last pump exit code, the stop leg's session-null count.
describe.each(PORTS)('the flight record fills all twelve keys — %s port', (_name, wire, base) => {
  beforeEach(() => wire())
  const facts = (blob: Blob) => ({ blob, segmentCount: 3, seqMin: 0, seqMax: 2, seq0Present: true })

  it('the three seq keys ride the stored arm\'s finalize body', async () => {
    // S87 F4: lastSeq agrees with the rows (seq 0..2) — a whole take; with the
    // old `lastSeq: 0` these facts are a hole and the verdict is 'partial'.
    m.readTakeSecureMeta.mockResolvedValue(meta({ lastSeq: 2 }))
    m.loadTakeBlobFacts.mockResolvedValueOnce(facts(GOOD) as never)
    const port = withTakeDoors(base)
    await secureTake(port, TAKE, 5)
    expect(port.finalizeTake.mock.calls[0][0].diag).toMatchObject({ seq_min: 0, seq_count: 3, seq0_present: true })
  })
  it('K-1 extended: a staged body with all 12 keys filled passes the server schema', async () => {
    const counts = { diagCounts: { hidden: 1, freeze: 1, store_error: 1 }, lastPumpStop: 'landed' }
    m.readTakeSecureMeta.mockResolvedValue(meta({ ...counts, lastSeq: 2 }))
    m.loadTakeBlobFacts.mockResolvedValueOnce(facts(HEADLESS) as never)
    await secureTake(withTakeDoors(base), TAKE, 5, undefined, 2)
    const diag = stagedBodies[0].diag as Record<string, unknown>
    expect(Object.keys(diag).sort()).toHaveLength(12)
    expect(diag).toMatchObject({ pump_stop_code: 'landed', session_null_count: 2, seq_count: 3 })
    expect(UploadUrlMintSchema.safeParse(stagedBodies[0]).success).toBe(true)
  })
  // 5c (FM-5): the killer of M-B17 「a long take's hidden count comes up short」.
  it('M-B17: one early hidden, then > 64 alternating pump exits → finalize says hidden_count 1, the last code', async () => {
    let row = foldDiagEvent({}, { code: 'hidden' }, 0)
    for (let i = 1; i <= DIAG_RING_MAX_ENTRIES + 6; i++)
      row = foldDiagEvent(row, { code: 'pump_stop', stop: i % 2 ? 'nothing_new' : 'landed' }, i)
    expect(row.diagRing!.some((e) => e.code === 'hidden')).toBe(false) // the ring evicted it
    m.readTakeSecureMeta.mockResolvedValue(meta(row))
    const port = withTakeDoors(base)
    await secureTake(port, TAKE, 5)
    expect(port.finalizeTake.mock.calls[0][0].diag).toMatchObject({ hidden_count: 1, pump_stop_code: 'landed' })
  })
})

// PR-B commit 8 (R-S84-4 path 2, the M-B4 killer of record): `partial` rides
// the STAGED body only — the client-named take-key mint keeps today's body.
describe('M-B4 — the thin take-key mint body never carries partial', () => {
  it('mintTakeUrl sends exactly { takeId, mimeType, recordingSessionId } — no partial key', async () => {
    PORTS[0][1]()
    await viteRecordingPort.mintTakeUrl(TAKE, 'audio/webm', SESSION)
    expect(stagedBodies).toEqual([{ takeId: TAKE, mimeType: 'audio/webm', recordingSessionId: SESSION }])
    expect('partial' in stagedBodies[0]).toBe(false)
  })
})

// model: claude-opus-5-5 · S87 F3 (SF-3, R-S87-3a): the recorder's own emitted
// count reaches the verdict — a stored copy short of it is never a whole take.
describe.each(PORTS)('S87 F3 — the recorder emitted count — %s port', (_name, wire, base) => {
  beforeEach(() => wire())
  it('all flushed: stored bytes === emitted → ok, the take key is sealed', async () => {
    m.readTakeSecureMeta.mockResolvedValue(meta())
    m.loadTakeBlob.mockResolvedValue(GOOD)
    const port = withTakeDoors(base)
    await secureTake(port, TAKE, 5, undefined, undefined, GOOD.size)
    expect(port.finalizeTake).toHaveBeenCalledTimes(1)
    expect(m.markTakeStagedDamaged).not.toHaveBeenCalled()
  })
  it('one flush refused: stored bytes < emitted → partial, staged, the take key never sealed', async () => {
    m.readTakeSecureMeta.mockResolvedValue(meta())
    m.loadTakeBlob.mockResolvedValue(GOOD)
    const port = withTakeDoors(base)
    await secureTake(port, TAKE, 5, undefined, undefined, GOOD.size + 50)
    expect(port.mintTakeUrl).not.toHaveBeenCalled()
    expect(port.finalizeTake).not.toHaveBeenCalled()
    expect(m.markTakeStagedDamaged).toHaveBeenCalledWith(TAKE, STAGED_PATH, 'audio_partial', expect.objectContaining({ arm: 'stored' }))
  })
})
