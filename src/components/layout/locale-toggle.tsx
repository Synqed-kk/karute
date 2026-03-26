'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useRouter, usePathname } from '@/i18n/navigation'

export function LocaleToggle() {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const t = useTranslations('localeToggle')

  function toggleLocale() {
    const next = locale === 'ja' ? 'en' : 'ja'
    router.replace(pathname as Parameters<typeof router.replace>[0], { locale: next })
  }

  return (
    <button
      onClick={toggleLocale}
      type="button"
      className="min-h-[44px] rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground"
      aria-label={locale === 'en' ? t('switchToJapanese') : t('switchToEnglish')}
    >
      {locale === 'en' ? 'EN' : 'JP'}
    </button>
  )
}
