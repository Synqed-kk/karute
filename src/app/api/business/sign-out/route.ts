// ⚖ R53 — ログアウト from the Business shell. Server-side, inside the fence: the
// sign-out itself lives in admission.ts (one of the two files the play-phase fence
// lets hold a supabase client); its signOut() clears the session cookies on this response. No admission read — a
// person signing out needs no business admission; with no session this is a
// no-op 200. The phone's vault wipe is not done here (the login page owns it).
// Unexported methods (GET, …) are answered 405 by Next's route handler runtime.

import { endSession } from '@/business/lib/admission'

const NO_STORE = { 'Cache-Control': 'no-store' }

/** Strict same-origin — MIRRORED line for line from api/business/card-color/route.ts
 *  (a file-local function there, not a shared helper). With an Origin header, it must
 *  name this request's own scheme and the `host` this server received — never
 *  `x-forwarded-host`. Without an Origin, only `Sec-Fetch-Site: same-origin` passes. */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  const host = req.headers.get('host') ?? ''
  if (origin !== null) {
    try {
      return host !== '' && new URL(origin).origin === `${new URL(req.url).protocol}//${host}`
    } catch {
      return false
    }
  }
  return req.headers.get('sec-fetch-site') === 'same-origin'
}

export async function POST(req: Request): Promise<Response> {
  // The card-color route's refusal, same status and body.
  if (!sameOrigin(req)) return Response.json({ ok: false, reason: 'forbidden' }, { status: 403, headers: NO_STORE })
  return (await endSession())
    ? Response.json({ ok: true }, { status: 200, headers: NO_STORE })
    : Response.json({ ok: false }, { status: 500, headers: NO_STORE })
}
