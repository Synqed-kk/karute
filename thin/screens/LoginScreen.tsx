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
    // Success: flip the store from the RESOLVED session. auth-js notifies
    // SIGNED_IN inline before returning, so this is normally a same-value
    // no-op — kept as belt-and-braces so the gate swap never depends on
    // event-subscriber internals holding across auth-js versions.
    if (data.session) {
      setSessionState({ status: 'signed-in', session: data.session })
    } else {
      // No error and no session should be unreachable — re-enable the form
      // rather than dead-ending it.
      setLoading(false)
    }
  }

  // min-h-dvh, not min-h-full: the thin shell mounts this outside any
  // height-chained parent, so min-h-full collapses to content height and the
  // form top-aligns under the status bar (8/1 field bug). Safe-area padding
  // keeps the centering honest between the notch and the home bar.
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
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
