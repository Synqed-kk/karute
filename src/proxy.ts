import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'

const intlMiddleware = createMiddleware(routing)

// Path segments that stay public (no auth required). Everything else under a
// locale is an (app) route and requires a session.
const PUBLIC_SEGMENTS = ['login', 'signup', 'join', 'auth']

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

  if (!data?.claims && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = `/${locale}/login`
    url.search = ''
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: '/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)',
}
