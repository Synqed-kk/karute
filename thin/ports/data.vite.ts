// DataPort — Vite/shell implementation. The bundle has no Next server, so every
// `/api/*` gets prefixed with the facade base (facadeApiUrl). PRODUCTION, not a
// stub: real fetch to the live facade. Same-origin behavior stays on web via the
// default port (src/lib/ports/data-port.ts).

import type { DataPort } from '@/lib/ports/types'
import { facadeApiUrl } from '@/lib/ports/rewrite'
import { getAccessToken } from '@/lib/auth/mobile/session-store'
import { getThinActiveStore } from '../chrome/store-pref'
import { getThinEnv } from '../env'

export const viteDataPort: DataPort = {
  // getThinEnv() resolves lazily at call time — main.tsx has already validated
  // (and rendered a visible error screen on failure) before any fetch can run.
  //
  // NO credentials:'include': the shell is Bearer-only (packet 01) and needs no
  // cookies — and a credentialed cross-origin fetch requires the facade to send
  // Access-Control-Allow-Credentials, which it does not; WebKit then blocks the
  // whole response (packet-09 F-5 cause 3). Plain CORS mode reads fine against
  // the reflected capacitor://localhost allow-origin.
  // Bearer from the session-store: SYNC read (never await getSession on the
  // hot path — boot-gate rationale), kept fresh by onAuthStateChange. No token
  // → no header → the facade 401s honestly and the screen shows its message.
  // App-RELATIVE paths only: facadeApiUrl passes absolute URLs through
  // untouched, and the session token must never ride to a foreign origin
  // (latent exfiltration footgun — security lens F-4).
  apiFetch: (path, init) => {
    const headers = new Headers(init?.headers)
    if (!/^https?:\/\//i.test(path)) {
      const token = getAccessToken()
      if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`)
      }
      // The store lens — the web's active-store cookie, as the explicit
      // header the facade clamp expects. Server-side resolveStoreForRequest
      // remains the authority (fails closed on out-of-scope stores).
      const store = getThinActiveStore()
      if (store && !headers.has('store-id')) {
        headers.set('store-id', store)
      }
    }
    return fetch(facadeApiUrl(getThinEnv().facadeUrl, path), { ...init, headers })
  },
}
