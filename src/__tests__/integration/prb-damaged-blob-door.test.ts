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
  markTakeSecureError: jest.fn(async () => undefined),
  markTakeStaged: jest.fn(async () => undefined),
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
    expect(m.markTakeStaged).toHaveBeenCalledWith(TAKE, STAGED_PATH)
    expect(m.markTakeSecureError).toHaveBeenCalledWith(TAKE, code)
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
    expect(m.markTakeStaged).toHaveBeenCalledWith(TAKE, STAGED_PATH)
    expect(m.markTakeSecureError).toHaveBeenCalledWith(TAKE, 'audio_partial')
    expect(m.markTakeFinalized).not.toHaveBeenCalled()
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
  })

  it('(i) a staged refusal → today\'s retry path: no staged path, no terminal code', async () => {
    m.loadTakeBlob.mockResolvedValue(HEADLESS)
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }))
    const port = withTakeDoors(base)
    await secureTake(port, TAKE, 5)
    expect(m.markTakeStaged).not.toHaveBeenCalled()
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
