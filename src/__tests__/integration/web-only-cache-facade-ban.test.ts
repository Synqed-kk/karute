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

// THREE independent regexes, not one alternation. Two proven blind spots:
// a string-only pattern misses `import(\`@/x\`)` (delta-verify PoC — the
// backtick form is a live idiom in this repo, src/i18n/request.ts), and a
// combined alternation's `[^'"]*?` lazy scan spans newlines, letting a quoted
// `from '…'` later in the file swallow a preceding backtick import inside its
// match (order-fragile — proven by mutant). Independent passes can't shadow
// each other; FROM_RE keys on the `from '…'` clause alone, covering import,
// export-from and multi-line named forms alike.
const FROM_RE = /from\s*['"]([^'"]+)['"]/g
const DYN_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g
const DYN_BACKTICK_RE = /import\(\s*`([^`]+)`\s*\)/g
// Side-effect imports (`import '@/x'`) have no `from` and no call parens —
// invisible to the three regexes above (Greptile #660 finding). Executing a
// module IS reaching it, so the guard must see this form too. The quote
// directly after `import` keeps `import x from 'y'` out of this pattern.
const SIDE_EFFECT_RE = /import\s*['"]([^'"]+)['"]/g

/** Every file transitively reachable from `entry` via static imports.
 *  An INTERPOLATED local dynamic import (`import(\`@/x/${y}\`)`) cannot be
 *  resolved statically — it lands in `unscannable` and the caller must fail
 *  loud, never skip silently. */
function reachable(entry: string): {
  seen: Set<string>
  unscannable: string[]
} {
  const seen = new Set<string>()
  const unscannable: string[] = []
  const stack = [entry]
  while (stack.length) {
    const f = stack.pop()!
    if (seen.has(f)) continue
    seen.add(f)
    const src = readFileSync(f, 'utf8')
    for (const re of [FROM_RE, DYN_RE, DYN_BACKTICK_RE, SIDE_EFFECT_RE]) {
      re.lastIndex = 0
      for (const m of src.matchAll(re)) {
        const spec = m[1]
        if (!spec) continue
        if (
          spec.includes('${') &&
          (spec.startsWith('@/') || spec.startsWith('.'))
        ) {
          unscannable.push(
            `${f.replace(process.cwd(), '.')}: import(\`${spec}\`)`,
          )
          continue
        }
        const r = resolveSpec(spec, f)
        if (r) stack.push(r)
      }
    }
  }
  return { seen, unscannable }
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
    expect([...reachable(page).seen]).toContain(BANNED[0])
  })

  it('resolves backtick dynamic imports even with a quoted import LATER in the file', () => {
    // Self-check of the walker's regexes against BOTH proven blind spots:
    // the backtick form itself, and the order-fragility where a later quoted
    // `from '…'` used to swallow it inside a combined alternation's match.
    const source = [
      'const x = await import(`@/lib/appointments/day-agenda-cached`)',
      "import { z } from '@/lib/staff'",
      "import '@/lib/appointments/screen'",
    ].join('\n')
    const specs: string[] = []
    for (const re of [FROM_RE, DYN_RE, DYN_BACKTICK_RE, SIDE_EFFECT_RE]) {
      re.lastIndex = 0
      for (const m of source.matchAll(re)) specs.push(m[1])
    }
    expect(specs).toContain('@/lib/appointments/day-agenda-cached')
    expect(specs).toContain('@/lib/staff')
    // Side-effect form seen; and the quote-after-import pattern must NOT
    // misparse a default import as a side-effect specifier.
    expect(specs).toContain('@/lib/appointments/screen')
  })

  it.each(routes.map((r) => [r.replace(process.cwd(), '.'), r]))(
    '%s does not import any web-only cache',
    (_rel, route) => {
      const { seen, unscannable } = reachable(route)
      // Fail loud on anything the scan cannot follow — a skipped edge is a
      // hole, not a pass.
      expect(unscannable).toEqual([])
      expect(BANNED.filter((b) => seen.has(b))).toEqual([])
    },
  )
})

export {}
