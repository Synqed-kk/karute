/**
 * Capture pipeline PR3 — the THIN (phone) entry of the secure-at-stop doors.
 *
 * This is the arm staff actually record on, and the two calls it makes are the
 * whole of "the audio is safe": mint the finalized key for a take the DEVICE
 * named, then tell the server that take is complete. What matters here is the
 * wiring, because a wrong path or a dropped field is invisible until a take is
 * already lost:
 *   · both go through apiFetch, so the Bearer and the store lens are assembled
 *     once in facade-fetch.ts and never spelled at a call site;
 *   · the mint body carries the take id, the container (a `.webm` name on iOS
 *     mp4 bytes is the live mislabelling bug) AND the row to reserve the key on;
 *   · a refused mint comes back NAMED, never thrown — WHICH refusal decides
 *     whether the phone ever re-uploads this take at all;
 *   · finalize FAILS SETTLED, never thrown — and a facade error body parses
 *     perfectly, so `!res.ok` has to be half the guard (the discard port's
 *     lesson, thin-recording-discard-port.test.ts).
 *
 * Shape follows thin-recording-discard-port.test.ts (the closest sibling).
 */
import { setDataPort } from '@/lib/ports/data-port'
import { TERMINAL_SECURE_ERRORS } from '@/lib/karute/take-store'

import { viteRecordingPort } from '../../../thin/ports/recording.vite'
// The recorder's OWN start-mint reaches the same door by the other route: it
// calls @/actions/recordings, which the thin build aliases to the actions port.
// Two doors, one invariant — so both are pinned here (fix round 8).
import { startRecordingSession } from '../../../thin/ports/actions.vite'

const FINALIZE = {
  takeId: '11111111-2222-4333-8444-555555555555',
  mimeType: 'audio/mp4',
  durationSeconds: 42.5,
  byteLength: 1234,
  recordingSessionId: '99999999-2222-4333-8444-555555555555',
}

/** A second take id — the key must be per-TAKE, not per-device. */
const OTHER_TAKE = '11111111-2222-4333-8444-666666666666'

function port(res: (path: string, init?: RequestInit) => Promise<Response>) {
  const apiFetch = jest.fn(res)
  setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
  return apiFetch
}

/** The REAL wire shape of a facade failure: an error body that parses. */
const errorBody = (code: string) => JSON.stringify({ error: { code, message: code } })
/** The upload-url route's own failures, verbatim (…/upload-url/route.ts): the
 *  two client-fixable families carry the mint's CODE as the message, the rest
 *  carry a sentence and are recognised by their classification. */
const facadeError = (code: string, message: string) =>
  JSON.stringify({ error: { code, message } })

