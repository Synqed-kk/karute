'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { bootstrapBusinessForNewUser } from '@/actions/bootstrap'

export function SignupForm({ locale }: { locale: string }) {
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

    const { data, error: signupError } = await supabase.auth.signUp({ email, password })
    if (signupError) {
      setError(signupError.message)
      setLoading(false)
      return
    }
    if (!data.user) {
      setError(t('signupNoUser'))
      setLoading(false)
      return
    }
    // Supabase returns an obfuscated user object (identities: []) when the
    // email is already registered — meant to block account enumeration.
    // Without this guard, bootstrap would fail later with a confusing
    // "User not found in auth" because the id may not resolve.
    if (data.user.identities && data.user.identities.length === 0) {
      setError(t('emailAlreadyRegistered'))
      setLoading(false)
      return
    }

    const result = await bootstrapBusinessForNewUser(salonName, data.user.id)
    if (!result.ok) {
      setError(result.error)
      setLoading(false)
      return
    }

    router.push(`/${locale}/sessions`)
    router.refresh()
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
