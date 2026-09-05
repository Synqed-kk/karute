/**
 * PHONEWIRE-2C — the THIN (phone) entry of the discard-transcript actions, plus
 * the flag that lets the shared record page use them.
 *
 * The field bug this closes: a 20-second phone recording, spoken words,
 * discarded with a reason, produced a correct 破棄の記録 row whose transcript
 * read この録音の文字起こしはありません — because `supportsDiscardTranscript`
 * was false on this port, so keepTake evaluated false, the take was deleted at
 * the gate and there was never anything left to transcribe.
 *
 * The status map is the whole contract on this side. The relay
 * (lib/recording/discard-transcript.ts) retries ONLY `error: 'failed'` and
 * SETTLES everything else, so getting it wrong either deletes a take whose
 * words never landed or re-stages the entire audio on every record-page mount
 * for the take-store's seven days. Each row below is one of those outcomes.
 *
 * Shape follows thin-recording-discard-port.test.ts (the closest sibling).
 */
import { setDataPort } from '@/lib/ports/data-port'

jest.mock('@/lib/karute/take-store', () => ({}))

import {
  persistDiscardTranscript,
  transcribeAndPersistDiscard,
} from '../../../thin/ports/actions.vite'
import { viteRecordingPort } from '../../../thin/ports/recording.vite'

const REVIEW = { recordingSessionId: 'rs-1', transcript: '在庫の話をしました', durationSeconds: 62 }
const STAGED = {
  recordingSessionId: 'rs-1',
  audioPath: 'app_business-1_11111111-2222-3333-4444-555555555555.webm',
  durationSeconds: 62,
  locale: 'ja',
}

function port(res: (path: string, init?: RequestInit) => Promise<Response>) {
  const apiFetch = jest.fn(res)
  setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
  return apiFetch
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })
/** The REAL wire shape of a facade failure: an error body that parses. */
const errorBody = (code: string) => JSON.stringify({ error: { code, message: code } })

