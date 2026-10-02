// Business import-isolation gate (phone-safety lock 3, clause 2): nothing
// outside Business territory may import Business code — which makes
// "Business = new files the thin bundle never imports" a structural fact, not
// a review promise. The later workspace-switch wiring (Permission v2, Packet
// 2+) will be a deliberate, owner-reviewed edit to THIS suite, never a quiet
// import. Complements the CI diff gate (scripts/business/
// check-business-isolation.mjs); territory list is shared via
// business-territory.json. ONE named outward exception (⚖ Liam 9/19, the
// practice-salon door): src/business/lib/practice-door/core-reach.ts may
// import the core client factory, see FILE_ALLOWED_TARGETS. ⚖ 2026-09-28
// (PLAN-BUSINESS-LIVE v2.2 §2 S1, W0 PR (1)): a second row, keyed by
// business-territory.json's sharedCores.doorFile, lets that ONE file import the
// phone's shared mutation cores (sharedCores.modules, read from the JSON, never
// retyped) — and only src/business/lib/data.ts may import the door file.
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
const fences: { territory: string[]; sharedCores: { doorFile: string; modules: string[] } } = JSON.parse(
  readFileSync(join(ROOT, 'scripts/business/business-territory.json'), 'utf8'),
)
const territory: string[] = fences.territory
// ⚖ 2026-09-28 — the shared-cores door (W0 PR (1)): one file, the listed
// modules, one importer. scripts/business/check-shared-cores.mjs is the call-
// site half (which calls, from which exported function); this suite is the
// import half.
const SHARED_CORES = fences.sharedCores
const DOOR_IMPORTERS = ['src/business/lib/data.ts']

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
  // jest.requireActual loads the REAL module and jest.requireMock builds its
  // automock FROM it — the same reach as require(), one form each. A type
  // argument (up to two nested `<…>` levels, no newline) may sit before `(`; a
  // newline inside the type argument is not read by these forms — the three
  // such calls in the repo carry an import() the dynamic form reads.
  ['jest.requireActual()', /jest\s*\.\s*requireActual\s*(?:<(?:[^<>\n]|<(?:[^<>\n]|<[^<>\n]*>)*>)*>)?\s*\(\s*['"`]([^'"`\n]+)['"`]/g],
  ['jest.requireMock()', /jest\s*\.\s*requireMock\s*(?:<(?:[^<>\n]|<(?:[^<>\n]|<[^<>\n]*>)*>)*>)?\s*\(\s*['"`]([^'"`\n]+)['"`]/g],
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
  // ⚖ Liam 9/19 — the practice-salon door. ONE territory file may import ONE
  // outside target: the explicit-tenant core client factory. Keyed by the
  // importing file, judged on the RESOLVED target like everything else here, so
  // the alias and relative spellings get one verdict and a barrel (`@/lib/synqed`)
  // stays an offender. DESIGN-PRACTICE-DOOR.md §9.
  const FILE_ALLOWED_TARGETS: Record<string, string[]> = {
    'src/business/lib/practice-door/core-reach.ts': ['src/lib/synqed/client'],
    // ⚖ 2026-09-28 (PLAN-BUSINESS-LIVE v2.2 §2 S1) — the desk writes through the
    // phone's own cores from ONE file. Keyed and valued straight from the JSON,
    // so the fence and this allowlist can never disagree; judged on the RESOLVED
    // target like the row above (a barrel such as `@/lib/appointments` stays out).
    [SHARED_CORES.doorFile]: SHARED_CORES.modules,
  }
  // Bare packages: the render runtime only. `node:` builtins ride along because
  // the territory's own test file reads fixtures off disk — stdlib reaches no
  // app data, so it cannot smuggle core the way a shared @/ helper does.
  const ALLOWED_BARE = /^(?:react|next)(?:\/|$)|^node:/
  // ⚖ Liam 9/27 — the rendered-test door. A `*.test.tsx` file DIRECTLY under
  // src/__tests__/integration/business/ may import exactly these two bare
  // specifiers (a DOM renderer + RTL), so a territory suite can MOUNT a
  // Business component and prove a click / an Escape. Judged on the importing
  // FILE's shape and the EXACT specifier: a `.test.ts`, a non-test `.tsx`, a
  // subfolder, `react-dom` itself, `react-dom/server`, `@testing-library/jest-dom`
  // all stay offenders. Runtime Business files are not test files, and (below)
  // may not import the test folder at all, so nothing shipped reaches these two
  // packages through the door — directly or in two hops. DESIGN-PRACTICE-DOOR.md
  // §9's sibling.
  const RENDER_TEST_FILE = /^src\/__tests__\/integration\/business\/[^/]+\.test\.tsx$/
  const RENDER_TEST_BARE = new Set(['react-dom/client', '@testing-library/react'])
  // R123 (S51): react-dom for the shared Dialog's createPortal only — React's own renderer, no data access
  const FILE_ALLOWED_BARE: Record<string, string[]> = { 'src/app/[locale]/(business)/business/settings/Dialog.tsx': ['react-dom'] }

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
      // `next/dist/compiled/react-dom/client` was a hole through `^next/`.
      if (/^next\/dist(?:\/|$)/.test(spec)) return 'next/dist internals are not a public entry'
      if (ALLOWED_BARE.test(spec)) return null
      if (RENDER_TEST_FILE.test(fromFile) && RENDER_TEST_BARE.has(spec)) return null
      if (FILE_ALLOWED_BARE[fromFile]?.includes(spec)) return null
      return 'bare package off the allowlist'
    }
    // Tests may import tests; runtime + e2e never import the test folder (a *.test.tsx may re-export the door).
    if (target === 'src/__tests__' || target.startsWith('src/__tests__/')) {
      if (!fromFile.startsWith('src/__tests__/')) return 'runtime file imports the test folder'
    }
    if (inTerritory(target)) return null // territory's own, root barrel included
    if (ALLOWED_TARGETS.includes(target)) return null
    if (FILE_ALLOWED_TARGETS[fromFile]?.includes(target)) return null
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
    expect(outwardOffense('@/lib/workspaces/types', from)).not.toBeNull()
    // …the old denylist's targets, now offenders by default…
    expect(outwardOffense('@/components/ui/button', from)).not.toBeNull()
    expect(outwardOffense('../../../messages/ja.json', 'src/business/screens/Home.tsx')).not.toBeNull()
    // …and core, with no type-only carve-out: types come from fixtures too.
    expect(outwardOffense('@synqed-kk/client', from)).not.toBeNull()
    expect(outwardOffense('next-intl', from)).not.toBeNull()
    // …and the ONE named door: the core-reach file may import the factory in
    // either spelling; data.ts still may not; the SDK and @/lib/staff stay out.
    const door = 'src/business/lib/practice-door/core-reach.ts'
    expect(outwardOffense('@/lib/synqed/client', door)).toBeNull()
    // (the scanner's ALLOW pins the same two spellings, one occurrence — the pair agrees)
    expect(outwardOffense('../../../lib/synqed/client', door)).toBeNull()
    expect(outwardOffense('@/lib/synqed', door)).not.toBeNull()
    expect(outwardOffense('@/lib/synqed/client', from)).not.toBeNull()
    expect(outwardOffense('@synqed-kk/client', door)).not.toBeNull()
    expect(outwardOffense('@/lib/staff', door)).not.toBeNull()
  })

  // ⚖ 2026-09-28 (W0 PR (1)) — the shared-cores door, judged like the factory door above.
  it('the shared-cores door: doorFile may import exactly the JSON modules, nothing else, and no other file may', () => {
    expect(SHARED_CORES.doorFile).toBe('src/business/lib/practice-door/door-writes.ts')
    expect(inTerritory(SHARED_CORES.doorFile)).toBe(true)
    expect(SHARED_CORES.modules.length).toBeGreaterThan(0)
    expect(FILE_ALLOWED_TARGETS[SHARED_CORES.doorFile]).toBe(SHARED_CORES.modules)
    const door = SHARED_CORES.doorFile
    for (const mod of SHARED_CORES.modules) {
      // Either spelling from the door; neither from data.ts or core-reach.ts.
      expect(outwardOffense(`@/${mod.slice('src/'.length)}`, door)).toBeNull()
      expect(outwardOffense(`../../../${mod.slice('src/'.length)}`, door)).toBeNull()
      expect(outwardOffense(`@/${mod.slice('src/'.length)}`, 'src/business/lib/data.ts')).not.toBeNull()
      expect(outwardOffense(`@/${mod.slice('src/'.length)}`, 'src/business/lib/practice-door/core-reach.ts')).not.toBeNull()
    }
    // A neighbour of a listed module, a barrel, and the audit POLICY stay out.
    expect(outwardOffense('@/lib/audit-policy', door)).not.toBeNull()
    expect(outwardOffense('@/lib/appointments', door)).not.toBeNull()
    expect(outwardOffense('@/lib/customers/customers', door)).not.toBeNull()
    expect(outwardOffense('@/lib/synqed/client', door)).not.toBeNull()
  })

  /** Every scanned file (both walks) whose import resolves to the door file. */
  function importersOfDoor(scanned: Array<{ rel: string; src: string }>): string[] {
    const doorModule = SHARED_CORES.doorFile.replace(/\.[cm]?[jt]sx?$/, '')
    const out = new Set<string>()
    for (const { rel, src } of scanned) {
      for (const [, re] of IMPORT_FORMS) {
        re.lastIndex = 0
        for (let m = re.exec(src); m; m = re.exec(src)) {
          const target = resolveSpecifier(m[1], rel)
          if (target !== null && target.replace(/\.[cm]?[jt]sx?$/, '') === doorModule) out.add(rel)
        }
      }
    }
    return [...out].sort()
  }

  it('the shared-cores door file has ONE possible importer: src/business/lib/data.ts', () => {
    const scanned = [...files, ...businessFiles].map((f) => ({
      rel: f.slice(ROOT.length + 1),
      src: stripFullLineComments(readFileSync(f, 'utf8')),
    }))
    const strays = importersOfDoor(scanned).filter((rel) => !DOOR_IMPORTERS.includes(rel))
    expect(strays).toEqual([])
  })

  it('the one-importer pin bites (self-check): both spellings resolve, data.ts passes, anything else is a stray', () => {
    // Spliced, so this file's own text never holds a Business import form.
    const rel = './door-writes'
    const alias = `@/${SHARED_CORES.doorFile.slice('src/'.length).replace(/\.ts$/, '')}`
    const fixtures = [
      { rel: 'src/business/lib/data.ts', src: `import { moveBooking } from '${alias}'` },
      { rel: 'src/business/lib/practice-door/other.ts', src: `import { moveBooking } from '${rel}'` },
      { rel: 'src/business/screens/Home.tsx', src: `const d = await import('${alias}')` },
      { rel: 'src/business/lib/practice-door/near.ts', src: `import { x } from './door-writes-helpers'` },
    ]
    expect(importersOfDoor(fixtures)).toEqual([
      'src/business/lib/data.ts',
      'src/business/lib/practice-door/other.ts',
      'src/business/screens/Home.tsx',
    ])
    expect(importersOfDoor(fixtures).filter((r) => !DOOR_IMPORTERS.includes(r))).toEqual([
      'src/business/lib/practice-door/other.ts',
      'src/business/screens/Home.tsx',
    ])
  })

  it('the rendered-test door: one folder, one file shape, two specifiers, bare only', () => {
    const BARE_OFF = 'bare package off the allowlist'
    // Exact strings, never a prefix — that is what makes the order against the next/dist deny irrelevant.
    expect([...RENDER_TEST_BARE]).toEqual(['react-dom/client', '@testing-library/react'])
    // A direct-child *.test.tsx: the two door specifiers pass, react is
    // unchanged, every neighbour specifier stays out, and a RESOLVED target
    // never rides the door (@/lib/staff is still judged as a target).
    const tsx = 'src/__tests__/integration/business/sample-mark-disclosure.test.tsx'
    expect(outwardOffense('react-dom/client', tsx)).toBeNull()
    expect(outwardOffense('@testing-library/react', tsx)).toBeNull()
    expect(outwardOffense('react', tsx)).toBeNull()
    expect(outwardOffense('react-dom', tsx)).toBe(BARE_OFF)
    expect(outwardOffense('react-dom/server', tsx)).toBe(BARE_OFF)
    expect(outwardOffense('@testing-library/jest-dom', tsx)).toBe(BARE_OFF)
    expect(outwardOffense('@testing-library/react/pure', tsx)).toBe(BARE_OFF)
    expect(outwardOffense('@/lib/staff', tsx)).toBe('resolves outside territory to src/lib/staff')
    expect(outwardOffense('@/business/components/SampleMark', tsx)).toBeNull()
    // Every other file shape stays shut to BOTH door specifiers.
    const shut = [
      'src/__tests__/integration/business/helpers.ts',
      'src/__tests__/integration/business/render.tsx',
      'src/__tests__/integration/business/x.test.ts',
      'src/__tests__/integration/business/sub/x.test.tsx',
      'src/__tests__/integration/businessX/x.test.tsx',
      'src/business/components/SampleMark.tsx',
      'src/app/[locale]/(business)/business/today/TodayScreen.tsx',
    ]
    const verdicts = (spec: string) => Object.fromEntries(shut.map((f) => [f, outwardOffense(spec, f)]))
    const allOff = Object.fromEntries(shut.map((f) => [f, BARE_OFF]))
    expect(verdicts('react-dom/client')).toEqual(allOff)
    expect(verdicts('@testing-library/react')).toEqual(allOff)
    // next/dist internals are shut everywhere — from runtime code AND from the
    // door's own file shape — while the public next/* entries stay open.
    const data = 'src/business/lib/data.ts'
    const DIST_OFF = 'next/dist internals are not a public entry'
    expect(outwardOffense('next/dist/compiled/react-dom/client', data)).toBe(DIST_OFF)
    expect(outwardOffense('next/dist/compiled/react-dom/client', tsx)).toBe(DIST_OFF)
    expect(outwardOffense('next/dist', data)).toBe(DIST_OFF)
    expect(outwardOffense('next/navigation', data)).toBeNull()
    expect(outwardOffense('next/link', data)).toBeNull()
    expect(outwardOffense('next/headers', data)).toBeNull()
  })

  it('the door is one hop: runtime and e2e never import the test folder', () => {
    const TESTS_OFF = 'runtime file imports the test folder'
    // A territory *.test.tsx may re-export the door's packages, so a runtime
    // or e2e file importing it would reach them in two hops — shut, in every spelling.
    const aTest = '@/__tests__/integration/business/sample-mark-disclosure.test'
    expect(outwardOffense(aTest, 'src/business/components/SampleMark.tsx')).toBe(TESTS_OFF)
    expect(outwardOffense(aTest, 'src/app/[locale]/(business)/business/today/TodayScreen.tsx')).toBe(TESTS_OFF)
    const rel = '../../__tests__/integration/business/x.test'
    expect(resolveSpecifier(rel, 'src/business/lib/data.ts')).toBe('src/__tests__/integration/business/x.test')
    expect(outwardOffense(rel, 'src/business/lib/data.ts')).toBe(TESTS_OFF)
    expect(outwardOffense('../../src/__tests__/integration/business/x.test', 'e2e/business/spec.ts')).toBe(TESTS_OFF)
    // Test files still import each other and their helpers.
    expect(outwardOffense('./sample-mark-disclosure.test', 'src/__tests__/integration/business/other.test.ts')).toBeNull()
    expect(
      outwardOffense('@/__tests__/integration/business/fixtures-helper', 'src/__tests__/integration/business/x.test.tsx'),
    ).toBeNull()
  })

  it('no import form captures a specifier that spans a line', () => {
    // The header's promise ("every specifier group forbids newlines"), pinned
    // per form: one fixture each with a newline INSIDE the specifier.
    const spanning: Record<string, string> = {
      'static from, single-quote': "import x from '@/lib\n/staff'",
      'static from, double-quote': 'import x from "@/lib\n/staff"',
      'side-effect import': "import '@/lib\n/staff'",
      'dynamic import()': "import('@/lib\n/staff')",
      'require()': "require('@/lib\n/staff')",
      // …and for the jest forms, a newline inside the type argument too, at
      // every level the type argument reads (outer, one nested, two nested).
      'jest.requireActual()': [
        "jest.requireActual('@/lib\n/staff')",
        "jest.requireActual<Pump\n>('@/lib/staff')",
        "jest.requireActual<Record<string,\nPump>>('@/lib/staff')",
        "jest.requireActual<Record<string, Record<string,\nstring>>>('@/lib/staff')",
      ].join('\n'),
      'jest.requireMock()': [
        'jest.requireMock("@/lib\n/staff")',
        'jest.requireMock<Pump\n>("@/lib/staff")',
        'jest.requireMock<Record<string,\nX>>("@/lib/staff")',
        'jest.requireMock<Record<string, Record<string,\nstring>>>("@/lib/staff")',
      ].join('\n'),
    }
    // Every form has its fixture: a new form without one fails here first.
    expect(IMPORT_FORMS.map(([form]) => form).sort()).toEqual(Object.keys(spanning).sort())
    const src = Object.values(spanning).join('\n')
    const captures = Object.fromEntries(
      IMPORT_FORMS.map(([form, re]) => {
        const got: string[] = []
        re.lastIndex = 0
        for (let m = re.exec(src); m; m = re.exec(src)) got.push(m[1])
        return [form, got]
      }),
    )
    expect(captures).toEqual(Object.fromEntries(IMPORT_FORMS.map(([form]) => [form, []])))
  })

  it('jest.requireActual / jest.requireMock are import forms the scanner reads', () => {
    // Spliced in, so this file's own text never holds a Business import form
    // (the inward scan below reads this file too).
    const biz = '@/business/lib/data'
    const src = stripFullLineComments(
      [
        "const a = jest.requireActual('@/lib/staff')",
        'const b = jest.requireMock("@/lib/staff")',
        'const c = jest . requireActual(`react-dom/client`)',
        "const d = require('@/x')",
        "// jest.requireActual('@/lib/auth/x')",
        "const e = jest.requireActual<Pump>('@/lib/staff')",
        'const f = jest.requireMock<Record<string, X>>("@/lib/staff")',
        `const g = jest.requireActual<typeof import('${biz}')>('${biz}')`,
        "const h = jest.requireActual<Record<string, Record<string, string>>>('@/lib/staff')",
      ].join('\n'),
    )
    const captured: Array<[string, string]> = []
    for (const [form, re] of IMPORT_FORMS) {
      re.lastIndex = 0
      for (let m = re.exec(src); m; m = re.exec(src)) captured.push([form, m[1]])
    }
    // The comment line yields nothing, and require() never also claims a jest
    // call (no double capture): exactly one capture per real call. A typed
    // call is read too, nested generics two levels deep included; an import()
    // inside the type argument is its own capture, so `g` lands twice — once per form.
    expect(captured).toEqual([
      ['dynamic import()', '@/business/lib/data'],
      ['require()', '@/x'],
      ['jest.requireActual()', '@/lib/staff'],
      ['jest.requireActual()', 'react-dom/client'],
      ['jest.requireActual()', '@/lib/staff'],
      ['jest.requireActual()', '@/business/lib/data'],
      ['jest.requireActual()', '@/lib/staff'],
      ['jest.requireMock()', '@/lib/staff'],
      ['jest.requireMock()', '@/lib/staff'],
    ])
    // A captured helper reach is judged like any other import: an offender.
    expect(outwardOffense(captured[2][1], 'src/business/lib/data.ts')).toBe(
      'resolves outside territory to src/lib/staff',
    )
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
