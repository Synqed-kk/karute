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

// Next's Link/router accept `{pathname, query}` objects as well as strings
// (CustomerIdentityCard's mic button passes one). Without this normalizer the
// History API stringifies the object to "[object Object]", the profile route
// regex eats it as a customer id, and the screen dead-ends on a lookup error
// with no way back (packet-09 F-7 cause 2). Normalize at the port root so
// every caller — Link, push, replace, redirect — is covered.
export type UrlObject = {
  pathname: string
  query?: Record<string, string | number | boolean | null | undefined>
}
export type Href = string | UrlObject

export function toHref(href: Href): string {
  if (typeof href === 'string') return href
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(href.query ?? {})) {
    if (v != null) params.set(k, String(v))
  }
  const qs = params.toString()
  return qs ? `${href.pathname}?${qs}` : href.pathname
}

function navigate(href: Href, replace = false): void {
  const url = toHref(href)
  if (replace) history.replaceState({}, '', url)
  else history.pushState({}, '', url)
  listeners.forEach((l) => l())
}

export function useRouter() {
  return {
    push: (href: Href) => navigate(href),
    replace: (href: Href) => navigate(href, true),
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

/** next/navigation useSearchParams drop-in — read surface only (the shared
 *  components read params; mutation goes through router.push, like Next).
 *  Same listener subscription as usePathname so pushState updates propagate. */
export function useSearchParams(): URLSearchParams {
  const [search, setSearch] = useState(
    typeof location !== 'undefined' ? location.search : '',
  )
  useEffect(() => {
    const on = () => setSearch(location.search)
    listeners.add(on)
    window.addEventListener('popstate', on)
    return () => {
      listeners.delete(on)
      window.removeEventListener('popstate', on)
    }
  }, [])
  return new URLSearchParams(search)
}

export function redirect(href: Href): void {
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
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: Href }) {
  return (
    <a
      href={toHref(href)}
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

// `import Link from 'next/link'` — the vite config aliases next/link here, and
// Next's Link is a default export; ours is prop-compatible for the shared usage.
export default Link

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
