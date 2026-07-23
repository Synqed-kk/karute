// DataPort — Vite/shell implementation. The bundle has no Next server, so every
// `/api/*` gets prefixed with the facade base (facadeApiUrl). PRODUCTION, not a
// stub: real fetch to the live facade. Same-origin behavior stays on web via the
// default port (src/lib/ports/data-port.ts). Header assembly + the stranded-pin
// self-heal live in facade-fetch.ts (import.meta-free so jest can pin them).

import type { DataPort } from '@/lib/ports/types'
import { facadeApiUrl } from '@/lib/ports/rewrite'
import { getThinEnv } from '../env'
import { facadeApiFetch } from './facade-fetch'
import { deliverFile } from './deliver-file.vite'

export const viteDataPort: DataPort = {
  // getThinEnv() resolves lazily at call time — main.tsx has already validated
  // (and rendered a visible error screen on failure) before any fetch can run.
  //
  // NO credentials:'include': the shell is Bearer-only (packet 01) and needs no
  // cookies — and a credentialed cross-origin fetch requires the facade to send
  // Access-Control-Allow-Credentials, which it does not; WebKit then blocks the
  // whole response (packet-09 F-5 cause 3). Plain CORS mode reads fine against
  // the reflected capacitor://localhost allow-origin.
  apiFetch: (path, init) =>
    facadeApiFetch((p) => facadeApiUrl(getThinEnv().facadeUrl, p), path, init),
  // Packet 23 (/data-export port) — deliver-file.vite.ts (import.meta-free,
  // see its header comment).
  deliverFile,
  supportsAutoDeliver: false,
  // Bearer twin of /api/export — the cookie-only web route 401s on this path
  // (exportBase seam, aiBase precedent; Greptile P1 on #588).
  exportBase: '/api/app/v1/export',
}