// Fix round 6 — the row minter, and the only one. secure-take knocks here when
// a take's start-mint never landed, because the upload mint stopped creating
// rows for client-named takes (PR2 fix round 7).
describe('thin recording port — startSession', () => {
  it('POSTs the customer and appointment to the shared session door, with an idempotency key', async () => {
    let seen: [string, RequestInit | undefined] | null = null
    const apiFetch = port(async (path: string, init?: RequestInit) => {
      seen = [path, init]
      return new Response(JSON.stringify({ id: 'rs-new' }), { status: 200 })
    })

    await expect(
      viteRecordingPort.startSession({
        customerId: 'cust-1',
        appointmentId: 'appt-1',
        takeId: FINALIZE.takeId,
      }),
    ).resolves.toEqual({ id: 'rs-new' })

    expect(apiFetch).toHaveBeenCalledTimes(1)
    const [path, init] = seen!
    // The SAME door the recorder's own start-mint uses — one home for row
    // minting, so a drain-minted row and a start-minted one cannot differ.
    expect(path).toBe('/api/app/v1/recordings/session')
    expect(init?.method).toBe('POST')
    // An effectful create: the route REQUIRES the key, and a retried POST on a
    // flaky tunnel must not leave two rows behind.
    expect(
      (init?.headers as Record<string, string>)['idempotency-key'],
    ).toEqual(expect.any(String))
    // The take id is the KEY's anchor, never part of the body: the door mints a
    // row from the customer/appointment, and a field it does not know would
    // just be a dead value on the wire.
    expect(JSON.parse(init?.body as string)).toEqual({
      customerId: 'cust-1',
      appointmentId: 'appt-1',
    })
  })

  // ⚖ A FRESH KEY PER ATTEMPT (fix round 12, P3) — one discipline with the web
  // arm's twin (thin/ports/actions.vite.ts#idemPost), which has always minted a
  // uuid here.
  //
  // Round 7 keyed this off the TAKE, so a retry after a lost reply landed back
  // on the same row rather than orphaning another. Real — but it collided with
  // the step back below: an Idempotency-Key is a promise that the SAME request
  // gets the SAME answer, so a door replaying its 400 to the second,
  // differently shaped body is correct, and the step back became unreachable. A
  // take on a server that predates the pair then got no row at all, and audio
  // with no row never leaves the device. Losing a take beats leaving a stray
  // row, so both arms now take the orphan-row degradation core already accepts
  // for this door (packet-10 fact 3).
  it('every attempt carries its OWN idempotency key — never the take id', async () => {
    const keys: string[] = []
    port(async (_path: string, init?: RequestInit) => {
      keys.push((init?.headers as Record<string, string>)['idempotency-key'])
      return new Response(JSON.stringify({ id: 'rs-new' }), { status: 200 })
    })

    const input = { customerId: 'cust-1', appointmentId: null, takeId: FINALIZE.takeId }
    await viteRecordingPort.startSession(input)
    await viteRecordingPort.startSession(input)
    await viteRecordingPort.startSession({ ...input, takeId: OTHER_TAKE })

    expect(new Set(keys).size).toBe(3)
    // Nothing about the take is in the key any more — a replay of one attempt's
    // answer must never be able to reach another attempt.
    expect(keys.some((k) => k.includes(FINALIZE.takeId))).toBe(false)
  })

  // ── ⚖ BORN RESERVED (fix round 8) ────────────────────────────────────────
  // With the container beside the take, the door composes this take's finalized
  // key AT CREATE — the row is never unbound, so two client-named mints have no
  // window to race in and the mint that follows only answers "already ours".
  it('names the take and its container, so the row is born pointing at the key', async () => {
    let seen: RequestInit | undefined
    const apiFetch = port(async (_path: string, init?: RequestInit) => {
      seen = init
      return new Response(JSON.stringify({ id: 'rs-new' }), { status: 200 })
    })

    await expect(
      viteRecordingPort.startSession({
        customerId: 'cust-1',
        appointmentId: null,
        takeId: FINALIZE.takeId,
        mimeType: FINALIZE.mimeType,
      }),
    ).resolves.toEqual({ id: 'rs-new' })

    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(seen?.body as string)).toEqual({
      customerId: 'cust-1',
      appointmentId: null,
      takeId: FINALIZE.takeId,
      mimeType: FINALIZE.mimeType,
    })
  })

  // TRANSITIONAL (fix round 8). The pair is refused wholesale by a server that
  // predates it — the door's schema is strict — and a capture that lost its row
  // over a field the server has never heard of would be a regression. So: one
  // step back, to the body the door has always taken — under its OWN key (fix
  // round 12), because an Idempotency-Key promises the same answer to the same
  // request, and sharing one let a door replay the first attempt's 400 to the
  // second, differently shaped body: the step back never reached the server.
  it('a door that does not know the pair is asked ONCE more without it', async () => {
    const bodies: unknown[] = []
    const keys: string[] = []
    const apiFetch = port(async (_path: string, init?: RequestInit) => {
      bodies.push(JSON.parse(init?.body as string))
      keys.push((init?.headers as Record<string, string>)['idempotency-key'])
      return bodies.length === 1
        ? new Response(errorBody('validation'), { status: 400 })
        : new Response(JSON.stringify({ id: 'rs-new' }), { status: 200 })
    })

    await expect(
      viteRecordingPort.startSession({
        customerId: 'cust-1',
        appointmentId: null,
        takeId: FINALIZE.takeId,
        mimeType: FINALIZE.mimeType,
      }),
    ).resolves.toEqual({ id: 'rs-new' })

    expect(apiFetch).toHaveBeenCalledTimes(2)
    expect(bodies[1]).toEqual({ customerId: 'cust-1', appointmentId: null })
    // A key of its own — a replayed 400 would make this step back a no-op, and
    // a take with no row never leaves the device.
    expect(keys[1]).not.toBe(keys[0])
  })

  // …and ONLY on the 400. Any other refusal is the door being unable to answer
  // right now, which is a retryable 'session' — asking again inside one call
  // would just double the traffic of an outage.
  it('never steps back on a status that is not the door refusing the fields', async () => {
    const apiFetch = port(async () => new Response(errorBody('upstream_unavailable'), { status: 500 }))

    await expect(
      viteRecordingPort.startSession({
        customerId: null,
        appointmentId: null,
        takeId: FINALIZE.takeId,
        mimeType: FINALIZE.mimeType,
      }),
    ).resolves.toBeNull()
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  // FAIL-OPEN, exactly like the web action: every one of these is a moment in
  // time, and secure-take records a RETRYABLE 'session' for it. A throw here
  // would reach secure-take's catch as a blanket 'network' instead.
  it.each([
    ['a 500', async () => new Response(errorBody('upstream_unavailable'), { status: 500 })],
    ['a 403', async () => new Response(errorBody('forbidden'), { status: 403 })],
    ['an unreadable 2xx body', async () => new Response('<html>x</html>', { status: 200 })],
    ['a null id (unresolvable staff)', async () => new Response(JSON.stringify({ id: null }))],
    [
      'a dead socket',
      async () => {
        throw new Error('offline')
      },
    ],
  ])('%s answers null, never a throw', async (_label, res) => {
    port(res as () => Promise<Response>)
    await expect(
      viteRecordingPort.startSession({
        customerId: null,
        appointmentId: null,
        takeId: FINALIZE.takeId,
      }),
    ).resolves.toBeNull()
  })
})

describe('thin recording port — mintTakeUrl', () => {
  it('POSTs the take id and container to the shared upload-url door', async () => {
    let seen: [string, RequestInit | undefined] | null = null
    const apiFetch = port(async (path: string, init?: RequestInit) => {
      seen = [path, init]
      return new Response(
        JSON.stringify({
          path: 'app_biz-1_11111111-2222-4333-8444-555555555555.mp4',
          url: 'https://proj.supabase.co/upload/x?token=up',
          contentType: 'audio/mp4',
          recordingSessionId: FINALIZE.recordingSessionId,
          // The facade echoes the mint's WHOLE result, and the mint's result
          // carries the bare signed token as well (fix round 13).
          token: 'up',
        }),
        { status: 200 },
      )
    })

    // toEqual, not toMatchObject: the ABSENCE of `token` is the assertion. It
    // already rides inside `url`, and the port contract omits it — handing a
    // caller a credential it is not supposed to have is how a second
    // signed-request assembler gets born (the web arm drops it for the same
    // reason, lib/ports/recording-port.ts).
    await expect(
      viteRecordingPort.mintTakeUrl(
        FINALIZE.takeId,
        'audio/mp4;codecs=mp4a.40.2',
        FINALIZE.recordingSessionId,
      ),
    ).resolves.toEqual({
      path: 'app_biz-1_11111111-2222-4333-8444-555555555555.mp4',
      url: 'https://proj.supabase.co/upload/x?token=up',
      contentType: 'audio/mp4',
      // The row the mint just RESERVED this key on — secure-take stamps it on
      // the take before it sends a single byte.
      recordingSessionId: FINALIZE.recordingSessionId,
    })

    expect(apiFetch).toHaveBeenCalledTimes(1)
    const [path, init] = seen!
    // ONE door for the phone and the web page — the key a take lands on must
    // not be able to differ per arm.
    expect(path).toBe('/api/app/v1/recordings/upload-url')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({ 'content-type': 'application/json' })
    expect(JSON.parse(init?.body as string)).toEqual({
      takeId: FINALIZE.takeId,
      mimeType: 'audio/mp4;codecs=mp4a.40.2',
      recordingSessionId: FINALIZE.recordingSessionId,
    })
  })

  // A take whose start-mint never landed sends null, which is what asks the
  // mint to CREATE the row. Dropping the key entirely would mean the same thing
  // to the schema, but the phone must not rely on an absent field to say it.
  it('a take with no session sends null — the shape that asks the mint to create the row', async () => {
    let seen: RequestInit | undefined
    port(async (_path: string, init?: RequestInit) => {
      seen = init
      return new Response(
        JSON.stringify({ path: 'p', url: 'u', contentType: 'audio/webm', recordingSessionId: 'rs-new' }),
        { status: 200 },
      )
    })

    await expect(
      viteRecordingPort.mintTakeUrl(FINALIZE.takeId, 'audio/webm', null),
    ).resolves.toMatchObject({ recordingSessionId: 'rs-new' })
    expect(JSON.parse(seen?.body as string).recordingSessionId).toBeNull()
  })

  // WHICH refusal is the whole question: `exists` and `reserved_elsewhere` are
  // TERMINAL (this take is spoken for — re-uploading it forever changes
  // nothing), while a 502 is the moment passing. The STATUS alone cannot tell
  // the first two apart — they are both 409 — so the body has to be read.
  it.each([
    // The route answers these with the mint's own code AS the message.
    [409, 'exists', facadeError('conflict', 'exists')],
    [409, 'reserved_elsewhere', facadeError('conflict', 'reserved_elsewhere')],
    [400, 'bad_mime', facadeError('validation', 'bad_mime')],
    [400, 'bad_take_id', facadeError('validation', 'bad_take_id')],
    // The door's refusal for a client-named take with no row (PR2 fix round 7).
    // Read as the generic `mint_400` it stayed RETRYABLE, so the phone
    // re-uploaded a whole take against an answer that can never change.
    [400, 'bad_input', facadeError('validation', 'bad_input')],
    // …and these with a sentence, so the classification carries the code.
    [403, 'forbidden', facadeError('forbidden', 'that recording session is not yours to record onto')],
    [404, 'not_found', facadeError('not_found', 'no such recording session')],
    [502, 'upstream', facadeError('upstream_unavailable', 'could not mint an upload URL')],
  ])('HTTP %i → the mint code %s', async (status, code, body) => {
    port(async () => new Response(body as string, { status }))
    await expect(
      viteRecordingPort.mintTakeUrl(FINALIZE.takeId, 'audio/mp4', FINALIZE.recordingSessionId),
    ).resolves.toEqual({ error: code })
  })

  it('…and every one of those named refusals the store judges TERMINAL really is', () => {
    for (const code of ['exists', 'reserved_elsewhere', 'bad_mime', 'bad_take_id', 'bad_input'])
      expect(TERMINAL_SECURE_ERRORS.has(code)).toBe(true)
  })

  // The route's OWN validation refusals carry a SENTENCE, not a mint code, so
  // the allowlist above cannot catch them and they fell through to the generic
  // `mint_400` — RETRYABLE. A body this server will never accept does not
  // become acceptable by sending it again, so the phone re-uploaded a whole
  // take against it on every cooldown, forever (fix round 13, P3).
  it.each([
    ['malformed JSON body'],
    ['invalid upload-url payload'],
  ])('a facade validation refusal (%s) is the TERMINAL bad_input, never a retry', async (message) => {
    port(async () => new Response(facadeError('validation', message), { status: 400 }))
    await expect(
      viteRecordingPort.mintTakeUrl(FINALIZE.takeId, 'audio/webm', null),
    ).resolves.toEqual({ error: 'bad_input' })
    expect(TERMINAL_SECURE_ERRORS.has('bad_input')).toBe(true)
  })

  // Anything the body does NOT name falls back to the status — retryable, which
  // is the safe default: a token blip must never mark a take permanently lost.
  it.each([
    [401, 'mint_401', errorBody('unauthenticated')],
    [429, 'mint_429', errorBody('rate_limited')],
    [500, 'mint_500', '<html>gateway</html>'],
  ])('HTTP %i with a body naming nothing we know → %s', async (status, code, body) => {
    port(async () => new Response(body as string, { status }))
    await expect(
      viteRecordingPort.mintTakeUrl(FINALIZE.takeId, 'audio/aiff', null),
    ).resolves.toEqual({ error: code })
  })

  // The finalize twin's lesson, on this door too: an unreadable 2xx is a
  // refusal, never an assumed success — a URL nobody can PUT to is not a mint.
  it('an unreadable 2xx body is a refusal, not an assumed success', async () => {
    port(async () => new Response('<html>gateway</html>', { status: 200 }))
    await expect(
      viteRecordingPort.mintTakeUrl(FINALIZE.takeId, 'audio/webm', null),
    ).resolves.toEqual({ error: 'mint_200' })
  })
})

describe('thin recording port — finalizeTake', () => {
  it('POSTs the finalize body verbatim to the shared door', async () => {
    let seen: [string, RequestInit | undefined] | null = null
    port(async (path: string, init?: RequestInit) => {
      seen = [path, init]
      return new Response(JSON.stringify({ ok: true, recordingSessionId: 'rs-1' }), {
        status: 200,
      })
    })

    await expect(viteRecordingPort.finalizeTake(FINALIZE)).resolves.toEqual({
      ok: true,
      recordingSessionId: 'rs-1',
    })
    const [path, init] = seen!
    expect(path).toBe('/api/app/v1/recordings/finalize')
    expect(init?.method).toBe('POST')
    // No storage PATH is ever sent: the key is re-composed server-side against
    // the Bearer identity's own business.
    expect(JSON.parse(init?.body as string)).toEqual(FINALIZE)
  })

  it('a SOFT refusal rides back in the 2xx body, exactly as the route sends it', async () => {
    port(
      async () => new Response(JSON.stringify({ error: 'object_missing' }), { status: 200 }),
    )
    await expect(viteRecordingPort.finalizeTake(FINALIZE)).resolves.toEqual({
      error: 'object_missing',
    })
  })

  // THE regression this file exists for, same as the discard port's: every row
  // arrives with a body that PARSES, so the guard cannot rest on an unreadable
  // one. A non-2xx read as success would mark the take secured and stop the
  // retry on audio the server never got.
  it.each([
    [502, 'upstream_unavailable'],
    [401, 'unauthorized'],
  ])('HTTP %i (%s) → failed, never a silent success', async (status, code) => {
    port(async () => new Response(errorBody(code), { status }))
    await expect(viteRecordingPort.finalizeTake(FINALIZE)).resolves.toEqual({
      error: 'failed',
    })
  })

  // …except a 403, which is not a moment in time: the door is saying this take
  // is not this caller's to finalize, and it will say the same forever. Folded
  // into the retryable 'failed' it made the phone re-upload a whole take on
  // every mount; 'forbidden' is TERMINAL, the same answer the web twin gives.
  it('HTTP 403 → forbidden, the TERMINAL code — not a whole-take re-upload forever', async () => {
    port(async () => new Response(errorBody('forbidden'), { status: 403 }))
    await expect(viteRecordingPort.finalizeTake(FINALIZE)).resolves.toEqual({
      error: 'forbidden',
    })
    expect(TERMINAL_SECURE_ERRORS.has('forbidden')).toBe(true)
  })

  it('an unreadable body is failed too, not an assumed success', async () => {
    port(async () => new Response('<html>gateway</html>', { status: 200 }))
    await expect(viteRecordingPort.finalizeTake(FINALIZE)).resolves.toEqual({
      error: 'failed',
    })
  })
})

// ── The recorder's own start-mint, on the same door (fix round 8) ────────────
// global-recorder calls @/actions/recordings#startRecordingSession directly,
// which on the phone IS this port — so the born-reserved invariant has to hold
// on both routes or the very first session of every recording is born unbound.
describe('thin actions port — the recorder start-mint reserves at create too', () => {
  it('sends the take and its container with the customer', async () => {
    let seen: RequestInit | undefined
    const apiFetch = port(async (path: string, init?: RequestInit) => {
      seen = init
      expect(path).toBe('/api/app/v1/recordings/session')
      return new Response(JSON.stringify({ id: 'rs-new' }), { status: 200 })
    })

    await expect(
      startRecordingSession({
        customerId: 'cust-1',
        appointmentId: null,
        takeId: FINALIZE.takeId,
        mimeType: FINALIZE.mimeType,
      }),
    ).resolves.toEqual({ id: 'rs-new' })

    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(seen?.body as string)).toEqual({
      customerId: 'cust-1',
      appointmentId: null,
      takeId: FINALIZE.takeId,
      mimeType: FINALIZE.mimeType,
    })
  })

  it('steps back ONCE to the body an older server knows, and still mints', async () => {
    const bodies: unknown[] = []
    const apiFetch = port(async (_path: string, init?: RequestInit) => {
      bodies.push(JSON.parse(init?.body as string))
      return bodies.length === 1
        ? new Response(errorBody('validation'), { status: 400 })
        : new Response(JSON.stringify({ id: 'rs-new' }), { status: 200 })
    })

    await expect(
      startRecordingSession({
        customerId: 'cust-1',
        appointmentId: null,
        takeId: FINALIZE.takeId,
        mimeType: FINALIZE.mimeType,
      }),
    ).resolves.toEqual({ id: 'rs-new' })

    expect(apiFetch).toHaveBeenCalledTimes(2)
    expect(bodies[1]).toEqual({ customerId: 'cust-1', appointmentId: null })
  })

  // BOTH OR NEITHER — half a pair is a validation 400 by the door's schema, so
  // a take with no uuid to name (or no negotiated container) never sends one.
  it('sends neither when only one of the two is known', async () => {
    let seen: RequestInit | undefined
    port(async (_path: string, init?: RequestInit) => {
      seen = init
      return new Response(JSON.stringify({ id: 'rs-new' }), { status: 200 })
    })

    await startRecordingSession({ customerId: 'cust-1', takeId: FINALIZE.takeId })
    expect(JSON.parse(seen?.body as string)).toEqual({ customerId: 'cust-1' })
  })

  // ⚖ AND IT DOES NOT WAIT FOREVER (fix round 10, P1). A phone that walks out
  // of signal STALLS its requests rather than failing them, and this door had
  // no deadline on either attempt: the reply could land minutes later, after
  // the stop had already secured the take against a row of its own. The take's
  // store refuses that late stamp now; this releases the socket that carried it.
  it('a door that never answers is abandoned at its deadline — null, and the socket is aborted', async () => {
    jest.useFakeTimers()
    try {
      let aborted = false
      port(
        (_path: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              aborted = true
              reject(new Error('AbortError'))
            })
          }),
      )

      const pending = startRecordingSession({
        customerId: 'cust-1',
        takeId: FINALIZE.takeId,
        mimeType: FINALIZE.mimeType,
      })
      await jest.advanceTimersByTimeAsync(10_000)

      // Fail-OPEN, like every other failure here: capture never blocks on it.
      await expect(pending).resolves.toBeNull()
      expect(aborted).toBe(true)
    } finally {
      jest.useRealTimers()
    }
  })
})
