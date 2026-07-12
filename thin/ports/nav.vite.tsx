// NavPort — Vite/shell implementation AND the drop-in for `next/navigation` +
// `@/i18n/navigation` (the vite config aliases both to this module, so existing
// shared components resolve without edits). A REAL History-API client router —
// not the spike's inert stubs. Locale-prefix routing is deferred: the shell is
// single-locale (ja) in v1, so paths are used as-is.

import {
  useEffect,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
} from 'react'
import type { NavPort } from '@/lib/ports/types'

const listeners = new Set<() => void>()

function navigate(href: string, replace = false): void {
  if (replace) history.replaceState({}, '', href)
  else history.pushState({}, '', href)
  listeners.forEach((l) => l())
}

export function useRouter() {
  return {
    push: (href: string) => navigate(href),
    replace: (href: string) => navigate(href, true),
    back: () => history.back(),
    refresh: () => listeners.forEach((l) => l()),
    prefetch: () => {},
  }
}

export function usePathname(): string {
  const [path, setPath] = useState(
    typeof location !== 'undefined' ? location.pathname : '/',
  )
  useEffect(() => {
    const on = () => setPath(location.pathname)
    listeners.add(on)
    window.addEventListener('popstate', on)
    return () => {
      listeners.delete(on)
      window.removeEventListener('popstate', on)
    }
  }, [])
  return path
}

export function redirect(href: string): void {
  navigate(href, true)
}

export function notFound(): never {
  // ponytail: the shell has no Next 404 convention; throw so AppRoot's
  // ErrorBoundary shows recovery. Upgrade path: a real in-router 404 route.
  throw new Error('NAV_NOT_FOUND')
}

export function Link({
  href,
  children,
  onClick,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      href={href}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e)
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return
        e.preventDefault()
        navigate(href)
      }}
      {...rest}
    >
      {children}
    </a>
  )
}

/** Forward API for components migrated off `next/navigation`. */
export function useNavPort(): NavPort {
  const router = useRouter()
  const pathname = usePathname()
  return {
    push: router.push,
    replace: router.replace,
    back: router.back,
    refresh: router.refresh,
    pathname,
    Link,
  }
}
