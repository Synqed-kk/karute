'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { authErrorKey } from '@/lib/auth/error-key'
import { safeNext } from '@/lib/auth/safe-next'

export function LoginForm({ locale, next }: { locale: string; next?: string | null }) {
  const t = useTranslations('auth')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const supabase = createClient()
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const formData = new FormData(e.currentTarget)
    const { error } = await supabase.auth.signInWithPassword({
      email: formData.get('email') as string,
      password: formData.get('password') as string,
    })
    if (error) {
      setError(t(authErrorKey(error)))
      setLoading(false)
    } else {
      // ⚖ Liam flag 70 — land EXACTLY where the link pointed, once. The value
      // arrives raw and is gated here rather than at the caller, so the form is
      // safe by construction whoever renders it; anything that is not a
      // relative same-origin path falls back to today's destination.
      router.push(safeNext(next) ?? `/${locale}/dashboard`)
      router.refresh()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 w-full max-w-sm">
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
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? t('submitting') : t('submit')}
      </Button>
      <p className="text-sm text-center text-muted-foreground">
        <a href={`/${locale}/reset-password`} className="text-foreground underline underline-offset-4 hover:text-primary">
          {t('forgotPassword')}
        </a>
      </p>
      <p className="text-sm text-center text-muted-foreground">
        {t('noAccount')}{' '}
        <a href={`/${locale}/signup`} className="text-foreground underline underline-offset-4 hover:text-primary">
          {t('signupLink')}
        </a>
      </p>
    </form>
  )
}
