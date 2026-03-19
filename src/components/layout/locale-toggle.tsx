'use client'

import { useLocale } from 'next-intl'
import { useRouter, usePathname } from '@/i18n/navigation'

export function LocaleToggle() {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()

  function toggleLocale() {
    const next = locale === 'ja' ? 'en' : 'ja'
    router.replace(pathname as Parameters<typeof router.replace>[0], { locale: next })
  }

  return (
    <button
      onClick={toggleLocale}
      type="button"
      className="min-h-[44px] rounded-md border border-gray-300 dark:border-white/20 px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-white/80 transition hover:text-gray-900 dark:hover:text-white"
      aria-label={locale === 'en' ? 'Switch to Japanese' : '英語に切り替え'}
    >
      {locale === 'en' ? 'EN' : 'JP'}
    </button>
  )
}
