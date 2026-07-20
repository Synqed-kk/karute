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
import { useRouter } from '../../../thin/ports/nav.vite'
import { ScreenStates, useScreenDto } from '../../../thin/screens/ScreenBoundary'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

const parse = (raw: unknown): { label: string } => raw as { label: string }

function Probe() {
  const { state, retry } = useScreenDto('/api/app/v1/screens/probe', parse)
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

    render(<Probe />)
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

    render(<Probe />)
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

    render(<Probe />)
    await waitFor(() => expect(screen.getByText('somethingWentWrong')).toBeTruthy())

    await act(async () => {
      screen.getByText('retry').click()
    })
    await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('v1'))
  })
})
