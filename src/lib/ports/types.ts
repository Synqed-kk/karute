// Platform-neutral PORTS (PLAN §3 / packet-02 build #2, "the core of the boundary").
//
// Shared UI depends on these interfaces, never on `@/actions/*`, relative
// `/api/*`, or `next/navigation` directly. Each has a Next implementation (web
// keeps same-origin fetch / next-navigation) and a Vite implementation (the thin
// shell bundle: facade fetch / client router). No Next or Vite type is imported
// here — that is what keeps this file loadable by BOTH builds and by jest.

import type { AnchorHTMLAttributes, ComponentType } from 'react'

/**
 * DataPort — the ONE home for every app-API call reachable from the target.
 *
 * `apiFetch` is the single seam every `/api/*` call routes through:
 *   - Web (Next):  same-origin `fetch(path, init)` — byte-identical to today.
 *   - Shell (Vite): `fetch(${FACADE}${path}, init)` — the bundle has no Next
 *     server, so relative `/api/*` would hit `capacitor://localhost` and 404.
 *
 * Keeping it a single method (not one method per endpoint) means migrating a
 * caller is a one-line swap and the drift gate can ban raw `fetch('/api'` in the
 * shared subtree outright.
 */
export interface DataPort {
  apiFetch(path: string, init?: RequestInit): Promise<Response>
}

/** Anchor-shaped Link, the subset every shared component uses. */
export type LinkProps = { href: string } & AnchorHTMLAttributes<HTMLAnchorElement>

/**
 * NavPort — routing seam. Next builds it from `useRouter()/usePathname()`; the
 * Vite impl is a History-API client router. Hook-shaped because the Next router
 * is only available via hooks.
 */
export interface NavPort {
  push(href: string): void
  replace(href: string): void
  back(): void
  refresh(): void
  pathname: string
  Link: ComponentType<LinkProps>
}
