// Thin-shell login (packet-01 integration). Mirrors the web login page/form
// (src/app/[locale]/login + src/components/login-form.tsx) minus the web-only
// pieces: no next/navigation redirect (the AuthGate re-renders on SIGNED_IN),
// and no signup link — that flow stays on the HTTPS site in v1 (packet-01:
// capacitor://localhost has no URL-based auth callback).
//
// Forgot-password (2026-08-11 packet) IS in scope here as a local view state,
// not a route: the shell has no signed-out router (AuthGate mounts this
// screen directly), so "request → sent" lives in useState the same way the
// web's src/components/reset-password-form.tsx keeps its own `sent` flag.
// The emailed link still finishes on the PROD WEB confirm page (#692,
// live) — capacitor://localhost still has no callback, so only the REQUEST
// half moves into the shell.

import { useRef, useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { authErrorKey } from '@/lib/auth/error-key'
import { setSessionState } from '@/lib/auth/mobile/session-store'
import { getMobileAuth } from '../auth/session'
import { getThinEnv } from '../env'

type View = 'signin' | 'forgot' | 'sent'

const inputCls =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'
// Same resting-quiet treatment as the web's back-to-login link
// (reset-password-form.tsx): neutral foreground at rest, accent only on
// hover — legal under the one-way accent law (pressables may be quieter
// than accent; CLAUDE.md).
const quietLinkCls = 'text-foreground underline underline-offset-4 hover:text-primary'

export function LoginScreen() {
  const t = useTranslations('auth')
  const tCommon = useTranslations('common')
  const [view, setView] = useState<View>('signin')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // One-time seed, not a live sync: captured off the sign-in field's ref
  // when the link is clicked (packet: "prefill from whatever's typed in the
  // login email field"). Kept as a ref so the existing sign-in input stays
  // uncontrolled — no behavior change to the working form above.
  const emailInputRef = useRef<HTMLInputElement>(null)
  const [forgotEmailSeed, setForgotEmailSeed] = useState('')
  // Request-generation counter (fix round, blind lens P1/P2): a stale async
  // result must never write state — any navigation or newer submit
  // invalidates it. Every nav handler bumps it; every submit captures its own
  // value up front and re-checks after its await, before touching state.
  const reqSeq = useRef(0)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    const seq = ++reqSeq.current
    e.preventDefault()
    setLoading(true)
    setError(null)
    const formData = new FormData(e.currentTarget)
    const { data, error } = await getMobileAuth().auth.signInWithPassword({
      email: formData.get('email') as string,
      password: formData.get('password') as string,
    })
    if (seq !== reqSeq.current) return
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

  async function handleForgotSubmit(e: FormEvent<HTMLFormElement>) {
    const seq = ++reqSeq.current
    e.preventDefault()
    setLoading(true)
    setError(null)
    const formData = new FormData(e.currentTarget)
    // Web's own /ja/reset-password/confirm route is the ONLY finish target —
    // capacitor://localhost has no URL-based auth callback (packet-01).
    // facadeUrl is the same VITE_FACADE_URL prod origin the shell already
    // trusts (thin/env.ts); 'ja' is a literal because this bundle ships
    // messages/ja.json only — same literal thin/main.tsx already uses for
    // <AppRoot locale="ja">, there being no other locale to select.
    const { error } = await getMobileAuth().auth.resetPasswordForEmail(
      formData.get('email') as string,
      { redirectTo: `${getThinEnv().facadeUrl}/ja/reset-password/confirm` },
    )
    if (seq !== reqSeq.current) return
    if (error) {
      // Rate limit / network only — mirrors reset-password-form.tsx: Supabase
      // never reveals whether the account exists, so this is the sole error
      // branch and always generic copy (anti-enumeration).
      setError(t('resetErrorGeneric'))
      setLoading(false)
    } else {
      setView('sent')
      setLoading(false)
    }
  }

  if (view === 'forgot') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <div className="w-full max-w-sm space-y-6 p-8">
          <div>
            <h1 className="text-2xl font-semibold">{t('resetTitle')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t('resetSubtitle')}</p>
          </div>
          <form onSubmit={handleForgotSubmit} className="w-full space-y-4">
            <div>
              <label htmlFor="reset-email" className="mb-1 block text-sm font-medium">
                {t('email')}
              </label>
              <input
                id="reset-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                defaultValue={forgotEmailSeed}
                className={inputCls}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-red-400">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t('resetSubmitting') : t('resetSubmit')}
            </Button>
          </form>
          <p className="text-sm text-center text-muted-foreground">
            <button
              type="button"
              onClick={() => {
                reqSeq.current++
                setLoading(false)
                setError(null)
                setView('signin')
              }}
              className={quietLinkCls}
            >
              {t('backToLogin')}
            </button>
          </p>
        </div>
      </div>
    )
  }

  if (view === 'sent') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <div className="w-full max-w-sm space-y-6 p-8">
          <div className="rounded-md border border-border bg-muted/40 px-4 py-3">
            <p className="text-sm font-medium text-foreground">{t('resetSentTitle')}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {t('resetSentBody')}
            </p>
          </div>
          <p className="text-sm text-center text-muted-foreground">
            <button
              type="button"
              onClick={() => {
                reqSeq.current++
                setLoading(false)
                setError(null)
                setView('signin')
              }}
              className={quietLinkCls}
            >
              {t('backToLogin')}
            </button>
          </p>
        </div>
      </div>
    )
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
              ref={emailInputRef}
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
        <p className="text-sm text-center text-muted-foreground">
          <button
            type="button"
            onClick={() => {
              setForgotEmailSeed(emailInputRef.current?.value ?? '')
              reqSeq.current++
              setLoading(false)
              setError(null)
              setView('forgot')
            }}
            className={quietLinkCls}
          >
            {t('forgotPassword')}
          </button>
        </p>
      </div>
    </div>
  )
}
