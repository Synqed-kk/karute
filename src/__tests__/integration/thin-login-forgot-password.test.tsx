/**
 * @jest-environment jsdom
 *
 * Thin-shell forgot-password sub-view (2026-08-11 packet). LoginScreen has no
 * router in the thin target (thin-splash-gate.test.tsx's own comment: the
 * gate under test only needs to know WHICH branch rendered, not the real
 * form) — this suite is the real-form counterpart, pinning the sub-view
 * itself: link → forgot view → resetPasswordForEmail with the exact
 * redirectTo → sent view, plus the generic anti-enumeration error branch.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { setSessionState } from '@/lib/auth/mobile/session-store'
// REAL (unmocked) here — only thin/auth/session.ts (the thin-specific
// wrapper) is mocked below, not the underlying library. Used by the
// flow-type pin test at the bottom of this file.
import { createMobileAuth } from '@/lib/auth/mobile/client-session'

// thin/locale mocked (mutable var, defaults 'ja' so every EXISTING test
// below — including the redirectTo pin, which reads getThinLocale() the
// SAME way LoginScreen itself does — is unaffected): 2026-08-11 packet §3
// D.1 armor fix needs an en-seeded variant of that pin, and an
// isolateModulesAsync fresh-registry reload of a REACT COMPONENT (tried
// first) duplicates React itself — the freshly-loaded LoginScreen's hooks
// then dispatch against a DIFFERENT react instance than
// @testing-library/react's renderer holds ("Cannot read properties of null
// (reading 'useState')"). Flipping this mock is the safe way to change what
// getThinLocale() returns without reloading the component tree.
let mockLocale: 'ja' | 'en' = 'ja'
jest.mock('../../../thin/locale', () => ({
  getThinLocale: () => mockLocale,
  setThinLocale: jest.fn(),
}))
import { getThinLocale } from '../../../thin/locale'

// Same real-ja.json feed as thin-splash-gate.test.tsx — keeps copy assertions
// honest against the actual bundled strings instead of raw keys.
jest.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => {
    const messages = jest.requireActual<Record<string, Record<string, string>>>(
      '../../../messages/ja.json',
    )
    return messages[ns]?.[key] ?? key
  },
}))

// thin/env.ts reads import.meta.env (Vite-only) — jest can't parse that
// untransformed, same reason thin-auth-session-rotation.test.ts mocks it.
jest.mock('../../../thin/env', () => ({
  getThinEnv: () => ({ facadeUrl: 'https://karute.synqed.jp' }),
}))

// thin/auth/session.ts transitively pulls the same import.meta env chain via
// createMobileAuth/config — mock the module boundary LoginScreen actually
// calls through, same idiom as thin-auth-session-rotation.test.ts.
const resetPasswordForEmail = jest.fn()
const signInWithPassword = jest.fn()
jest.mock('../../../thin/auth/session', () => ({
  getMobileAuth: () => ({
    auth: { resetPasswordForEmail, signInWithPassword },
  }),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { LoginScreen } = require('../../../thin/screens/LoginScreen') as
  typeof import('../../../thin/screens/LoginScreen')

beforeEach(() => {
  resetPasswordForEmail.mockReset()
  signInWithPassword.mockReset()
  mockLocale = 'ja'
})

/** Controlled unresolved promise — lets a test hold an auth call pending,
 *  navigate, and only then decide how it resolves (fix round: race tests). */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

afterEach(() => {
  // Two-step, same as thin-splash-gate.test.tsx: only an explicit signed-out
  // clears the store's lastSession.
  setSessionState({ status: 'signed-out' })
  setSessionState({ status: 'recovering' })
})

