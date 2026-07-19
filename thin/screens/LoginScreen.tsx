// Thin-shell login (packet-01 integration). Mirrors the web login page/form
// (src/app/[locale]/login + src/components/login-form.tsx) minus the web-only
// pieces: no next/navigation redirect (the AuthGate re-renders on SIGNED_IN),
// and no signup / reset links — those flows stay on the HTTPS site in v1
// (packet-01: capacitor://localhost has no URL-based auth callback).

import { useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { authErrorKey } from '@/lib/auth/error-key'
import { setSessionState } from '@/lib/auth/mobile/session-store'
import { getMobileAuth } from '../auth/session'

export function LoginScreen() {
  const t = useTranslations('auth')
  const tCommon = useTranslations('common')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const formData = new FormData(e.currentTarget)
    const { data, error } = await getMobileAuth().auth.signInWithPassword({
      email: formData.get('email') as string,
      password: formData.get('password') as string,
    })
    if (error) {
      setError(t(authErrorKey(error)))
      setLoading(false)
      return
    }
    // Success: flip the store from the RESOLVED session — deterministic, no
    // dependency on the SIGNED_IN event arriving (Greptile: a dropped event
    // left the button disabled forever). The AuthGate then swaps this screen
    // for the router; onAuthStateChange stays the rotation/refresh truth.
    if (data.session) {
      setSessionState({ status: 'signed-in', session: data.session })
    } else {
      // No error and no session should be unreachable — re-enable the form
      // rather than dead-ending it.
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 p-8">
        <div>
          <h1 className="text-2xl font-semibold">{tCommon('appName')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <form onSubmit={handleSubmit} className="w-full space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium">
              {t('email')}
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium">
              {t('password')}
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t('submitting') : t('submit')}
          </Button>
        </form>
      </div>
    </div>
  )
}
