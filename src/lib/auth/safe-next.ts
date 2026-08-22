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
export function safeNext(value: string | null | undefined): string | null {
  if (!value) return null
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
  return value
}
