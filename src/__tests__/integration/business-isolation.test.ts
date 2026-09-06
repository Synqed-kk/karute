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
// Walk covers src/ + thin/ + the REPO ROOT's own source files (blind-round
// catch, mutation-proven: next-intl.config.ts sits at root, is in the live
// SSR module graph via createNextIntlPlugin, and a business re-export planted
// there passed the original two-root walk green). thin/dist is build output —
// skipped, its bundles carry no unresolved specifiers.
//
// Symlinks are REJECTED, never followed (lstat, not stat): readFileSync and
// statSync resolve a link transparently, so a link planted at a phone-owned
// path (thin/util.ts → src/business/leaf.ts) would be scanned as though its
// Business bytes lived outside territory. The bytes are Business, the label is
// not, and a sibling's relative `./util` import of it carries no business/
// segment for BUSINESS_SPECIFIER to match — the content check and the
// specifier check would BOTH read clean. The repo tracks zero symlinks (git
// mode 120000), so refusing them outright costs nothing and keeps every path
// label honest. thin/vite.config.ts denies the resolved path at build time as
// the second half of this pair.
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'

const ROOT = process.cwd()
const territory: string[] = JSON.parse(
  readFileSync(join(ROOT, 'scripts/business/business-territory.json'), 'utf8'),
).territory

// Territory prefixes carry a trailing '/', so a plain startsWith misses the
// root itself: an extensionless barrel import (`@/business` → src/business/
// index.ts) resolves to exactly `src/business` and would read as OUTSIDE the
// fence (Greptile P2, #721). Equality counts as inside — EXACT equality only,
// so `src/businessX` stays the different tree that it is.
const inTerritory = (p: string) => territory.some((t) => p === t.slice(0, -1) || p.startsWith(t))

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
  // (?:\/|$): an extensionless barrel import (`../business` → src/business/
  // index.ts) is Business too — Greptile P1 on #662.
  (s: string) => /^\.\.?\/(?:.*\/)?business(?:\/|$)/.test(s),
]

const SOURCE_EXT = /\.(ts|tsx|mts|cts|mjs|cjs|jsx|js)$/

/** Paths that are symlinks — collected, never followed. Asserted empty below. */
const symlinks: string[] = []

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const rel = full.slice(ROOT.length + 1)
    if (inTerritory(rel)) continue // Business's own files may import Business
    if (rel === 'thin/dist') continue // local build output (untracked)
    if (name === 'node_modules') continue // never our source, and a symlink farm
    const stat = lstatSync(full)
    if (stat.isSymbolicLink()) {
      symlinks.push(rel)
      continue
    }
    if (stat.isDirectory()) walk(full, out)
    else if (SOURCE_EXT.test(name)) out.push(full)
  }
  return out
}

/** Root-level source files only (configs like next-intl.config.ts /
 *  next.config.ts live in the real build graph); directories are covered by
 *  their own walks or are not code (node_modules, .next, public, …). */
