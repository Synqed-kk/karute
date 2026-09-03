/**
 * webRecordingPort's upload legs after the 2026-08-25 hotfix. The bug this
 * pins: the browser used to write to the `recordings` bucket itself, and the
 * bucket's RLS started 403-ing it ("new row violates row-level security
 * policy") — every web take died at the upload. The web arm now goes through
 * the SAME server-minted signed-URL flow the thin arm has always used, so what
 * this file proves is the wiring: the blob goes to the MINTED url (never
 * supabase-js), the transcribe leg gets a SERVER-minted read url, and cleanup
 * is a server action.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

type MintInput =
  | { takeId?: string | null; mimeType?: string | null; recordingSessionId?: string | null }
  | undefined
type MintReply =
  | {
      path: string
      url: string
      token: string
      contentType: string
      recordingSessionId: string | null
    }
  | { error: string }
const MINTED = {
  path: 'app_biz-1_uuid-1.webm',
  url: 'https://proj.supabase.co/storage/v1/object/upload/sign/recordings/app_biz-1_uuid-1.webm?token=up',
  token: 'up',
  contentType: 'audio/webm',
  // The row the mint RESERVED this key on — echoing the caller's own back is
  // what the door does when the client named one (mint-take-url.ts).
  recordingSessionId: 'rs-1',
}
const mintRecordingUploadUrl = jest.fn(
  async (_input?: MintInput): Promise<MintReply> => MINTED,
)
const mintRecordingReadUrl = jest.fn(async (p: string) => ({
  url: `https://proj.supabase.co/storage/v1/object/sign/recordings/${p}?token=read`,
}))
const removeRecordingObject = jest.fn(async (_p: string) => ({ ok: true as const }))
jest.mock('@/actions/recording-upload', () => ({
  mintRecordingUploadUrl: (i?: MintInput) => mintRecordingUploadUrl(i),
  mintRecordingReadUrl: (p: string) => mintRecordingReadUrl(p),
  removeRecordingObject: (p: string) => removeRecordingObject(p),
}))

// The finalize door's web twin. Mocked because @/actions/recordings reaches
// @synqed-kk/client, which jest cannot parse — the same reason the port
// imports it lazily.
const finalizeTakeAction = jest.fn(async (_i: unknown) => ({
  ok: true as const,
  recordingSessionId: 'rs-1',
}))
/** The recorder's own start-mint door — the port reaches the SAME action
 *  global-recorder imports (fix round 6: row minting has one home). */
const startRecordingSessionAction = jest.fn(
  async (_i: unknown): Promise<{ id: string } | null> => ({ id: 'rs-new' }),
)
jest.mock('@/actions/recordings', () => ({
  finalizeTake: (i: unknown) => finalizeTakeAction(i),
  startRecordingSession: (i: unknown) => startRecordingSessionAction(i),
}))

import { webRecordingPort } from '@/lib/ports/recording-port'
import { extFromMime, normalizeAudioMime } from '@/lib/recording/key-grammar'

const fetchMock = jest.fn(async () => ({ ok: true, status: 200 }) as unknown as Response)

beforeEach(() => {
  jest.clearAllMocks()
  mintRecordingUploadUrl.mockImplementation(async () => MINTED)
  mintRecordingReadUrl.mockImplementation(async (p: string) => ({
    url: `https://proj.supabase.co/storage/v1/object/sign/recordings/${p}?token=read`,
  }))
  removeRecordingObject.mockImplementation(async () => ({ ok: true as const }))
  startRecordingSessionAction.mockImplementation(async () => ({ id: 'rs-new' }))
  fetchMock.mockImplementation(async () => ({ ok: true, status: 200 }) as unknown as Response)
  global.fetch = fetchMock as unknown as typeof fetch
})

const blob = () => new Blob(['audio'], { type: 'audio/webm' })

