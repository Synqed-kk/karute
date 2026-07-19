/**
 * @jest-environment jsdom
 *
 * AuthGate native-splash handshake (launch-flash fix): the entry used to
 * release the splash on the unconditional first paint, which on every cold
 * boot is the boot gate's full-screen 読み込み中 frame — a visible flash
 * between splash and content. These pin the new contract: hold while the boot
 * gate is unresolved, release on the first COMMIT of a resolved state (login,
 * app, or an offline resume with a known session — the AuthGate's mounted
 * case, which must keep releasing).
 */
import type { Session } from '@supabase/supabase-js'
import { act, render, screen } from '@testing-library/react'
import { setSessionState } from '@/lib/auth/mobile/session-store'
import { AuthGate } from '../../../thin/AuthGate'

// next-intl's react-client entry ships production ESM that CI's node 20 jest
// can't parse untransformed (local node 24 masks it via require(esm)). Feed
// the hook the REAL ja.json values so the 読み込み中 assertion stays honest.
jest.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => {
    const messages = jest.requireActual<Record<string, Record<string, string>>>(
      '../../../messages/ja.json',
    )
    return messages[ns]?.[key] ?? key
  },
}))

// LoginScreen pulls the mobile-auth singleton (thin env → import.meta, which
// jest can't parse). The gate/splash contract under test only needs to know
// WHICH branch rendered, not the real form.
jest.mock('../../../thin/screens/LoginScreen', () => ({
  LoginScreen: () => <div data-testid="login-screen" />,
}))

// jsdom 20 has no user-timing API — spy on the marks module instead, which is
// also the sharper pin: the gate MARKS the reveal, whatever performance does.
jest.mock('../../../thin/probe/marks', () => ({
  ...jest.requireActual('../../../thin/probe/marks'),
  mark: jest.fn(),
}))

import { mark, MARKS } from '../../../thin/probe/marks'

type CapWindow = Window & {
  Capacitor?: { Plugins?: { SplashScreen?: { hide?: () => void } } }
}

const hide = jest.fn()
const session = (token: string) => ({ access_token: token }) as Session

beforeEach(() => {
  hide.mockClear()
  ;(window as CapWindow).Capacitor = { Plugins: { SplashScreen: { hide } } }
  // Collapse the double-rAF release to synchronous so assertions are
  // deterministic — the two-frame delay is a paint-timing detail, not the
  // contract under test.
  window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    cb(0)
    return 0
  }
  ;(mark as jest.Mock).mockClear()
})

afterEach(() => {
  // Two-step on purpose (see thin-bottom-nav.test.tsx): only an explicit
  // signed-out clears the store's lastSession — recovering alone keeps it,
  // by design (offline resume).
  setSessionState({ status: 'signed-out' })
  setSessionState({ status: 'recovering' })
})

describe('AuthGate splash handshake (launch-flash fix)', () => {
  it('holds the splash while the boot gate is unresolved (cold boot)', () => {
    render(
      <AuthGate>
        <div data-testid="app" />
      </AuthGate>,
    )
    // The loading frame paints (under the splash) — but no release.
    expect(screen.getByText('読み込み中...')).toBeTruthy()
    expect(screen.queryByTestId('app')).toBeNull()
    expect(hide).not.toHaveBeenCalled()
  })

  it('releases on the first commit of the login screen (resolves signed-out)', () => {
    render(
      <AuthGate>
        <div data-testid="app" />
      </AuthGate>,
    )
    expect(hide).not.toHaveBeenCalled()
    act(() => setSessionState({ status: 'signed-out' }))
    expect(screen.getByTestId('login-screen')).toBeTruthy()
    expect(hide).toHaveBeenCalledTimes(1)
    // The reveal is marked for the on-device probe story (firstPixel keeps
    // measuring the raw first paint, which now lands under the splash).
    expect(mark).toHaveBeenCalledWith(MARKS.splashReleased)
  })

  it('releases on the first commit of the app (resolves signed-in)', () => {
    render(
      <AuthGate>
        <div data-testid="app" />
      </AuthGate>,
    )
    expect(hide).not.toHaveBeenCalled()
    act(() => setSessionState({ status: 'signed-in', session: session('tok') }))
    expect(screen.getByTestId('app')).toBeTruthy()
    expect(hide).toHaveBeenCalledTimes(1)
  })

  it('offline resume (recovering WITH a known session): app mounted, splash still releases', () => {
    setSessionState({ status: 'signed-in', session: session('tok') })
    setSessionState({ status: 'recovering' })
    render(
      <AuthGate>
        <div data-testid="app" />
      </AuthGate>,
    )
    expect(screen.getByTestId('app')).toBeTruthy()
    expect(hide).toHaveBeenCalledTimes(1)
  })
})