describe('the flag flip — the fix itself', () => {
  it('the thin recording port now supports discard transcripts', () => {
    // RecordPageView's discard arm reads this BEFORE it stamps the take:
    // `durationSeconds >= BELOW_FLOOR_SEC && discardTranscriptSupported() &&
    // stampDiscardPending(...)`. False here is what deleted the audio.
    expect(viteRecordingPort.supportsDiscardTranscript).toBe(true)
  })

  // ⚖ A STAGED COPY IS NAMED FOR ITS SESSION (PR4 fix round 7). The phone's
  // staging leg posted NO body at all, so its copy was anonymous — and an
  // anonymous copy is a claim the transcribe door has nothing to check.
  it('the staging leg names the session it is staged FOR — and the TAKE', async () => {
    const apiFetch = port(async () =>
      json({
        path: 'stg/business-1_rs-1_take-1.webm',
        url: 'https://up/',
        contentType: 'audio/webm',
      }),
    )
    global.fetch = jest.fn(
      async () => ({ ok: true, status: 200 }) as unknown as Response,
    ) as unknown as typeof fetch

    const { path } = await viteRecordingPort.prepareTranscription(new Blob(['a']), null, {
      stagedFor: 'rs-1',
      stagedTake: 'take-1',
    })

    const [url, init] = apiFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/app/v1/recordings/upload-url')
    // ⚖ slice five packet B (D10): the take fills the key's uuid slot, which is
    // what makes a row-less object findable from the row that owes it.
    expect(JSON.parse(init.body as string)).toEqual({ stagedFor: 'rs-1', stagedTake: 'take-1' })
    expect(path).toBe('stg/business-1_rs-1_take-1.webm')
  })

  // ⚖ …AND THE COPY WEARS THE TAKE'S OWN CONTAINER (slice five packet B). This
  // arm composed and PUT every staged copy as webm, so an iOS take's mp4 bytes
  // were mislabelled twice: in the key's extension and in the object's own
  // content-type. `blob.type` is the take's, straight off the store's meta.
  it('…and the take’s CONTAINER rides with it, on the body and on the PUT', async () => {
    const apiFetch = port(async () =>
      json({
        path: 'stg/business-1_rs-1_take-1.mp4',
        url: 'https://up/',
        contentType: 'audio/mp4',
      }),
    )
    const put = jest.fn(async () => ({ ok: true, status: 200 }) as unknown as Response)
    global.fetch = put as unknown as typeof fetch

    await viteRecordingPort.prepareTranscription(
      new Blob(['a'], { type: 'audio/mp4' }),
      null,
      { stagedFor: 'rs-1', stagedTake: 'take-1' },
    )

    const [, init] = apiFetch.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      stagedFor: 'rs-1',
      stagedTake: 'take-1',
      mimeType: 'audio/mp4',
    })
    // The MINT's answer, never this arm's guess: the same closed-map value that
    // decided the key's `.mp4`.
    const [, putInit] = put.mock.calls[0] as unknown as [string, RequestInit]
    expect(putInit.headers).toEqual({ 'content-type': 'audio/mp4' })
  })

  // ⚖ ONLY OUR OWN BYTE LENGTH IS ADOPTED (fix round 2). Packet B read a PUT's
  // "already there" as a success — which, with a key that is composable in
  // advance and D11 releasing the device copy, let a records.write holder put
  // any bytes at their own discarded session's staged key first and have the
  // phone adopt them, then throw the real recording away. The door answers
  // existence with a SIZE now, and only a match adopts.
  describe('an object already at the staged key', () => {
    /** The facade echoing the door's OTHER success arm: no url, a size. */
    const existing = (size: number | null) =>
      json({
        path: 'stg/business-1_rs-1_take-1.webm',
        contentType: 'audio/webm',
        recordingSessionId: 'rs-1',
        existingSize: size,
      })
    const put = () => global.fetch as unknown as jest.Mock

    it('OUR OWN size is adopted with NO upload — the lost-markTakeStaged retry', async () => {
      port(async () => existing(1))
      global.fetch = jest.fn() as unknown as typeof fetch

      const { path } = await viteRecordingPort.prepareTranscription(new Blob(['a']), null, {
        stagedFor: 'rs-1',
        stagedTake: 'take-1',
      })
      expect(path).toBe('stg/business-1_rs-1_take-1.webm')
      expect(put()).not.toHaveBeenCalled()
    })

    it('a DIFFERENT size is refused — nothing adopted, nothing uploaded', async () => {
      port(async () => existing(999))
      global.fetch = jest.fn() as unknown as typeof fetch

      await expect(
        viteRecordingPort.prepareTranscription(new Blob(['a']), null, {
          stagedFor: 'rs-1',
          stagedTake: 'take-1',
        }),
      ).rejects.toThrow('staged copy mismatch')
      expect(put()).not.toHaveBeenCalled()
    })

    it('a size storage would not give proves nothing — refused too', async () => {
      port(async () => existing(null))
      global.fetch = jest.fn() as unknown as typeof fetch

      await expect(
        viteRecordingPort.prepareTranscription(new Blob(['a']), null, {
          stagedFor: 'rs-1',
          stagedTake: 'take-1',
        }),
      ).rejects.toThrow('staged copy mismatch')
      expect(put()).not.toHaveBeenCalled()
    })
  })

  // …and on the SIGNED arm the 409 is a failure again: it is a race the mint
  // did not see a moment ago, and the next mount's mint answers it with a size.
  // (On the WHOLE-TAKE path it stays a success — finalize re-proves the size
  // and the row's ownership there; a staged copy is row-less and has neither.)
  it('a 409 on a SIGNED PUT is a failure — it is not proof the copy is ours', async () => {
    port(async () =>
      json({
        path: 'stg/business-1_rs-1_take-1.webm',
        url: 'https://up/',
        contentType: 'audio/webm',
      }),
    )
    // The 400-with-409-in-the-body shape, which is the one Supabase's signed
    // upload endpoint actually answers with.
    global.fetch = jest.fn(
      async () => new Response(JSON.stringify({ statusCode: '409', error: 'Duplicate' }), {
        status: 400,
      }),
    ) as unknown as typeof fetch

    await expect(
      viteRecordingPort.prepareTranscription(new Blob(['a']), null, {
        stagedFor: 'rs-1',
        stagedTake: 'take-1',
      }),
    ).rejects.toThrow('Upload failed (400)')
  })

  it('a PUT that really failed still throws — a 403 is not "already there"', async () => {
    port(async () =>
      json({ path: 'stg/business-1_rs-1_take-1.webm', url: 'https://up/', contentType: 'audio/webm' }),
    )
    global.fetch = jest.fn(
      async () => ({ ok: false, status: 403 }) as unknown as Response,
    ) as unknown as typeof fetch

    await expect(
      viteRecordingPort.prepareTranscription(new Blob(['a']), null, {
        stagedFor: 'rs-1',
        stagedTake: 'take-1',
      }),
    ).rejects.toThrow('Upload failed (403)')
  })

  // ⚖ AND THE IN-TAB FALLBACK SENDS NEITHER FIELD (slice five fix round 3, F2).
  // Both rode ONE body for both branches, and the door's pair rule refuses a
  // bare `mimeType` that names neither a takeId nor a stagedFor — which is this
  // branch's exact shape. The blob ALWAYS carries a type in production
  // (loadTakeBlob sets it from the take's meta, the recorder's result blob sets
  // it from the negotiated container), so every phone take whose stop-time
  // upload had failed died at 録音を使用 with `Upload URL failed (400)` — the
  // offline cohort this slice exists to protect. The typed blob here is what
  // makes that reachable: the old case used `new Blob(['a'])`, whose empty type
  // omitted the offending field and hid the defect. The body is byte-identical
  // to the one this leg sent before packet B, which also spares it a `.strict()`
  // refusal from a server that predates `stagedTake`.
  it('…and the in-tab fallback names none — no take, no container, as before', async () => {
    const apiFetch = port(async () =>
      json({ path: 'app_business-1_x.webm', url: 'https://up/', contentType: 'audio/webm' }),
    )
    global.fetch = jest.fn(
      async () => ({ ok: true, status: 200 }) as unknown as Response,
    ) as unknown as typeof fetch

    await viteRecordingPort.prepareTranscription(new Blob(['a'], { type: 'audio/mp4' }), null)

    const [, init] = apiFetch.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ stagedFor: null })
  })

  // ⚖ AND BOTH LEGS CARRY A DEADLINE (slice five fix round 3, F7). A phone that
  // walks out of signal STALLS its sockets rather than failing them, and a hung
  // staged leg is held in runDiscardTranscript's module-level `inFlight` set
  // while the sequential sweep waits on it — so one of them withheld the
  // discard words of every take behind it for the rest of the app run.
  describe('the staged legs are bounded', () => {
    it('the mint goes through the port’s 30 s door, not a bare apiFetch', async () => {
      const apiFetch = port(async () =>
        json({ path: 'stg/business-1_rs-1_take-1.webm', url: 'https://up/', contentType: 'audio/webm' }),
      )
      global.fetch = jest.fn(
        async () => ({ ok: true, status: 200 }) as unknown as Response,
      ) as unknown as typeof fetch

      await viteRecordingPort.prepareTranscription(new Blob(['a']), null, {
        stagedFor: 'rs-1',
        stagedTake: 'take-1',
      })

      const [, init] = apiFetch.mock.calls[0] as [string, RequestInit]
      expect(init.signal).toBeInstanceOf(AbortSignal)
    })

    it('a stalled PUT is cut at the blob’s own deadline', async () => {
      jest.useFakeTimers()
      try {
        port(async () =>
          json({
            path: 'stg/business-1_rs-1_take-1.webm',
            url: 'https://up/',
            contentType: 'audio/webm',
          }),
        )
        // A socket iOS holds open: it answers nothing until the signal fires.
        global.fetch = jest.fn(
          (_url: string, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () =>
                reject(new Error('The operation was aborted.')),
              )
            }),
        ) as unknown as typeof fetch

        const leg = viteRecordingPort.prepareTranscription(new Blob(['a']), null, {
          stagedFor: 'rs-1',
          stagedTake: 'take-1',
        })
        const settled = leg.then(
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
  })

  it('a take that already has its object still uploads NOTHING', async () => {
    const apiFetch = port(async () => json({}))
    const { body, path } = await viteRecordingPort.prepareTranscription(
      new Blob(['a']),
      'app_business-1_take-1.webm',
      { stagedFor: 'rs-1' },
    )
    expect(apiFetch).not.toHaveBeenCalled()
    expect(body).toEqual({ path: 'app_business-1_take-1.webm' })
    expect(path).toBe('app_business-1_take-1.webm')
  })

  // ⚖ J2 (fix round 7): the phone cannot compose a tenant key, and its cohort
  // for the backfill is EMPTY by construction — no phone release ever shipped
  // slice three alone.
  it('finalizedKey is null on this arm — the take keeps the behaviour it has', async () => {
    await expect(viteRecordingPort.finalizedKey('take-1', 'audio/webm')).resolves.toBeNull()
  })

  it('and stages NOTHING — the words come off the take’s finalized object', () => {
    // ⚖ capture pipeline PR4: runDiscardTranscript hands the route the take's
    // own finalized key (take-store's finalizedPath), so the staging door the
    // collection leg used to lean on is gone from the port entirely — and with
    // it the janitor that deleted a discarded recording's audio.
    expect('stageForJob' in viteRecordingPort).toBe(false)
  })
})

