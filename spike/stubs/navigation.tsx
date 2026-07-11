// STUB for `@/i18n/navigation` (next-intl createNavigation) AND `next/navigation`.
// Both pull the Next router runtime, which doesn't exist outside a Next app.
// In the real shell these become client-side routing (History API / a small
// router) — for the render proof they're inert.
import type { AnchorHTMLAttributes } from 'react'

const router = {
  push: (href: string) => console.warn('[spike stub] router.push', href),
  replace: (href: string) => console.warn('[spike stub] router.replace', href),
  back: () => console.warn('[spike stub] router.back'),
  refresh: () => console.warn('[spike stub] router.refresh'),
  prefetch: () => {},
}

export function useRouter() {
  return router
}

export function usePathname() {
  return '/customers/spike'
}

export function redirect(href: string) {
  console.warn('[spike stub] redirect', href)
}

export function notFound() {
  console.warn('[spike stub] notFound')
}

export function Link({
  href,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}
