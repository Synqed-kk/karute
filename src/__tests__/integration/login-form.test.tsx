/**
 * @jest-environment jsdom
 *
 * Login errors must be translated (never raw Supabase English), and the login
 * page must surface a confirm-failure banner when the callback bounced the user
 * back with ?error=confirm.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

function tFor(ns: string) {
  const ja = jest.requireActual('../../../messages/ja.json') as Record<string, unknown>
  return (key: string) => {
    let cur: unknown = ja
    for (const part of `${ns}.${key}`.split('.'))
      cur = (cur as Record<string, unknown> | undefined)?.[part]
    if (typeof cur !== 'string') throw new Error(`missing ja.json key: ${ns}.${key}`)
    return cur
  }
}

jest.mock('next-intl', () => ({
  useTranslations: (ns: string) => tFor(ns),
  // The page wraps itself in a provider pick (client-dictionary split) —
  // render it transparently here.
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}))

jest.mock('next-intl/server', () => ({
  getTranslations: async (ns: string) => tFor(ns),
  getMessages: async () => ({ auth: {} }),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('@/lib/supabase/client', () => {
  const signInWithPassword = jest.fn()
  return {
    __signIn: signInWithPassword,
    createClient: () => ({ auth: { signInWithPassword } }),
  }
})

// LoginPage now renders <LocaleToggle/> (2026-08-11 packet) — it reaches
// real next-intl/navigation (createNavigation) via @/i18n/navigation, which
// jest can't parse raw ESM. Not what this suite is testing (translated
// errors + the confirm banner); stub it out same as
// accent-tier-contract.test.tsx does for the landing page.
jest.mock('@/components/layout/locale-toggle', () => ({ LocaleToggle: () => null }))

import { LoginForm } from '@/components/login-form'
import LoginPage from '@/app/[locale]/login/page'
import * as clientMod from '@/lib/supabase/client'

const signInWithPassword = (clientMod as unknown as { __signIn: jest.Mock }).__signIn

beforeEach(() => {
  jest.clearAllMocks()
})

describe('LoginForm — translated errors', () => {
  it('renders the translated invalid-credentials message, not the raw string', async () => {
    signInWithPassword.mockResolvedValue({
      error: { message: 'Invalid login credentials' },
    })
    render(<LoginForm locale="ja" />)
    fireEvent.change(screen.getByLabelText('メールアドレス'), {
      target: { value: 'a@b.jp' },
    })
    fireEvent.change(screen.getByLabelText('パスワード'), {
      target: { value: 'nope' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'サインイン' }))

    await waitFor(() =>
      expect(
        screen.getByText('メールアドレスまたはパスワードが無効です'),
      ).toBeInTheDocument(),
    )
    expect(screen.queryByText('Invalid login credentials')).toBeNull()
  })
})

describe('LoginPage — confirm-error banner', () => {
  it('renders the confirm-error banner when ?error=confirm', async () => {
    const ui = await LoginPage({
      params: Promise.resolve({ locale: 'ja' }),
      searchParams: Promise.resolve({ error: 'confirm' }),
    })
    render(ui)
    expect(
      screen.getByText('確認リンクが無効または期限切れです。もう一度サインアップしてください。'),
    ).toBeInTheDocument()
  })

  it('does not render the banner without the error param', async () => {
    const ui = await LoginPage({
      params: Promise.resolve({ locale: 'ja' }),
      searchParams: Promise.resolve({}),
    })
    render(ui)
    expect(
      screen.queryByText('確認リンクが無効または期限切れです。もう一度サインアップしてください。'),
    ).toBeNull()
  })
})
