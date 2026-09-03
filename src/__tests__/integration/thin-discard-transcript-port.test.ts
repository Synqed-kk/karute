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
