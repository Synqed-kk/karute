import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
  locales: ['en', 'ja'],
  defaultLocale: 'ja',
  // Japanese-first product: don't auto-switch to English from the browser's
  // Accept-Language header. A fresh visit resolves to `ja` (defaultLocale); the
  // EN toggle still works for the rare English user.
  localeDetection: false,
})
