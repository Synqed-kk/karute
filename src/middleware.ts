import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Path segments that stay public (no auth required). Everything else under a
// locale is an (app) route and requires a session.
const PUBLIC_SEGMENTS = ['login', 'signup', 'join', 'auth']

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

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
            request.cookies.set(name, value),
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // IMPORTANT: refreshes the session cookie on every request. Do not remove.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const segments = request.nextUrl.pathname.split('/').filter(Boolean)
  const locale = segments[0]
  const section = segments[1]
  // Public: marketing root (/{locale}) and the login/signup/join/auth routes.
  const isPublic = !section || PUBLIC_SEGMENTS.includes(section)

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = `/${locale}/login`
    url.search = ''
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
