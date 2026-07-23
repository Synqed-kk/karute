/**
 * @jest-environment jsdom
 *
 * useScreenDto × router.refresh() (design-parity P-B). On web, a mutation's
 * router.refresh() re-runs the server render so the new/cancelled booking
 * appears in place; the shell has no server render, so the nav port's refresh
 * now re-fetches every mounted screen DTO. Pins: refresh triggers a re-fetch ·
 * the current content STAYS on screen while the fresh DTO loads (no loading
 * flash — Next keeps stale content visible too) · the swap lands when the
 * fetch resolves · a FAILED same-path re-fetch keeps the rendered content
 * (web parity: a failed router.refresh() leaves the page intact — a success
 * toast must never be followed by an error frame) · retry() after an error
 * still shows the loading frame.
 */
import type { Session } from '@supabase/supabase-js'
import { act, render, screen, waitFor } from '@testing-library/react'
import { setDataPort } from '@/lib/ports/data-port'
import { seedKnownSession, setSessionState } from '@/lib/auth/mobile/session-store'
import { emitRefresh, useRouter } from '../../../thin/ports/nav.vite'
import { cacheDto, dtoCache, ScreenStates, useScreenDto } from '../../../thin/screens/ScreenBoundary'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

const parse = (raw: unknown): { label: string } => raw as { label: string }

function Probe({ path }: { path: string }) {
  const { state, retry } = useScreenDto(path, parse)
  const router = useRouter()
  return (
    <div>
      <button onClick={() => router.refresh()}>do-refresh</button>
      <ScreenStates state={state} retry={retry}>
        {(dto) => <div data-testid="content">{dto.label}</div>}
      </ScreenStates>
    </div>
  )
}

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response
}

function unauthorizedResponse(): Response {
  return {
    ok: false,
    status: 401,
    json: async () => ({ error: { message: 'unauthorized' } }),
  } as unknown as Response
}

const seedSession = (token: string, uid: string): Session =>
  ({ access_token: token, user: { id: uid } }) as Session

describe('useScreenDto refresh (stale-while-revalidate)', () => {
  it('refresh re-fetches; content stays visible until the fresh DTO lands', async () => {
    let resolveSecond: (r: Response) => void = () => {}
    const apiFetch = jest
      .fn<Promise<Response>, unknown[]>()
      .mockResolvedValueOnce(jsonResponse({ label: 'v1' }))
      .mockImplementationOnce(
        () => new Promise<Response>((res) => (resolveSecond = res)),
      )
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    render(<Probe path="/api/app/v1/screens/probe-refresh" />)
    await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('v1'))

    act(() => {
      screen.getByText('do-refresh').click()
    })
    expect(apiFetch).toHaveBeenCalledTimes(2)
    // No loading flash: the v1 content is still on screen mid-refetch.
    expect(screen.getByTestId('content').textContent).toBe('v1')

    act(() => resolveSecond(jsonResponse({ label: 'v2' })))
    await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('v2'))
  })

  it('a FAILED same-path re-fetch keeps the rendered content, not an error frame', async () => {
    const apiFetch = jest
      .fn<Promise<Response>, unknown[]>()
      .mockResolvedValueOnce(jsonResponse({ label: 'v1' }))
      .mockRejectedValueOnce(new Error('offline blip'))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    render(<Probe path="/api/app/v1/screens/probe-failed-refetch" />)
    await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('v1'))

    await act(async () => {
      screen.getByText('do-refresh').click()
    })
    expect(apiFetch).toHaveBeenCalledTimes(2)
    // The mutation landed server-side; the agenda must not flip to an error
    // frame because the background refresh hit a blip.
    expect(screen.getByTestId('content').textContent).toBe('v1')
    expect(screen.queryByText('somethingWentWrong')).toBeNull()
  })

  it('retry() after a first-fetch error shows the loading frame, then recovers', async () => {
    const apiFetch = jest
      .fn<Promise<Response>, unknown[]>()
      .mockRejectedValueOnce(new Error('boot fail'))
      .mockResolvedValueOnce(jsonResponse({ label: 'v1' }))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    render(<Probe path="/api/app/v1/screens/probe-retry" />)
    await waitFor(() => expect(screen.getByText('somethingWentWrong')).toBeTruthy())

    await act(async () => {
      screen.getByText('retry').click()
    })
    await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('v1'))
  })
})

