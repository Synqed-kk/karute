/** @jest-environment jsdom */
// ContentErrorBoundary (white-screen insurance, field report 2026-07-28):
// wraps ONLY <ThinRouter/> (thin/main.tsx, inside ThinChromeContent), keyed
// by pathname (thin/ports/nav.vite's usePathname) so navigating to another
// tab remounts the boundary — clearing the caught error AND remounting the
// crashed subtree, the auto-recovery Liam actually used in the field. Pins:
// a render throw shows the recovery card + logs via the stable
// [thin-boundary] prefix; a pathname change remounts children (recovery).
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ContentErrorBoundary } from '../../../thin/ContentErrorBoundary'
import { useRouter, usePathname } from '../../../thin/ports/nav.vite'

function Thrower(): null {
  throw new Error('boom')
}

// Throws only while mounted at '/settings' — mirrors the real shape of the
// bug (one screen's render crashes; a DIFFERENT screen mounted after
// navigating away is a different component that doesn't).
function PathAwareThrower() {
  const pathname = usePathname()
  if (pathname === '/settings') throw new Error('boom')
  return <div data-testid="ok-screen">{pathname}</div>
}

describe('ContentErrorBoundary (thin white-screen insurance, 2026-07-28)', () => {
  const originalError = console.error
  afterEach(() => {
    console.error = originalError
    history.replaceState({}, '', '/')
  })

  it('a render throw shows the recovery card and logs via the stable [thin-boundary] prefix', () => {
    const spy = jest.fn()
    console.error = spy
    render(
      <ContentErrorBoundary>
        <Thrower />
      </ContentErrorBoundary>,
    )
    expect(screen.getByText('画面の表示に失敗しました')).toBeTruthy()
    expect(screen.getByText('再読み込み')).toBeTruthy()
    expect(spy).toHaveBeenCalledWith('[thin-boundary]', expect.any(Error))
  })

  it('navigating to another pathname remounts the boundary — the crash clears and the new screen renders', () => {
    history.replaceState({}, '', '/settings')
    render(
      <ContentErrorBoundary>
        <PathAwareThrower />
      </ContentErrorBoundary>,
    )
    expect(screen.getByText('画面の表示に失敗しました')).toBeTruthy()

    act(() => {
      useRouter().push('/dashboard')
    })

    // New pathname → new `key` → the OLD (errored) Boundary instance is torn
    // down and a fresh one mounts; PathAwareThrower remounts fresh too and,
    // at this pathname, doesn't throw — proving both the boundary's own
    // state AND its children actually remounted, not just re-rendered.
    expect(screen.queryByText('画面の表示に失敗しました')).toBeNull()
    expect(screen.getByTestId('ok-screen').textContent).toBe('/dashboard')
  })

  it('再読み込み performs a REAL reload (Greptile #637 P1: a state reset would just re-render the same crashed subtree)', () => {
    console.error = jest.fn()
    render(
      <ContentErrorBoundary>
        <Thrower />
      </ContentErrorBoundary>,
    )
    // Swap location AFTER render (usePathname read the real one at mount);
    // jsdom's own reload is unimplemented, so the spy doubles as a guard.
    const original = window.location
    const reloadSpy = jest.fn()
    Object.defineProperty(window, 'location', {
      value: { ...original, pathname: original.pathname, reload: reloadSpy },
      configurable: true,
    })
    try {
      fireEvent.click(screen.getByText('再読み込み'))
      expect(reloadSpy).toHaveBeenCalledTimes(1)
      // A state-reset implementation would re-render the crashed subtree and
      // land back on the card WITHOUT reloading — the spy assertion above is
      // what discriminates (red-run-proven).
    } finally {
      Object.defineProperty(window, 'location', { value: original, configurable: true })
    }
  })
})
