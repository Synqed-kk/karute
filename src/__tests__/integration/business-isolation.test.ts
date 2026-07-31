// Business import-isolation gate (phone-safety lock 3, clause 2): nothing
// outside Business territory may import Business code — which makes
// "Business = new files the thin bundle never imports" a structural fact, not
// a review promise. The later workspace-switch wiring (Permission v2, Packet
// 2+) will be a deliberate, owner-reviewed edit to THIS suite, never a quiet
// import. Complements the CI diff gate (scripts/business/
// check-business-isolation.mjs); territory list is shared via
// business-territory.json.
//
// Scanner lessons inherited from the #660/#661 guard work: three independent
// per-form regexes, never one combined alternation (a spanning wildcard let a
// later import swallow an earlier one); side-effect imports are a real form
// (`import '@/business/x'` — the #660 blind spot); full-line comments are
// stripped BEFORE matching (a doc comment once grafted a phantom namespace).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const territory: string[] = JSON.parse(
  readFileSync(join(ROOT, 'scripts/business/business-territory.json'), 'utf8'),
).territory

// One regex per import form, no cross-form alternation. Every specifier group
// forbids newlines so a match can never span statements.
const IMPORT_FORMS: Array<[string, RegExp]> = [
  ['static from, single-quote', /from\s*'([^'\n]+)'/g],
  ['static from, double-quote', /from\s*"([^"\n]+)"/g],
  ['side-effect import', /import\s*['"]([^'"\n]+)['"]/g],
  ['dynamic import()', /import\s*\(\s*['"`]([^'"`\n]+)['"`]/g],
  ['require()', /require\s*\(\s*['"`]([^'"`\n]+)['"`]/g],
]

// A specifier is Business when it resolves under src/business/ (alias) or
// names a business/ path segment relatively.
const BUSINESS_SPECIFIER = [
  (s: string) => s === '@/business' || s.startsWith('@/business/'),
  (s: string) => /^\.\.?\/(?:.*\/)?business\//.test(s),
]

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const rel = full.slice(ROOT.length + 1)
    if (territory.some((p) => rel.startsWith(p))) continue // Business's own files may import Business
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|mts|mjs)$/.test(name)) out.push(full)
  }
  return out
}

function stripFullLineComments(src: string): string {
  return src
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n')
}

describe('Business import isolation (phone-safety lock 3)', () => {
  const files = [...walk(join(ROOT, 'src'), []), ...walk(join(ROOT, 'thin'), [])]

  it('territory config is well-formed directory prefixes', () => {
    expect(territory.length).toBeGreaterThan(0)
    for (const p of territory) expect(p.endsWith('/')).toBe(true)
  })

  it('finds the shared surface to scan', () => {
    // Guard of the guard: an empty or misrooted walk must fail loud, never
    // pass vacuously.
    expect(files.length).toBeGreaterThan(200)
  })

  it('no file outside Business territory imports Business code', () => {
    const offenders: string[] = []
    for (const file of files) {
      const src = stripFullLineComments(readFileSync(file, 'utf8'))
      for (const [form, re] of IMPORT_FORMS) {
        re.lastIndex = 0
        for (let m = re.exec(src); m; m = re.exec(src)) {
          const spec = m[1]
          if (BUSINESS_SPECIFIER.some((test) => test(spec))) {
            offenders.push(`${file.slice(ROOT.length + 1)} (${form}): ${spec}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
