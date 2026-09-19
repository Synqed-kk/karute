/**
 * @jest-environment jsdom
 *
 * G-1 fold (Greptile, 2026-09-16) — the component half of the recovery story:
 * `AuthGate` wires the shared `UnassignedStoreScreen`'s 「もう一度確認する」
 * button to `recheckStoreUnassigned`, and re-probes automatically when the app
 * returns to the foreground. `thin-unassigned-gate.test.ts` pins the store
 * module itself (clearStoreUnassigned/recheckStoreUnassigned in isolation);
 * this file drives the REAL AuthGate + REAL UnassignedStoreScreen together, so
 * the wiring — not just the pieces — is under test.
 */
import type { Session } from '@supabase/supabase-js'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { setSessionState } from '@/lib/auth/mobile/session-store'
import { setDataPort } from '@/lib/ports/data-port'
import { AuthGate } from '../../../thin/AuthGate'
import {
  markStoreUnassigned,
  resetStoreUnassigned,
  unassignedUserId,
} from '../../../thin/chrome/store-unassigned'

jest.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => {
    const messages = jest.requireActual<Record<string, Record<string, string>>>(
      '../../../messages/ja.json',
    )
    return messages[ns]?.[key] ?? key
  },
  useLocale: () => 'ja',
}))

jest.mock('../../../thin/screens/LoginScreen', () => ({
  LoginScreen: () => <div data-testid="login-screen" />,
}))
jest.mock('@/components/recording/ProcessingIndicator', () => ({
  ProcessingIndicator: () => null,
}))
jest.mock('@/components/recording/DiscreetRecordingIndicator', () => ({
  DiscreetRecordingIndicator: () => null,
}))
jest.mock('../../../thin/probe/marks', () => ({
  ...jest.requireActual('../../../thin/probe/marks'),
  mark: jest.fn(),
}))

const signOut = jest.fn(async () => ({ error: null }))
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signOut: () => signOut() } }),
}))
const wipeSessionVault = jest.fn(async () => {})
jest.mock('@/lib/karute/logout-wipe', () => ({
  wipeSessionVault: () => wipeSessionVault(),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))

const session = (userId: string) =>
  ({ access_token: 'tok', user: { id: userId } }) as unknown as Session

// jsdom's test environment has no global Response (unlike the plain node
// environment the rest of this file's siblings run under) — `probeStoreAssignment`
// only ever reads `.ok`, so a duck-typed stub is all this needs.
const ok = () => ({ ok: true, status: 200 }) as Response
const refused = () => ({ ok: false, status: 403 }) as Response

beforeEach(() => {
  resetStoreUnassigned()
  setSessionState({ status: 'signed-in', session: session('u1') })
})

afterEach(() => {
  setSessionState({ status: 'signed-out' })
  setSessionState({ status: 'recovering' })
})

describe('AuthGate — the honest screen renders and wires the recheck', () => {
  it('an unassigned signed-in user sees the screen, with the primary recheck action', () => {
    markStoreUnassigned('u1')
    render(
      <AuthGate>
        <div data-testid="app" />
      </AuthGate>,
    )
    expect(screen.queryByTestId('app')).toBeNull()
    expect(screen.getByText('担当店舗が未設定です')).toBeTruthy()
    expect(screen.getByText('もう一度確認する')).toBeTruthy()
  })

  it('probe succeeds → the mark clears and the app shell renders', async () => {
    const apiFetch = jest.fn(async () => ok())
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
    markStoreUnassigned('u1')
    render(
      <AuthGate>
        <div data-testid="app" />
      </AuthGate>,
    )
    await act(async () => {
      fireEvent.click(screen.getByText('もう一度確認する'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(apiFetch).toHaveBeenCalledWith('/api/app/v1/screens/chrome')
    expect(unassignedUserId()).toBeNull()
    expect(screen.getByTestId('app')).toBeTruthy()
  })

  it('probe still refuses (403) → the mark stays, the screen stays', async () => {
    const apiFetch = jest.fn(async () => refused())
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
    markStoreUnassigned('u1')
    render(
      <AuthGate>
        <div data-testid="app" />
      </AuthGate>,
    )
    await act(async () => {
      fireEvent.click(screen.getByText('もう一度確認する'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(unassignedUserId()).toBe('u1')
    expect(screen.queryByTestId('app')).toBeNull()
    // The button is usable again — not stuck disabled on a failed recheck.
    expect(screen.getByText('もう一度確認する')).not.toBeDisabled()
  })

  it('the probe rejecting (network error) → the mark stays', async () => {
    const apiFetch = jest.fn(async () => {
      throw new Error('offline')
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
    markStoreUnassigned('u1')
    render(
      <AuthGate>
        <div data-testid="app" />
      </AuthGate>,
    )
    await act(async () => {
      fireEvent.click(screen.getByText('もう一度確認する'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(unassignedUserId()).toBe('u1')
    expect(screen.queryByTestId('app')).toBeNull()
  })

  it('foreground recheck fires once — a visibilitychange burst is throttled', async () => {
    const apiFetch = jest.fn(async () => ok())
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
    markStoreUnassigned('u1')
    render(
      <AuthGate>
        <div data-testid="app" />
      </AuthGate>,
    )
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      document.dispatchEvent(new Event('visibilitychange'))
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(apiFetch).toHaveBeenCalledTimes(1)
    // The first probe already cleared the mark, so the app shell is up.
    expect(screen.getByTestId('app')).toBeTruthy()
  })

  it('an ASSIGNED user (no mark) never sees the screen — unchanged', () => {
    render(
      <AuthGate>
        <div data-testid="app" />
      </AuthGate>,
    )
    expect(screen.getByTestId('app')).toBeTruthy()
    expect(screen.queryByText('担当店舗が未設定です')).toBeNull()
  })
})
