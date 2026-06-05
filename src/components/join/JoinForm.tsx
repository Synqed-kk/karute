'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { acceptInvite } from '@/actions/invites'

const inputCls =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'

export function JoinForm({
  token,
  email,
  locale,
}: {
  token: string
  email: string
  locale: string
}) {
  const t = useTranslations('invite')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const fd = new FormData(e.currentTarget)
    const fullName = (fd.get('fullName') as string).trim()
    const password = fd.get('password') as string

    // On success acceptInvite redirects (throws NEXT_REDIRECT) and never returns;
    // only an error object comes back to handle here.
    const res = await acceptInvite(token, password, fullName, locale)
    if (res?.error) {
      setError(res.error)
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 w-full">
      <div>
        <label htmlFor="fullName" className="block text-sm font-medium mb-1">
          {t('joinNameLabel')}
        </label>
        <input id="fullName" name="fullName" type="text" required maxLength={100} className={inputCls} />
      </div>
      <div>
        <label htmlFor="email" className="block text-sm font-medium mb-1">
          {t('joinEmailLabel')}
        </label>
        {/* Email is fixed to the invite — shown read-only so the new account
            matches exactly what the owner invited. */}
        <input id="email" type="email" value={email} readOnly disabled className={`${inputCls} opacity-70`} />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium mb-1">
          {t('joinPasswordLabel')}
        </label>
        <input id="password" name="password" type="password" required minLength={8} className={inputCls} />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? t('joinSubmitting') : t('joinSubmit')}
      </Button>
    </form>
  )
}