describe('useScreenDto screen DTO cache (packet 24 PR-A — instant revisit paint)', () => {
  it('revisit: cache-seeded initial paint (no loading frame) — a background fetch still swaps content', async () => {
    const path = '/api/app/v1/screens/revisit'
    let resolveSecond: (r: Response) => void = () => {}
    const apiFetch = jest
      .fn<Promise<Response>, unknown[]>()
      .mockResolvedValueOnce(jsonResponse({ label: 'dto1' }))
      .mockImplementationOnce(
        () => new Promise<Response>((res) => (resolveSecond = res)),
      )
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    const first = render(<Probe path={path} />)
    await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('dto1'))
    first.unmount()

    // Revisit — remount the SAME path. The first paint must be the cached
    // dto, never the loading frame, and a background revalidate still fires.
    render(<Probe path={path} />)
    expect(screen.queryByText('loading')).toBeNull()
    expect(screen.getByTestId('content').textContent).toBe('dto1')
    expect(apiFetch).toHaveBeenCalledTimes(2)

    act(() => resolveSecond(jsonResponse({ label: 'dto2' })))
    await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('dto2'))
  })

  it('mutation refresh: emitRefresh() clears the WHOLE cache while the mounted screen swap-refreshes', async () => {
    const pathA = '/api/app/v1/screens/mutation-a'
    const pathB = '/api/app/v1/screens/mutation-b'

    // Prime B's cache entry via its own mount → settle → unmount.
    setDataPort({
      apiFetch: jest
        .fn<Promise<Response>, unknown[]>()
        .mockResolvedValueOnce(jsonResponse({ label: 'b1' })),
    } as unknown as Parameters<typeof setDataPort>[0])
    const probeB1 = render(<Probe path={pathB} />)
    await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('b1'))
    probeB1.unmount()
    expect(dtoCache.has(pathB)).toBe(true)

    // Mount A; let its first fetch settle.
    let resolveSecondA: (r: Response) => void = () => {}
    const apiFetchA = jest
      .fn<Promise<Response>, unknown[]>()
      .mockResolvedValueOnce(jsonResponse({ label: 'a1' }))
      .mockImplementationOnce(
        () => new Promise<Response>((res) => (resolveSecondA = res)),
      )
    setDataPort({ apiFetch: apiFetchA } as unknown as Parameters<typeof setDataPort>[0])
    const probeA = render(<Probe path={pathA} />)
    await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('a1'))

    // A mutation elsewhere calls router.refresh() → emitRefresh(): A swap-
    // refreshes without dropping frames, AND the whole cache (incl. B) clears.
    act(() => emitRefresh())
    expect(screen.getByTestId('content').textContent).toBe('a1') // no flash
    expect(dtoCache.has(pathB)).toBe(false)

    act(() => resolveSecondA(jsonResponse({ label: 'a2' })))
    await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('a2'))
    probeA.unmount()

    // B's cache entry is gone: a fresh mount of B now starts at loading.
    setDataPort({
      apiFetch: jest
        .fn<Promise<Response>, unknown[]>()
        .mockResolvedValueOnce(jsonResponse({ label: 'b2' })),
    } as unknown as Parameters<typeof setDataPort>[0])
    render(<Probe path={pathB} />)
    expect(screen.getByText('loading')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('b2'))
  })

  it('sign-out: setSessionState signed-out clears the cache (remount = loading)', async () => {
    const path = '/api/app/v1/screens/signout'
    setDataPort({
      apiFetch: jest
        .fn<Promise<Response>, unknown[]>()
        .mockResolvedValueOnce(jsonResponse({ label: 'dto1' })),
    } as unknown as Parameters<typeof setDataPort>[0])
    const probe = render(<Probe path={path} />)
    await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('dto1'))
    probe.unmount()
    expect(dtoCache.has(path)).toBe(true)

    setSessionState({ status: 'signed-out' })
    expect(dtoCache.has(path)).toBe(false)

    setDataPort({
      apiFetch: jest
        .fn<Promise<Response>, unknown[]>()
        .mockResolvedValueOnce(jsonResponse({ label: 'dto2' })),
    } as unknown as Parameters<typeof setDataPort>[0])
    render(<Probe path={path} />)
    expect(screen.getByText('loading')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('dto2'))
    setSessionState({ status: 'recovering' })
  })

  it('straggler fence: a fetch in flight across sign-out settles WITHOUT re-populating the cache', async () => {
    const path = '/api/app/v1/screens/straggler'
    let resolveFetch: (r: Response) => void = () => {}
    setDataPort({
      apiFetch: jest
        .fn<Promise<Response>, unknown[]>()
        .mockImplementationOnce(() => new Promise<Response>((res) => (resolveFetch = res))),
    } as unknown as Parameters<typeof setDataPort>[0])

    const probe = render(<Probe path={path} />)
    expect(screen.getByText('loading')).toBeTruthy()

    // Outgoing user signs out while the fetch is still on the wire. The probe
    // stays MOUNTED on purpose: in production AuthGate unmounts the screen,
    // but the unmount commit is async — this pins the generation fence for
    // the window where `alive` is still true when the straggler settles.
    setSessionState({ status: 'signed-out' })
    expect(dtoCache.has(path)).toBe(false)

    // The straggler settles AFTER the wipe — the generation fence must drop
    // the cache write, or the next user's first frame paints this dto.
    await act(async () => {
      resolveFetch(jsonResponse({ label: 'outgoing-user-data' }))
      // Drain the full then-chain (json → parse → cache write attempt).
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(dtoCache.has(path)).toBe(false)
    probe.unmount()

    // Even after the NEXT user signs in (a later generation), the straggler's
    // write stays dropped and their first mount starts honestly at loading.
    setSessionState({ status: 'recovering' })
    setDataPort({
      apiFetch: jest
        .fn<Promise<Response>, unknown[]>()
        .mockResolvedValueOnce(jsonResponse({ label: 'next-user-data' })),
    } as unknown as Parameters<typeof setDataPort>[0])
    render(<Probe path={path} />)
    expect(screen.getByText('loading')).toBeTruthy()
    await waitFor(() =>
      expect(screen.getByTestId('content').textContent).toBe('next-user-data'),
    )
  })

  it('alive gate: a superseded fetch (refresh mid-flight, same auth generation) never overwrites the newer cached dto', async () => {
    const path = '/api/app/v1/screens/superseded'
    let resolveFirst: (r: Response) => void = () => {}
    const apiFetch = jest
      .fn<Promise<Response>, unknown[]>()
      .mockImplementationOnce(() => new Promise<Response>((res) => (resolveFirst = res)))
      .mockResolvedValueOnce(jsonResponse({ label: 'fresh' }))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    render(<Probe path={path} />)
    expect(screen.getByText('loading')).toBeTruthy()

    // A mutation/heal fires refresh while fetch #1 is still on the wire: the
    // old effect is superseded (alive=false), fetch #2 dispatches and lands.
    act(() => emitRefresh())
    await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('fresh'))
    expect(dtoCache.get(path)).toEqual({ label: 'fresh' })

    // The superseded fetch settles LAST, same auth generation throughout —
    // e.g. a wrong-store-lens response after a self-heal. The alive gate must
    // drop its cache write; last-writer-wins here would cache stale/wrong-
    // scope data for the next revisit's first frame.
    await act(async () => {
      resolveFirst(jsonResponse({ label: 'stale-superseded' }))
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(dtoCache.get(path)).toEqual({ label: 'fresh' })
  })

  it('retry: clears a stale cache entry for that path so a later revisit never flashes it', async () => {
    const path = '/api/app/v1/screens/retry-cache'
    const apiFetch = jest
      .fn<Promise<Response>, unknown[]>()
      .mockRejectedValueOnce(new Error('boot fail'))
      .mockResolvedValueOnce(jsonResponse({ label: 'fresh' }))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    render(<Probe path={path} />)
    await waitFor(() => expect(screen.getByText('somethingWentWrong')).toBeTruthy())

    // A stale entry surviving from an earlier, unrelated visit to this path.
    dtoCache.set(path, { label: 'stale' })

    act(() => {
      screen.getByText('retry').click()
    })
    // Synchronous: retry() drops the cache entry before the re-fetch settles.
    expect(dtoCache.has(path)).toBe(false)

    await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('fresh'))
  })

  it('warm-cache revisit whose background revalidate FAILS keeps the cached content (deliberate SWR contract, no error frame)', async () => {
    const path = '/api/app/v1/screens/warm-revalidate-fail'
    const apiFetch = jest
      .fn<Promise<Response>, unknown[]>()
      .mockResolvedValueOnce(jsonResponse({ label: 'known-good' }))
      .mockRejectedValueOnce(new Error('revalidate blip'))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    const first = render(<Probe path={path} />)
    await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('known-good'))
    first.unmount()

    // Revisit paints from cache; the background revalidate then rejects.
    // PINNED AS INTENDED: last-known content stays (same-path-failure-keeps-
    // dto contract now also covers cache-seeded frames — offline-tolerant SWR,
    // the same posture as the recovering-session DataPort). If product ever
    // wants a degraded-state hint here, change this test deliberately.
    render(<Probe path={path} />)
    expect(screen.getByTestId('content').textContent).toBe('known-good')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(screen.getByTestId('content').textContent).toBe('known-good')
    expect(screen.queryByText('somethingWentWrong')).toBeNull()
    expect(apiFetch).toHaveBeenCalledTimes(2)
  })

  it('cap: 51 distinct paths evict the oldest, keeping the newest 50', () => {
    dtoCache.clear()
    for (let i = 0; i < 51; i++) {
      cacheDto(`/api/app/v1/screens/cap-${i}`, { label: `dto-${i}` })
    }
    expect(dtoCache.size).toBe(50)
    expect(dtoCache.has('/api/app/v1/screens/cap-0')).toBe(false)
    expect(dtoCache.has('/api/app/v1/screens/cap-1')).toBe(true)
    expect(dtoCache.has('/api/app/v1/screens/cap-50')).toBe(true)
  })
})