describe('thin actions port — the review shape', () => {
  it('POSTs the shared facade transcript path, no Idempotency-Key', async () => {
    let seen: string | null = null
    let init: RequestInit | undefined
    const apiFetch = port(async (path: string, i?: RequestInit) => {
      seen = path
      init = i
      return json({ ok: true })
    })

    await expect(persistDiscardTranscript(REVIEW)).resolves.toEqual({ ok: true })

    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(seen).toBe('/api/app/v1/recordings/discards/transcript')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual(REVIEW)
    // The dedupe is SERVER-derived (alreadyLanded), so a client-minted header
    // would be a second, weaker key the relay could forget to send.
    expect(Object.keys(init?.headers ?? {}).map((k) => k.toLowerCase())).not.toContain(
      'idempotency-key',
    )
  })

  it('passes a settled skip through verbatim — the take may go', async () => {
    port(async () => json({ skipped: 'consent' }))
    await expect(persistDiscardTranscript(REVIEW)).resolves.toEqual({ skipped: 'consent' })
  })
})

describe('thin actions port — the staged shape', () => {
  it('POSTs the SAME path with the audio body', async () => {
    let seen: string | null = null
    let init: RequestInit | undefined
    port(async (path: string, i?: RequestInit) => {
      seen = path
      init = i
      return json({ ok: true })
    })

    await expect(transcribeAndPersistDiscard(STAGED)).resolves.toEqual({ ok: true })

    // ONE door for both shapes — the phone and the web page must not be able to
    // drift into different discard semantics.
    expect(seen).toBe('/api/app/v1/recordings/discards/transcript')
    expect(JSON.parse(String(init?.body))).toEqual(STAGED)
  })
})

