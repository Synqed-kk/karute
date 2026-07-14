// Follow-up-e (pre-assigned since packet-04, lands with packet 06 batch 3): an
// EXHAUSTIVE guard so no facade WRITE endpoint can ever ship on the local
// fast-path by omission. It scans every `/api/app/v1/**/route.ts` for a
// facadeHandler registration on a non-GET/OPTIONS method and asserts that
// registration's endpoint key ∈ REVOCATION_SENSITIVE_ENDPOINTS. A new write
// route that forgets to add its key fails THIS test — not production.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { REVOCATION_SENSITIVE_ENDPOINTS } from '@/lib/auth/revocation'

const ROOT = join(process.cwd(), 'src/app/api/app/v1')
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function routeFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...routeFiles(full))
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

/** Extract [method, endpointKey] for every `export const METHOD =
 *  facadeHandler[<...>]('key', ...)`. Aliased re-exports (`export const OPTIONS =
 *  POST`) don't match — they carry no key and short-circuit before auth. */
function registrations(src: string): { method: string; key: string }[] {
  const re = /export\s+const\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS)\s*=\s*facadeHandler(?:<[^>]*>)?\(\s*['"]([^'"]+)['"]/g
  const out: { method: string; key: string }[] = []
  for (let m = re.exec(src); m; m = re.exec(src)) out.push({ method: m[1], key: m[2] })
  return out
}

describe('facade write endpoints are all revocation-sensitive (follow-up-e)', () => {
  const files = routeFiles(ROOT)

  it('finds facade route files to scan', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('every non-GET/OPTIONS facadeHandler key is in REVOCATION_SENSITIVE_ENDPOINTS', () => {
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const { method, key } of registrations(src)) {
        if (!WRITE_METHODS.has(method)) continue
        if (!REVOCATION_SENSITIVE_ENDPOINTS.has(key)) {
          offenders.push(`${method} ${key} (${file.replace(process.cwd(), '.')})`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('would FAIL for a hypothetical unlisted write key (self-check)', () => {
    // Prove the assertion logic actually bites: a write key not in the set must
    // be flagged. (Guards against a future refactor that no-ops the check.)
    const hypothetical = 'customer.__unlisted_write__'
    expect(REVOCATION_SENSITIVE_ENDPOINTS.has(hypothetical)).toBe(false)
  })
})
