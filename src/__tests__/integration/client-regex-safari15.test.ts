// R-S115-10 SF1 + R-S115-15 (the class): no regex feature newer than Safari 15
// in the modules reachable from src/instrumentation-client.ts. Next requires
// that file at the top of the client entry with no try, so a regex that does
// not PARSE on an older engine (iOS 15 WKWebView: the Capacitor shell's floor)
// throws at module load and the page never hydrates. V8 parses all of these,
// so running the code in Node shows nothing; two checks instead:
// (1) SOURCE: every module in that graph (static and dynamic imports,
//     require, re-exports; type-only skipped), read with the TypeScript AST:
//     regex literals, string literals and each literal part of a template.
// (2) RUN TIME: every module in that graph is required with the global RegExp
//     wrapped; every regex CONSTRUCTED while they load (`new RegExp`,
//     `RegExp()`, an alias of either, `globalThis.RegExp`) is judged from its
//     whole pattern and flags, so a pattern assembled from parts (`'(?<' +
//     '=a)'`, `'\x3c'`, a split template, `.join`) is seen.
// Both fail on, with the Safari version that first parses each:
// - lookbehind `(?<=` `(?<!`            Safari 16.4
// - the `v` flag (set notation)          Safari 17
// - inline modifiers `(?i:` `(?-i:`      Safari 18.x / not yet everywhere
// - any regex flag outside `dgimsuy`     (d 15, s 11.1, u/y 10, g/i/m always)
// (1) also fails on a `RegExp(…, flags)` whose flags are not a literal.
// Named groups `(?<name>` and `\p{…}` with `u` parse since Safari 11.1: allowed.
// What neither check sees: a regex constructed LATER, at call time, from an
// assembled pattern (a function body that does not run at load; every regex
// in mask-sensitive.ts, sentry-exit.ts and sentry-scrub.ts is built at load
// today, so they are seen); code outside this graph (the 'use client'
// components the root layout loads, page code); a module the walk does not
// resolve (a bare package import: node_modules are not read).
import fs from 'fs'
import nodePath from 'path'
import ts from 'typescript'