describe('useScreenDto × seed-pending-verification 401 grace window (packet 25 fix F2)', () => {
  afterEach(() => {
    // Local cleanup (this file has no global session-store afterEach) —
    // restore the pristine pre-boot state for the next test.
    setSessionState({ status: 'signed-out' })
    setSessionState({ status: 'recovering' })
  })

  it('a 401 during the seed-pending window holds `loading`, not the error card', async () => {
    seedKnownSession(seedSession('tok-seed', 'u1'))
    const apiFetch = jest.fn<Promise<Response>, unknown[]>().mockResolvedValueOnce(unauthorizedResponse())
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    render(<Probe path="/api/app/v1/screens/probe-401-seed-window" />)
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(screen.getByText('loading')).toBeTruthy()
    expect(screen.queryByText('somethingWentWrong')).toBeNull()
  })

  it('a seed-window 401 on a re-fetch KEEPS already-rendered same-path content (never drops to loading)', async () => {
    seedKnownSession(seedSession('tok-seed', 'u1'))
    const apiFetch = jest
      .fn<Promise<Response>, unknown[]>()
      .mockResolvedValueOnce(jsonResponse({ label: 'seed-good' }))
      .mockResolvedValueOnce(unauthorizedResponse())
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    render(<Probe path="/api/app/v1/screens/probe-401-keeps-dto" />)
    await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('seed-good'))

    // Same-path re-fetch (post-mutation refresh) that 401s inside the window:
    // the rendered dto must survive — a blank loading frame here would be a
    // regression of the same-path-keeps-dto contract.
    act(() => {
      emitRefresh()
    })
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(screen.getByTestId('content').textContent).toBe('seed-good')
    expect(screen.queryByText('loading')).toBeNull()
    expect(screen.queryByText('somethingWentWrong')).toBeNull()
  })

  it('a 401 OUTSIDE the window (a store write already cleared the flag) shows the error card, unchanged', async () => {
    seedKnownSession(seedSession('tok-seed', 'u1'))
    // Any store write clears seedPendingVerification (F2) — simulate the
    // settle having already landed before this fetch's 401 arrives.
    setSessionState({ status: 'signed-in', session: seedSession('tok-seed', 'u1') })
    const apiFetch = jest.fn<Promise<Response>, unknown[]>().mockResolvedValueOnce(unauthorizedResponse())
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    render(<Probe path="/api/app/v1/screens/probe-401-outside-window" />)
    await waitFor(() => expect(screen.getByText('somethingWentWrong')).toBeTruthy())
  })

  it('a NON-401 failure during the seed-pending window still shows the error card, unchanged', async () => {
    seedKnownSession(seedSession('tok-seed', 'u1'))
    const apiFetch = jest
      .fn<Promise<Response>, unknown[]>()
      .mockRejectedValueOnce(new Error('offline blip'))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    render(<Probe path="/api/app/v1/screens/probe-non401-seed-window" />)
    await waitFor(() => expect(screen.getByText('somethingWentWrong')).toBeTruthy())
  })
})
