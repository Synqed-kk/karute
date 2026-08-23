/**
 * ⚖ Liam flag 70 (2026-08-22) — the login honours the deep link.
 *
 * His repro: every Business preview link he opened landed him on the Karute
 * dashboard. Each preview alias is its own origin, so the link always hits a
 * fresh login; the middleware threw the destination away (`url.search = ''`
 * with nothing put back) and the login page had nothing to honour.
 *
 * Two halves, pinned here: the wall CARRIES the intended path, and the success
 * path HONOURS it once — through a sanitizer, because an open redirect on a
 * real login page is a security defect, not a routing nit.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { safeNext } from '@/lib/auth/safe-next'

const mockIntl = jest.fn()
const mockGetClaims = jest.fn()

jest.mock('next-intl/middleware', () => ({
  __esModule: true,
  default: () => (req: unknown) => mockIntl(req),
}))
jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getClaims: (...a: unknown[]) => mockGetClaims(...a) } }),
}))
jest.mock('@/i18n/routing', () => ({ routing: {} }))

import { proxy } from '@/proxy'

beforeEach(() => {
  jest.clearAllMocks()
  mockIntl.mockReturnValue(NextResponse.next())
  // Signed OUT — every case below is a wall hit.
  mockGetClaims.mockResolvedValue({ claims: null })
})

const wall = async (href: string) => {
  const res = await proxy(new NextRequest(new URL(href)))
  return new URL(res.headers.get('location')!)
}

describe('the auth wall carries where the operator was going', () => {
  it('a Business deep link survives the redirect, path AND query', async () => {
    const to = await wall('https://karute.app/ja/business/today?store=store-a&day=1')
    expect(to.pathname).toBe('/ja/login')
    expect(to.searchParams.get('next')).toBe('/ja/business/today?store=store-a&day=1')
  })

  it('the Karute side is carried by the same one rule — it is the app\'s one login', async () => {
    const to = await wall('https://karute.app/en/karute/cus-01')
    expect(to.pathname).toBe('/en/login')
    expect(to.searchParams.get('next')).toBe('/en/karute/cus-01')
  })

  it("Next's internal `_rsc` cache-buster never rides along — it is plumbing, not a destination", async () => {
    const to = await wall('https://karute.app/ja/business/today?store=a&_rsc=abc')
    expect(to.searchParams.get('next')).toBe('/ja/business/today?store=a')
  })

  it('a destination whose ONLY param was `_rsc` carries no orphaned `?`', async () => {
    const to = await wall('https://karute.app/ja/business/today?_rsc=abc')
    expect(to.searchParams.get('next')).toBe('/ja/business/today')
  })

  it('a query-less destination is carried byte-identical to today — no trailing `?`', async () => {
    const to = await wall('https://karute.app/ja/business/today')
    expect(to.searchParams.get('next')).toBe('/ja/business/today')
  })

  it('a public route is not walled at all, so it carries nothing', async () => {
    const res = await proxy(new NextRequest(new URL('https://karute.app/ja/signup')))
    expect(res.headers.get('location')).toBeNull()
    expect(res).toBeInstanceOf(NextResponse)
  })
})

describe('safeNext — only a relative same-origin path survives', () => {
  it('keeps a real destination, query and all', () => {
    expect(safeNext('/ja/business/today')).toBe('/ja/business/today')
    expect(safeNext('/ja/business/today?store=store-a&day=1')).toBe('/ja/business/today?store=store-a&day=1')
    // Hyphens and percent-encoding are ordinary path content.
    expect(safeNext('/ja/reset-password')).toBe('/ja/reset-password')
    expect(safeNext('/ja/karute/%E3%81%82')).toBe('/ja/karute/%E3%81%82')
  })

  it('DROPS an absolute URL — the open-redirect case', () => {
    expect(safeNext('https://evil.test/steal')).toBeNull()
    expect(safeNext('http://evil.test')).toBeNull()
  })

  it('DROPS a protocol-relative path — same origin to a regex, another host to a browser', () => {
    expect(safeNext('//evil.test/steal')).toBeNull()
    expect(safeNext('///evil.test')).toBeNull()
  })

  it('DROPS backslashes — browsers normalise them to slashes', () => {
    expect(safeNext('/\\evil.test')).toBeNull()
    expect(safeNext('\\\\evil.test')).toBeNull()
    expect(safeNext('/ja/business\\..\\..')).toBeNull()
  })

  it('DROPS anything not rooted here, and anything malformed', () => {
    expect(safeNext('evil.test')).toBeNull()
    expect(safeNext('javascript:alert(1)')).toBeNull()
    expect(safeNext('/ja/today\npath')).toBeNull()
    expect(safeNext('/ja/today path')).toBeNull()
    expect(safeNext('/ja/\x00today')).toBeNull()
  })

  it('DROPS /api/ — a place to land after signing in is a PAGE, not a data endpoint', () => {
    expect(safeNext('/api/export.csv')).toBeNull()
    expect(safeNext('/api/customers/export')).toBeNull()
    expect(safeNext('/api')).toBeNull()
  })

  it('DROPS /_next/ — Next\'s own asset plumbing is not a place either', () => {
    expect(safeNext('/_next/static/chunks/main.js')).toBeNull()
    expect(safeNext('/_next')).toBeNull()
  })

  it('KEEPS a path that merely STARTS with those letters — the refusal is the segment, not the prefix', () => {
    expect(safeNext('/apidocs')).toBe('/apidocs')
    expect(safeNext('/ja/api/x')).toBe('/ja/api/x')
    expect(safeNext('/_nextdoor')).toBe('/_nextdoor')
  })

  /** Browsers STRIP tabs out of URLs, so `/<tab>/evil.test` collapses toward
   *  `//evil.test` — the protocol-relative escape above, wearing a disguise.
   *  The control-character regex already catches it; this pins it so it can
   *  never regress silently. The tab is written as the ESCAPE SEQUENCE on
   *  purpose: a literal control byte got #754's test file classified as binary
   *  and made it invisible to review. */
  it('DROPS a tab after the leading slash — it collapses toward //evil.test', () => {
    expect(safeNext('/\t/evil.test')).toBeNull()
  })

  it('absent or empty is null, which is what makes the fallback today\'s behaviour', () => {
    expect(safeNext(null)).toBeNull()
    expect(safeNext(undefined)).toBeNull()
    expect(safeNext('')).toBeNull()
  })

  /** GREPTILE #754 P1 — a query string can say the same thing twice, and Next.js
   *  hands a repeated key over as an ARRAY. `.startsWith` is not a thing an array
   *  can do, so this threw — and it threw AFTER `signInWithPassword` had already
   *  succeeded, which is the worst place on the flow to throw: the operator is
   *  signed in, on the login page, going nowhere. It is a null like every other
   *  value this gate refuses, so the dashboard fallback carries them. */
  it('DROPS a repeated ?next= — an array is not a path, and it must not throw', () => {
    expect(() => safeNext(['/ja/business/today', '/ja/karute'])).not.toThrow()
    expect(safeNext(['/ja/business/today', '/ja/karute'])).toBeNull()
    // Even a single-element array: it is still not the string the caller pushes.
    expect(safeNext(['/ja/business/today'])).toBeNull()
    expect(safeNext([])).toBeNull()
    // …and the login falls back to today's destination rather than dying.
    expect(safeNext(['/ja/x', '//evil.test']) ?? '/ja/dashboard').toBe('/ja/dashboard')
  })
})