const SRC = nodePath.resolve(__dirname, '../..')
const ENTRY = nodePath.join(SRC, 'instrumentation-client.ts')
const SAFE_FLAGS = /^[dgimsuy]*$/
const NEWER_PATTERN = /\(\?<[=!]|\(\?[ims]*-?[ims]+:/

function resolveImport(from: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = nodePath.join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = nodePath.resolve(nodePath.dirname(from), spec)
  else return null
  for (const ext of ['', '.ts', '.tsx', '.js', '/index.ts', '/index.tsx', '/index.js']) {
    const f = base + ext
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return f
  }
  return null
}

function sourceOf(file: string): ts.SourceFile {
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
}

/** Every src module reachable from the client entry (static and dynamic imports, re-exports). */
function reachable(entry: string): string[] {
  const seen = new Set<string>([entry])
  const queue = [entry]
  while (queue.length) {
    const file = queue.shift() as string
    const visit = (n: ts.Node) => {
      let spec: string | undefined
      if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
        if (!(ts.isImportDeclaration(n) && n.importClause?.isTypeOnly) && !(ts.isExportDeclaration(n) && n.isTypeOnly)) spec = n.moduleSpecifier.text
      } else if (ts.isCallExpression(n) && n.arguments.length === 1 && ts.isStringLiteral(n.arguments[0]) &&
        (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require'))) {
        spec = n.arguments[0].text
      }
      const to = spec ? resolveImport(file, spec) : null
      if (to && !seen.has(to)) { seen.add(to); queue.push(to) }
      ts.forEachChild(n, visit)
    }
    visit(sourceOf(file))
  }
  return [...seen].sort()
}

/** Every regex feature newer than Safari 15 in one source text. */
export function newerThanSafari15(fileName: string, text: string): string[] {
  const hits: string[] = []
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true)
  const at = (n: ts.Node) => `${nodePath.basename(fileName)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`
  // in a literal, a string or a template: the pattern text itself
  const PATTERN = NEWER_PATTERN
  const visit = (n: ts.Node) => {
    if (ts.isRegularExpressionLiteral(n)) {
      const slash = n.text.lastIndexOf('/')
      const flags = n.text.slice(slash + 1)
      if (!SAFE_FLAGS.test(flags)) hits.push(`${at(n)} flags /${flags}`)
      if (PATTERN.test(n.text.slice(0, slash + 1))) hits.push(`${at(n)} ${n.text.match(PATTERN)?.[0]}`)
    } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      const raw = n.getText(sf)
      if (PATTERN.test(raw)) hits.push(`${at(n)} ${raw.match(PATTERN)?.[0]} in a string`)
    } else if ((ts.isNewExpression(n) || ts.isCallExpression(n)) && ts.isIdentifier(n.expression) && n.expression.text === 'RegExp' && n.arguments && n.arguments.length > 1) {
      const f = n.arguments[1]
      if (!(ts.isStringLiteral(f) || ts.isNoSubstitutionTemplateLiteral(f))) hits.push(`${at(n)} RegExp flags not a literal`)
      else if (!SAFE_FLAGS.test(f.text)) hits.push(`${at(n)} RegExp flags '${f.text}'`)
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return hits
}

describe('SF1 — client-loaded code parses on Safari 15 (no lookbehind, no v flag, no modifiers)', () => {
  const files = reachable(ENTRY)

  it('the walk reaches the modules #1159 touches (it is not vacuous)', () => {
    for (const f of ['lib/observability/sentry-exit.ts', 'lib/observability/sentry-scrub.ts', 'lib/text/mask-sensitive.ts']) {
      expect(files).toContain(nodePath.join(SRC, f))
    }
  })

  it('the checker flags each feature it names', () => {
    const bad = [
      'const a = /(?<=x)y/', 'const b = /(?<!x)y/', "const c = new RegExp('(?<=' + d + ')', 'u')",
      'const e = /[\\p{L}--[a-z]]/v', "const f = new RegExp('x', 'v')", 'const g = /(?i:x)/', "const h = new RegExp('x', fl)",
      'const i = `(?<=${j})`',
    ]
    for (const src of bad) expect(newerThanSafari15('probe.ts', src)).toHaveLength(1)
    expect(newerThanSafari15('probe.ts', "const k = /(?<name>x)\\p{L}/u; const l = new RegExp('(?:a)', 'giu')")).toEqual([])
  })

  it('no reachable client module holds a regex newer than Safari 15', () => {
    const hits = files.flatMap((f) => newerThanSafari15(f, fs.readFileSync(f, 'utf8')))
    expect(hits).toEqual([])
  })
})

type Built = { source: string; flags: string }
/** Every regex constructed while fn runs, read from the constructor's
 *  arguments (so a pattern this engine cannot parse is still recorded). */
function builtDuring(fn: () => void): Built[] {
  const Real = globalThis.RegExp
  const built: Built[] = []
  const note = (args: unknown[]) => {
    const [p, f] = args
    built.push({ source: p instanceof Real ? p.source : String(p ?? ''), flags: f !== undefined ? String(f) : p instanceof Real ? p.flags : '' })
  }
  const Spy = new Proxy(Real, {
    construct: (target, args) => (note(args), Reflect.construct(target, args)),
    apply: (target, self, args) => (note(args), Reflect.apply(target, self, args)),
  })
  globalThis.RegExp = Spy
  try {
    fn()
  } finally {
    globalThis.RegExp = Real
  }
  return built
}
export function builtNewerThanSafari15(b: Built): string | null {
  if (!SAFE_FLAGS.test(b.flags)) return `flags /${b.flags}`
  const m = b.source.match(NEWER_PATTERN)
  return m ? `${m[0]} in /${b.source.slice(0, 60)}/` : null
}

describe('R-S115-15 — regexes constructed while the client graph loads (the run-time complement)', () => {
  it('the wrapper sees assembled patterns and aliases (the forms the source check misses)', () => {
    const built = builtDuring(() => {
      const tryBuild = (f: () => unknown) => {
        try {
          f()
        } catch {
          // an engine that cannot parse it still had it recorded
        }
      }
      const R4 = RegExp
      const lt = '\x3c'
      tryBuild(() => new RegExp('(?<' + '=a)b'))
      tryBuild(() => new RegExp(`(?${''}<=a)b`))
      tryBuild(() => new RegExp(['(?', '<!a)b'].join('')))
      tryBuild(() => new RegExp(`(?${lt === '\x3c' ? '<' : ''}=a)b`))
      tryBuild(() => new R4('a', ['v'].join('')))
      tryBuild(() => new globalThis.RegExp('a', 'v'.trim()))
      tryBuild(() => RegExp('(?' + 'i:a)'))
      tryBuild(() => new RegExp('(?<name>a)\\p{L}', 'giu'))
    })
    expect(built.map(builtNewerThanSafari15)).toEqual([
      expect.stringContaining('(?<='), expect.stringContaining('(?<='), expect.stringContaining('(?<!'),
      expect.stringContaining('(?<='), 'flags /v', 'flags /v', expect.stringContaining('(?i:'), null,
    ])
  })

  it('every module reachable from instrumentation-client.ts loads, and none constructs a regex newer than Safari 15', () => {
    const files = reachable(ENTRY)
    const failed: string[] = []
    const built = builtDuring(() =>
      jest.isolateModules(() => {
        for (const f of files) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require(f)
          } catch (e) {
            failed.push(`${nodePath.relative(SRC, f)}: ${(e as Error).message}`)
          }
        }
      }),
    )
    expect(failed).toEqual([])
    // not vacuous: mask-sensitive.ts builds its digit and cut rules at load
    expect(built.length).toBeGreaterThanOrEqual(4)
    expect(built.flatMap((b) => builtNewerThanSafari15(b) ?? [])).toEqual([])
  })
})
