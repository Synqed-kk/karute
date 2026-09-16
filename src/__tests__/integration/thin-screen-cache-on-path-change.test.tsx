/** @jest-environment jsdom */
/**
 * ⚖ S2b — the screen cache has to answer a PATH CHANGE, not only a mount.
 *
 * Measured on the phone bundle at CPU ×4 against staging BEFORE this: every
 * 日/週/月 tap dimmed the page to 50 % for 551–1023 ms and moved the selected
 * pill only when the round trip landed — on the THIRD identical pass, with that
 * exact view+date already in the cache. Zero blank frames, zero layout shift,
 * zero long tasks: the "flicker" was the page going half strength and snapping
 * back, never a rendering cost.
 */
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'ja',
}))
jest.mock('@/lib/ports/data-port', () => ({
  getDataPort: () => ({ apiFetch: mockFetch }),
}))
const mockFetch = jest.fn()

import { useState } from 'react'
import { act, render, screen } from '@testing-library/react'
import { cacheDto, dtoCache, fetchedAtByPath, useScreenDto } from '../../../thin/screens/ScreenBoundary'

const parse = (raw: unknown) => raw as { n: number }

function Screen({ path }: { path: string }) {
  const { state, fetching } = useScreenDto(path, parse)
  return (
    <div>
      <span data-testid="status">{state.status}</span>
      <span data-testid="n">{state.status === 'ready' ? String(state.dto.n) : '-'}</span>
      <span data-testid="shown-path">{state.status === 'ready' ? state.path : '-'}</span>
      {/* The phone's dim is exactly this condition (AppointmentsScreen). */}
      <span data-testid="dim">
        {fetching && state.status === 'ready' && state.path !== path ? 'dim' : 'clear'}
      </span>
    </div>
  )
}

function Host({ first }: { first: string }) {
  const [path, setPath] = useState(first)
  return (
    <div>
      <button type="button" data-testid="go" onClick={() => setPath('/b')}>
        go
      </button>
      <Screen path={path} />
    </div>
  )
}

/** A fetch that never settles — so a test can prove a paint happened WITHOUT
 *  the network, which is the whole claim. */
function neverSettles() {
  mockFetch.mockImplementation(() => new Promise(() => {}))
}

beforeEach(() => {
  mockFetch.mockReset()
  dtoCache.clear()
  fetchedAtByPath.clear()
})

describe('a path change consults the cache', () => {
  it('paints the cached answer with no round trip at all', async () => {
    cacheDto('/a', { n: 1 })
    cacheDto('/b', { n: 2 })
    neverSettles()
    render(<Host first="/a" />)
    expect(screen.getByTestId('n').textContent).toBe('1')

    await act(async () => {
      screen.getByTestId('go').click()
    })
    // Not one promise has settled, and the new screen is already on.
    expect(screen.getByTestId('n').textContent).toBe('2')
    expect(screen.getByTestId('shown-path').textContent).toBe('/b')
    // …so the page is never dimmed and never taken away.
    expect(screen.getByTestId('dim').textContent).toBe('clear')
    // The revalidate still fires — the cache buys an instant paint, never a
    // skipped read.
    expect(mockFetch).toHaveBeenCalledWith('/b')
  })

  it('a MISS keeps the outgoing screen painted, exactly as before', async () => {
    cacheDto('/a', { n: 1 })
    neverSettles()
    render(<Host first="/a" />)
    await act(async () => {
      screen.getByTestId('go').click()
    })
    expect(screen.getByTestId('n').textContent).toBe('1')
    expect(screen.getByTestId('shown-path').textContent).toBe('/a')
    // …and THAT is the case the dim exists for: the numbers on screen are the
    // ones being navigated away from.
    expect(screen.getByTestId('dim').textContent).toBe('dim')
  })
})

describe('an unchanged answer is not news', () => {
  it('a revalidate bringing back the same payload does not re-render the screen', async () => {
    cacheDto('/a', { n: 1 })
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ n: 1 }) })
    render(<Screen path="/a" />)
    const before = screen.getByTestId('n')
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    // The SAME node — React did not replace the subtree, so nothing repaints
    // and nothing can shift.
    expect(screen.getByTestId('n')).toBe(before)
    expect(screen.getByTestId('n').textContent).toBe('1')
  })

  it('a revalidate bringing back a DIFFERENT payload lands immediately', async () => {
    cacheDto('/a', { n: 1 })
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ n: 7 }) })
    render(<Screen path="/a" />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByTestId('n').textContent).toBe('7')
  })
})
