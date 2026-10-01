/**
 * S76 commit W — 「The fullest copy wins」 (W-1, A1-route, A2, A3, R-S76-8, S-3,
 * R-S76-7's ROUTE). Lands the S75 W-1 red test, adjusted (rev 2 §6): the
 * take-store mock carries markTakeHeldUpload / clearTakeHeldUpload and RED 2
 * asserts the TAKE-KEY route, never only 「no throw」.
 *
 * Real ai-pipeline + real secure-take + real blob-fate; the damaged/terminal
 * readings are take-store's REAL ones (requireActual), so a mutant there is seen.
 * Take store rows, ports, recorder and network are faked (recording-fallback-attach's
 * boundaries).
 */
const awaitTakeSecured = jest.fn(async (_takeId: string) => {})
jest.mock('@/lib/global-recorder', () => ({
  globalRecorder: { awaitTakeSecured: (takeId: string) => awaitTakeSecured(takeId) },
}))

type Meta = {
  recordingSessionId?: string
  mimeType?: string
  durationMs?: number
  finalizedAt?: number
  finalizedPath?: string
  secureError?: string
  tailIncomplete?: boolean
  bytesEmitted?: number
  lastSeq?: number
  stagedPath?: string
  heldUpload?: { bytes: number; seconds: number }
  startedAt: number
  updatedAt: number
}
const store = { meta: null as Meta | null, blob: null as Blob | null, noteAnswer: true }
const markTakeHeldUpload = jest.fn(async (_id: string, bytes: number, seconds: number) => {
  if (store.noteAnswer && store.meta) store.meta = { ...store.meta, heldUpload: { bytes, seconds } }
  return store.noteAnswer
})
const clearTakeHeldUpload = jest.fn(async (_id: string) => {
  if (store.meta) store.meta = { ...store.meta, heldUpload: undefined }
  return true
})
jest.mock('@/lib/karute/take-store', () => {
  const real = jest.requireActual('@/lib/karute/take-store')
  return {
    readTakeSecureMeta: async () => (store.meta ? { ...store.meta } : null),
    loadTakeBlob: async () => store.blob,
    loadTakeBlobFacts: async () =>
      store.blob ? { blob: store.blob, segmentCount: 1, seqMin: 0, seqMax: 0, seq0Present: true } : null,
    ensureFinalizedPath: async (_id: string, meta: Meta) => meta.finalizedPath ?? null,
    readTakeTranscript: async () => null,
    stampTakeTranscript: async () => {},
    isStoppedTake: () => false,
    markTakeFinalized: async (_id: string, path: string) => {
      if (store.meta) store.meta = { ...store.meta, finalizedAt: 1, finalizedPath: path, secureError: undefined }
    },
    markTakeSecureError: async (_id: string, code: string) => {
      if (store.meta) store.meta = { ...store.meta, secureError: code }
    },
    markTakeStaged: async (_id: string, path: string) => {
      if (store.meta) store.meta = { ...store.meta, stagedPath: path }
    },
    markTakeStagedDamaged: async (_id: string, path: string, code: string) => {
      if (store.meta) store.meta = { ...store.meta, stagedPath: path, secureError: code }
    },
    markTakeHeldUpload: (id: string, b: number, s: number) => markTakeHeldUpload(id, b, s),
    clearTakeHeldUpload: (id: string) => clearTakeHeldUpload(id),
    markTakeStartBoundAttempted: async () => {},
    adoptTakeSession: async () => false,
    stampTakeSession: async () => false,
    isDamagedTake: real.isDamagedTake,
    DAMAGED_SECURE_CODES: real.DAMAGED_SECURE_CODES,
    TERMINAL_SECURE_ERRORS: real.TERMINAL_SECURE_ERRORS,
  }
})

jest.mock('@/lib/ports/data-port', () => ({
  getDataPort: () => ({
    apiFetch: async (url: string) =>
      ({
        ok: true,
        json: async () =>
          url.endsWith('/transcribe') ? { transcript: 'こんにちは' } : url.endsWith('/extract') ? { entries: [] } : { summary: 'まとめ' },
      }) as unknown as Response,
  }),
}))

