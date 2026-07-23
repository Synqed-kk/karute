/**
 * @jest-environment jsdom
 *
 * Foreground revalidate (perf packet 29, Liam design directive 7/23). Staff
 * foreground the app dozens of times per shift; today's MOUNTED screen only
 * refetches on a tab-switch remount or a mutation (emitRefresh) — never on a
 * plain app-switch, so a re-foregrounded screen showed stale bookings. This
 * pins bindForegroundRevalidate (thin/data/foreground-revalidate.ts): a
 * quiet swap-not-flash re-fetch of the mounted screen past STALE_MS, the
 * wave-1.5 chrome-degrade re-arm fold-in, and — THE PIN — that an active
 * recording is never disturbed by any of it.
 */
import type { Session } from '@supabase/supabase-js'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { setDataPort } from '@/lib/ports/data-port'
import { setSessionState } from '@/lib/auth/mobile/session-store'
import { globalRecorder } from '@/lib/global-recorder'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

// global-recorder.ts drags these in statically (same seam thin-chrome.test.tsx
// and global-recorder-session-race.test.ts stub) — irrelevant here since this
// file only ever touches `.state` directly, never start()/discard().
jest.mock('@/actions/recordings', () => ({ startRecordingSession: jest.fn() }))
jest.mock('@/lib/karute/take-store', () => ({
  appendTakeSegment: jest.fn(),
  createTake: jest.fn(),
  deleteTake: jest.fn(),
  stampTakeSession: jest.fn(),
}))

import { emitRefresh } from '../../../thin/ports/nav.vite'
import {
  cacheDto,
  dtoCache,
  fetchedAtByPath,
  ScreenStates,
  useScreenDto,
} from '../../../thin/screens/ScreenBoundary'
import { ensureChromeLoaded, getChromeState } from '../../../thin/chrome/chrome-store'
import { bindForegroundRevalidate } from '../../../thin/data/foreground-revalidate'
import type { ChromeScreenDTOType } from '@/lib/app-api/chrome-dto'

const parse = (raw: unknown): { label: string } => raw as { label: string }

function Probe({ path }: { path: string }) {
  const { state, retry } = useScreenDto(path, parse)
  return (
    <ScreenStates state={state} retry={retry}>
      {(dto) => <div data-testid="content">{dto.label}</div>}
    </ScreenStates>
  )
}

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response
}

const CHROME_DTO: ChromeScreenDTOType = {
  staffId: 's1',
  nextCustomer: null,
  notifications: [],
  stores: [],
  activeStoreId: null,
}

const session = (token: string): Session =>
  ({ access_token: token, user: { id: 'u1' } }) as Session

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

// Bound ONCE for the whole file (mirrors production: main.tsx calls this a
// single time for the page's lifetime — the listener is deliberately never
// removed).
bindForegroundRevalidate()

afterEach(() => {
  cleanup()
  // Two-step reset (established codebase idiom): the signed-out flip clears
  // ScreenBoundary's dtoCache/fetchedAtByPath AND resets chrome-store to idle.
  setSessionState({ status: 'signed-out' })
  setSessionState({ status: 'recovering' })
  globalRecorder.state = 'idle'
})

