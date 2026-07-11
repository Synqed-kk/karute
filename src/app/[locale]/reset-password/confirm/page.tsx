import { getTranslations } from 'next-intl/server'
import { ResetPasswordConfirmForm } from '@/components/reset-password-confirm-form'

// Landing page for the emailed recovery link. Also outside the (app) route
// group: the visitor only becomes authenticated once the client component
// exchanges the token in the URL for a session.
export default async function ResetPasswordConfirmPage({
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
          <h1 className="text-lg font-semibold text-foreground mt-4">{t('newPasswordTitle')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('newPasswordSubtitle')}</p>
        </div>
        <ResetPasswordConfirmForm locale={locale} />
      </div>
    </div>
  )
}