const TAKE = '0b8d2c4e-1f3a-4b5c-8d7e-9f0a1b2c3d4e'
const SESSION = '7c1f0a2b-4d3e-4f56-9a7b-8c9d0e1f2a3b'
const TAKE_KEY = `app_biz-1_${TAKE}.webm`
type Opts = { stagedFor?: string; attachOutcome?: string; takeRow?: string }
const prepareTranscription = jest.fn(async (_blob: Blob, finalizedPath: string | null, opts?: Opts) => ({
  body: { path: finalizedPath ?? 'app_biz-1_server-named.webm' },
  path: opts?.stagedFor ? `stg/${TAKE}.webm` : (finalizedPath ?? 'app_biz-1_server-named.webm'),
  recordingSessionId: null as string | null,
}))
type Minted = { path: string; url?: string; contentType: string } | { error: string }
const mintTakeUrl = jest.fn(
  async (..._a: unknown[]): Promise<Minted> => ({ path: TAKE_KEY, url: 'https://proj.supabase.co/upload/x', contentType: 'audio/webm' }),
)
type FinalizeBody = { durationSeconds: number; byteLength: number }
const finalizeTake = jest.fn(async (_b: FinalizeBody): Promise<{ ok: true } | { error: string }> => ({ ok: true }))
jest.mock('@/lib/ports/recording-port', () => ({
  getRecordingPipelinePort: () => ({
    aiBase: '/api/ai',
    prepareTranscription: (b: Blob, p: string | null, o?: Opts) => prepareTranscription(b, p, o),
    mintTakeUrl: (...a: unknown[]) => mintTakeUrl(...a),
    finalizeTake: (b: FinalizeBody) => finalizeTake(b),
    startSession: async () => null,
  }),
}))

const put = jest.fn(async (_url: string, _init: { body: Blob }) => ({ ok: true, status: 200 }) as Response)
global.fetch = put as unknown as typeof fetch

import { withContainerHead } from './helpers/container-head-fetch'
import { runAIPipeline, DamagedAudioError } from '@/lib/ai-pipeline'
import { secureTake } from '@/lib/recording/secure-take'
import { RECORDING_SWITCHES } from '@/lib/recording/recording-switches'
import { getRecordingPipelinePort } from '@/lib/ports/recording-port'

// The stored prefix (27 B: seq 0 with the head) and the whole recording (20,030 B).
const stored = new Blob(withContainerHead('stored-prefix', 'webm'), { type: 'audio/webm' })
const memory = new Blob(withContainerHead('whole-recording:' + 'x'.repeat(20_000), 'webm'), { type: 'audio/webm' })

const unboundCalls = () => prepareTranscription.mock.calls.filter((c) => !c[2]?.stagedFor)
const stagedCalls = () => prepareTranscription.mock.calls.filter((c) => !!c[2]?.stagedFor)
const outcomeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'resolved',
    (e: Error) => (e instanceof DamagedAudioError ? `DamagedAudioError(${e.message})` : `rejected(${e?.message})`),
  )
const MINT_REFUSED = { error: 'upstream' }
const MINT_NO_URL = { path: TAKE_KEY, contentType: 'audio/webm' }

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
  // Defaults restored every test (clearAllMocks keeps a mockResolvedValue).
  mintTakeUrl.mockResolvedValue({ path: TAKE_KEY, url: 'https://proj.supabase.co/upload/x', contentType: 'audio/webm' })
  finalizeTake.mockResolvedValue({ ok: true })
  store.blob = stored
  store.noteAnswer = true
  store.meta = {
    recordingSessionId: SESSION,
    mimeType: 'audio/webm',
    tailIncomplete: true,
    bytesEmitted: stored.size,
    lastSeq: 0,
    startedAt: 0,
    updatedAt: 1,
  }
})

const run = (blob: Blob = memory, durationSeconds: number | undefined = 600) =>
  runAIPipeline(blob, TAKE, 'ja', () => {}, { recordingSessionId: SESSION, durationSeconds })

describe('W-1 — the whole held recording goes to the take key (red test S75, adjusted)', () => {
  it('sanity: 27 B stored, 20,030 B held', () => {
    expect([stored.size, memory.size]).toEqual([27, 20_030])
  })

  it('RED 1 → green: the run resolves', async () => {
    expect(await outcomeOf(run())).toBe('resolved')
  })

  it('RED 2 → green: the TAKE-KEY route — note, PUT(memory), finalize once, transcribe the take key, never staged', async () => {
    await run()
    expect(markTakeHeldUpload).toHaveBeenCalledWith(TAKE, memory.size, 600)
    expect(markTakeHeldUpload.mock.invocationCallOrder[0]).toBeLessThan(mintTakeUrl.mock.invocationCallOrder[0])
    expect(put.mock.calls.map((c) => c[1].body.size)).toEqual([memory.size])
    expect(finalizeTake).toHaveBeenCalledTimes(1)
    expect(finalizeTake.mock.calls[0][0]).toMatchObject({ byteLength: memory.size, durationSeconds: 600 })
    expect(prepareTranscription.mock.calls.map((c) => [c[0], c[1]])).toEqual([[memory, TAKE_KEY]])
    expect(stagedCalls()).toEqual([])
  })

  it('CONTROL: door OFF → today’s fallback uploads the whole memory blob', async () => {
    const off = jest.replaceProperty(RECORDING_SWITCHES as { stagedPartialDoor: boolean }, 'stagedPartialDoor', false)
    try {
      expect(await outcomeOf(run())).toBe('resolved')
      expect(markTakeHeldUpload).not.toHaveBeenCalled()
      expect(prepareTranscription).toHaveBeenCalledWith(memory, null, { attachOutcome: 'attach_failed' })
    } finally {
      off.restore()
    }
  })

  it('A1: the note did not commit → no mint, no take-key PUT; the whole blob takes the attach_failed door', async () => {
    store.noteAnswer = false
    expect(await outcomeOf(run())).toBe('resolved')
    expect(mintTakeUrl).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
    expect(unboundCalls().map((c) => [c[0], c[1], c[2]])).toEqual([[memory, null, { attachOutcome: 'attach_failed' }]])
  })

  it('S-3: held wins but the take row has NO session → no note, no take-key PUT; fallback carries the whole blob', async () => {
    store.meta = { ...store.meta!, recordingSessionId: undefined }
    expect(await outcomeOf(run())).toBe('resolved')
    expect(markTakeHeldUpload).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
    expect(unboundCalls().map((c) => c[0])).toEqual([memory])
  })
})

