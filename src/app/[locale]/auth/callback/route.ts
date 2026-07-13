import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { bootstrapBusinessForNewUser } from '@/actions/bootstrap'

/**
 * Email-confirmation callback. Supabase sends the confirm link here with a
 * one-time `code`. We exchange it for a session (sets cookies), then run the
 * idempotent, service-role bootstrap using the salon name stashed in user
 * metadata at signup. Any failure lands the user on the login page with a
 * confirm-error banner rather than a dead marketing page.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { locale } = await params
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const fail = NextResponse.redirect(
    new URL(`/${locale}/login?error=confirm`, url.origin),
  )
  if (!code) return fail

  const supabase = await createClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error || !data.user) return fail

  const salonName =
    (data.user.user_metadata?.salon_name as string | undefined) ??
    data.user.email ??
    'Salon'
  const result = await bootstrapBusinessForNewUser(salonName, data.user.id)
  if (!result.ok) return fail

  return NextResponse.redirect(new URL(`/${locale}/sessions`, url.origin))
}