describe('webRecordingPort.prepareTranscription', () => {
  it('PUTs the blob at the MINTED url — same request shape as the thin arm', async () => {
    const take = blob()
    await webRecordingPort.prepareTranscription(take)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = (fetchMock as unknown as jest.Mock).mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://proj.supabase.co/storage/v1/object/upload/sign/recordings/app_biz-1_uuid-1.webm?token=up',
    )
    expect(init.method).toBe('PUT')
    expect(init.headers).toEqual({ 'content-type': 'audio/webm' })
    expect(init.body).toBe(take)
  })

  it('hands the transcribe leg the SERVER-minted read url for the path it just uploaded', async () => {
    const { body } = await webRecordingPort.prepareTranscription(blob())
    expect(mintRecordingReadUrl).toHaveBeenCalledWith('app_biz-1_uuid-1.webm')
    expect(body).toEqual({
      audioUrl:
        'https://proj.supabase.co/storage/v1/object/sign/recordings/app_biz-1_uuid-1.webm?token=read',
    })
  })

  it('mints, then uploads, then signs — never signs a path that was not written', async () => {
    const order: string[] = []
    mintRecordingUploadUrl.mockImplementation(async () => {
      order.push('mint')
      return {
        path: 'app_biz-1_uuid-1.webm',
        url: 'https://up/',
        token: 'up',
        contentType: 'audio/webm',
        recordingSessionId: 'rs-1',
      }
    })
    fetchMock.mockImplementation(async () => {
      order.push('put')
      return { ok: true, status: 200 } as unknown as Response
    })
    mintRecordingReadUrl.mockImplementation(async () => {
      order.push('read')
      return { url: 'https://read/' }
    })
    await webRecordingPort.prepareTranscription(blob())
    expect(order).toEqual(['mint', 'put', 'read'])
  })

  it('cleanup deletes through the SERVER ACTION, with the uploaded path', async () => {
    const { cleanup } = await webRecordingPort.prepareTranscription(blob())
    expect(removeRecordingObject).not.toHaveBeenCalled()
    cleanup()
    expect(removeRecordingObject).toHaveBeenCalledWith('app_biz-1_uuid-1.webm')
  })

  it('cleanup is fire-and-forget — a rejecting delete never escapes', async () => {
    removeRecordingObject.mockRejectedValue(new Error('rpc down'))
    // cleanup() is called and not awaited, so "it didn't throw" is free — the
    // rejection would escape as an UNHANDLED one, which only the guard prevents.
    const unhandled = jest.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const { cleanup } = await webRecordingPort.prepareTranscription(blob())
      expect(() => cleanup()).not.toThrow()
      // Node reports an unhandled rejection once the microtask queue has drained
      // and the tick ends — take a full loop turn before reading the spy.
      await Promise.resolve()
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('a rejected upload fails the take loudly (no silent empty transcript)', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 403 }) as unknown as Response)
    await expect(webRecordingPort.prepareTranscription(blob())).rejects.toThrow(
      'Upload failed (403)',
    )
    expect(mintRecordingReadUrl).not.toHaveBeenCalled()
  })
})

describe('webRecordingPort.stageForJob', () => {
  it('returns the TENANT-PREFIXED path the enqueue guard demands', async () => {
    await expect(webRecordingPort.stageForJob(blob())).resolves.toEqual({
      path: 'app_biz-1_uuid-1.webm',
    })
    expect(mintRecordingReadUrl).not.toHaveBeenCalled()
    expect(removeRecordingObject).not.toHaveBeenCalled()
  })

  it('PUTs to the minted url and propagates an upload failure', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 500 }) as unknown as Response)
    await expect(webRecordingPort.stageForJob(blob())).rejects.toThrow('Upload failed (500)')
  })

  it('the server-job flag stays OFF — the flip is its own decision, not this hotfix', () => {
    expect(webRecordingPort.supportsServerJob).toBe(false)
  })
})

describe('the browser-direct uploader is gone', () => {
  it('recording-port.ts no longer reaches for the browser supabase client', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/ports/recording-port.ts'), 'utf8')
    expect(source).not.toContain('@/lib/supabase/client')
    expect(source).not.toContain('.storage.from(')
    expect(source).not.toMatch(/rec_\$\{/)
  })
})

// ── Capture pipeline PR3 — the two doors secureTake knocks on ───────────────
// The web arm gets the SAME secure-at-stop path as the phone (design R6), so
// what these pin is that the client's take id and container actually reach the
// shared server bodies, and that the finalize twin's REFUSALS come back settled
// rather than thrown.
// Fix round 6 — the row minter. The web arm reaches the very action
// global-recorder's start-mint calls, so a take whose start-mint failed and a
// take whose drain minted its row land on the same kind of row.
describe('webRecordingPort.startSession', () => {
  it("calls the recorder's own start-mint action, verbatim", async () => {
    await expect(
      webRecordingPort.startSession({ customerId: 'cust-1', appointmentId: 'appt-1' }),
    ).resolves.toEqual({ id: 'rs-new' })
    expect(startRecordingSessionAction).toHaveBeenCalledWith({
      customerId: 'cust-1',
      appointmentId: 'appt-1',
    })
  })

  // The action's own FAIL-OPEN contract, passed through untouched: capture must
  // never block on the mint, so an unresolvable staff / SDK failure is null.
  it('a null from the action stays a null — the take is retried, not failed forever', async () => {
    startRecordingSessionAction.mockImplementation(async () => null)
    await expect(
      webRecordingPort.startSession({ customerId: null, appointmentId: null }),
    ).resolves.toBeNull()
  })
})