describe('A2 — the unbound door never carries the stored short copy', () => {
  it('the run holds the STORED copy, the note’s finish refused (mint) → DamagedAudioError(partial), nothing transcribed', async () => {
    store.meta = { ...store.meta!, heldUpload: { bytes: memory.size, seconds: 600 } }
    mintTakeUrl.mockResolvedValueOnce(MINT_REFUSED)
    expect(await outcomeOf(run(stored, undefined))).toBe('DamagedAudioError(Audio is partial.)')
    expect(prepareTranscription).not.toHaveBeenCalled()
  })

  it('the run holds the STORED copy, the staged door throws a passing error → DamagedAudioError(partial), no unbound upload', async () => {
    prepareTranscription.mockRejectedValueOnce(new Error('staged door 503'))
    expect(await outcomeOf(run(stored, undefined))).toBe('DamagedAudioError(Audio is partial.)')
    expect(unboundCalls()).toEqual([])
  })

  it('CONTROL: door OFF → today’s fallback uploads the stored blob', async () => {
    const off = jest.replaceProperty(RECORDING_SWITCHES as { stagedPartialDoor: boolean }, 'stagedPartialDoor', false)
    try {
      expect(await outcomeOf(run(stored, undefined))).toBe('resolved')
      expect(unboundCalls().map((c) => c[0])).toEqual([stored])
    } finally {
      off.restore()
    }
  })

  it('the run holds the 20,030 B whole blob and every secure leg fails → fallback with the WHOLE blob (verdict ok)', async () => {
    mintTakeUrl.mockResolvedValue(MINT_REFUSED)
    expect(await outcomeOf(run())).toBe('resolved')
    expect(unboundCalls().map((c) => [c[0], c[2]])).toEqual([[memory, { attachOutcome: 'attach_failed' }]])
  })

  it('(a) tailIncomplete, no bytesEmitted, NOTHING stored, memory arm refused → fallback uploads the WHOLE blob', async () => {
    store.blob = null
    store.meta = { ...store.meta!, bytesEmitted: undefined, lastSeq: -1 }
    mintTakeUrl.mockResolvedValue(MINT_REFUSED)
    expect(await outcomeOf(run())).toBe('resolved')
    expect(unboundCalls().map((c) => c[0])).toEqual([memory])
  })

  it('(b) no bytesEmitted, stored 27 B, held 20,030 B, every secure leg fails → fallback whole', async () => {
    store.meta = { ...store.meta!, bytesEmitted: undefined }
    mintTakeUrl.mockResolvedValue(MINT_REFUSED)
    expect(await outcomeOf(run())).toBe('resolved')
    expect(unboundCalls().map((c) => c[0])).toEqual([memory])
  })

  it('(c) stored == held (LIMIT 14) → refused as partial', async () => {
    const same = new Blob([stored], { type: 'audio/webm' })
    prepareTranscription.mockRejectedValueOnce(new Error('staged door 503'))
    expect(await outcomeOf(run(same, undefined))).toBe('DamagedAudioError(Audio is partial.)')
    expect(unboundCalls()).toEqual([])
  })
})

describe('R-S76-8 — the damaged belt sizes by the REAL stored copy', () => {
  it('audio_partial pre-marked, no bytesEmitted, stored 27 B, held 20,030 B, the PUT throws → fallback whole, no DamagedAudioError', async () => {
    store.meta = { ...store.meta!, secureError: 'audio_partial', bytesEmitted: undefined }
    put.mockRejectedValueOnce(new Error('network down'))
    expect(await outcomeOf(run())).toBe('resolved')
    expect(unboundCalls().map((c) => c[0])).toEqual([memory])
  })
})

