'use client'
import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

const inputCls =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'

type LinkState = 'checking' | 'ready' | 'invalid'

export function ResetPasswordConfirmForm({ locale }: { locale: string }) {
  const t = useTranslations('auth')
  const router = useRouter()
  // Implicit-flow client, matching the flow the recovery email was issued with
  // (see reset-password-form.tsx). detectSessionInUrl (on by default) consumes a
  // `#access_token=…` fragment during client init; cookie storage means the
  // session it establishes is the same one the rest of the app sees.
  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { flowType: 'implicit' } }
      ),
    []
  )
  const [linkState, setLinkState] = useState<LinkState>('checking')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    const url = new URL(window.location.href)
    const code = url.searchParams.get('code')
    const tokenHash = url.searchParams.get('token_hash')
    const type = url.searchParams.get('type')

    async function establishSession() {
      // Cover every shape a Supabase recovery link can arrive in, so a later
      // email-template or auth-config change can't silently strand users:
      // ?code= (PKCE), ?token_hash&type=recovery (token-hash template), or
      // #access_token (implicit — handled by detectSessionInUrl on init).
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!cancelled) setLinkState(error ? 'invalid' : 'ready')
        return
      }
      if (tokenHash && type === 'recovery') {
        const { error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash })
        if (!cancelled) setLinkState(error ? 'invalid' : 'ready')
        return
      }
      // Implicit fragment: give detectSessionInUrl a moment to finish, then
      // fall back to one delayed re-check before declaring the link dead.
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        if (!cancelled) setLinkState('ready')
        return
      }
      setTimeout(async () => {
        const { data: { session: retried } } = await supabase.auth.getSession()
        if (!cancelled) setLinkState(retried ? 'ready' : 'invalid')
      }, 1500)
    }
    establishSession()
    return () => {
      cancelled = true
    }
  }, [supabase])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    const password = fd.get('password') as string
    const confirm = fd.get('passwordConfirm') as string
    if (password !== confirm) {
      setError(t('passwordsDoNotMatch'))
      return
    }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(t('resetUpdateError'))
      setLoading(false)
    } else {
      router.push(`/${locale}/dashboard`)
      router.refresh()
    }
  }

  if (linkState === 'checking') {
    return <p className="text-sm text-muted-foreground">{t('resetLinkChecking')}</p>
  }

  if (linkState === 'invalid') {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-border bg-muted/40 px-4 py-3">
          <p className="text-sm font-medium text-foreground">{t('resetLinkInvalidTitle')}</p>
          <p className="text-sm leading-relaxed text-muted-foreground mt-1">
            {t('resetLinkInvalidBody')}
          </p>
        </div>
        <p className="text-sm text-center text-muted-foreground">
          <a
            href={`/${locale}/reset-password`}
            className="text-foreground underline underline-offset-4 hover:text-primary"
          >
            {t('resetRequestAgain')}
          </a>
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 w-full max-w-sm">
      <div>
        <label htmlFor="password" className="block text-sm font-medium mb-1">
          {t('newPassword')}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={inputCls}
        />
      </div>
      <div>
        <label htmlFor="passwordConfirm" className="block text-sm font-medium mb-1">
          {t('newPasswordConfirm')}
        </label>
        <input
          id="passwordConfirm"
          name="passwordConfirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={inputCls}
        />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? t('newPasswordSubmitting') : t('newPasswordSubmit')}
      </Button>
    </form>
  )
}
