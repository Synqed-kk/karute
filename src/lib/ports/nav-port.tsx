'use client'

// NavPort — Next implementation. Builds the platform-neutral NavPort from the
// app's next-intl navigation (locale-aware Link + router). The Vite thin target
// supplies its own History-API implementation (thin/ports/nav.vite.tsx) that the
// bundler aliases in; shared components migrated off `next/navigation` call
// `useNavPort()` and get whichever platform provided it.

import { Link as IntlLink, useRouter, usePathname } from '@/i18n/navigation'
import type { LinkProps, NavPort } from './types'

/** Next/next-intl NavPort. Hook-shaped because the router is hook-only. */
export function useNavPort(): NavPort {
  const router = useRouter()
  const pathname = usePathname()
  return {
    push: (href) => router.push(href),
    replace: (href) => router.replace(href),
    back: () => router.back(),
    refresh: () => router.refresh(),
    pathname,
    // next-intl's Link takes a typed href; the shared NavPort narrows to string,
    // which is a subset — safe to pass through.
    Link: IntlLink as unknown as NavPort['Link'],
  }
}

export type { LinkProps }
