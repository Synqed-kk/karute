// R-S115-10 SF1 (the class): no regex feature newer than Safari 15 in code the
// browser loads at start. src/instrumentation-client.ts is required by Next at
// the top of the client entry with no try, so a regex that does not PARSE on
// an older engine (iOS 15 WKWebView: the Capacitor shell's floor) throws at
// module load and the page never hydrates. V8 parses all of these, so CI can
// only catch them by reading the source.
// Checked, with the Safari version that first parses each:
// - lookbehind `(?<=` `(?<!`            Safari 16.4
// - the `v` flag (set notation)          Safari 17
// - inline modifiers `(?i:` `(?-i:`      Safari 18.x / not yet everywhere
// - any regex flag outside `dgimsuy`     (d 15, s 11.1, u/y 10, g/i/m always)
// - a `RegExp(…, flags)` whose flags are not a literal (cannot be checked)
// Named groups `(?<name>` and `\p{…}` with `u` parse since Safari 11.1: allowed.
import fs from 'fs'
import nodePath from 'path'
import ts from 'typescript'

const SRC = nodePath.resolve(__dirname, '../..')
const ENTRY = nodePath.join(SRC, 'instrumentation-client.ts')
const SAFE_FLAGS = /^[dgimsuy]*$/

function resolveImport(from: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = nodePath.join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = nodePath.resolve(nodePath.dirname(from), spec)
  else return null
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
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
  const PATTERN = /\(\?<[=!]|\(\?[ims]*-?[ims]+:/
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
