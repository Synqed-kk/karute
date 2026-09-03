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
 *   · the mint body carries the take id AND the container (a `.webm` name on
 *     iOS mp4 bytes is the live mislabelling bug);
 *   · finalize FAILS SETTLED, never thrown — and a facade error body parses
 *     perfectly, so `!res.ok` has to be half the guard (the discard port's
 *     lesson, thin-recording-discard-port.test.ts).
 *
 * Shape follows thin-recording-discard-port.test.ts (the closest sibling).
 */
import { setDataPort } from '@/lib/ports/data-port'

import { viteRecordingPort } from '../../../thin/ports/recording.vite'

const FINALIZE = {
  takeId: '11111111-2222-4333-8444-555555555555',
  mimeType: 'audio/mp4',
  durationSeconds: 42.5,
  byteLength: 1234,
  recordingSessionId: '99999999-2222-4333-8444-555555555555',
}

function port(res: (path: string, init?: RequestInit) => Promise<Response>) {
  const apiFetch = jest.fn(res)
  setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
  return apiFetch
}

/** The REAL wire shape of a facade failure: an error body that parses. */
const errorBody = (code: string) => JSON.stringify({ error: { code, message: code } })

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
        }),
        { status: 200 },
      )
    })

    await expect(
      viteRecordingPort.mintTakeUrl(FINALIZE.takeId, 'audio/mp4;codecs=mp4a.40.2'),
    ).resolves.toEqual({
      path: 'app_biz-1_11111111-2222-4333-8444-555555555555.mp4',
      url: 'https://proj.supabase.co/upload/x?token=up',
      contentType: 'audio/mp4',
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
    })
  })

  it('a refused mint throws, and the throw CARRIES the status — not a blanket network failure', async () => {
    port(async () => new Response(errorBody('validation'), { status: 400 }))
    // secure-take reads this code onto the take meta. Without it a 403 (wrong
    // tenant, permanently) and a 502 (storage down, try later) both land as
    // 'network' and the phone re-uploads the whole take forever.
    await expect(
      viteRecordingPort.mintTakeUrl(FINALIZE.takeId, 'audio/aiff'),
    ).rejects.toMatchObject({
      message: 'Upload URL failed (400)',
      secureError: 'mint_400',
    })
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
    [403, 'forbidden'],
    [401, 'unauthorized'],
  ])('HTTP %i (%s) → failed, never a silent success', async (status, code) => {
    port(async () => new Response(errorBody(code), { status }))
    await expect(viteRecordingPort.finalizeTake(FINALIZE)).resolves.toEqual({
      error: 'failed',
    })
  })

  it('an unreadable body is failed too, not an assumed success', async () => {
    port(async () => new Response('<html>gateway</html>', { status: 200 }))
    await expect(viteRecordingPort.finalizeTake(FINALIZE)).resolves.toEqual({
      error: 'failed',
    })
  })
})