describe('R-S76-7 ROUTE — isDamagedTake stays code-only at ai-pipeline:276', () => {
  it.each([
    ['mint forbidden', () => mintTakeUrl.mockResolvedValue({ error: 'forbidden' })],
    ['finalize size_mismatch', () => finalizeTake.mockResolvedValue({ error: 'size_mismatch' })],
  ])('tailIncomplete, NOTHING stored, memory arm refused terminally (%s) → fallback uploads the WHOLE blob', async (_n, arrange) => {
    store.blob = null
    store.meta = { ...store.meta!, bytesEmitted: undefined, lastSeq: -1 }
    arrange()
    expect(await outcomeOf(run())).toBe('resolved')
    expect(unboundCalls().map((c) => c[0])).toEqual([memory])
  })
})

describe('A3 — secureTake finishes a noted whole copy; the server’s answer resolves the note', () => {
  const port = () => getRecordingPipelinePort()
  beforeEach(() => {
    store.meta = { ...store.meta!, heldUpload: { bytes: memory.size, seconds: 600 } }
  })

  it('no url (the PUT landed) → finalize the NOTED size → finalized, nothing staged', async () => {
    mintTakeUrl.mockResolvedValueOnce(MINT_NO_URL)
    await secureTake(port(), TAKE)
    expect(finalizeTake.mock.calls[0][0]).toMatchObject({ byteLength: memory.size, durationSeconds: 600 })
    expect(store.meta).toMatchObject({ finalizedPath: TAKE_KEY })
    expect(stagedCalls()).toEqual([])
  })

  it('…the same with audio_partial pre-marked (the held branch sits before the terminal check)', async () => {
    store.meta = { ...store.meta!, secureError: 'audio_partial' }
    mintTakeUrl.mockResolvedValueOnce(MINT_NO_URL)
    await secureTake(port(), TAKE)
    expect(store.meta).toMatchObject({ finalizedPath: TAKE_KEY, secureError: undefined })
  })

  it('(i) mint answers a url (nothing landed) → note cleared, no PUT, the staged door as today', async () => {
    await secureTake(port(), TAKE)
    expect(clearTakeHeldUpload).toHaveBeenCalledWith(TAKE)
    expect(store.meta!.heldUpload).toBeUndefined()
    expect(put).not.toHaveBeenCalled()
    expect(stagedCalls().map((c) => c[0])).toEqual([stored])
    expect(store.meta!.secureError).toBe('audio_partial')
  })

  it('(ii) finalize refused with a TERMINAL code → the code is written and the note cleared', async () => {
    mintTakeUrl.mockResolvedValueOnce(MINT_NO_URL)
    finalizeTake.mockResolvedValueOnce({ error: 'size_mismatch' })
    await secureTake(port(), TAKE)
    expect(store.meta).toMatchObject({ secureError: 'size_mismatch', heldUpload: undefined })
    expect(stagedCalls()).toEqual([])
  })

  it('(iii) a PASSING refusal → the code is written, the note KEPT, nothing staged', async () => {
    mintTakeUrl.mockResolvedValueOnce(MINT_REFUSED)
    await secureTake(port(), TAKE)
    expect(store.meta).toMatchObject({ secureError: 'upstream', heldUpload: { bytes: memory.size, seconds: 600 } })
    expect(clearTakeHeldUpload).not.toHaveBeenCalled()
    expect(stagedCalls()).toEqual([])
  })

  it('(iii) a passing refusal never erases audio_partial; a thrown mint is the passing `network` (R-S76-9 b)', async () => {
    store.meta = { ...store.meta!, secureError: 'audio_partial' }
    mintTakeUrl.mockRejectedValueOnce(new Error('offline'))
    await secureTake(port(), TAKE)
    expect(store.meta).toMatchObject({ secureError: 'audio_partial', heldUpload: { bytes: memory.size, seconds: 600 } })
  })

  it('door OFF → a noted stamped take is not finished from the note (R-S76-9 a, K-6)', async () => {
    store.meta = { ...store.meta!, tailIncomplete: undefined, durationMs: 600_000 }
    const off = jest.replaceProperty(RECORDING_SWITCHES as { stagedPartialDoor: boolean }, 'stagedPartialDoor', false)
    try {
      await secureTake(port(), TAKE)
      expect(finalizeTake.mock.calls.map((c) => c[0].byteLength)).toEqual([stored.size])
      expect(clearTakeHeldUpload).not.toHaveBeenCalled()
    } finally {
      off.restore()
    }
  })
})
