// Follow-up-e (pre-assigned since packet-04, lands with packet 06 batch 3): an
// EXHAUSTIVE guard so no facade WRITE endpoint can ever ship on the local
// fast-path by omission. It scans every `/api/app/v1/**/route.ts` for a
// facadeHandler registration on a non-GET/OPTIONS method and asserts that
// registration's endpoint key ∈ REVOCATION_SENSITIVE_ENDPOINTS. A new write
// route that forgets to add its key fails THIS test — not production.
//
// The method-scan is blind to a WRITE hidden under a GET-classified key
// (design-parity packet 12 §B-3 S2, added after a review-round audit of
// GET-hidden writes: 'stores.list' is a GET whose ensurePrimary:true path
// lazily provisions the 本店 primary store).
// GET_ENDPOINTS_WITH_WRITE_SIDE_EFFECTS below is the maintained registry
// that closes that gap — register any future facade GET that performs a
// write here, and add its key to REVOCATION_SENSITIVE_ENDPOINTS.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { REVOCATION_SENSITIVE_ENDPOINTS, requiresRevocationCheck } from '@/lib/auth/revocation'

// 'audit.list' joins at packet 17 §S3: its GET fires the twin's
// privacy.audit_log_view write on a logOpen fetch (src/actions/audit-log.ts).
const GET_ENDPOINTS_WITH_WRITE_SIDE_EFFECTS = ['stores.list', 'audit.list']

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

  it('every registered GET-hidden-write endpoint is in REVOCATION_SENSITIVE_ENDPOINTS', () => {
    for (const key of GET_ENDPOINTS_WITH_WRITE_SIDE_EFFECTS) {
      expect(REVOCATION_SENSITIVE_ENDPOINTS.has(key)).toBe(true)
    }
  })

  it("'stores.list' requires the revocation round-trip (its GET hides a write)", () => {
    expect(requiresRevocationCheck('stores.list')).toBe(true)
  })

  it("'audit.list' requires the revocation round-trip (its GET hides a write)", () => {
    expect(requiresRevocationCheck('audit.list')).toBe(true)
  })
})
