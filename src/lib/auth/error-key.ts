/**
 * Map a raw Supabase auth error to an i18n key under the `auth` namespace.
 * Users must never see raw English Supabase strings; callers render
 * `t(authErrorKey(error))`.
 */
export function authErrorKey(error: unknown): string {
  const msg =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message)
      : ''
  const m = msg.toLowerCase()
  if (m.includes('already registered') || m.includes('already been registered'))
    return 'emailAlreadyRegistered'
  if (
    m.includes('invalid login') ||
    m.includes('invalid credentials') ||
    m.includes('email or password')
  )
    return 'error_invalid'
  return 'error_generic'
}
