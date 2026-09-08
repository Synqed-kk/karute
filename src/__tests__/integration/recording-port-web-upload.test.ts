/**
 * webRecordingPort's upload legs after the 2026-08-25 hotfix. The bug this
 * pins: the browser used to write to the `recordings` bucket itself, and the
 * bucket's RLS started 403-ing it ("new row violates row-level security
 * policy") — every web take died at the upload. The web arm now goes through
 * the SAME server-minted signed-URL flow the thin arm has always used, so what
 * this file proves is the wiring: the transcribe leg gets a SERVER-minted read
 * url over the take's FINALIZED key (capture pipeline PR4 — the happy path
 * uploads nothing and deletes nothing), and the fallback for a take the store
 * never held still PUTs its blob at the MINTED url, never supabase-js.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

type MintInput =
  | {
      takeId?: string | null
      mimeType?: string | null
      recordingSessionId?: string | null
      /** PR4 fix round 7: the session a STAGED copy is staged for. */
      stagedFor?: string | null
      /** Slice five packet B (D10): the TAKE that copy is of — the key's uuid
       *  slot, and the identity a row-less object otherwise has none of. */
      stagedTake?: string | null
    }
  | undefined
type MintReply =
  | {
      path: string
      url: string
      token: string
      contentType: string
      recordingSessionId: string | null
    }
  /** Fix round 2: the door found an object already at this key, so it signed
   *  NOTHING and answered its size instead. No url, no token — absent, not
   *  empty, so nothing here can be PUT against. */
  | {
      path: string
      contentType: string
      recordingSessionId: string | null
      existingSize: number | null
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
/** The backfill door (PR4 fix round 7) — a pure composition on the server, so
 *  the key never leaves the tenant prefix to a device that should not compose
 *  one. Null is its settled "cannot say". */
const recordingFinalizedKey = jest.fn(
  async (_i: { takeId: string; mimeType: string }) => 'app_biz-1_take-9.webm' as string | null,
)
/** The SEGMENT door (slice five packet C). Two success arms per seq — signed,
 *  and "an object is already here, and this is its length" — because the pump
 *  must tell them apart before it decides whether to PUT anything. */
type SegmentReply =
  | {
      segments: (
        | { seq: number; path: string; url: string; token: string; contentType: string }
        | { seq: number; path: string; contentType: string; existingSize: number | null }
      )[]
      recordingSessionId: string
    }
  | { error: string }
const mintRecordingSegmentUrls = jest.fn(
  async (input: MintInput & { seqs?: number[] | null }): Promise<SegmentReply> => ({
    segments: (input.seqs ?? []).map((seq) => ({
      seq,
      path: `seg/app_biz-1_take-1/${String(seq).padStart(6, '0')}.webm`,
      url: `https://proj.supabase.co/upload/seg-${seq}?token=up`,
      token: 'up',
      contentType: 'audio/webm',
    })),
    recordingSessionId: 'rs-1',
  }),
)
jest.mock('@/actions/recording-upload', () => ({
  mintRecordingUploadUrl: (i?: MintInput) => mintRecordingUploadUrl(i),
  mintRecordingReadUrl: (p: string) => mintRecordingReadUrl(p),
  recordingFinalizedKey: (i: { takeId: string; mimeType: string }) => recordingFinalizedKey(i),
  mintRecordingSegmentUrls: (i: MintInput & { seqs?: number[] | null }) =>
    mintRecordingSegmentUrls(i),
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
  startRecordingSessionAction.mockImplementation(async () => ({ id: 'rs-new' }))
  recordingFinalizedKey.mockImplementation(async () => 'app_biz-1_take-9.webm')
  mintRecordingSegmentUrls.mockImplementation(async (input) => ({
    segments: (input.seqs ?? []).map((seq) => ({
      seq,
      path: `seg/app_biz-1_take-1/${String(seq).padStart(6, '0')}.webm`,
      url: `https://proj.supabase.co/upload/seg-${seq}?token=up`,
      token: 'up',
      contentType: 'audio/webm',
    })),
    recordingSessionId: 'rs-1',
  }))
  fetchMock.mockImplementation(async () => ({ ok: true, status: 200 }) as unknown as Response)
  global.fetch = fetchMock as unknown as typeof fetch
})

const blob = () => new Blob(['audio'], { type: 'audio/webm' })

// ⚖ THE FINALIZED OBJECT IS THE OBJECT (capture pipeline PR4). The happy path
// uploads nothing and deletes nothing; the staging leg survives only for a take
// the store never held, and even that one no longer has a cleanup fn to call.
describe('webRecordingPort.prepareTranscription — the finalized take', () => {
  it('uploads NOTHING and signs the finalized key it was handed', async () => {
    const { body } = await webRecordingPort.prepareTranscription(
      blob(),
      'app_biz-1_take-9.webm',
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mintRecordingUploadUrl).not.toHaveBeenCalled()
    expect(mintRecordingReadUrl).toHaveBeenCalledWith('app_biz-1_take-9.webm')
    expect(body).toEqual({
      audioUrl:
        'https://proj.supabase.co/storage/v1/object/sign/recordings/app_biz-1_take-9.webm?token=read',
    })
  })

  it('answers with no cleanup fn at all — there is nothing to delete', async () => {
    const result = await webRecordingPort.prepareTranscription(blob(), 'app_biz-1_take-9.webm')
    // The shape, not merely the absence of one name: NOTHING this answers with
    // is callable, so no caller can be handed a delete by another spelling.
    expect(Object.keys(result).sort()).toEqual(['body', 'path'])
    expect(Object.values(result).some((v) => typeof v === 'function')).toBe(false)
  })

  // …and it SAYS which key the words came from (PR4 fix round 2). The discard's
  // word-collection needs the staged key back for a take that can never be
  // sealed under a finalized one, and a second spelling of this staging is the
  // thing that must never exist.
  it('answers the finalized key it was handed', async () => {
    const { path } = await webRecordingPort.prepareTranscription(blob(), 'app_biz-1_take-9.webm')
    expect(path).toBe('app_biz-1_take-9.webm')
  })
})

describe('webRecordingPort.prepareTranscription — the fallback (no finalized object)', () => {
  it('PUTs the blob at the MINTED url — same request shape as the thin arm', async () => {
    const take = blob()
    await webRecordingPort.prepareTranscription(take, null)
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
    const { body, path } = await webRecordingPort.prepareTranscription(blob(), null)
    expect(mintRecordingReadUrl).toHaveBeenCalledWith('app_biz-1_uuid-1.webm')
    expect(body).toEqual({
      audioUrl:
        'https://proj.supabase.co/storage/v1/object/sign/recordings/app_biz-1_uuid-1.webm?token=read',
    })
    // …and it names the STAGED key it just wrote (PR4 fix round 2), which is
    // what the discard's word-collection reads its words from.
    expect(path).toBe('app_biz-1_uuid-1.webm')
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
    await webRecordingPort.prepareTranscription(blob(), null)
    expect(order).toEqual(['mint', 'put', 'read'])
  })

  // ⚖ A STAGED COPY IS NAMED FOR ITS SESSION (PR4 fix round 7). The in-tab
  // fallback stays UNBOUND — nothing ever claims its path to a discard — and
  // the discard's own collection names the session, which is what lets the
  // transcribe door tell this session's staged audio from any key a caller
  // could have typed.
  it('the in-tab fallback names no session — byte-identical to before', async () => {
    await webRecordingPort.prepareTranscription(blob(), null)
    expect(mintRecordingUploadUrl).toHaveBeenCalledWith(undefined)
  })

  // ⚖ …AND ITS TAKE, AND ITS CONTAINER (slice five packet B, D10). The take
  // fills the key's uuid slot, which is what makes the row-less copy findable
  // from the core row that owes it; `blob.type` is the take's own container
  // (loadTakeBlob sets it from the stored meta), so an iOS copy is finally
  // `.mp4` instead of the `.webm` every staged copy used to wear.
  it('a copy staged FOR a discard carries that session, its take and its container', async () => {
    await webRecordingPort.prepareTranscription(blob(), null, {
      stagedFor: 'rs-7',
      stagedTake: 'take-7',
    })
    expect(mintRecordingUploadUrl).toHaveBeenCalledWith({
      stagedFor: 'rs-7',
      stagedTake: 'take-7',
      mimeType: 'audio/webm',
    })
  })

  it('an iOS take stages as audio/mp4 — the blob’s own type, not a hardcoded webm', async () => {
    mintRecordingUploadUrl.mockImplementation(async () => ({
      ...MINTED,
      path: 'stg/biz-1_rs-7_take-7.mp4',
      contentType: 'audio/mp4',
    }))
    await webRecordingPort.prepareTranscription(
      new Blob(['audio'], { type: 'audio/mp4' }),
      null,
      { stagedFor: 'rs-7', stagedTake: 'take-7' },
    )
    expect(mintRecordingUploadUrl).toHaveBeenCalledWith({
      stagedFor: 'rs-7',
      stagedTake: 'take-7',
      mimeType: 'audio/mp4',
    })
    // The PUT wears the MINT's answer — the same closed-map value that decided
    // the key's extension, never this arm's own guess.
    const [, init] = (fetchMock as unknown as jest.Mock).mock.calls[0] as [string, RequestInit]
    expect(init.headers).toEqual({ 'content-type': 'audio/mp4' })
  })

  it('a blob with no type omits mimeType — the server’s default stands', async () => {
    await webRecordingPort.prepareTranscription(new Blob(['audio']), null, {
      stagedFor: 'rs-7',
      stagedTake: 'take-7',
    })
    expect(mintRecordingUploadUrl).toHaveBeenCalledWith({
      stagedFor: 'rs-7',
      stagedTake: 'take-7',
      mimeType: undefined,
    })
  })

  // ⚖ ONLY OUR OWN BYTE LENGTH IS ADOPTED (fix round 2). Packet B read a PUT's
  // "already there" as a success — which, with a key that is composable in
  // advance and D11 releasing the device copy, let a records.write holder put
  // any bytes at their own discarded session's staged key first and have the
  // device adopt them, then throw the real recording away. The door answers
  // existence with a SIZE now, and only a match adopts.
  describe('an object already at the staged key', () => {
    /** The door's other success arm — it signs nothing. */
    const existing = (size: number | null) => ({
      path: 'stg/biz-1_rs-7_take-7.webm',
      contentType: 'audio/webm',
      recordingSessionId: 'rs-7',
      existingSize: size,
    })

    it('OUR OWN size is adopted with NO upload — the lost-markTakeStaged retry', async () => {
      const take = blob()
      mintRecordingUploadUrl.mockImplementation(async () => existing(take.size))
      const { path } = await webRecordingPort.prepareTranscription(take, null, {
        stagedFor: 'rs-7',
        stagedTake: 'take-7',
      })
      expect(fetchMock).not.toHaveBeenCalled()
      expect(path).toBe('stg/biz-1_rs-7_take-7.webm')
      // …and no read url, per F9 below — the fence would refuse a `stg/` key.
      expect(mintRecordingReadUrl).not.toHaveBeenCalled()
    })

    it('a DIFFERENT size is refused — nothing is adopted and nothing is uploaded', async () => {
      mintRecordingUploadUrl.mockImplementation(async () => existing(blob().size + 1))
      await expect(
        webRecordingPort.prepareTranscription(blob(), null, {
          stagedFor: 'rs-7',
          stagedTake: 'take-7',
        }),
      ).rejects.toThrow('staged copy mismatch')
      expect(fetchMock).not.toHaveBeenCalled()
      expect(mintRecordingReadUrl).not.toHaveBeenCalled()
    })

    it('a size storage would not give proves nothing — refused too', async () => {
      mintRecordingUploadUrl.mockImplementation(async () => existing(null))
      await expect(
        webRecordingPort.prepareTranscription(blob(), null, {
          stagedFor: 'rs-7',
          stagedTake: 'take-7',
        }),
      ).rejects.toThrow('staged copy mismatch')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  // ⚖ A DISCARD'S STAGED COPY NEEDS NO READ URL (slice five fix round 3, F9;
  // the defect predates this slice — PR4 fix round 7). `mintRecordingReadUrl`
  // is fenced at `kind === 'take'` (requireOwnPath → isOwnRecordingKey), so a
  // `stg/` key is refused there by construction: the web arm PUT the copy and
  // then THREW on the very next line, so the discard's words were never
  // collected on that arm at all. Nothing needs the URL — runDiscardTranscript
  // reads `path`, and the discard action signs its own URL from it.
  it('the staged branch returns the path and mints NO read url', async () => {
    const { body, path } = await webRecordingPort.prepareTranscription(blob(), null, {
      stagedFor: 'rs-7',
      stagedTake: 'take-7',
    })
    expect(fetchMock).toHaveBeenCalled() // the copy WAS uploaded
    expect(path).toBe('app_biz-1_uuid-1.webm')
    expect(body).toEqual({})
    expect(mintRecordingReadUrl).not.toHaveBeenCalled()
  })

  // ⚖ AND THE STAGED PUT CARRIES A DEADLINE (slice five fix round 3, F7). It is
  // a real network call on this arm, so the law applies: a stalled one holds
  // its take in runDiscardTranscript's `inFlight` set while the sequential
  // sweep waits behind it. Same size-derived number as the whole-take PUT.
  it('a stalled staged PUT is cut at the blob’s own deadline', async () => {
    jest.useFakeTimers()
    try {
      ;(fetchMock as unknown as jest.Mock).mockImplementation(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new Error('The operation was aborted.')),
            )
          }),
      )
      const settled = webRecordingPort
        .prepareTranscription(blob(), null, { stagedFor: 'rs-7', stagedTake: 'take-7' })
        .then(
          () => 'resolved',
          () => 'rejected',
        )
      // The floor, for a blob this small (storage-put.ts's PUT_FLOOR_MS).
      await jest.advanceTimersByTimeAsync(60_000)
      await expect(settled).resolves.toBe('rejected')
    } finally {
      jest.useRealTimers()
    }
  })

  // …and on the SIGNED arm the 409 is a failure again: it is a race the mint
  // did not see a moment ago, and the next mount's mint answers it with a size.
  // (On the WHOLE-TAKE path it stays a success — finalize re-proves the size
  // and the row's ownership there; a staged copy is row-less and has neither.)
  it('a 409 on a SIGNED PUT is a failure — it is not proof the copy is ours', async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ statusCode: '409', error: 'Duplicate' }), { status: 400 }),
    )
    await expect(
      webRecordingPort.prepareTranscription(blob(), null, {
        stagedFor: 'rs-7',
        stagedTake: 'take-7',
      }),
    ).rejects.toThrow('Upload failed (400)')
    expect(mintRecordingReadUrl).not.toHaveBeenCalled()
  })

  it('a rejected upload fails the take loudly (no silent empty transcript)', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 403 }) as unknown as Response)
    await expect(webRecordingPort.prepareTranscription(blob(), null)).rejects.toThrow(
      'Upload failed (403)',
    )
    expect(mintRecordingReadUrl).not.toHaveBeenCalled()
  })
})