describe('webRecordingPort.mintTakeUrl', () => {
  it('names the take, its container AND the row to reserve — the mint composes the key', async () => {
    await expect(
      webRecordingPort.mintTakeUrl('take-uuid-1', 'audio/mp4', 'rs-1'),
    ).resolves.toEqual(
      expect.objectContaining({
        path: 'app_biz-1_uuid-1.webm',
        contentType: 'audio/webm',
        recordingSessionId: 'rs-1',
      }),
    )
    expect(mintRecordingUploadUrl).toHaveBeenCalledWith({
      takeId: 'take-uuid-1',
      mimeType: 'audio/mp4',
      recordingSessionId: 'rs-1',
    })
  })

  // The port TYPE drops `token` (it already rides inside `url`), and the object
  // must drop it too: a caller handed a credential the contract says it never
  // gets is a second signed-request assembler waiting to be written.
  it('the signing token never leaves the port — the object matches the type', async () => {
    const minted = await webRecordingPort.mintTakeUrl('take-uuid-1', 'audio/webm', 'rs-1')
    expect(minted).toEqual({
      path: 'app_biz-1_uuid-1.webm',
      url: MINTED.url,
      contentType: 'audio/webm',
      recordingSessionId: 'rs-1',
    })
    expect(Object.keys(minted)).not.toContain('token')
    // …and the action really did hand one over, so the line above is the port
    // dropping it rather than the fake never sending it.
    expect(MINTED.token).toBe('up')
  })

  // The action answers with the shared core's result UNION now (PR2 fix round
  // 4), and this port passes it through UNCHANGED. Flattening a refusal into a
  // throw here would cost the client the one thing it needs: `exists` means
  // this take is permanently spoken for, `upstream` means try again later.
  it('a refusal comes back NAMED, never thrown — the same shape the finalize leg gives', async () => {
    mintRecordingUploadUrl.mockImplementation(async () => ({ error: 'reserved_elsewhere' }))
    await expect(
      webRecordingPort.mintTakeUrl('take-uuid-1', 'audio/webm', 'rs-1'),
    ).resolves.toEqual({ error: 'reserved_elsewhere' })
  })

  it("hands back the SERVER's contentType — an iOS take is audio/mp4, never the .webm default", async () => {
    // The mint answers the way the REAL door does: composeTakeKey takes BOTH
    // the extension and the content type off one closed MIME map. Hard-coding
    // the mp4 reply instead would prove only that this port returns what it was
    // handed — the container the client sent would never be read at all.
    mintRecordingUploadUrl.mockImplementation(async (input?: MintInput) => {
      const contentType = normalizeAudioMime(input?.mimeType) ?? 'audio/webm'
      const ext = extFromMime(contentType) ?? 'webm'
      return {
        path: `app_biz-1_uuid-1.${ext}`,
        url: `https://proj.supabase.co/upload/app_biz-1_uuid-1.${ext}?token=up`,
        token: 'up',
        contentType,
        recordingSessionId: input?.recordingSessionId ?? 'rs-minted',
      }
    })

    const mp4 = await webRecordingPort.mintTakeUrl('take-uuid-1', 'audio/mp4;codecs=mp4a', 'rs-1')
    expect(mp4).toMatchObject({ contentType: 'audio/mp4', path: 'app_biz-1_uuid-1.mp4' })
    // Same door, same take, a webm recorder — a different answer. That is what
    // makes the line above evidence rather than an echo.
    const webm = await webRecordingPort.mintTakeUrl('take-uuid-1', 'audio/webm;codecs=opus', null)
    expect(webm).toMatchObject({ contentType: 'audio/webm', path: 'app_biz-1_uuid-1.webm' })
    // A take with no row of its own gets the one the mint CREATED.
    expect(webm).toMatchObject({ recordingSessionId: 'rs-minted' })
  })
})

describe('webRecordingPort.finalizeTake', () => {
  it('calls the cookie twin of the facade door with the body verbatim', async () => {
    const input = {
      takeId: 'take-uuid-1',
      mimeType: 'audio/webm',
      durationSeconds: 42,
      byteLength: 1234,
      recordingSessionId: 'rs-1',
    }
    await expect(webRecordingPort.finalizeTake(input)).resolves.toEqual({
      ok: true,
      recordingSessionId: 'rs-1',
    })
    expect(finalizeTakeAction).toHaveBeenCalledWith(input)
  })

  it('a refusal comes back SETTLED, never thrown — the caller records it and retries later', async () => {
    finalizeTakeAction.mockImplementation(
      async () => ({ error: 'object_missing' }) as unknown as { ok: true; recordingSessionId: string },
    )
    await expect(
      webRecordingPort.finalizeTake({
        takeId: 'take-uuid-1',
        mimeType: 'audio/webm',
        durationSeconds: 42,
        byteLength: 1234,
        recordingSessionId: 'rs-1',
      }),
    ).resolves.toEqual({ error: 'object_missing' })
  })
})
