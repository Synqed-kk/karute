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
  // shipped broken). Walk the real route files so the list can never drift
  // behind the routes again.
  it('ALLOWED_METHODS covers every method exported by a facade route', () => {
    const root = join(process.cwd(), 'src/app/api/app/v1')
    const routeFiles: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name)
        if (entry.isDirectory()) walk(p)
        else if (entry.name === 'route.ts') routeFiles.push(p)
      }
    }
    walk(root)
    expect(routeFiles.length).toBeGreaterThan(0)
    const allowMethods =
      preflightResponse('capacitor://localhost', ENV).headers.get('Access-Control-Allow-Methods') ?? ''
    for (const file of routeFiles) {
      const src = readFileSync(file, 'utf8')
      for (const [, method] of src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)) {
        expect(`${relative(root, file)} needs ${allowMethods.includes(method) ? method : 'MISSING ' + method}`).toBe(
          `${relative(root, file)} needs ${method}`,
        )
      }
    }
  })
})
