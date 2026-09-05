/**
 * The play button's two port arms (build 23 slice ①). One method, two doors:
 * the card calls `getRecordingPipelinePort().mintPlaybackUrl(karuteId)` and
 * must not care which world it is in.
 *
 * The shared body's logic is proved in recording-playback-url.test.ts. What
 * this file owns is the SEAM: the web arm reaches the server action, the thin
 * arm hits the exact facade path with an encoded id, and every non-2xx comes
 * back as a NAMED code the card can show once — never a throw inside a card the
 * staffer is reading.
 *
 * Shape follows thin-discard-transcript-port.test.ts (the closest sibling).
 */
import { setDataPort } from '@/lib/ports/data-port'

const mintRecordingPlaybackUrl = jest.fn()
jest.mock('@/actions/recording-playback', () => ({
  mintRecordingPlaybackUrl: (id: string) => mintRecordingPlaybackUrl(id),
}))
jest.mock('@/lib/karute/take-store', () => ({}))

import { webRecordingPort } from '@/lib/ports/recording-port'
import { viteRecordingPort } from '../../../thin/ports/recording.vite'

function port(res: (path: string, init?: RequestInit) => Promise<Response>) {
  const apiFetch = jest.fn(res)
  setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
  return apiFetch
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const errorBody = (code: string) => ({ error: { code, message: code } })

const OK = { url: 'https://proj.supabase.co/read/app_b_x.mp4?token=t', expiresAt: '2026-09-06T00:00:00.000Z', durationSeconds: 742 }

beforeEach(() => jest.clearAllMocks())

describe('web arm', () => {
  it('calls the server action and unwraps the ok union', async () => {
    mintRecordingPlaybackUrl.mockResolvedValue({ ok: true, ...OK })
    expect(await webRecordingPort.mintPlaybackUrl('kar-1')).toEqual(OK)
    expect(mintRecordingPlaybackUrl).toHaveBeenCalledWith('kar-1')
  })

  it('carries the action’s refusal through as a named code', async () => {
    mintRecordingPlaybackUrl.mockResolvedValue({ ok: false, error: 'forbidden' })
    expect(await webRecordingPort.mintPlaybackUrl('kar-1')).toEqual({ error: 'forbidden' })
  })
})

describe('thin arm', () => {
  it('GETs the exact facade path with the id encoded', async () => {
    const apiFetch = port(async () => json(OK))
    expect(await viteRecordingPort.mintPlaybackUrl('kar 1/2')).toEqual(OK)
    expect(apiFetch).toHaveBeenCalledWith(
      '/api/app/v1/recordings/playback-url?karuteId=kar%201%2F2',
    )
  })

  it('maps a 403 body to the code the card shows', async () => {
    port(async () => json(errorBody('forbidden'), 403))
    expect(await viteRecordingPort.mintPlaybackUrl('kar-1')).toEqual({ error: 'forbidden' })
  })

  it('maps the 404 no-audio refusal to its own code', async () => {
    port(async () => json(errorBody('not_found'), 404))
    expect(await viteRecordingPort.mintPlaybackUrl('kar-1')).toEqual({ error: 'not_found' })
  })

  // A proxy page, an auth blip: a non-2xx that named no code at all still has
  // to come back as something honest.
  it('falls back to mint_<status> when the body names no code', async () => {
    port(async () => new Response('<html>gateway</html>', { status: 502 }))
    expect(await viteRecordingPort.mintPlaybackUrl('kar-1')).toEqual({ error: 'mint_502' })
  })

  // A facade error body parses perfectly (the discard port's lesson) — a 2xx
  // check alone is not enough, so the url's presence is checked too.
  it('a 200 with no url is a refusal, not a player with an empty src', async () => {
    port(async () => json({ expiresAt: 'x', durationSeconds: null }))
    expect(await viteRecordingPort.mintPlaybackUrl('kar-1')).toEqual({ error: 'mint_200' })
  })

  it('normalises a missing durationSeconds to null rather than failing', async () => {
    port(async () => json({ url: OK.url, expiresAt: OK.expiresAt }))
    expect(await viteRecordingPort.mintPlaybackUrl('kar-1')).toEqual({
      url: OK.url,
      expiresAt: OK.expiresAt,
      durationSeconds: null,
    })
  })
})