describe('LoginScreen — forgot-password sub-view', () => {
  it('renders the forgotPassword link on the sign-in view', () => {
    render(<LoginScreen />)
    expect(screen.getByText('パスワードをお忘れですか？')).toBeInTheDocument()
  })

  it('switches to the forgot sub-view on click, and back on backToLogin', () => {
    render(<LoginScreen />)
    fireEvent.click(screen.getByText('パスワードをお忘れですか？'))

    expect(screen.getByText('パスワード再設定')).toBeInTheDocument() // resetTitle
    expect(screen.queryByLabelText('パスワード')).not.toBeInTheDocument() // password field gone

    fireEvent.click(screen.getByText('サインインに戻る')) // backToLogin
    expect(screen.getByText('サインインして続行')).toBeInTheDocument() // subtitle
    expect(screen.getByLabelText('パスワード')).toBeInTheDocument()
  })

  it('submit calls resetPasswordForEmail with the exact prod-web redirectTo, then shows the sent view', async () => {
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })
    render(<LoginScreen />)
    fireEvent.click(screen.getByText('パスワードをお忘れですか？'))

    fireEvent.change(screen.getByLabelText('メールアドレス'), {
      target: { value: 'staff@example.com' },
    })
    await act(async () => {
      fireEvent.click(screen.getByText('再設定リンクを送信')) // resetSubmit
    })

    expect(resetPasswordForEmail).toHaveBeenCalledWith('staff@example.com', {
      redirectTo: `https://karute.synqed.jp/${getThinLocale()}/reset-password/confirm`,
    })
    expect(screen.getByText('メールを送信しました')).toBeInTheDocument() // resetSentTitle
  })

  it('en-seeded boot: redirectTo carries /en/, not a ja echo (armor fix — the pin above evaluates ja on BOTH sides by default, so it would still pass a hardcoded ja literal in LoginScreen.tsx)', async () => {
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })
    mockLocale = 'en'
    render(<LoginScreen />)
    fireEvent.click(screen.getByText('パスワードをお忘れですか？'))
    fireEvent.change(screen.getByLabelText('メールアドレス'), {
      target: { value: 'staff@example.com' },
    })
    await act(async () => {
      fireEvent.click(screen.getByText('再設定リンクを送信'))
    })
    expect(resetPasswordForEmail).toHaveBeenCalledWith('staff@example.com', {
      redirectTo: 'https://karute.synqed.jp/en/reset-password/confirm',
    })
  })

  it('prefills the forgot email from whatever was typed in the sign-in email field', async () => {
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })
    render(<LoginScreen />)
    fireEvent.change(screen.getByLabelText('メールアドレス'), {
      target: { value: 'seeded@example.com' },
    })
    fireEvent.click(screen.getByText('パスワードをお忘れですか？'))

    expect(screen.getByLabelText('メールアドレス')).toHaveValue('seeded@example.com')
  })

  it('a resetPasswordForEmail error shows the generic anti-enumeration copy, not a raw/specific message', async () => {
    resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: { message: 'over_email_send_rate_limit' },
    })
    render(<LoginScreen />)
    fireEvent.click(screen.getByText('パスワードをお忘れですか？'))
    fireEvent.change(screen.getByLabelText('メールアドレス'), {
      target: { value: 'staff@example.com' },
    })
    await act(async () => {
      fireEvent.click(screen.getByText('再設定リンクを送信'))
    })

    expect(screen.getByRole('alert')).toHaveTextContent(
      '送信に失敗しました。しばらくしてからもう一度お試しください。', // resetErrorGeneric
    )
    // Still on the forgot view, not sent — the account-exists question was
    // never surfaced either way.
    expect(screen.queryByText('メールを送信しました')).not.toBeInTheDocument()
  })
})

