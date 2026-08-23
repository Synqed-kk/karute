/**
 * ⚖ Liam flag 70 (2026-08-22) — WHERE THE LINK WAS POINTING, CARRIED SAFELY.
 *
 * Every preview alias is its own origin, so a link into one lands on a fresh
 * login. The middleware discarded the destination and the login page had
 * nothing to honour, so an operator opening a Business link was dropped on the
 * Karute dashboard instead. The redirect now carries `?next=`, and this is the
 * gate it goes through in both directions.
 *
 * ONLY a relative, same-origin PATH survives. An open redirect here would let a
 * crafted link walk someone from our real login straight onto an attacker's
 * page with their guard down, so this refuses rather than repairs: anything a
 * browser could read as another host is dropped and the caller falls back to
 * its own default.
 */
export function safeNext(value: string | string[] | null | undefined): string | null {
  // GREPTILE #754 P1 — AND A QUERY STRING CAN SAY A THING TWICE. `?next=a&next=b`
  // reaches a page as `string[]`, not `string`; the old signature said otherwise,
  // so `.startsWith` threw on the array — AFTER the password had been accepted.
  // The operator was signed in and standing on a dead page. The parameter type is
  // now the shape Next.js actually delivers, which makes this gate the only way
  // to turn one into a path anywhere in the app.
  if (typeof value !== 'string' || !value) return null
  // Must be rooted here. Absolute URLs ("https://evil.test"), scheme-relative
  // paths and bare words all fail this.
  if (!value.startsWith('/')) return null
  // "//evil.test" is protocol-relative — same origin to a regex, another host
  // to a browser.
  if (value.startsWith('//')) return null
  // Backslashes ("/\evil.test") are normalised to slashes by browsers, so they
  // are the same attack in a different spelling. Control characters and
  // whitespace are dropped for the same reason: they let a value read one way
  // to a check and another way to a navigator. No legitimate path carries any
  // of them un-encoded.
  // eslint-disable-next-line no-control-regex
  if (/[\\\s]/.test(value) || /[\x00-\x1f\x7f]/.test(value)) return null
  // A place to land after signing in is a PAGE — never data, never a file.
  // A crafted link must not be able to spend a fresh session on one, or the
  // login hands the operator a download instead of a screen.
  //
  // Judged on the PATH, so `?`/`#` cannot smuggle a value past the boundary:
  // `/api?x=1` and `/api#x` are the `/api` route however they are spelled.
  const path = value.split(/[?#]/)[0]
  const segments = path.split('/')
  // `/api/…` is data and `/_next/…` is Next's own asset plumbing. Compared as
  // a whole SEGMENT, not a prefix — `/apidocs` and `/_nextdoor` are ordinary
  // pages and stay welcome.
  if (segments[1] === 'api' || segments[1] === '_next') return null
  // No page lives under an `auth` segment. `/{locale}/auth/callback` is the
  // tree's only route handler outside /api, and a one-shot code-exchange URL
  // is not somewhere to land — its only other backstop is @supabase/ssr's
  // PKCE default, which is not this gate's to rely on.
  if (segments.includes('auth')) return null
  // A dot means a FILE (`/icon.png`, `/fonts/….ttf`, anything under public/),
  // which is the stated harm class in its plainest form. This mirrors the
  // middleware matcher's own `.*\..*` exclusion, so what the wall never guards
  // is exactly what this refuses to carry. The QUERY is already off the table
  // above, so `?v=1.2` on a real page survives.
  if (path.includes('.')) return null
  // Case-sensitivity (F4, recorded so it is not rediscovered as a defect):
  // these comparisons are exact, matching Next's own case-sensitive routing —
  // `/API/x` is not the api route, so it resolves to no page and dead-ends at
  // a 404 rather than reaching data.
  return value
}
