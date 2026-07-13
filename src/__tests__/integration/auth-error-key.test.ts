/**
 * authErrorKey maps raw Supabase auth errors to i18n keys so users never see
 * raw English Supabase strings.
 */
import { authErrorKey } from '@/lib/auth/error-key'

describe('authErrorKey', () => {
  const cases: Array<[unknown, string]> = [
    [{ message: 'Invalid login credentials' }, 'error_invalid'],
    [{ message: 'Email or password is incorrect' }, 'error_invalid'],
    [{ message: 'User already registered' }, 'emailAlreadyRegistered'],
    [{ message: 'Email address already been registered' }, 'emailAlreadyRegistered'],
    [{ status: 400, message: 'weird' }, 'error_generic'],
    [null, 'error_generic'],
    [undefined, 'error_generic'],
    ['a string', 'error_generic'],
  ]

  it.each(cases)('maps %p → %s', (input, expected) => {
    expect(authErrorKey(input)).toBe(expected)
  })
})
