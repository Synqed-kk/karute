/**
 * 破棄の記録 on the PHONE — the two manager reads of the actions port.
 *
 * DiscardReasonsSection is one shared component rendered by both platforms and
 * it branches ONLY on the `{ ok }` discriminator: `ok:false` is its 読み込めま
 * せんでした state, and a REJECTED promise is nothing at all — the list sits on
 * its spinner and an opened row loads forever. So the contract these ports owe
 * is the web actions' exact union, never a throw. Both web actions catch
 * everything (src/actions/recording-discards.ts); these must too.
 *
 * The other half is the A2-4 honesty law reaching the phone: an unreadable 200
 * must not become "there is no transcript" / "nothing was discarded". Only the
 * ROUTE's own empty answer (core's 404 — a swept session) means that.
 *
 * Shape follows thin-recording-discard-port.test.ts (the closest sibling).
 */
import { setDataPort } from '@/lib/ports/data-port'
// Type-only (erased): the fixtures below ARE the wire shape, so typing them
// with the web actions' own success shapes makes a renamed field fail tsc
// right here instead of passing a green suite and reaching the phone.
import type {
  ListDiscardReasonsResult,
  GetDiscardTranscriptResult,
} from '@/actions/recording-discards'

jest.mock('@/lib/karute/take-store', () => ({}))

import { listDiscardReasons, getDiscardTranscript } from '../../../thin/ports/actions.vite'

type ListBody = Omit<Extract<ListDiscardReasonsResult, { ok: true }>, 'ok'>
type TranscriptBody = Omit<Extract<GetDiscardTranscriptResult, { ok: true }>, 'ok'>

const LIST_BODY: ListBody = {
  rows: [
    {
      id: 'row-1',
      recordingSessionId: 'rs-1',
      createdAt: '2026-08-31T02:00:00.000Z',
      staffId: 'card-A',
      staffName: '原 奏恵',
      reason: 'お客様が席を外したため録り直します',
      customerId: 'cus-1',
      customerName: '田中 恵子',
      recordingCreatedAt: '2026-08-31T01:58:00.000Z',
      durationSeconds: 252,
      storeName: '代官山店',
    },
  ],
  counts: {
    thisMonth: 1,
    total: 1,
    byStaff: [{ staffId: 'card-A', staffName: '原 奏恵', thisMonth: 1 }],
  },
  truncated: false,
}

const TRANSCRIPT_BODY: TranscriptBody = {
  segments: [
    { text: 'ひとつめ', startTime: 4 },
    { text: 'ふたつめ', startTime: 331 },
  ],
  durationSeconds: 42,
}

function port(res: (path: string, init?: RequestInit) => Promise<Response>) {
  const apiFetch = jest.fn(res)
  setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
  return apiFetch
}

/** The REAL wire shape of a facade failure: an error body that parses. */
const errorBody = (code: string) => JSON.stringify({ error: { code, message: code } })

describe('thin actions port — 破棄の記録 list', () => {
  it('GETs the facade list path', async () => {
    let seen: string | null = null
    const apiFetch = port(async (path: string) => {
      seen = path
      return new Response(JSON.stringify(LIST_BODY), { status: 200 })
    })

    await listDiscardReasons()

    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(seen).toBe('/api/app/v1/recordings/discards')
  })

  it('2xx → the web action\'s ok union, rows and counts verbatim', async () => {
    port(async () => new Response(JSON.stringify(LIST_BODY), { status: 200 }))

    await expect(listDiscardReasons()).resolves.toEqual({ ok: true, ...LIST_BODY })
  })

  it('truncated:true rides through — the ⚖ 8/25 floors-not-totals qualifier is the phone\'s too', async () => {
    // The section renders the qualifier ON the count tiles off this flag. A
    // passthrough folded to a constant `false` would leave a phone manager
    // reading a capped number as a complete one, with every other assertion
    // in this file still green.
    const capped: ListBody = { ...LIST_BODY, truncated: true }
    port(async () => new Response(JSON.stringify(capped), { status: 200 }))

    await expect(listDiscardReasons()).resolves.toEqual({ ok: true, ...capped })
  })

  it('403 → forbidden (the capability is gone), not a generic failure', async () => {
    port(async () => new Response(errorBody('forbidden'), { status: 403 }))

    await expect(listDiscardReasons()).resolves.toEqual({ ok: false, error: 'forbidden' })
  })

  it.each([[500, 'internal'], [502, 'upstream_unavailable'], [401, 'unauthenticated']])(
    '%d (%s) → failed',
    async (status, code) => {
      port(async () => new Response(errorBody(code), { status }))

      await expect(listDiscardReasons()).resolves.toEqual({ ok: false, error: 'failed' })
    },
  )

  it('a transport failure RESOLVES failed — it never rejects', async () => {
    port(async () => {
      throw new Error('network down')
    })

    await expect(listDiscardReasons()).resolves.toEqual({ ok: false, error: 'failed' })
  })

  it.each([
    ['an unreadable body', '<html>gateway</html>'],
    ['a body with no rows', JSON.stringify({ counts: LIST_BODY.counts })],
    ['a body with no counts', JSON.stringify({ rows: [] })],
    // Presence is not shape. The section reads `rows.map` and
    // `counts.byStaff.length` unguarded, so a truthy non-array walks past a
    // presence check and throws at RENDER — a blank tab, which is the one
    // outcome worse than the honest error card.
    ['rows that is not an array', JSON.stringify({ rows: {}, counts: LIST_BODY.counts })],
    [
      'a counts whose byStaff is not an array',
      JSON.stringify({ rows: [], counts: { thisMonth: 0, total: 0, byStaff: {} } }),
    ],
  ])('a 2xx with %s is a FAILURE, never an empty ledger', async (_label, body) => {
    port(async () => new Response(body, { status: 200 }))

    await expect(listDiscardReasons()).resolves.toEqual({ ok: false, error: 'failed' })
  })
})

