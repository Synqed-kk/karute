// updateTag() is Server-Action-only in Next 16 — calling it from a Route
// Handler throws ('updateTag can only be called from within a Server Action',
// next/dist/server/web/spec-extension/revalidate.js). Every facade route
// reuses action-module cores, and 48 test files mock next/cache, so a core
// that picks up an updateTag call ships a runtime failure no jest suite can
// see: the write lands, THEN updateTag throws into the core's catch, and the
// route reports failure for a mutation that succeeded (found live on the
// org-settings PATCH + customer PATCH facade paths, design-parity packet 12
// §S4a fix round). Rule enforced here: cache invalidation lives on web action
// wrappers, never inside a function a route imports.
//
// Scope: DIRECT bodies of every function each facade route imports from
// @/actions/*. One level only — a core delegating to a helper that calls
// updateTag would slip through; today every such shared writer is itself
// route-imported (writeOrgSettingsBlobWithClient), so the direct scan covers
// the seam. Extend to a call graph only if that stops being true.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(process.cwd(), 'src/app/api/app/v1')

function routeFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...routeFiles(full))
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

/** name → actions module, for every value binding a route imports from
 *  '@/actions/<module>'. Type-only imports (both forms) are skipped; aliased
 *  imports resolve to the ORIGINAL exported name. */
function actionImports(files: string[]): Map<string, string> {
  const out = new Map<string, string>()
  const re = /import\s*(type\s+)?\{([^}]+)\}\s*from\s*['"]@\/actions\/([\w-]+)['"]/g
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    for (let m = re.exec(src); m; m = re.exec(src)) {
      if (m[1]) continue // import type { ... }
      for (const raw of m[2].split(',')) {
        const name = raw.trim()
        if (!name || name.startsWith('type ')) continue
        out.set(name.split(/\s+as\s+/)[0].trim(), m[3])
      }
    }
  }
  return out
}

/** The DECLARATION body of `function <fn>` in `src` — params and return-type
 *  annotation excluded (a `Promise<{ id: string }>` annotation would otherwise
 *  end a naive brace count early). Returns null when the declaration isn't
 *  found (const/arrow exports would need their own matcher — none of the
 *  route-imported action functions use that form today). */
function functionBody(src: string, fn: string): string | null {
  const decl = src.search(new RegExp(`(export\\s+)?(async\\s+)?function\\s+${fn}\\b`))
  if (decl < 0) return null
  let i = src.indexOf('(', decl)
  let parens = 0
  for (; i < src.length; i++) {
    if (src[i] === '(') parens++
    else if (src[i] === ')') {
      parens--
      if (parens === 0) break
    }
  }
  // Body brace = first { directly preceded (ignoring whitespace) by the params'
  // `)` or the return annotation's closing `>`; braces inside the annotation
  // are preceded by `<` or `|` and skipped.
  let j = i + 1
  for (; j < src.length; j++) {
    if (src[j] === '{') {
      let k = j - 1
      while (k > 0 && /\s/.test(src[k])) k--
      if (src[k] === ')' || src[k] === '>') break
    }
  }
  let depth = 0
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++
    else if (src[k] === '}') {
      depth--
      if (depth === 0) return src.slice(j, k)
    }
  }
  return null
}

describe('facade-imported action cores never call updateTag (Server-Action-only)', () => {
  const imports = actionImports(routeFiles(ROOT))

  it('finds route→action imports to scan', () => {
    expect(imports.size).toBeGreaterThan(20)
  })

  it('route files import actions modules ONLY in the form this scan parses', () => {
    // Guard of the guard: a relative-path, namespace (`import * as`), or
    // default import of an actions module would be invisible to
    // actionImports() — not even the missing[] check would fire. Strip every
    // import actionImports CAN parse (named `import {…} from '@/actions/mod'`,
    // single- or multi-line — [^}]+ spans newlines), then fail loud on any
    // remaining reference to an actions path.
    const named = /import\s*(type\s+)?\{[^}]+\}\s*from\s*['"]@\/actions\/[\w-]+['"]/g
    const offenders: string[] = []
    for (const file of routeFiles(ROOT)) {
      const residue = readFileSync(file, 'utf8').replace(named, '')
      for (const line of residue.split('\n')) {
        if (/from\s*['"][^'"]*actions\//.test(line)) {
          offenders.push(`${file.replace(process.cwd(), '.')}: ${line.trim()}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('every route-imported action function body is updateTag-free', () => {
    const offenders: string[] = []
    const missing: string[] = []
    for (const [fn, mod] of imports) {
      const file = join(process.cwd(), `src/actions/${mod}.ts`)
      if (!existsSync(file)) {
        missing.push(`${fn} → missing module src/actions/${mod}.ts`)
        continue
      }
      const body = functionBody(readFileSync(file, 'utf8'), fn)
      if (body === null) {
        missing.push(`${fn} not found as a function declaration in src/actions/${mod}.ts`)
        continue
      }
      if (/updateTag\(/.test(body)) offenders.push(`${fn} (src/actions/${mod}.ts)`)
    }
    // A name this scan can't resolve is a hole in the guard, not a pass.
    expect(missing).toEqual([])
    expect(offenders).toEqual([])
  })
})
