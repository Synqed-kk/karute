/** @jest-environment jsdom */
// Sign-out delegate (design-parity packet 12 §B-2 — the binary's FIRST
// in-app sign-out): thin/ports/supabase-client.stub.ts's `auth.signOut` used
// to be MISSING entirely (TypeError today), so ProfilePageView's
// handleSignOut (createClient().auth.signOut()) would throw and the
// sign-out button silently no-op behind its own try/catch. Pins:
//   (1) the stub delegates to getMobileAuth().signOut() exactly once — the
//       remote-revoke + ALWAYS-purge-locally composition itself is already
//       covered by mobile-client-session.test.ts's sign-out-adapter suite
//       (session-lifecycle.ts's signOutAndPurge), not re-proven here.
//   (2) the SIGNED_OUT outcome that a real signOut produces (via the
//       onAuthStateChange listener wired in thin/auth/session.ts) flips the
//       AuthGate to a sane LoginScreen — no error screen, no dead route —
//       exercised end-to-end from the stub delegate call.
import type { Session } from '@supabase/supabase-js'
import { act, render, screen } from '@testing-library/react'
import { setSessionState } from '@/lib/auth/mobile/session-store'

const signOut = jest.fn(async () => {
  // Reproduces only the OBSERVABLE store effect a real getMobileAuth()
  // .signOut() produces via its onAuthStateChange(SIGNED_OUT) listener —
  // that composition (remote revoke, unconditional local purge) is real
  // production code covered elsewhere (see file header); faking it here
  // keeps this suite offline while still exercising the UI contract below.
  setSessionState({ status: 'signed-out' })
  return { remoteOk: true }
})
jest.mock('../../../thin/auth/session', () => ({
  getMobileAuth: () => ({ signOut }),
}))

// Same stub-away as thin-splash-gate.test.tsx: LoginScreen pulls the
// mobile-auth singleton through a path this suite already mocks above, but
// stubbing it here keeps the assertion about ROUTING (did the gate land on
// login?), not the form's internals.
jest.mock('../../../thin/screens/LoginScreen', () => ({
  LoginScreen: () => <div data-testid="login-screen" />,
}))
// next-intl's react-client entry ships production ESM that jest's CJS
// transform can't parse (AuthGate's tree pulls it in via ScreenBoundary) —
// same fix thin-splash-gate.test.tsx uses: feed the hook the real ja.json.
jest.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => {
    const messages = jest.requireActual<Record<string, Record<string, string>>>(
      '../../../messages/ja.json',
    )
    return messages[ns]?.[key] ?? key
  },
}))
jest.mock('@/components/recording/ProcessingIndicator', () => ({
  ProcessingIndicator: () => null,
}))
jest.mock('@/components/recording/DiscreetRecordingIndicator', () => ({
  DiscreetRecordingIndicator: () => null,
}))

import { createClient } from '../../../thin/ports/supabase-client.stub'
import { AuthGate } from '../../../thin/AuthGate'

afterEach(() => {
  // Two-step, same as thin-splash-gate.test.tsx: only an explicit
  // signed-out clears the store's lastSession.
  setSessionState({ status: 'signed-out' })
  setSessionState({ status: 'recovering' })
})

describe('thin supabase-client.stub — auth.signOut delegate', () => {
  it('calls getMobileAuth().signOut() exactly once', async () => {
    signOut.mockClear()
    const result = await createClient().auth.signOut()
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ error: null })
  })

  it('the SIGNED_OUT outcome flips the AuthGate to a sane LoginScreen — no error screen, no dead route', async () => {
    signOut.mockClear()
    setSessionState({ status: 'signed-in', session: { access_token: 'tok' } as Session })
    render(
      <AuthGate>
        <div data-testid="app" />
      </AuthGate>,
    )
    expect(screen.getByTestId('app')).toBeTruthy()
    expect(screen.queryByTestId('login-screen')).toBeNull()

    await act(async () => {
      await createClient().auth.signOut()
    })

    expect(signOut).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('app')).toBeNull()
    expect(screen.getByTestId('login-screen')).toBeTruthy()
  })
})
