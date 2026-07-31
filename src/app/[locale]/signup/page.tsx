import { getTranslations, getMessages } from 'next-intl/server'
import { NextIntlClientProvider } from 'next-intl'
import { SignupForm } from '@/components/signup-form'
import { PAGE_PICKS, pickMessages } from '@/i18n/client-messages'

export default async function SignupPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations('auth')
  return (
    <NextIntlClientProvider
      messages={pickMessages(await getMessages(), PAGE_PICKS.authPages)}
    >
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-sm p-8 space-y-6">
          <div>
            <img src="/karute_logo.png" alt="Karute" className="h-12 object-contain dark:invert" />
            <p className="text-muted-foreground mt-2 text-sm">{t('signupSubtitle')}</p>
          </div>
          <SignupForm locale={locale} />
        </div>
      </div>
    </NextIntlClientProvider>
  )
}
