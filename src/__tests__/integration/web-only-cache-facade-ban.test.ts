// Web-only cache modules must stay unreachable from the facade. The 予約
// day-agenda cache (day-agenda-cached.ts) resolves its store scope from the
// COOKIE session and memoizes per (business, store, day) — a facade route
// importing it would at best throw on the cookie read and at worst serve one
// identity's cached agenda on another's Bearer request. Blind-round facade
// lens: nothing enforced this rule; this scan does, transitively (unlike the
// one-level updateTag ban, a helper re-export could otherwise smuggle it in).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'

const SRC = join(process.cwd(), 'src')
const API_ROOT = join(SRC, 'app', 'api')

// Modules that must never enter a facade route's import graph. Extend as
// more web-only caches appear.
const BANNED = [join(SRC, 'lib', 'appointments', 'day-agenda-cached.ts')]

function routeFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...routeFiles(full))
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

function resolveSpec(spec: string, fromFile: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec)
  else return null // bare specifier → node_modules
  for (const c of [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    join(base, 'index.tsx'),
    join(base, 'index.ts'),
  ]) {
    try {
      if (statSync(c).isFile()) return c
    } catch {
      /* keep trying */
    }
  }
  return null
}

const IMPORT_RE =
  /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g

/** Every file transitively reachable from `entry` via static imports. */
function reachable(entry: string): Set<string> {
  const seen = new Set<string>()
  const stack = [entry]
  while (stack.length) {
    const f = stack.pop()!
    if (seen.has(f)) continue
    seen.add(f)
    const src = readFileSync(f, 'utf8')
    IMPORT_RE.lastIndex = 0
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] || m[2]
      if (!spec) continue
      const r = resolveSpec(spec, f)
      if (r) stack.push(r)
    }
  }
  return seen
}

describe('web-only caches never reach the facade', () => {
  const routes = routeFiles(API_ROOT)

  it('finds the facade route inventory (guards against the walker going blind)', () => {
    expect(routes.length).toBeGreaterThan(20)
  })

  it('sees through the import graph (the banned module IS reachable from its web page)', () => {
    // Sanity of the scan itself: from the 予約 page, the walker must find the
    // banned module — otherwise a green facade scan proves nothing.
    const page = join(
      SRC,
      'app',
      '[locale]',
      '(app)',
      'appointments',
      'page.tsx',
    )
    expect([...reachable(page)]).toContain(BANNED[0])
  })

  it.each(routes.map((r) => [r.replace(process.cwd(), '.'), r]))(
    '%s does not import any web-only cache',
    (_rel, route) => {
      const graph = reachable(route)
      expect(BANNED.filter((b) => graph.has(b))).toEqual([])
    },
  )
})

export {}