describe('bindForegroundRevalidate — mounted screen', () => {
  it('reopen after hours: exactly ONE swap-not-flash refetch, never a loading frame', async () => {
    let resolveSecond: (r: Response) => void = () => {}
    const apiFetch = jest
      .fn<Promise<Response>, unknown[]>()
      .mockResolvedValueOnce(jsonResponse({ label: 'v1' }))
      .mockImplementationOnce(() => new Promise<Response>((res) => (resolveSecond = res)))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    const path = '/api/app/v1/screens/fg-reopen'
    render(<Probe path={path} />)
    await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('v1'))

    // Simulate "reopened after hours": the stamp is long past STALE_MS.
    fetchedAtByPath.set(path, 0)

    act(() => setVisibility('visible'))
    expect(apiFetch).toHaveBeenCalledTimes(2)
    // Swap-not-flash: still 'ready' with the old content, no loading frame.
    expect(screen.queryByText('loading')).toBeNull()
    expect(screen.getByTestId('content').textContent).toBe('v1')

    act(() => resolveSecond(jsonResponse({ label: 'v2' })))
    await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('v2'))
  })

  it('rapid app-switch: two visible events inside STALE_MS cost zero extra fetches', async () => {
    const apiFetch = jest
      .fn<Promise<Response>, unknown[]>()
      .mockResolvedValueOnce(jsonResponse({ label: 'v1' }))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    const path = '/api/app/v1/screens/fg-rapid'
    render(<Probe path={path} />)
    await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('v1'))

    // Freshly stamped at mount — well inside STALE_MS.
    act(() => setVisibility('visible'))
    act(() => setVisibility('visible'))
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('content').textContent).toBe('v1')
  })

  it('offline reopen: a stale + rejected revalidate keeps the rendered dto, no error card', async () => {
    const apiFetch = jest
      .fn<Promise<Response>, unknown[]>()
      .mockResolvedValueOnce(jsonResponse({ label: 'v1' }))
      .mockRejectedValueOnce(new Error('offline blip'))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    const path = '/api/app/v1/screens/fg-offline'
    render(<Probe path={path} />)
    await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('v1'))
    fetchedAtByPath.set(path, 0)

    await act(async () => {
      setVisibility('visible')
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(apiFetch).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('content').textContent).toBe('v1')
    expect(screen.queryByText('somethingWentWrong')).toBeNull()
  })

  it("THE PIN — recording/paused/recorded: zero screen fetches, chrome NOT re-armed, nothing emitted", async () => {
    setSessionState({ status: 'signed-in', session: session('tok') })
    const apiFetch = jest.fn<Promise<Response>, unknown[]>().mockImplementation(async (...args) =>
      String(args[0]).startsWith('/api/app/v1/screens/chrome')
        ? jsonResponse({ data: CHROME_DTO })
        : jsonResponse({ label: 'v1' }),
    )
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    const path = '/api/app/v1/screens/fg-recording-pin'
    render(<Probe path={path} />)
    await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('v1'))
    fetchedAtByPath.set(path, 0) // stale — the ONLY thing that should stop the refetch is the recorder gate
    expect(apiFetch).toHaveBeenCalledTimes(1) // just the mount fetch so far

    for (const takeState of ['recording', 'paused', 'recorded'] as const) {
      globalRecorder.state = takeState
      act(() => setVisibility('visible'))
      expect(apiFetch).toHaveBeenCalledTimes(1) // still just the mount fetch
      expect(getChromeState().status).toBe('idle') // ensureChromeLoaded never reached
      expect(screen.getByTestId('content').textContent).toBe('v1')
    }

    // Proves the flat counts above were the gate, not a broken harness: idle
    // lets the SAME stale stamp through immediately.
    globalRecorder.state = 'idle'
    act(() => setVisibility('visible'))
    await waitFor(() => expect(apiFetch.mock.calls.length).toBeGreaterThan(1))
    expect(getChromeState().status).not.toBe('idle')
  })

  it('chrome re-arm: an error-state chrome store retries on foreground (recorder idle)', async () => {
    setSessionState({ status: 'signed-in', session: session('tok') })
    const apiFetch = jest
      .fn<Promise<Response>, unknown[]>()
      .mockRejectedValueOnce(new Error('chrome 500'))
      .mockResolvedValueOnce(jsonResponse({ data: CHROME_DTO }))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await act(async () => {
      ensureChromeLoaded()
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(getChromeState().status).toBe('error')

    await act(async () => {
      setVisibility('visible')
      await new Promise((r) => setTimeout(r, 0))
    })
    const chromeCalls = apiFetch.mock.calls.filter(([p]) =>
      String(p).startsWith('/api/app/v1/screens/chrome'),
    )
    expect(chromeCalls.length).toBe(2)
    expect(getChromeState().status).toBe('ready')
  })

  it('cold open: bind + fire visible before any screen subscribes — no throw, no fetch', () => {
    const apiFetch = jest.fn<Promise<Response>, unknown[]>()
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
    // Default session ('recovering', no known session) → chrome is unmounted;
    // no Probe rendered → zero revalidate subscribers.
    expect(() => setVisibility('visible')).not.toThrow()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('hidden: a visibilitychange to hidden is a no-op', async () => {
    const apiFetch = jest.fn<Promise<Response>, unknown[]>().mockResolvedValueOnce(jsonResponse({ label: 'v1' }))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    const path = '/api/app/v1/screens/fg-hidden'
    render(<Probe path={path} />)
    await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('v1'))
    fetchedAtByPath.set(path, 0)

    act(() => setVisibility('hidden'))
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('content').textContent).toBe('v1')
  })
})

