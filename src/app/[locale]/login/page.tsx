import { getTranslations, getMessages } from 'next-intl/server'
import { NextIntlClientProvider } from 'next-intl'
import { LoginForm } from '@/components/login-form'
import { LocaleToggle } from '@/components/layout/locale-toggle'
import { PAGE_PICKS, pickMessages } from '@/i18n/client-messages'

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  const { locale } = await params
  // ⚖ Liam flag 70 — forwarded raw; `LoginForm` owns the gate (one home for
  // the rule, and the component stays safe whoever renders it).
  const { error, next } = await searchParams
  const t = await getTranslations('auth')
  return (
    <NextIntlClientProvider
      messages={pickMessages(await getMessages(), PAGE_PICKS.authPages)}
    >
      <div className="relative min-h-screen flex items-center justify-center bg-background">
        <div className="absolute right-4 top-4">
          <LocaleToggle />
        </div>
        <div className="w-full max-w-sm p-8 space-y-6">
          <div>
            <img src="/karute_logo.png" alt="Karute" className="h-12 object-contain dark:invert" />
            <p className="text-muted-foreground mt-2 text-sm">{t('subtitle')}</p>
          </div>
          {error === 'confirm' && (
            <p role="alert" className="text-sm text-red-400">{t('confirmError')}</p>
          )}
          <LoginForm locale={locale} next={next} />
        </div>
      </div>
    </NextIntlClientProvider>
  )
}
