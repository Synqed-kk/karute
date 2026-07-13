// DataPort — Vite/shell implementation. The bundle has no Next server, so every
// `/api/*` gets prefixed with the facade base (facadeApiUrl). PRODUCTION, not a
// stub: real fetch to the live facade. Same-origin behavior stays on web via the
// default port (src/lib/ports/data-port.ts).

import type { DataPort } from '@/lib/ports/types'
import { facadeApiUrl } from '@/lib/ports/rewrite'
import { getThinEnv } from '../env'

export const viteDataPort: DataPort = {
  // getThinEnv() resolves lazily at call time — main.tsx has already validated
  // (and rendered a visible error screen on failure) before any fetch can run.
  apiFetch: (path, init) =>
    fetch(facadeApiUrl(getThinEnv().facadeUrl, path), {
      // The shell carries the bearer session (packet 01); credentials:'include'
      // is a no-op for the token flow but harmless and correct for any cookie
      // the facade sets. Callers can still override via init.
      credentials: 'include',
      ...init,
    }),
}
