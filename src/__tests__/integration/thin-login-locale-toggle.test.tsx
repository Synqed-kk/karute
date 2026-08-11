/**
 * @jest-environment jsdom
 *
 * Thin-shell LoginScreen EN/JP toggle (2026-08-11 packet). Mirrors
 * thin-login-forgot-password.test.tsx's mock boundary (next-intl against the
 * real ja.json feed, thin/env + thin/auth/session mocked) and additionally
 * mocks thin/locale.ts so getThinLocale()'s return value drives the
 * component's branch independently of any translation-file swap (that swap
 * is thin/main.tsx's job, proven separately by i18n-label-totality.test.ts
 * covering key parity across ja/en) — this suite only proves LoginScreen
 * picks the right key/label per current locale and calls setThinLocale with
 * the OTHER one on tap.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { setSessionState } from '@/lib/auth/mobile/session-store'

jest.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => {
    const messages = jest.requireActual<Record<string, Record<string, string>>>(
      '../../../messages/ja.json',
    )
    return messages[ns]?.[key] ?? key
  },
}))

// thin/env.ts reads import.meta.env (Vite-only) — same mock boundary as
// thin-login-forgot-password.test.tsx.
jest.mock('../../../thin/env', () => ({
  getThinEnv: () => ({ facadeUrl: 'https://karute.synqed.jp' }),
}))

const resetPasswordForEmail = jest.fn()
const signInWithPassword = jest.fn()
jest.mock('../../../thin/auth/session', () => ({
  getMobileAuth: () => ({
    auth: { resetPasswordForEmail, signInWithPassword },
  }),
}))

const getThinLocaleMock = jest.fn<'ja' | 'en', []>()
const setThinLocaleMock = jest.fn()
jest.mock('../../../thin/locale', () => ({
  getThinLocale: () => getThinLocaleMock(),
  setThinLocale: (next: string) => setThinLocaleMock(next),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { LoginScreen } = require('../../../thin/screens/LoginScreen') as
  typeof import('../../../thin/screens/LoginScreen')

beforeEach(() => {
  resetPasswordForEmail.mockReset()
  signInWithPassword.mockReset()
  getThinLocaleMock.mockReset()
  setThinLocaleMock.mockReset()
})

afterEach(() => {
  setSessionState({ status: 'signed-out' })
  setSessionState({ status: 'recovering' })
})

describe('LoginScreen — EN/JP locale toggle', () => {
  it('current locale ja: shows "JP" with an aria-label offering the English switch', () => {
    getThinLocaleMock.mockReturnValue('ja')
    render(<LoginScreen />)
    const btn = screen.getByRole('button', { name: '英語に切り替え' }) // switchToEnglish
    expect(btn).toHaveTextContent('JP')
  })

  it('current locale en: shows "EN" with an aria-label offering the Japanese switch', () => {
    getThinLocaleMock.mockReturnValue('en')
    render(<LoginScreen />)
    const btn = screen.getByRole('button', { name: '日本語に切り替え' }) // switchToJapanese
    expect(btn).toHaveTextContent('EN')
  })

  it('tapping the toggle calls setThinLocale with the OTHER locale (ja -> en)', () => {
    getThinLocaleMock.mockReturnValue('ja')
    render(<LoginScreen />)
    fireEvent.click(screen.getByRole('button', { name: '英語に切り替え' }))
    expect(setThinLocaleMock).toHaveBeenCalledWith('en')
  })

  it('tapping the toggle calls setThinLocale with the OTHER locale (en -> ja)', () => {
    getThinLocaleMock.mockReturnValue('en')
    render(<LoginScreen />)
    fireEvent.click(screen.getByRole('button', { name: '日本語に切り替え' }))
    expect(setThinLocaleMock).toHaveBeenCalledWith('ja')
  })

  it('meets the 44px minimum tap target', () => {
    getThinLocaleMock.mockReturnValue('ja')
    render(<LoginScreen />)
    expect(screen.getByRole('button', { name: '英語に切り替え' }).className).toMatch(
      /min-h-\[44px\]/,
    )
  })

  it('never renders a solid black/dark fill (R13 — muted-foreground quiet-button treatment)', () => {
    getThinLocaleMock.mockReturnValue('ja')
    render(<LoginScreen />)
    const cls = screen.getByRole('button', { name: '英語に切り替え' }).className
    expect(cls).toMatch(/text-muted-foreground/)
    expect(cls).not.toMatch(/bg-(foreground|black|primary)\b/)
  })
})
