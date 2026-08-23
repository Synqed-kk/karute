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
  // A place to land after signing in is a PAGE. `/api/…` is data, not a
  // destination, so a crafted link must not be able to spend a fresh session
  // on one — the login would hand the operator a file download instead of a
  // screen. `/_next/…` is Next's own asset plumbing and is never a place
  // either. Refuse, like everything else here: no stripping, no rewriting.
  if (value === '/api' || value.startsWith('/api/')) return null
  if (value === '/_next' || value.startsWith('/_next/')) return null
  return value
}
