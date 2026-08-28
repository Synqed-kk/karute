/**
 * P5-A written-reason discard — the THIN (phone) entry of the actions port.
 *
 * This is the surface staff actually discard from, and its own header promises
 * the one property that matters: *"FAILS CLOSED, unlike its
 * deleteRecordingSession neighbour above: this call IS the trace, so anything
 * short of a 2xx must leave the take alone."* Nothing pinned it — the whole
 * repo stayed green with the status guard deleted (armor round 1, M18).
 *
 * Why that mattered, concretely: `src/lib/app-api/handler.ts` stringifies its
 * ERRORS, so a facade `upstream_unavailable` 502 arrives with a perfectly
 * parseable JSON body. Without the `!res.ok` half of the guard, `res.json()`
 * succeeds, `body` is non-null, and the port answers `{ ok: true }` —
 * RecordPageView then sees success and destroys the take with NO reason row and
 * NO receipt. That is precisely the doctrine failure P5-A exists to prevent.
 *
 * Shape follows thin-recordings-inbox-port.test.ts (the closest sibling).
 */
import { setDataPort } from '@/lib/ports/data-port'

jest.mock('@/lib/karute/take-store', () => ({}))

import { discardRecordingWithReason } from '../../../thin/ports/actions.vite'

const INPUT = {
  recordingSessionId: 'rs-1',
  takeId: 'take-1',
  reason: 'お客様が席を外したため録り直します',
  durationSeconds: 12.4,
  customerId: 'cust-1',
  appointmentId: 'appt-1',
  pipeline: 'in_tab' as const,
  jobState: null,
}

function port(res: (path: string, init?: RequestInit) => Promise<Response>) {
  const apiFetch = jest.fn(res)
  setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
  return apiFetch
}

/** The REAL wire shape of a facade failure: an error body that parses. */
const errorBody = (code: string) => JSON.stringify({ error: { code, message: code } })

describe('thin actions port — the written-reason discard fails closed', () => {
  it('POSTs the shared facade discard path', async () => {
    let seen: string | null = null
    const apiFetch = port(async (path: string) => {
      seen = path
      return new Response(JSON.stringify({ receiptId: 'row-1', duplicate: false }), {
        status: 200,
      })
    })

    await discardRecordingWithReason(INPUT)

    expect(apiFetch).toHaveBeenCalledTimes(1)
    // ONE endpoint for both shapes — the phone and the web page must not be
    // able to drift into different discard semantics.
    expect(seen).toBe('/api/app/v1/recordings/discard')
  })

  it('2xx → the receipt is reported back verbatim', async () => {
    port(
      async () =>
        new Response(JSON.stringify({ receiptId: 'row-1', duplicate: false }), { status: 200 }),
    )

    await expect(discardRecordingWithReason(INPUT)).resolves.toEqual({
      ok: true,
      receiptId: 'row-1',
      duplicate: false,
    })
  })

  // THE regression this file exists for. Every row here arrives with a body
  // that PARSES — the guard cannot be allowed to rest on an unreadable one.
  it.each([
    [502, 'upstream_unavailable', 'failed'],
    [500, 'internal', 'failed'],
    [403, 'forbidden', 'forbidden'],
    [400, 'validation', 'validation'],
    [401, 'unauthorized', 'failed'],
  ])('%d (%s) → { ok: false, error: %s } — the take is left alone', async (status, code, error) => {
    port(async () => new Response(errorBody(code), { status }))

    await expect(discardRecordingWithReason(INPUT)).resolves.toEqual({ ok: false, error })
  })

  it('a 2xx with an unreadable body is NOT a discard', async () => {
    // A 200 whose body is not JSON tells us nothing landed. Reporting success
    // here would destroy the take on the strength of a status code alone.
    port(async () => new Response('<html>gateway</html>', { status: 200 }))

    await expect(discardRecordingWithReason(INPUT)).resolves.toEqual({
      ok: false,
      error: 'failed',
    })
  })

  it('a transport failure is a refusal, never a silent success', async () => {
    port(async () => {
      throw new Error('network down')
    })

    await expect(discardRecordingWithReason(INPUT)).resolves.toEqual({
      ok: false,
      error: 'failed',
    })
  })

  it('a 2xx with an empty JSON body still reports the discard, receipt id absent', async () => {
    // `ok()` returns the data bare, so `{}` is a well-formed "landed, but core
    // handed back no row id" — the receipt id is nullable by contract.
    port(async () => new Response(JSON.stringify({}), { status: 200 }))

    await expect(discardRecordingWithReason(INPUT)).resolves.toEqual({
      ok: true,
      receiptId: null,
      duplicate: false,
    })
  })
})