function rootFiles(): string[] {
  const out: string[] = []
  for (const name of readdirSync(ROOT)) {
    const full = join(ROOT, name)
    // Skipped by name BEFORE the symlink check, exactly as walk() does: some
    // local worktrees symlink node_modules to a sibling checkout, and that is
    // a dependency-install detail, not a source-attribution problem.
    if (name === 'node_modules') continue
    const stat = lstatSync(full)
    if (stat.isSymbolicLink()) {
      symlinks.push(name)
      continue
    }
    if (!stat.isDirectory() && SOURCE_EXT.test(name)) out.push(full)
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
  // e2e/ + scripts/ never ship (no build config references them) but are
  // real source — walked so the suite's claim holds literally, not just for
  // the shipped graph (verify-round finding).
  const files = [
    ...rootFiles(),
    ...walk(join(ROOT, 'src'), []),
    ...walk(join(ROOT, 'thin'), []),
    ...walk(join(ROOT, 'e2e'), []),
    ...walk(join(ROOT, 'scripts'), []),
  ]

  it('territory config is well-formed directory prefixes', () => {
    expect(territory.length).toBeGreaterThan(0)
    for (const p of territory) expect(p.endsWith('/')).toBe(true)
  })

  it('finds the shared surface to scan', () => {
    // Guard of the guard: an empty or misrooted walk must fail loud, never
    // pass vacuously.
    expect(files.length).toBeGreaterThan(200)
  })

  it('no symlinks in the scanned trees — Business bytes cannot wear a phone-owned path', () => {
    // Zero tracked symlinks today (git mode 120000). A new one is either a
    // mistake or the attribution gap described in the header; both want eyes.
    expect(symlinks).toEqual([])
  })

  // Outward direction — an ALLOWLIST since the 2026-08-19 post-merge audit.
  // The old rule denied named phone-owned targets (src/components/**, root
  // messages/*.json) and passed everything else, so territory reached core
  // INDIRECTLY through shared helpers — @/actions/stores, @/lib/auth/*,
  // @/lib/staff — with all three gates green. A denylist can only forbid what
  // someone already thought of; the play-phase rule (fixtures only until Liam's
  // reconnect order) needs the opposite default. So: a Business file may import
  // ONLY what is named below, and anything else is an offender by construction.
  //
  // This suite is the INDIRECT half of the machine; scripts/business/
  // check-business-data-access.mjs is the direct half (it reads specifiers and
  // call sites inside territory, and cannot see what a shared helper does).
  // Neither is sufficient alone. Its own walk: walk() above SKIPS territory.
  const ALLOWED_TARGETS = ['src/lib/supabase/server', 'src/lib/supabase/service']
  // Bare packages: the render runtime only. `node:` builtins ride along because
  // the territory's own test file reads fixtures off disk — stdlib reaches no
  // app data, so it cannot smuggle core the way a shared @/ helper does.
  const ALLOWED_BARE = /^(?:react|next)(?:\/|$)|^node:/

  /** Repo-relative target of a specifier, or null when it is a bare package. */
  function resolveSpecifier(spec: string, fromFile: string): string | null {
    if (spec.startsWith('@/')) return posix.join('src', spec.slice(2))
    if (/^\.\.?(\/|$)/.test(spec)) return posix.join(posix.dirname(fromFile), spec)
    return null
  }

  /** Why this import is an offender, or null when it is on the allowlist.
   *  Judged on the RESOLVED target, never the raw specifier (Greptile P1), so
   *  the alias and relative spellings of one file get one verdict. */
  function outwardOffense(spec: string, fromFile: string): string | null {
    const target = resolveSpecifier(spec, fromFile)
    if (target === null) {
      if (fromFile === 'src/__tests__/integration/business/reserve-card-color-ui.test.tsx' && spec === '@testing-library/react') return null
      return ALLOWED_BARE.test(spec) ? null : 'bare package off the allowlist'
    }
    if (inTerritory(target)) return null // territory's own, root barrel included
    // One authorized appearance reconnect; all other Business routes remain sealed.
    if (['src/app/api/business/reserve-card-color/route.ts', 'src/__tests__/integration/business/reserve-card-color.test.ts'].includes(fromFile) && ['src/lib/auth/require-permission', 'src/lib/staff', 'src/lib/synqed/client'].includes(target)) return null
    if (ALLOWED_TARGETS.includes(target)) return null
    return `resolves outside territory to ${target}`
  }

  function walkTerritory(dir: string, out: string[]): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (name === 'node_modules') continue
      const stat = lstatSync(full)
      if (stat.isSymbolicLink()) {
        symlinks.push(full.slice(ROOT.length + 1))
        continue
      }
      if (stat.isDirectory()) walkTerritory(full, out)
      else if (SOURCE_EXT.test(name)) out.push(full)
    }
    return out
  }

  // Collected in the describe body like `files` above, so any symlink found in
  // territory still lands in the symlinks assertion.
  const businessFiles: string[] = []
  for (const p of territory) {
    const dir = join(ROOT, p)
    if (existsSync(dir)) walkTerritory(dir, businessFiles)
  }

  it('the outward rule is an allowlist judged on resolved targets', () => {
    const from = 'src/business/lib/data.ts'
    // On the list: territory's own (relative + alias), the render runtime, the
    // two supabase modules in either spelling, stdlib for the fixture reads.
    expect(outwardOffense('./fixtures', from)).toBeNull()
    expect(outwardOffense('@/business/lib/grants', from)).toBeNull()
    // The root barrel resolves to exactly `src/business` — inside, and the
    // prefix-collision spelling next to it is still outside (Greptile P2).
    expect(outwardOffense('@/business', from)).toBeNull()
    expect(outwardOffense('@/businessX', from)).not.toBeNull()
    expect(outwardOffense('../components/Card', 'src/app/[locale]/(business)/dash/page.tsx')).toBeNull()
    expect(outwardOffense('react', from)).toBeNull()
    expect(outwardOffense('next/navigation', from)).toBeNull()
    expect(outwardOffense('@/lib/supabase/service', from)).toBeNull()
    expect(outwardOffense('../../lib/supabase/server', from)).toBeNull()
    expect(outwardOffense('node:fs', 'src/__tests__/integration/business/foundation.test.ts')).toBeNull()
    // Off it: the four indirect reaches the audit actually found…
    expect(outwardOffense('@/actions/stores', from)).not.toBeNull()
    expect(outwardOffense('@/lib/auth/require-permission', from)).not.toBeNull()
    expect(outwardOffense('@/lib/staff', from)).not.toBeNull()
    expect(outwardOffense('@/lib/staff', 'src/app/api/business/reserve-card-color/route.ts')).toBeNull()
    expect(outwardOffense('@/lib/staff', 'src/app/api/business/other/route.ts')).not.toBeNull()
    expect(outwardOffense('@/actions/org-settings', 'src/app/api/business/reserve-card-color/route.ts')).not.toBeNull()
    expect(outwardOffense('@/lib/workspaces/types', from)).not.toBeNull()
    // …the old denylist's targets, now offenders by default…
    expect(outwardOffense('@/components/ui/button', from)).not.toBeNull()
    expect(outwardOffense('../../../messages/ja.json', 'src/business/screens/Home.tsx')).not.toBeNull()
    // …and core, with no type-only carve-out: types come from fixtures too.
    expect(outwardOffense('@synqed-kk/client', from)).not.toBeNull()
    expect(outwardOffense('next-intl', from)).not.toBeNull()
  })

  it('every Business import is on the allowlist', () => {
    const offenders: string[] = []
    for (const file of businessFiles) {
      const rel = file.slice(ROOT.length + 1)
      const src = stripFullLineComments(readFileSync(file, 'utf8'))
      for (const [form, re] of IMPORT_FORMS) {
        re.lastIndex = 0
        for (let m = re.exec(src); m; m = re.exec(src)) {
          const why = outwardOffense(m[1], rel)
          if (why) offenders.push(`${rel} (${form}): ${m[1]} — ${why}`)
        }
      }
    }
    expect(offenders).toEqual([])
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
