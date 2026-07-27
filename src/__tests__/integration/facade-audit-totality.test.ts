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
import { API_ROUTE_DECISIONS, FACADE_AUDIT_MAP, type ApiRouteDecision } from '@/lib/audit'

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

// ── CP1 hardening (contract §8, PR-M4 fix round F4) ─────────────────────
// The two checks above prove every route.ts registers AT LEAST ONE mapped
// key/decision — they never looked at whether a file with SEVERAL exported
// HTTP methods covers all of them. A mutant that survived the blind round:
// add a second bare (unwrapped) export to a facade file, or add a second
// method to a non-facade route without extending its decision — both slip
// past the checks above untouched. These two suites close that gap.

/** method -> the RHS expression assigned to it, e.g. `facadeHandler<P>('x', fn)`
 *  or a bare identifier (`POST`, the OPTIONS-alias idiom). Facade route files
 *  only ever use the `export const METHOD = ...` form (verified across the
 *  whole app/v1 tree — none use `export function METHOD`). */
function facadeMethodExports(src: string): Record<string, string> {
  const re = /^export const (GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*=\s*(.+)$/gm
  const out: Record<string, string> = {}
  for (let m = re.exec(src); m; m = re.exec(src)) out[m[1]] = m[2].trim()
  return out
}

function isFacadeWrapped(rhs: string): boolean {
  return /^facadeHandler\s*(?:<[^>]*>)?\s*\(/.test(rhs)
}

/** Methods that are neither facadeHandler-wrapped themselves nor an alias
 *  (`export const OPTIONS = POST`) of another exported method IN THE SAME
 *  FILE that is. Empty = the file's every export is accounted for. */
function unwrappedFacadeMethods(src: string): string[] {
  const exported = facadeMethodExports(src)
  const offenders: string[] = []
  for (const [method, rhs] of Object.entries(exported)) {
    if (isFacadeWrapped(rhs)) continue
    const aliasTarget = /^([A-Z]+)\b/.exec(rhs)?.[1]
    if (aliasTarget && exported[aliasTarget] && isFacadeWrapped(exported[aliasTarget])) continue
    offenders.push(method)
  }
  return offenders
}

describe('CP1 hardening — every facade export is wrapped or aliases a wrapped export', () => {
  const files = routeFiles(API_ROOT).filter((f) => f.startsWith(FACADE_ROOT + '/'))

  it('every exported HTTP method in every facade route.ts is facadeHandler-wrapped (or aliases one that is)', () => {
    const offenders: string[] = []
    for (const file of files) {
      const rel = file.replace(process.cwd() + '/', '')
      for (const method of unwrappedFacadeMethods(readFileSync(file, 'utf8'))) {
        offenders.push(`${rel}: exported ${method} is not facadeHandler-wrapped and does not alias a wrapped export`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('would FAIL for a file with one wrapped export and one bare export (self-check / mutant proof)', () => {
    const fakeSrc = [
      `export const GET = facadeHandler('customer.read', async (ctx) => ok(ctx, {}))`,
      `export const POST = async (req) => new Response(null)`,
    ].join('\n')
    expect(unwrappedFacadeMethods(fakeSrc)).toEqual(['POST'])
  })

  it('accepts the OPTIONS-alias idiom (self-check)', () => {
    const fakeSrc = [
      `export const POST = facadeHandler('customer.update', async (ctx) => ok(ctx, {}))`,
      `export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.`,
    ].join('\n')
    expect(unwrappedFacadeMethods(fakeSrc)).toEqual([])
  })
})

/** Non-facade routes use `export async function METHOD(...)` / `export
 *  function METHOD(...)` (verified across the whole non-facade route set —
 *  none use the `const` form). */
function nonFacadeMethodExports(src: string): string[] {
  const re = /^export (?:async )?function (GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/gm
  const out: string[] = []
  for (let m = re.exec(src); m; m = re.exec(src)) out.push(m[1])
  return out
}

function isMethodKeyed(
  entry: ApiRouteDecision | Record<string, ApiRouteDecision>,
): entry is Record<string, ApiRouteDecision> {
  return !('kind' in entry)
}

describe('CP1 hardening — every method on a decisioned non-facade route is covered', () => {
  const files = routeFiles(API_ROOT).filter((f) => !f.startsWith(FACADE_ROOT + '/'))

  it('every exported method has its own decision, or the directory-level decision covers all methods', () => {
    const offenders: string[] = []
    for (const file of files) {
      const rel = file.replace(process.cwd() + '/', '')
      const decisionKey = relative(API_ROOT, dirname(file))
      const entry = API_ROUTE_DECISIONS[decisionKey]
      if (!entry) continue // caught by the route-totality test above
      if (!isMethodKeyed(entry)) continue // one directory-level decision covers every method
      for (const method of nonFacadeMethodExports(readFileSync(file, 'utf8'))) {
        if (!(method in entry)) {
          offenders.push(`${rel}: exported ${method} has no API_ROUTE_DECISIONS['${decisionKey}'].${method} entry`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('would FAIL for a method-keyed decision missing one exported method (self-check / mutant proof)', () => {
    const fakeSrc = ['export async function GET() {}', 'export async function POST() {}'].join('\n')
    const fakeDecision: Record<string, ApiRouteDecision> = {
      GET: { kind: 'skip', justification: 'x', dated: '2026-07-27' },
    }
    const offenders = nonFacadeMethodExports(fakeSrc).filter((m) => !(m in fakeDecision))
    expect(offenders).toEqual(['POST'])
  })
})

// CP8 forerunner — ground-truth disposition pin (M4 delta-verify finding,
// 2026-07-27): the parameterized hook pins derive their expectations from the
// map itself, so a quiet map edit (live row flipped to skip, an action
// renamed, a pending row going live) moves test and code in LOCKSTEP and
// ships green — proven by a full-suite mutant. This table is the HARDCODED
// truth: any disposition change must edit this snapshot too, making the
// reclassification a visible, reviewable diff (contract §8 CP8's spirit,
// until the CI weakening-diff proof lands with the proof-suite PR).
// Editing this table is not a chore to route around — it IS the review gate.
describe('CP8 forerunner — hardcoded live-row disposition pin', () => {
  const LIVE_ROWS: Record<
    string,
    { kind: 'view' | 'mutation'; action: string; targetType?: string }
  > = {
    'customer.read': { kind: 'view', action: 'customer.view', targetType: 'customer' },
    'customer.update': { kind: 'mutation', action: 'customer.edit', targetType: 'customer' },
    'sync.run': { kind: 'mutation', action: 'settings.sync_run_now', targetType: 'business' },
    'customer.memory.add': { kind: 'mutation', action: 'customer.memory_add', targetType: 'customer' },
    'customer.memory.update': { kind: 'mutation', action: 'customer.memory_update', targetType: 'customer' },
    'customer.memory.delete': { kind: 'mutation', action: 'customer.memory_delete', targetType: 'customer' },
    'customer.memory.relearn': { kind: 'mutation', action: 'customer.memory_relearn', targetType: 'customer' },
    'customer.pack.create': { kind: 'mutation', action: 'customer.pack_create', targetType: 'customer' },
    'customer.pack.redeem': { kind: 'mutation', action: 'customer.pack_redeem', targetType: 'customer' },
    // No targetType: the route param is the REDEMPTION id — see the map row's
    // comment (Wave-W refinement pending a core getRedemption lookup).
    'customer.pack.undoRedemption': { kind: 'mutation', action: 'customer.pack_undo' },
    'customer.passport.upsert': { kind: 'mutation', action: 'customer.passport_update', targetType: 'customer' },
    'customer.photo.upload': { kind: 'mutation', action: 'customer.photo_add', targetType: 'customer' },
  }

  it('exactly the pinned rows are live — every other key is skip or pendingWave', () => {
    const liveInMap = Object.entries(FACADE_AUDIT_MAP)
      .filter(([, r]) => r.kind !== 'skip' && r.pendingWave === undefined)
      .map(([k]) => k)
      .sort()
    expect(liveInMap).toEqual(Object.keys(LIVE_ROWS).sort())
  })

  it('every live row matches its pinned kind/action/target exactly', () => {
    for (const [key, expected] of Object.entries(LIVE_ROWS)) {
      const rule = FACADE_AUDIT_MAP[key as keyof typeof FACADE_AUDIT_MAP]
      expect({ key, kind: rule.kind, action: rule.action, targetType: rule.targetType }).toEqual({
        key,
        kind: expected.kind,
        action: expected.action,
        targetType: expected.targetType,
      })
    }
  })
})