describe('the status map — which answers settle the take and which retry it', () => {
  it('403 → forbidden (terminal): the caller can never succeed, so the take goes', async () => {
    // A facade 403 is a resolved identity without records.write, or another
    // tenant's staged key. Reported as `failed` it would re-stage the whole
    // audio on every record-page mount until the 7-day TTL pruned it.
    port(async () => new Response(errorBody('forbidden'), { status: 403 }))
    await expect(transcribeAndPersistDiscard(STAGED)).resolves.toEqual({ error: 'forbidden' })
  })

  it('502 → failed (retryable): a parseable error body must NOT read as success', async () => {
    // handler.ts stringifies its errors, so `res.json()` succeeds on a 502 and
    // `body` is non-null. Without the `!res.ok` half of the guard the port
    // would hand back the error envelope as the answer — the same trap the
    // discard-receipt port's own suite exists to pin.
    port(async () => new Response(errorBody('upstream_unavailable'), { status: 502 }))
    await expect(persistDiscardTranscript(REVIEW)).resolves.toEqual({ error: 'failed' })
  })

  it('401 → failed (retryable): an auth blip is not a denial', async () => {
    port(async () => new Response(errorBody('unauthenticated'), { status: 401 }))
    await expect(persistDiscardTranscript(REVIEW)).resolves.toEqual({ error: 'failed' })
  })

  it('a 2xx with an unparseable body → failed, never a false success', async () => {
    port(async () => new Response('not json', { status: 200 }))
    await expect(transcribeAndPersistDiscard(STAGED)).resolves.toEqual({ error: 'failed' })
  })

  it('a dead network → failed, never a thrown rejection', async () => {
    // The relay awaits these inside its own try, but a throw would skip the
    // stamp bookkeeping around it; the port answers instead.
    port(async () => {
      throw new Error('offline')
    })
    await expect(persistDiscardTranscript(REVIEW)).resolves.toEqual({ error: 'failed' })
  })
})
