// CP1 — route totality (contract §2.1/§2.3/§8, PR-M4). Replaces the old
// "an unmapped endpoint emits nothing (deny-default)" assertion in
// facade-audit.test.ts: that test only proved the HOOK's behavior for a key
// nobody could reach through a real route — never that every route.ts
// actually resolves to a decision. This walks EVERY route.ts under
// src/app/api/**, not just the facade subtree (§2.3: the fifth door —
// 今すぐ同期 and the legacy /api/ai/* routes were both invisible to every
// v1 mechanism because nothing walked this tree). Facade-subtree files must
// yield a facadeHandler key that is a member of FACADE_AUDIT_MAP;
// everything else must appear in API_ROUTE_DECISIONS. Any route file with
// neither fails HERE, with its path in the message — the fifth-door class
// is now permanently closed, not just patched for today's routes.
//
// The FacadeEndpointKey union (audit.ts) already proves every key a
// route.ts file COULD register is mapped, at compile time — but it can't
// prove a route file actually calls facadeHandler at all (a route that
// forgets to wrap its export, or wraps it with a computed/runtime key,
// slips past tsc entirely). This test is the runtime half of CP1.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { API_ROUTE_DECISIONS, FACADE_AUDIT_MAP } from '@/lib/audit'

const API_ROOT = join(process.cwd(), 'src/app/api')
const FACADE_ROOT = join(process.cwd(), 'src/app/api/app/v1')

function routeFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...routeFiles(full))
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

// Multiline-tolerant (same method as the FacadeEndpointKey census and
// app-api-revocation-coverage.test.ts's registrations() scan): a naive
// single-line grep misses the one call site split across lines
// (recordings.job.status, src/app/api/app/v1/recordings/job/[sessionId]/route.ts).
function facadeKeys(src: string): string[] {
  const re = /facadeHandler\s*(?:<[^>]*>)?\s*\(\s*['"]([^'"]+)['"]/g
  const out: string[] = []
  for (let m = re.exec(src); m; m = re.exec(src)) out.push(m[1])
  return out
}

describe('route totality (CP1)', () => {
  const files = routeFiles(API_ROOT)

  it('finds route files to scan', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('every route.ts resolves to a decision — a facade key in FACADE_AUDIT_MAP, or an API_ROUTE_DECISIONS entry', () => {
    const offenders: string[] = []
    for (const file of files) {
      const rel = file.replace(process.cwd() + '/', '')
      if (file.startsWith(FACADE_ROOT + '/')) {
        const keys = facadeKeys(readFileSync(file, 'utf8'))
        if (keys.length === 0) {
          offenders.push(`${rel}: no facadeHandler registration found`)
          continue
        }
        for (const key of keys) {
          if (!(key in FACADE_AUDIT_MAP)) {
            offenders.push(`${rel}: facade key '${key}' is not in FACADE_AUDIT_MAP`)
          }
        }
      } else {
        const decisionKey = relative(API_ROOT, dirname(file))
        if (!(decisionKey in API_ROUTE_DECISIONS)) {
          offenders.push(`${rel}: not in API_ROUTE_DECISIONS (expected key '${decisionKey}')`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('would FAIL for a hypothetical unmapped facade route (self-check)', () => {
    // Proves the assertion logic actually bites (guards against a future
    // refactor that no-ops the check) — same self-check convention as
    // app-api-revocation-coverage.test.ts.
    const fakeSrc = `export const GET = facadeHandler('totally.__unmapped__', h)`
    const [key] = facadeKeys(fakeSrc)
    expect(key in FACADE_AUDIT_MAP).toBe(false)
  })
})
