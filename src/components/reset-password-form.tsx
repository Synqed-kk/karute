'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { createBrowserClient } from '@supabase/ssr'
import { Button } from '@/components/ui/button'
import { publicSiteOrigin } from '@/lib/platform'

const inputCls =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'

// The recovery email is requested through an implicit-flow client (NOT the app's
// default PKCE client from @/lib/supabase/client). PKCE ties the emailed link to
// this browser's stored code verifier, so opening the email anywhere else — and
// staff in the iOS shell will almost always open mail in Safari, not the WebView
// that requested it — would fail with a code-verifier error. The implicit flow
// puts the session token in the link itself, so it works in whichever browser
// opens it.
function createRecoveryClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { flowType: 'implicit' } }
  )
}

export function ResetPasswordForm({ locale }: { locale: string }) {
  const t = useTranslations('auth')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const email = new FormData(e.currentTarget).get('email') as string
    const supabase = createRecoveryClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${publicSiteOrigin()}/${locale}/reset-password/confirm`,
    })
    if (error) {
      // Rate limit / network only. "No such account" is NOT an error here —
      // Supabase (correctly) doesn't reveal whether the email exists.
      setError(t('resetErrorGeneric'))
      setLoading(false)
    } else {
      setSent(true)
    }
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-border bg-muted/40 px-4 py-3">
          <p className="text-sm font-medium text-foreground">{t('resetSentTitle')}</p>
          <p className="text-sm leading-relaxed text-muted-foreground mt-1">
            {t('resetSentBody')}
          </p>
        </div>
        <p className="text-sm text-center text-muted-foreground">
          <a
            href={`/${locale}/login`}
            className="text-foreground underline underline-offset-4 hover:text-primary"
          >
            {t('backToLogin')}
          </a>
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 w-full max-w-sm">
      <div>
        <label htmlFor="email" className="block text-sm font-medium mb-1">
          {t('email')}
        </label>
        <input id="email" name="email" type="email" required className={inputCls} />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? t('resetSubmitting') : t('resetSubmit')}
      </Button>
      <p className="text-sm text-center text-muted-foreground">
        <a
          href={`/${locale}/login`}
          className="text-foreground underline underline-offset-4 hover:text-primary"
        >
          {t('backToLogin')}
        </a>
      </p>
    </form>
  )
}
