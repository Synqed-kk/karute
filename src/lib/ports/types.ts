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
  /**
   * Deliver an already-fetched file blob to the user (packet 23, /data-export
   * port). Web triggers the browser's native download (anchor+click);
   * WebKit's share() needs a user gesture, so the thin impl never calls this
   * from an async fetch continuation — a view wires it to a tap AFTER the
   * blob is already in state. Returns which path actually happened, so the
   * caller can toast on 'copied' (the only silent-otherwise outcome).
   */
  deliverFile(blob: Blob, fileName: string): Promise<'downloaded' | 'shared' | 'copied'>
  /** Whether this world may auto-trigger deliverFile right after a fetch
   *  resolves (web: yes, same-tab anchor click needs no gesture). Thin is
   *  false — see deliverFile's doc. Precedent: RecordingPipelinePort's
   *  supportsServerJob (src/lib/ports/recording-port.ts). */
  supportsAutoDeliver: boolean
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
