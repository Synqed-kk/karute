// Centralized CORS for the facade (PLAN §6, packet point 6). ONE place decides
// method/header allow-lists and the credentials rule, so a new route can never
// hand-roll a permissive header by mistake.
//
// THE CREDENTIALS RULE (the standard credential-theft misconfiguration this
// avoids): there are TWO separate branches, never one "origin-in-list → allow +
// credentials" branch.
//   - SITE origins (our own web app) may send cookies → credentialed CORS.
//   - SHELL origins (the capacitor bundle) authenticate with a Bearer token and
//     carry NO cookie identity → CORS WITHOUT credentials. `capacitor://` is
//     NEVER reflected with Access-Control-Allow-Credentials.
// An unknown origin gets NO Access-Control-Allow-Origin at all (browser blocks).

// Derived from the built capacitor config (PLAN §8): iOS WebView origin is
// `capacitor://localhost` (server.iosScheme default `capacitor`); Android default
// is `https://localhost` (androidScheme @default https). Both carried from day
// one so the Android lane needs no CORS change when it unparks.
const SHELL_ORIGINS = ['capacitor://localhost', 'https://localhost'] as const

/** Non-safelisted request headers the mobile client sends (PLAN §6). All must be
 *  named explicitly — the browser will not send them otherwise. */
const ALLOWED_HEADERS = [
  'Authorization',
  'Content-Type',
  'store-id',
  'Idempotency-Key',
  'If-Match',
  'app-version',
  'platform',
  'request-id',
].join(', ')

const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
const MAX_AGE = '600' // bounded preflight cache (10 min)

/** Site origins that may use CREDENTIALED (cookie) CORS. From config, never
 *  hardcoded (custom-domain swap = config). Comma-separated. */
function siteOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.FACADE_SITE_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export type OriginClass = 'site' | 'shell' | 'unknown'

export function classifyOrigin(
  origin: string | null,
  env: NodeJS.ProcessEnv = process.env,
): OriginClass {
  if (!origin) return 'unknown'
  if (siteOrigins(env).includes(origin)) return 'site'
  if ((SHELL_ORIGINS as readonly string[]).includes(origin)) return 'shell'
  return 'unknown'
}

/**
 * CORS headers for a given request origin. `Vary: Origin` is ALWAYS set so a
 * cached response is never reused across origins. Credentials are granted ONLY
 * to site origins — the two branches never merge.
 */
export function corsHeaders(
  origin: string | null,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const headers: Record<string, string> = { Vary: 'Origin' }
  const cls = classifyOrigin(origin, env)
  if (cls === 'unknown' || !origin) return headers // no ACAO → browser blocks

  headers['Access-Control-Allow-Origin'] = origin
  headers['Access-Control-Allow-Methods'] = ALLOWED_METHODS
  headers['Access-Control-Allow-Headers'] = ALLOWED_HEADERS
  headers['Access-Control-Max-Age'] = MAX_AGE
  if (cls === 'site') {
    // Cookie (credentialed) CORS — our own origins ONLY.
    headers['Access-Control-Allow-Credentials'] = 'true'
  }
  // Shell (Bearer) origins deliberately get NO Allow-Credentials.
  return headers
}

/** Preflight (OPTIONS) response — 204 with the CORS headers, no body. */
export function preflightResponse(
  origin: string | null,
  env: NodeJS.ProcessEnv = process.env,
): Response {
  return new Response(null, { status: 204, headers: corsHeaders(origin, env) })
}
