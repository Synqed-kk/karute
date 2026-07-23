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
import { act, render, screen, waitFor } from '@testing-library/react'
import { setDataPort } from '@/lib/ports/data-port'
import { setSessionState } from '@/lib/auth/mobile/session-store'
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

    // Outgoing user signs out while the fetch is still on the wire; the app
    // unmounts the screen (AuthGate swaps to login) and the cache wipes.
    probe.unmount()
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
