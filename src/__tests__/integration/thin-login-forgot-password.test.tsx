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
})

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
      redirectTo: 'https://karute.synqed.jp/ja/reset-password/confirm',
    })
    expect(screen.getByText('メールを送信しました')).toBeInTheDocument() // resetSentTitle
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