// ⚖ J2 (PR4 fix round 7): the key of a take finalized before the key was
// stamped. Composed on the SERVER — the device must never assemble a tenant
// key, which is the rule markTakeFinalized was written to.
describe('webRecordingPort.finalizedKey', () => {
  it('asks the composing action and answers its key verbatim', async () => {
    await expect(webRecordingPort.finalizedKey('take-9', 'audio/mp4')).resolves.toBe(
      'app_biz-1_take-9.webm',
    )
    expect(recordingFinalizedKey).toHaveBeenCalledWith({
      takeId: 'take-9',
      mimeType: 'audio/mp4',
    })
  })

  it('a null from the action stays a null — the take keeps its un-finalized behaviour', async () => {
    recordingFinalizedKey.mockImplementation(async () => null)
    await expect(webRecordingPort.finalizedKey('take-9', 'audio/webm')).resolves.toBeNull()
  })
})

describe('the delete doors are GONE, not refused (capture pipeline PR4)', () => {
  it('the port exposes no stageForJob — the job reads the finalized object', () => {
    expect('stageForJob' in webRecordingPort).toBe(false)
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
  it("calls the recorder's own start-mint action, verbatim — and the take id is NOT part of it", async () => {
    await expect(
      webRecordingPort.startSession({
        customerId: 'cust-1',
        appointmentId: 'appt-1',
        takeId: 'take-uuid-1',
      }),
    ).resolves.toEqual({ id: 'rs-new' })
    // The take id is the PHONE's idempotency anchor (fix round 7); a server
    // action carries no key, and the action's own signature has no such field —
    // forwarding it would put a dead, misleading value on the wire.
    expect(startRecordingSessionAction).toHaveBeenCalledWith({
      customerId: 'cust-1',
      appointmentId: 'appt-1',
    })
  })

  // …unless a CONTAINER comes with it (fix round 8), which changes what the
  // pair is: not an idempotency anchor the action has no header for, but the
  // two facts the door composes this take's finalized key from. Then both go,
  // and the web arm's row is born reserved exactly like the phone's.
  it('forwards the take AND its container when the recorder named both', async () => {
    await expect(
      webRecordingPort.startSession({
        customerId: 'cust-1',
        appointmentId: null,
        takeId: 'take-uuid-1',
        mimeType: 'audio/mp4',
      }),
    ).resolves.toEqual({ id: 'rs-new' })

    expect(startRecordingSessionAction).toHaveBeenCalledWith({
      customerId: 'cust-1',
      appointmentId: null,
      takeId: 'take-uuid-1',
      mimeType: 'audio/mp4',
    })
  })

  // The action's own FAIL-OPEN contract, passed through untouched: capture must
  // never block on the mint, so an unresolvable staff / SDK failure is null.
  it('a null from the action stays a null — the take is retried, not failed forever', async () => {
    startRecordingSessionAction.mockImplementation(async () => null)
    await expect(
      webRecordingPort.startSession({
        customerId: null,
        appointmentId: null,
        takeId: 'take-uuid-1',
      }),
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

  // ⚖ THE OTHER SUCCESS ARM PASSES THROUGH (hotfix 2026-09-05). The take mint
  // answers "the object is already there, here is its size" when this take's
  // own row reserved the key and storage holds it. This port used to convert
  // that into `upstream` — retryable, so the web arm would have re-asked for
  // ever, exactly as the phone did.
  it('the already-there arm reaches the caller intact — no `upstream`, no `token`, no `url`', async () => {
    mintRecordingUploadUrl.mockImplementation(async () => ({
      path: 'app_biz-1_uuid-1.webm',
      contentType: 'audio/webm',
      recordingSessionId: 'rs-1',
      existingSize: 682_520,
    }))
    const minted = await webRecordingPort.mintTakeUrl('take-uuid-1', 'audio/webm', 'rs-1')
    // toEqual, not toMatchObject: the ABSENCE of `url` is half the assertion —
    // secureTake reads that field to decide whether there is anything to send.
    expect(minted).toEqual({
      path: 'app_biz-1_uuid-1.webm',
      contentType: 'audio/webm',
      recordingSessionId: 'rs-1',
      existingSize: 682_520,
    })
    expect(Object.keys(minted)).not.toContain('url')
    expect(Object.keys(minted)).not.toContain('token')
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

// ⚖ THE SEGMENT DOOR (slice five packet C, C5). The same door the take mint
// knocks on, asked for a BATCH of keys under one take's folder — and the arm
// that says "an object is already here" carries a SIZE and no way to write.
describe('webRecordingPort.mintSegmentUrls', () => {
  it('names the take, its container, the row and the seqs — verbatim', async () => {
    await webRecordingPort.mintSegmentUrls('take-uuid-1', 'audio/mp4', 'rs-1', [0, 1, 2])
    expect(mintRecordingSegmentUrls).toHaveBeenCalledWith({
      takeId: 'take-uuid-1',
      mimeType: 'audio/mp4',
      recordingSessionId: 'rs-1',
      seqs: [0, 1, 2],
    })
  })

  // The port TYPE drops `token`, and the object must drop it too — the same
  // rule, and the same reason, as mintTakeUrl one describe up.
  it('the signing token never leaves the port, on any seq', async () => {
    const minted = await webRecordingPort.mintSegmentUrls('take-uuid-1', 'audio/webm', 'rs-1', [
      0, 1,
    ])
    expect(minted).toEqual({
      segments: [
        {
          seq: 0,
          path: 'seg/app_biz-1_take-1/000000.webm',
          url: 'https://proj.supabase.co/upload/seg-0?token=up',
          contentType: 'audio/webm',
        },
        {
          seq: 1,
          path: 'seg/app_biz-1_take-1/000001.webm',
          url: 'https://proj.supabase.co/upload/seg-1?token=up',
          contentType: 'audio/webm',
        },
      ],
    })
    // …and the action really did hand tokens over, so the line above is the
    // port dropping them rather than the fake never sending any.
    const sent = (await mintRecordingSegmentUrls.mock.results[0].value) as {
      segments: { token?: string }[]
    }
    expect(sent.segments[0].token).toBe('up')
  })

  // ⚖ THE ALREADY-THERE ARM CARRIES NO URL AT ALL (the R2 rule). Absent, never
  // empty: nothing reachable from that answer can PUT, and the pump has to
  // narrow before it reaches for one.
  it('an occupied seq comes through as a SIZE, with no url on it', async () => {
    mintRecordingSegmentUrls.mockImplementation(async () => ({
      segments: [
        { seq: 0, path: 'seg/app_biz-1_take-1/000000.webm', contentType: 'audio/webm', existingSize: 4096 },
        { seq: 1, path: 'seg/app_biz-1_take-1/000001.webm', contentType: 'audio/webm', existingSize: null },
      ],
      recordingSessionId: 'rs-1',
    }))
    const minted = await webRecordingPort.mintSegmentUrls('t', 'audio/webm', 'rs-1', [0, 1])
    expect(minted).toEqual({
      segments: [
        { seq: 0, path: 'seg/app_biz-1_take-1/000000.webm', contentType: 'audio/webm', existingSize: 4096 },
        { seq: 1, path: 'seg/app_biz-1_take-1/000001.webm', contentType: 'audio/webm', existingSize: null },
      ],
    })
    expect('segments' in minted && 'url' in minted.segments[0]).toBe(false)
  })

  it('a refusal comes back NAMED, never thrown', async () => {
    mintRecordingSegmentUrls.mockImplementation(async () => ({ error: 'not_reserved' }))
    await expect(
      webRecordingPort.mintSegmentUrls('take-uuid-1', 'audio/webm', 'rs-1', [0]),
    ).resolves.toEqual({ error: 'not_reserved' })
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

// ⚖ NO WEB DOOR WAITS FOREVER EITHER (fix round 12, P3). The phone's three
// doors have carried a deadline since fix round 7; this arm's are server
// ACTIONS, which take no AbortSignal, and the standing answer was "the
// platform's function timeout bounds them". It does not bound US: a hung action
// leaves secureTake's take in `inFlight` for the whole page life, so the stop
// path is gone, every mount/re-drain attempt hits the guard and returns, and no
// other owed take is ever reached. One stall starves the drain.
//
// Every deadline lands as a RETRYABLE answer — a stall is a moment in time, and
// a code the take store judges terminal would stop the take being sent ever
// again.
describe('the web arm’s doors are bounded too', () => {
  beforeEach(() => {
    // The ports reach their actions through a dynamic import, which settles on
    // the microtask queue — faking that would deadlock every call here.
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] })
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  /** Resolves only when the port does — so "still waiting" is provable. */
  function watch<T>(work: Promise<T>) {
    const state = { settled: false, value: undefined as T | undefined }
    const done = work.then((v) => {
      state.settled = true
      state.value = v
      return v
    })
    return { state, done }
  }

  it('a session mint that never answers is abandoned at 10 s — as the fail-open null', async () => {
    // …Once, so the hang cannot leak into the control below (this file's
    // beforeEach re-seeds some implementations, not all of them).
    startRecordingSessionAction.mockImplementationOnce(() => new Promise(() => {}))
    const { state, done } = watch(
      webRecordingPort.startSession({
        customerId: 'cust-1',
        appointmentId: null,
        takeId: 'take-uuid-1',
      }),
    )

    await jest.advanceTimersByTimeAsync(9_000)
    // The action really was reached and really is still out — the deadline is
    // what ends this, not a call that never happened.
    expect(startRecordingSessionAction).toHaveBeenCalledTimes(1)
    expect(state.settled).toBe(false)
    await jest.advanceTimersByTimeAsync(1_000)

    // null is this door's own fail-open answer, which secureTake already reads
    // as the retryable 'session'.
    await expect(done).resolves.toBeNull()
  })

  it('a mint that never answers is abandoned at 30 s — retryable, never terminal', async () => {
    mintRecordingUploadUrl.mockImplementationOnce(() => new Promise(() => {}))
    const { state, done } = watch(webRecordingPort.mintTakeUrl('take-uuid-1', 'audio/webm', 'rs-1'))

    await jest.advanceTimersByTimeAsync(29_000)
    expect(mintRecordingUploadUrl).toHaveBeenCalledTimes(1)
    expect(state.settled).toBe(false)
    await jest.advanceTimersByTimeAsync(1_000)

    await expect(done).resolves.toEqual({ error: 'upstream' })
  })

  it('a segment mint that never answers is abandoned at 30 s — retryable, never terminal', async () => {
    mintRecordingSegmentUrls.mockImplementationOnce(() => new Promise(() => {}))
    const { state, done } = watch(
      webRecordingPort.mintSegmentUrls('take-uuid-1', 'audio/webm', 'rs-1', [0]),
    )

    await jest.advanceTimersByTimeAsync(29_000)
    expect(mintRecordingSegmentUrls).toHaveBeenCalledTimes(1)
    expect(state.settled).toBe(false)
    await jest.advanceTimersByTimeAsync(1_000)

    // 'upstream' is the one code the pump does not judge terminal — a stall is
    // a moment in time, so these seqs stay askable.
    await expect(done).resolves.toEqual({ error: 'upstream' })
  })

  it('a finalize that never answers is abandoned at 30 s — the take stays un-finalized and retryable', async () => {
    finalizeTakeAction.mockImplementationOnce(() => new Promise(() => {}))
    const { state, done } = watch(
      webRecordingPort.finalizeTake({
        takeId: 'take-uuid-1',
        mimeType: 'audio/webm',
        durationSeconds: 42,
        byteLength: 1234,
        recordingSessionId: 'rs-1',
      }),
    )

    await jest.advanceTimersByTimeAsync(29_000)
    expect(finalizeTakeAction).toHaveBeenCalledTimes(1)
    expect(state.settled).toBe(false)
    await jest.advanceTimersByTimeAsync(1_000)

    await expect(done).resolves.toEqual({ error: 'failed' })
  })

  // A deadline that answers normally must leave NOTHING pending: the timer is
  // cleared, not merely ignored. Without this the drain would hold one live
  // timer per door per take for its whole cooldown.
  it('a door that answers in time leaves no timer behind', async () => {
    await webRecordingPort.startSession({
      customerId: 'cust-1',
      appointmentId: null,
      takeId: 'take-uuid-1',
    })
    await webRecordingPort.mintTakeUrl('take-uuid-1', 'audio/webm', 'rs-1')
    await webRecordingPort.finalizeTake({
      takeId: 'take-uuid-1',
      mimeType: 'audio/webm',
      durationSeconds: 42,
      byteLength: 1234,
      recordingSessionId: 'rs-1',
    })

    expect(jest.getTimerCount()).toBe(0)
  })
})
