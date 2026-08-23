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
    // ⚖ Liam flag 70 rider (i) — THE TAP MUST NOT THROW THE DESTINATION AWAY.
    // `usePathname()` is the next-intl wrapper and is path-only, so switching
    // EN/JA on the login page used to drop the `?next=` the wall had just
    // carried there — the operator signed in and landed on the dashboard
    // anyway. The current search rides through the replace instead.
    //
    // Read at CLICK TIME, not via `useSearchParams()`: this component is
    // shared with the static marketing root, where a render-time
    // searchParams subscription would trip Next's CSR-bailout/Suspense
    // requirement. The handler only ever needs the value on tap.
    //
    // `_rsc` is Next's internal cache-buster and is dropped here for the same
    // reason the proxy drops it. Repeated keys (`?next=a&next=b`) pass through
    // URLSearchParams intact on purpose — the downstream gate owns that shape.
    const params = new URLSearchParams(window.location.search)
    params.delete('_rsc')
    const qs = params.toString()
    router.replace(
      `${pathname}${qs ? `?${qs}` : ''}` as Parameters<typeof router.replace>[0],
      { locale: next }
    )
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
