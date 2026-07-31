// CORS contract (packet 03 point 6). The credential-theft misconfiguration this
// proves against: a shell (capacitor) origin must NEVER be reflected with
// Access-Control-Allow-Credentials; only our own site origins get credentials.
import { readdirSync, readFileSync } from 'fs'
import { join, relative } from 'path'

import { classifyOrigin, corsHeaders, preflightResponse } from '@/lib/app-api/cors'

const ENV = { FACADE_SITE_ORIGINS: 'https://karute.example.com,https://www.karute.example.com' } as unknown as NodeJS.ProcessEnv

describe('facade CORS', () => {
  it('classifies site / shell / unknown origins', () => {
    expect(classifyOrigin('https://karute.example.com', ENV)).toBe('site')
    expect(classifyOrigin('capacitor://localhost', ENV)).toBe('shell')
    expect(classifyOrigin('https://localhost', ENV)).toBe('shell') // Android default
    expect(classifyOrigin('https://evil.example', ENV)).toBe('unknown')
    expect(classifyOrigin(null, ENV)).toBe('unknown')
  })

  it('site origin → credentialed CORS', () => {
    const h = corsHeaders('https://karute.example.com', ENV)
    expect(h['Access-Control-Allow-Origin']).toBe('https://karute.example.com')
    expect(h['Access-Control-Allow-Credentials']).toBe('true')
    expect(h['Vary']).toBe('Origin')
  })

  it('shell (capacitor) origin → CORS WITHOUT credentials', () => {
    const h = corsHeaders('capacitor://localhost', ENV)
    expect(h['Access-Control-Allow-Origin']).toBe('capacitor://localhost')
    expect(h['Access-Control-Allow-Credentials']).toBeUndefined() // the load-bearing assertion
  })

  it('unknown origin → no Access-Control-Allow-Origin (browser blocks)', () => {
    const h = corsHeaders('https://evil.example', ENV)
    expect(h['Access-Control-Allow-Origin']).toBeUndefined()
    expect(h['Vary']).toBe('Origin')
  })

  it('preflight advertises every non-safelisted mobile header + method', () => {
    const res = preflightResponse('capacitor://localhost', ENV)
    expect(res.status).toBe(204)
    const allowHeaders = res.headers.get('Access-Control-Allow-Headers') ?? ''
    for (const hdr of ['Authorization', 'store-id', 'Idempotency-Key', 'If-Match', 'app-version', 'platform', 'request-id']) {
      expect(allowHeaders).toContain(hdr)
    }
    const allowMethods = res.headers.get('Access-Control-Allow-Methods') ?? ''
    for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) expect(allowMethods).toContain(m)
    expect(res.headers.get('Access-Control-Max-Age')).toBe('600')
  })

  // A facade route exporting a method the CORS allow-list omits fails ONLY at
  // runtime, from the shell, as an opaque "Load failed" (preflight 204s, the
  // browser then refuses the real request — how the staff/[id]/permissions PUT
  // shipped broken). Walk the real route files so the list can't drift behind
  // the routes. Catches `export const M =`, `export async function M(`, and
  // `export { M }` styles; a style none of these match would show up as the
  // known-fixture self-check failing, not as a silent pass.
  describe('CORS allow-list ↔ facade route methods', () => {
    const METHOD = /(?:export\s+(?:const|async\s+function)\s+(GET|POST|PUT|PATCH|DELETE)\b)|(?:export\s*\{[^}]*?\b(GET|POST|PUT|PATCH|DELETE)\b[^}]*?\})/g
    const root = join(process.cwd(), 'src/app/api/app/v1')
    const routeFiles: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name)
        if (entry.isDirectory()) walk(p)
        else if (/^route\.(ts|tsx|js|mjs)$/.test(entry.name)) routeFiles.push(p)
      }
    }
    walk(root)
    const methodsByFile = new Map(
      routeFiles.map((f) => {
        const src = readFileSync(f, 'utf8')
        const methods = new Set(
          [...src.matchAll(METHOD)].map(([, a, b]) => a ?? b).filter((m): m is string => !!m),
        )
        return [relative(root, f), { methods, hasOptions: /export\s+const\s+OPTIONS\b/.test(src) }] as const
      }),
    )
    const allowMethods =
      preflightResponse('capacitor://localhost', ENV).headers.get('Access-Control-Allow-Methods') ?? ''

    it('scanner self-check: sees PUT on the route that shipped broken', () => {
      // If the extraction regex rots, this known fixture fails loudly instead
      // of every file silently contributing zero assertions (the sibling
      // revocation-coverage test pins its scanner the same way).
      expect([...(methodsByFile.get('staff/[id]/permissions/route.ts')?.methods ?? [])]).toEqual(
        expect.arrayContaining(['GET', 'PUT']),
      )
      expect(methodsByFile.size).toBeGreaterThan(0)
    })

    it('every exported route method is in ALLOWED_METHODS', () => {
      for (const [file, { methods }] of methodsByFile) {
        for (const method of methods) {
          expect(`${file} needs ${allowMethods.includes(method) ? method : 'MISSING ' + method}`).toBe(
            `${file} needs ${method}`,
          )
        }
      }
    })

    it('every facade route exports OPTIONS (a missing preflight handler 405s = the same opaque shell failure)', () => {
      for (const [file, { hasOptions }] of methodsByFile) {
        expect(`${file} ${hasOptions ? 'has OPTIONS' : 'MISSING OPTIONS'}`).toBe(`${file} has OPTIONS`)
      }
    })

    it('ALLOWED_METHODS carries no method no route uses (two-way ratchet)', () => {
      const used = new Set<string>(['OPTIONS']) // preflight itself, exported as an alias
      for (const { methods } of methodsByFile.values()) for (const m of methods) used.add(m)
      for (const listed of allowMethods.split(',').map((s) => s.trim()).filter(Boolean)) {
        expect(`${listed} ${used.has(listed) ? 'used' : 'UNUSED in routes'}`).toBe(`${listed} used`)
      }
    })
  })
})
