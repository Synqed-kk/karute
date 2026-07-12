/**
 * @jest-environment jsdom
 *
 * Signup submit must never hang (fix/signup-hang). Two contracts:
 *   1. a rejected signUp resets the loading state and surfaces an error — the
 *      button re-enables instead of freezing on "アカウント作成中...".
 *   2. a signUp that resolves WITHOUT a session (email confirmation required)
 *      shows the confirm-email notice and does NOT call bootstrap/redirect.
 *
 * next-intl is mocked to echo keys (repo tsx-test convention); supabase client,
 * the bootstrap server action, and next/navigation are stubbed so we assert the
 * form's behavior, not the network.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

const push = jest.fn()
const refresh = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}))

const signUp = jest.fn()
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signUp } }),
}))

jest.mock('@/actions/bootstrap', () => ({
  bootstrapBusinessForNewUser: jest.fn(),
}))

import { SignupForm } from '@/components/signup-form'
import { bootstrapBusinessForNewUser } from '@/actions/bootstrap'

const mockBootstrap = bootstrapBusinessForNewUser as jest.MockedFunction<
  typeof bootstrapBusinessForNewUser
>

beforeEach(() => {
  jest.clearAllMocks()
})

function fillAndSubmit() {
  render(<SignupForm locale="ja" />)
  fireEvent.change(screen.getByLabelText('salonName'), { target: { value: 'Salon' } })
  fireEvent.change(screen.getByLabelText('email'), { target: { value: 'a@b.com' } })
  fireEvent.change(screen.getByLabelText('password'), { target: { value: 'password1' } })
  fireEvent.change(screen.getByLabelText('confirmPassword'), { target: { value: 'password1' } })
  // next-intl echoes keys, so the submit button reads its key 'signup'.
  fireEvent.click(screen.getByRole('button', { name: 'signup' }))
}

describe('SignupForm — never hang', () => {
  it('resets loading and surfaces an error when signUp rejects', async () => {
    signUp.mockRejectedValue(new Error('network down'))
    fillAndSubmit()

    await waitFor(() => expect(screen.getByText('signupTimeout')).toBeInTheDocument())
    // Button re-enabled (label back to 'signup', not stuck on 'signingUp').
    expect(screen.getByRole('button', { name: 'signup' })).not.toBeDisabled()
    expect(mockBootstrap).not.toHaveBeenCalled()
  })

  it('shows the confirm-email notice and does NOT bootstrap when signUp returns no session', async () => {
    signUp.mockResolvedValue({
      data: { user: { id: 'u1', identities: [{ id: 'i1' }] }, session: null },
      error: null,
    })
    fillAndSubmit()

    await waitFor(() => expect(screen.getByText('checkEmailToConfirm')).toBeInTheDocument())
    expect(mockBootstrap).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'signup' })).not.toBeDisabled()
  })
})