describe('LoginScreen — stale-request guard (fix round, blind lens P1/P2)', () => {
  it('① forgot-submit pending → tap backToLogin → resolve → view STAYS signin, no sent-flip', async () => {
    const req = deferred<{ data: object; error: null }>()
    resetPasswordForEmail.mockReturnValue(req.promise)
    render(<LoginScreen />)
    fireEvent.click(screen.getByText('パスワードをお忘れですか？'))
    fireEvent.change(screen.getByLabelText('メールアドレス'), {
      target: { value: 'staff@example.com' },
    })
    fireEvent.click(screen.getByText('再設定リンクを送信')) // submit — leaves it pending
    expect(screen.getByText('送信中...')).toBeInTheDocument() // resetSubmitting

    fireEvent.click(screen.getByText('サインインに戻る')) // backToLogin, mid-flight
    expect(screen.getByText('サインインして続行')).toBeInTheDocument() // subtitle — back on signin

    await act(async () => {
      req.resolve({ data: {}, error: null })
      await Promise.resolve()
    })

    // Still signin — the stale resolve never fired setView('sent').
    expect(screen.getByText('サインインして続行')).toBeInTheDocument()
    expect(screen.queryByText('メールを送信しました')).not.toBeInTheDocument() // resetSentTitle
  })

  it('② sign-in pending → tap forgotPassword → sign-in resolves with an error → NO error rendered on the forgot view', async () => {
    const req = deferred<{ data: object; error: { message: string } | null }>()
    signInWithPassword.mockReturnValue(req.promise)
    render(<LoginScreen />)
    fireEvent.change(screen.getByLabelText('メールアドレス'), {
      target: { value: 'staff@example.com' },
    })
    fireEvent.change(screen.getByLabelText('パスワード'), {
      target: { value: 'wrong-pw' },
    })
    fireEvent.click(screen.getByText('サインイン')) // submit — leaves it pending

    fireEvent.click(screen.getByText('パスワードをお忘れですか？')) // nav away, mid-flight
    expect(screen.getByText('パスワード再設定')).toBeInTheDocument() // resetTitle — on forgot now

    await act(async () => {
      req.resolve({ data: {}, error: { message: 'Invalid login credentials' } })
      await Promise.resolve()
    })

    // Still forgot view, no error surfaced from the stale sign-in resolve.
    expect(screen.getByText('パスワード再設定')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('③ after navigating away from an in-flight request, the destination submit button is enabled with its normal label', () => {
    const req = deferred<{ data: object; error: null }>()
    signInWithPassword.mockReturnValue(req.promise)
    render(<LoginScreen />)
    fireEvent.click(screen.getByText('サインイン')) // submit — leaves it pending (loading=true)

    fireEvent.click(screen.getByText('パスワードをお忘れですか？')) // nav away, mid-flight

    const resetButton = screen.getByText('再設定リンクを送信') // resetSubmit, not resetSubmitting
    expect(resetButton).toBeInTheDocument()
    expect(resetButton.closest('button')).toBeEnabled()
    // never resolved — proves the nav handler itself reset loading, not the
    // stale promise settling.
  })
})

describe('shell auth client — flow-type pin (blind lens P3)', () => {
  it("constructs its GoTrueClient with flowType 'implicit'", () => {
    // Contract: implicit-flow resetPasswordForEmail never touches the
    // session's storage namespace the way PKCE would (PKCE writes a
    // code_verifier under the same storageKey before the redirect — a
    // partitioning question on a shared device; see reset-password-form.tsx's
    // createRecoveryClient comment for why the WEB side deliberately opts
    // into implicit for this exact call). createMobileAuth passes no
    // flowType, so this pins @supabase/auth-js's own DEFAULT_OPTIONS
    // ('implicit', verified against the installed 2.99.1 source — GoTrueClient.js).
    // If this ever fails, either something started passing flowType
    // explicitly or the installed auth-js changed its default — re-audit
    // recovery storage before shipping either way.
    const mobileAuth = createMobileAuth({
      config: { url: 'https://test.supabase.co', anonKey: 'anon' },
      storage: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
      appState: { onActive: () => {} },
      onSessionState: () => {},
      purgeLocalCaches: async () => {},
    })
    // flowType is `protected` on GoTrueClient (TS2445) — this test only
    // needs its runtime value, so a structural cast reads it without
    // touching lint's no-explicit-any.
    expect((mobileAuth.auth as unknown as { flowType: string }).flowType).toBe('implicit')
  })
})
