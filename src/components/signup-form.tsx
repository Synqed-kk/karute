'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { bootstrapBusinessForNewUser } from '@/actions/bootstrap'

// ponytail: reject after `ms` so a stalled Supabase email-send / server action
// can never freeze the submit button forever (root cause of the signup hang).
function withTimeout<T>(promise: Promise<T>, ms = 20000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms),
    ),
  ])
}

export function SignupForm({ locale }: { locale: string }) {
  const t = useTranslations('auth')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const supabase = createClient()
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setNotice(null)
    const formData = new FormData(e.currentTarget)
    const salonName = (formData.get('salonName') as string).trim()
    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const confirmPassword = formData.get('confirmPassword') as string

    if (!salonName) {
      setError(t('salonNameRequired'))
      setLoading(false)
      return
    }

    if (password !== confirmPassword) {
      setError(t('passwordsDoNotMatch'))
      setLoading(false)
      return
    }

    try {
      const { data, error: signupError } = await withTimeout(
        supabase.auth.signUp({ email, password }),
      )
      if (signupError) {
        setError(signupError.message)
        return
      }
      if (!data.user) {
        setError(t('signupNoUser'))
        return
      }
      // Supabase returns an obfuscated user object (identities: []) when the
      // email is already registered — meant to block account enumeration.
      // Without this guard, bootstrap would fail later with a confusing
      // "User not found in auth" because the id may not resolve.
      if (data.user.identities && data.user.identities.length === 0) {
        setError(t('emailAlreadyRegistered'))
        return
      }

      // Bootstrap BEFORE the session check — deliberate. bootstrap.ts is
      // session-independent by design: it takes an explicit userId and
      // verifies it via service-role getUserById (its own doc comment: "the
      // client can pass user.id from supabase.auth.signUp's response without
      // waiting for session cookies to sync"). With email confirmation ON
      // there is no session here, and the salonName typed into this form
      // exists nowhere else — skipping bootstrap would strand confirm-later
      // users with no profile/business row.
      const result = await withTimeout(
        bootstrapBusinessForNewUser(salonName, data.user.id),
      )
      if (!result.ok) {
        setError(result.error)
        return
      }

      // With email confirmation ON, signUp returns a user but NO session.
      // Redirecting would push the user to /sessions, where the (app) layout
      // bounces them to /login with no explanation. Tell them to confirm via
      // email and stop; once the owner turns autoconfirm off, a session is
      // present and the normal redirect runs.
      if (!data.session) {
        setNotice(t('checkEmailToConfirm'))
        return
      }

      router.push(`/${locale}/sessions`)
      router.refresh()
    } catch {
      // Timeout or network/unexpected error — never leave the button stuck.
      setError(t('signupTimeout'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 w-full max-w-sm">
      <div>
        <label htmlFor="salonName" className="block text-sm font-medium mb-1">{t('salonName')}</label>
        <input
          id="salonName"
          name="salonName"
          type="text"
          required
          maxLength={100}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div>
        <label htmlFor="email" className="block text-sm font-medium mb-1">{t('email')}</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium mb-1">{t('password')}</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-medium mb-1">{t('confirmPassword')}</label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? t('signingUp') : t('signup')}
      </Button>
      <p className="text-sm text-center text-muted-foreground">
        {t('hasAccount')}{' '}
        <a href={`/${locale}/login`} className="text-foreground underline underline-offset-4 hover:text-primary">
          {t('signinLink')}
        </a>
      </p>
    </form>
  )
}
