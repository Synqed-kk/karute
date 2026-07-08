import { getTranslations } from 'next-intl/server'
import { ResetPasswordForm } from '@/components/reset-password-form'

// Forgot-password request page. Lives OUTSIDE the (app) route group so the auth
// guard in (app)/layout.tsx doesn't redirect a logged-out staff member to /login
// — being logged out is exactly why they're here.
export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations('auth')
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm p-8 space-y-6">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/karute_logo.png" alt="Karute" className="h-12 object-contain dark:invert" />
          <h1 className="text-lg font-semibold text-foreground mt-4">{t('resetTitle')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('resetSubtitle')}</p>
        </div>
        <ResetPasswordForm locale={locale} />
      </div>
    </div>
  )
}
