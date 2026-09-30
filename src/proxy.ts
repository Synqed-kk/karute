import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'
import { safeNext } from './lib/auth/safe-next'

const intlMiddleware = createMiddleware(routing)

// Path segments that stay public (no auth required). Everything else under a
// locale is an (app) route and requires a session.
const PUBLIC_SEGMENTS = ['login', 'signup', 'join', 'auth', 'reset-password']

// ⚖ Liam 2026-09-30 — a Business address that needs sign-in comes back to
// Business. A STALE cookie still yields claims (getClaims is JWT-local), so the
// signed-out branch below never fired and admission's 404 dropped the operator
// on the front page. On a PREVIEW Business path only, the session is asked of
// the auth server once, and only a session the SDK itself calls gone is sent to
// the login. Verdicts follow @supabase/auth-js 2.99.1 src/lib/errors.ts — its
// own predicates test `error.name` (isAuthSessionMissingError :126,
// isAuthApiError :61), so this reads the same fields without loading the SDK:
//   gone   = AuthSessionMissingError (:120; also what fetch.ts:99 throws for
//            session_not_found) · AuthApiError (:50) with status 401 / 403
//   outage = everything else — AuthRetryableFetchError (:268; fetch.ts:42
//            network throw, status 0; fetch.ts:45 502/503/504), AuthApiError
//            ≥ 500 or 429, AuthUnknownError — and the request passes through
//            unchanged so admission answers exactly as it does today.
// Production, every non-Business path and every public segment never make the
// call at all (and /api never reaches this file — see the matcher).
function sessionGone(user: unknown, error: unknown): boolean {
  if (!error) return !user
  const e = error as { name?: unknown; status?: unknown }
  if (e.name === 'AuthSessionMissingError') return true
  return e.name === 'AuthApiError' && (e.status === 401 || e.status === 403)
}

export async function proxy(request: NextRequest) {
  // Run next-intl middleware first (handles locale redirects, prefix routing)
  const intlResponse = intlMiddleware(request)

  // If intl wants to redirect (e.g., / → /en), honour it
  if (intlResponse.status !== 200) {
    return intlResponse
  }

  let response = intlResponse

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh auth token — getClaims() is JWT-local (fast), not a network call
  const { data } = await supabase.auth.getClaims()

  const segments = request.nextUrl.pathname.split('/').filter(Boolean)
  const locale = segments[0]
  const section = segments[1]
  // Public: marketing root (/{locale}) and the login/signup/join/auth routes.
  const isPublic = !section || PUBLIC_SEGMENTS.includes(section)

  let signedOut = !data?.claims
  if (
    !signedOut &&
    !isPublic &&
    section === 'business' &&
    locale !== 'api' && // belt to the matcher's braces: /api never asks here
    process.env.VERCEL_ENV === 'preview'
  ) {
    // A throw is an outage too: pass through, never a proxy 500.
    try {
      const { data: got, error } = await supabase.auth.getUser()
      signedOut = sessionGone(got?.user, error)
    } catch {
      signedOut = false
    }
  }

  if (signedOut && !isPublic) {
    const url = request.nextUrl.clone()
    // ⚖ Liam flag 70 (2026-08-22) — CARRY WHERE THEY WERE GOING. Every preview
    // alias is its own origin, so a link into one always lands on a fresh
    // login; this used to throw the destination away and the login page had
    // nothing to honour, so a Business link put the operator on the Karute
    // dashboard. The intended path rides along and the login honours it once.
    // `_rsc` is Next's internal cache-buster on client navigations, not part of
    // where the operator was going — it must never ride into the destination.
    const carried = new URLSearchParams(request.nextUrl.search)
    carried.delete('_rsc')
    const qs = carried.toString()
    const next = `${request.nextUrl.pathname}${qs ? `?${qs}` : ''}`
    url.pathname = `/${locale}/login`
    url.search = ''
    // Write what the GATE returns, never the raw value. They are identical
    // today — the gate refuses and never repairs — but the moment it ever
    // normalises, the carried value must be the normalised one.
    const gated = safeNext(next)
    if (gated) url.searchParams.set('next', gated)
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: '/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)',
}
