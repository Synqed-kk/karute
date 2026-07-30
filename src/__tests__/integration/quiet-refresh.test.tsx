/**
 * @jest-environment jsdom
 *
 * <QuietRefresh> is the half of the SWR screen delivery that makes the long
 * staleTimes window honest, so its ONE branch — "is the copy the router served
 * older than the freshness window?" — is pinned here.
 *
 * What must hold:
 *  - a FRESH copy never refreshes (no server work on a quick revisit)
 *  - a STALE copy refreshes exactly once (the quiet correction)
 *  - a hidden tab never refreshes (no work for a screen nobody is looking at)
 *  - a re-render with the SAME stamp never fires a second refresh (refresh-loop
 *    guard — a loop here would hammer the function on every prod pageview)
 */
import { render, act } from '@testing-library/react'
import { QuietRefresh } from '@/components/perf/QuietRefresh'

const refresh = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: (...a: unknown[]) => refresh(...a) }),
}))

/** Matches FRESH_MS in QuietRefresh.tsx. */
const FRESH_MS = 25_000

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  })
}

beforeEach(() => {
  refresh.mockClear()
  setVisibility('visible')
})

describe('QuietRefresh', () => {
  it('does NOT refresh a copy inside the freshness window', () => {
    render(<QuietRefresh renderedAt={Date.now() - (FRESH_MS - 5_000)} />)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refreshes a copy older than the freshness window', () => {
    render(<QuietRefresh renderedAt={Date.now() - (FRESH_MS + 5_000)} />)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does NOT refresh while the tab is hidden', () => {
    setVisibility('hidden')
    render(<QuietRefresh renderedAt={Date.now() - (FRESH_MS + 60_000)} />)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('fires at most once per mount even if the stamp never advances', () => {
    // The refresh-loop guard: a server that came back with an unchanged stamp
    // must not re-trigger the effect forever.
    const stale = Date.now() - (FRESH_MS + 5_000)
    const { rerender } = render(<QuietRefresh renderedAt={stale} />)
    act(() => {
      rerender(<QuietRefresh renderedAt={stale} />)
      rerender(<QuietRefresh renderedAt={stale} />)
    })
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