describe('fetchedAtByPath hygiene — mirrors dtoCache 1:1', () => {
  it('cap eviction deletes the stamp along with the oldest cache entry', () => {
    dtoCache.clear()
    fetchedAtByPath.clear()
    for (let i = 0; i < 51; i++) {
      cacheDto(`/api/app/v1/screens/fg-cap-${i}`, { label: `dto-${i}` })
    }
    expect(fetchedAtByPath.size).toBe(50)
    expect(fetchedAtByPath.has('/api/app/v1/screens/fg-cap-0')).toBe(false)
    expect(fetchedAtByPath.has('/api/app/v1/screens/fg-cap-1')).toBe(true)
    expect(fetchedAtByPath.has('/api/app/v1/screens/fg-cap-50')).toBe(true)
  })

  it('retry() clears the stamp along with the cache entry', async () => {
    const path = '/api/app/v1/screens/fg-retry'
    const apiFetch = jest
      .fn<Promise<Response>, unknown[]>()
      .mockRejectedValueOnce(new Error('boot fail'))
      .mockResolvedValueOnce(jsonResponse({ label: 'fresh' }))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    render(<Probe path={path} />)
    await waitFor(() => expect(screen.getByText('somethingWentWrong')).toBeTruthy())
    fetchedAtByPath.set(path, 12345)

    act(() => {
      screen.getByText('retry').click()
    })
    expect(fetchedAtByPath.has(path)).toBe(false)
    await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('fresh'))
  })

  it('subscribeRefresh handler (emitRefresh) clears the WHOLE fetchedAtByPath map too', async () => {
    const pathA = '/api/app/v1/screens/fg-refresh-a'
    const pathB = '/api/app/v1/screens/fg-refresh-b'
    setDataPort({
      apiFetch: jest.fn<Promise<Response>, unknown[]>().mockResolvedValueOnce(jsonResponse({ label: 'b1' })),
    } as unknown as Parameters<typeof setDataPort>[0])
    const probeB = render(<Probe path={pathB} />)
    await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('b1'))
    probeB.unmount()
    expect(fetchedAtByPath.has(pathB)).toBe(true)

    let resolveSecondA: (r: Response) => void = () => {}
    setDataPort({
      apiFetch: jest
        .fn<Promise<Response>, unknown[]>()
        .mockResolvedValueOnce(jsonResponse({ label: 'a1' }))
        .mockImplementationOnce(() => new Promise<Response>((res) => (resolveSecondA = res))),
    } as unknown as Parameters<typeof setDataPort>[0])
    render(<Probe path={pathA} />)
    await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('a1'))

    act(() => emitRefresh())
    expect(fetchedAtByPath.has(pathB)).toBe(false)
    act(() => resolveSecondA(jsonResponse({ label: 'a2' })))
    await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('a2'))
  })

  it('signed-out clears fetchedAtByPath along with dtoCache', async () => {
    const path = '/api/app/v1/screens/fg-signout'
    setDataPort({
      apiFetch: jest.fn<Promise<Response>, unknown[]>().mockResolvedValueOnce(jsonResponse({ label: 'dto1' })),
    } as unknown as Parameters<typeof setDataPort>[0])
    const probe = render(<Probe path={path} />)
    await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('dto1'))
    probe.unmount()
    expect(fetchedAtByPath.has(path)).toBe(true)

    setSessionState({ status: 'signed-out' })
    expect(fetchedAtByPath.has(path)).toBe(false)
    expect(dtoCache.has(path)).toBe(false)
    setSessionState({ status: 'recovering' })
  })
})