describe('thin actions port — 破棄の記録 transcript', () => {
  it('GETs the facade transcript path with the session id encoded', async () => {
    let seen: string | null = null
    const apiFetch = port(async (path: string) => {
      seen = path
      return new Response(JSON.stringify(TRANSCRIPT_BODY), { status: 200 })
    })

    await getDiscardTranscript('rs/1')

    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(seen).toBe('/api/app/v1/recordings/discards/transcript?sessionId=rs%2F1')
  })

  it('2xx → the web action\'s ok union, segments and duration verbatim', async () => {
    port(async () => new Response(JSON.stringify(TRANSCRIPT_BODY), { status: 200 }))

    await expect(getDiscardTranscript('rs-1')).resolves.toEqual({ ok: true, ...TRANSCRIPT_BODY })
  })

  it('an EMPTY segments array from the route is an answer — the swept session', async () => {
    port(async () => new Response(JSON.stringify({ segments: [], durationSeconds: null }), { status: 200 }))

    await expect(getDiscardTranscript('rs-1')).resolves.toEqual({
      ok: true,
      segments: [],
      durationSeconds: null,
    })
  })

  it.each([
    ['no startTime at all (a deployment older than the redesign)', { text: 'ひとつめ' }],
    ['a startTime that is not a number', { text: 'ひとつめ', startTime: '0:04' }],
    ['an explicitly null startTime', { text: 'ひとつめ', startTime: null }],
  ])('%s degrades to null — the WORDS still arrive', async (_label, segment) => {
    // The old-wire boundary. A baked phone newer than the server it is talking
    // to must still show what was said; only the 5-minute markers go missing,
    // and the panel renders none rather than placing them from a value it does
    // not have. Rejecting here would answer 読み込めませんでした for a
    // transcript the server sent in full.
    port(
      async () =>
        new Response(JSON.stringify({ segments: [segment], durationSeconds: 42 }), { status: 200 }),
    )

    await expect(getDiscardTranscript('rs-1')).resolves.toEqual({
      ok: true,
      segments: [{ text: 'ひとつめ', startTime: null }],
      durationSeconds: 42,
    })
  })

  it('403 → forbidden, not a generic failure', async () => {
    port(async () => new Response(errorBody('forbidden'), { status: 403 }))

    await expect(getDiscardTranscript('rs-1')).resolves.toEqual({ ok: false, error: 'forbidden' })
  })

  it.each([[500, 'internal'], [502, 'upstream_unavailable'], [400, 'validation']])(
    '%d (%s) → failed',
    async (status, code) => {
      port(async () => new Response(errorBody(code), { status }))

      await expect(getDiscardTranscript('rs-1')).resolves.toEqual({ ok: false, error: 'failed' })
    },
  )

  it('a transport failure RESOLVES failed — it never rejects', async () => {
    port(async () => {
      throw new Error('network down')
    })

    await expect(getDiscardTranscript('rs-1')).resolves.toEqual({ ok: false, error: 'failed' })
  })

  it.each([
    ['an unreadable body', '<html>gateway</html>'],
    // Same presence-vs-shape rule as the list above: the panel joins
    // `segments.map(…)`, so a truthy non-array throws at render rather than
    // rendering the honest 読み込めませんでした.
    ['a segments that is not an array', JSON.stringify({ segments: {}, durationSeconds: null })],
  ])('a 2xx with %s is NOT "there is no transcript"', async (_label, body) => {
    port(async () => new Response(body, { status: 200 }))

    await expect(getDiscardTranscript('rs-1')).resolves.toEqual({ ok: false, error: 'failed' })
  })
})
