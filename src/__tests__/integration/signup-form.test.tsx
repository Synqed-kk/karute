/**
 * @jest-environment jsdom
 *
 * Signup rebuild: with email confirmation ON, signUp returns no session.
 * The form must (a) send an emailRedirectTo pointing at the locale callback
 * route + salon_name metadata, (b) NOT bootstrap client-side, and (c) render
 * the "check your email" state on success instead of redirecting.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json')
  return {
    useTranslations:
      (ns: string) =>
      (key: string, vars?: Record<string, unknown>) => {
        let cur: unknown = ja
        for (const part of `${ns}.${key}`.split('.'))
          cur = (cur as Record<string, unknown> | undefined)?.[part]
        if (typeof cur !== 'string') throw new Error(`missing ja.json key: ${ns}.${key}`)
        return cur.replace(/\{(\w+)\}/g, (_, v: string) =>
          String((vars as Record<string, unknown> | undefined)?.[v] ?? `{${v}}`),
        )
      },
  }
})

const mockPush = jest.fn()
const mockRefresh = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}))

const mockSignUp = jest.fn()
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signUp: mockSignUp } }),
}))

const mockBootstrap = jest.fn()
jest.mock('@/actions/bootstrap', () => ({
  bootstrapBusinessForNewUser: mockBootstrap,
}))

import { SignupForm } from '@/components/signup-form'

function fill() {
  fireEvent.change(screen.getByLabelText('サロン名'), { target: { value: 'My Salon' } })
  fireEvent.change(screen.getByLabelText('メールアドレス'), {
    target: { value: 'jane@salon.jp' },
  })
  fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'password1' } })
  fireEvent.change(screen.getByLabelText('パスワード確認'), {
    target: { value: 'password1' },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSignUp.mockResolvedValue({
    data: { user: { id: 'u1', identities: [{ id: 'i1' }] } },
    error: null,
  })
})

describe('SignupForm — confirm-email flow', () => {
  it('sends signUp with emailRedirectTo callback + salon_name metadata', async () => {
    render(<SignupForm locale="ja" />)
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'アカウント作成' }))

    await waitFor(() => expect(mockSignUp).toHaveBeenCalledTimes(1))
    const arg = mockSignUp.mock.calls[0][0]
    expect(arg.email).toBe('jane@salon.jp')
    expect(arg.password).toBe('password1')
    expect(arg.options.emailRedirectTo).toMatch(/\/ja\/auth\/callback$/)
    expect(arg.options.data).toEqual({ salon_name: 'My Salon' })
  })

  it('does NOT bootstrap client-side and does not redirect', async () => {
    render(<SignupForm locale="ja" />)
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'アカウント作成' }))

    await waitFor(() => expect(mockSignUp).toHaveBeenCalled())
    expect(mockBootstrap).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('renders the check-email state on success', async () => {
    render(<SignupForm locale="ja" />)
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'アカウント作成' }))

    await waitFor(() =>
      expect(screen.getByText(/確認メールを送信しました/)).toBeInTheDocument(),
    )
  })

  it('shows the already-registered message when identities is empty', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'u1', identities: [] } },
      error: null,
    })
    render(<SignupForm locale="ja" />)
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'アカウント作成' }))

    await waitFor(() =>
      expect(
        screen.getByText('このメールアドレスは既に登録されています。サインインしてください。'),
      ).toBeInTheDocument(),
    )
    // button re-enabled on this exit path
    expect(screen.getByRole('button', { name: 'アカウント作成' })).not.toBeDisabled()
  })
})