describe('the login success path honours it ONCE, and falls back to today', () => {
  // The form is a client component and @testing-library is not in this
  // territory, so the wiring is pinned on the source: one expression, the
  // sanitizer in front of it, and the old destination as the fallback.
  const form = readFileSync(join(process.cwd(), 'src/components/login-form.tsx'), 'utf8')
  const page = readFileSync(join(process.cwd(), 'src/app/[locale]/login/page.tsx'), 'utf8')

  it('pushes the sanitized next, or the dashboard when there is none', () => {
    expect(form).toContain('router.push(safeNext(next) ?? `/${locale}/dashboard`)')
    // No second, un-gated push survives.
    expect(form.match(/router\.push\(/g)).toHaveLength(1)
    expect(form).toContain("import { safeNext } from '@/lib/auth/safe-next'")
  })

  it('the page forwards the raw value and the FORM owns the gate', () => {
    expect(page).toContain('<LoginForm locale={locale} next={next} />')
    // GREPTILE #754 P1 — the type says what Next.js DELIVERS. A repeated key is
    // an array, and the old `next?: string` was a cast that let the array walk
    // to `.startsWith` unchallenged. With the honest shape here, nothing can turn
    // this value into a path except the gate.
    expect(page).toContain('searchParams: Promise<{ error?: string | string[]; next?: string | string[] }>')
    expect(form).toContain('next?: string | string[] | null')
    // One home for the rule: the page does not sanitize and then hand over a
    // value the component trusts blindly.
    expect(page).not.toContain('safeNext')
  })

  it('no next = today\'s destination, byte for byte', () => {
    expect(safeNext(undefined) ?? '/ja/dashboard').toBe('/ja/dashboard')
  })
})
