// CP7 — writer-emission proof (contract §8, round-2 amendment A: symbol-level
// registry, not file-level). Every AUDITED_CORES entry (src/lib/audit-
// policy.ts) names real writers: the file exists, each `symbols` entry
// resolves and emits on every non-error-classified return path (shared
// walker) — EXCEPT `unproven` symbols, which are registered (so registry-
// reality is honest) but not asserted to pass (documented mechanical-proof
// ceiling, see audit-policy.ts's AUDITED_CORES header). Registry-reality
// cross-check (symbol-level): statically enumerate EVERY exported symbol,
// across ALL of src (not just src/lib/src/actions/src/app/api — the original
// grep census missed a real page.tsx writer), whose subtree (including
// nested closures, e.g. the emitSave idiom) contains a REAL
// audit()/auditWeb() CallExpression (AST-verified, not a comment — the
// org-settings/route.ts false positive this replaces); every one must be
// listed in that file's AUDITED_CORES `symbols`.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { AUDITED_CORES } from '@/lib/audit-policy'
import { findSymbol, emitsOnEveryNonErrorPath } from './helpers/audit-emission'

const ROOT = process.cwd()

// The three infrastructure emitters — CP7 excludes them explicitly (contract
// §8): they ARE the emit primitives, not "a writer that calls the emitter".
const INFRA_EXEMPT = new Set([
  'src/lib/audit.ts',
  'src/lib/audit-web.ts',
  'src/lib/app-api/handler.ts',
])

function srcFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) srcFiles(full, out)
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

function isFnLike(n: ts.Node): n is ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression {
  return ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)
}

function hasExportModifier(node: ts.Node & { modifiers?: ts.NodeArray<ts.ModifierLike> }): boolean {
  return !!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
}

function unwrapFnLike(expr: ts.Expression | undefined): ts.Node | null {
  if (!expr) return null
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) return expr
  if (ts.isCallExpression(expr)) {
    for (const arg of expr.arguments) {
      if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) return arg
    }
  }
  return null
}

/** Does an exported function-like node's subtree (including nested closures
 *  — the emitSave idiom) contain a REAL CallExpression to audit(/auditWeb(?
 *  AST-verified: a comment mentioning "auditWeb() call" in prose (the
 *  org-settings/route.ts false positive) can never match, since comments
 *  aren't AST nodes. */
function containsRealEmitCall(fnNode: ts.Node): boolean {
  let found = false
  function visit(n: ts.Node): void {
    if (found) return
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && (n.expression.text === 'audit' || n.expression.text === 'auditWeb')) {
      found = true
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(fnNode)
  return found
}

/** Every EXPORTED symbol name in `source` whose subtree contains a real
 *  emit call — `export function X`, `export const X = (...) => {...}`
 *  (incl. `export default async function X(...)`), or the facade-wrapped
 *  idiom. */
function exportedEmittingSymbols(source: string, filePath: string): string[] {
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const out: string[] = []
  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name && hasExportModifier(node)) {
      if (containsRealEmitCall(node)) out.push(node.name.text)
    }
    if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          const fn = unwrapFnLike(decl.initializer)
          if (fn && isFnLike(fn) && containsRealEmitCall(fn)) out.push(decl.name.text)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

describe('CP7 — AUDITED_CORES writers emit on every non-error path', () => {
  it('has entries to verify', () => {
    expect(AUDITED_CORES.length).toBeGreaterThan(0)
  })

  for (const entry of AUDITED_CORES) {
    describe(entry.file, () => {
      const abs = join(ROOT, entry.file)
      const source = readFileSync(abs, 'utf8')
      const unprovenNames = new Set((entry.unproven ?? []).map((u) => u.symbol))
      const provenSymbols = entry.symbols.filter((s) => !unprovenNames.has(s))

      it.each(provenSymbols)('symbol %s resolves and emits on every non-error path', (symbolName) => {
        const symbol = findSymbol(source, symbolName)
        expect(symbol).not.toBeNull()
        const result = emitsOnEveryNonErrorPath(symbol!)
        if (!result.ok) {
          throw new Error(`${entry.file}#${symbolName} has undominated returns:\n${result.offenders.join('\n')}`)
        }
        expect(result.ok).toBe(true)
      })

      if (entry.unproven?.length) {
        it.each(entry.unproven)('unproven symbol $symbol resolves (registered, not walker-asserted — $reason)', ({ symbol: symbolName }) => {
          const symbol = findSymbol(source, symbolName)
          expect(symbol).not.toBeNull()
          // Deliberately NOT asserting emitsOnEveryNonErrorPath — see
          // AUDITED_CORES's `unproven` doc comment. Logged for visibility.
          const result = emitsOnEveryNonErrorPath(symbol!)
          // eslint-disable-next-line no-console -- deliberate: keeps the known gap visible in CI output without failing the suite.
          console.log(`[CP7] ${entry.file}#${symbolName} unproven (registered only): ok=${result.ok}`)
        })
      }
    })
  }
})

describe('CP7 — registry-reality cross-check (symbol-level, all of src)', () => {
  it('every exported symbol with a real audit()/auditWeb() call, anywhere in src, is in AUDITED_CORES.symbols', () => {
    const registeredByFile = new Map(AUDITED_CORES.map((e) => [e.file, new Set([...e.symbols, ...(e.unproven ?? []).map((u) => u.symbol)])]))
    const files = srcFiles(join(ROOT, 'src'))
    const offenders: string[] = []
    for (const file of files) {
      const rel = file.replace(ROOT + '/', '')
      if (INFRA_EXEMPT.has(rel)) continue
      const source = readFileSync(file, 'utf8')
      const emitting = exportedEmittingSymbols(source, file)
      if (emitting.length === 0) continue
      const registered = registeredByFile.get(rel) ?? new Set<string>()
      for (const symbolName of emitting) {
        if (!registered.has(symbolName)) {
          offenders.push(
            `${rel}#${symbolName}: exported symbol emits audit()/auditWeb() but is not in AUDITED_CORES.\n` +
              `  Add to src/lib/audit-policy.ts AUDITED_CORES (or that file's existing entry's symbols[]):\n` +
              `  { file: '${rel}', symbols: ['${symbolName}'] }`,
          )
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('every AUDITED_CORES file still exists and every listed symbol (incl. unproven) still resolves (no dead entries)', () => {
    const offenders: string[] = []
    for (const entry of AUDITED_CORES) {
      const abs = join(ROOT, entry.file)
      let source: string
      try {
        source = readFileSync(abs, 'utf8')
      } catch {
        offenders.push(`${entry.file}: file does not exist — prune this AUDITED_CORES entry`)
        continue
      }
      const allNames = [...entry.symbols, ...(entry.unproven ?? []).map((u) => u.symbol)]
      for (const symbolName of allNames) {
        if (!findSymbol(source, symbolName)) {
          offenders.push(`${entry.file}#${symbolName}: symbol no longer resolves — prune or fix this AUDITED_CORES entry`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('CP7 self-check', () => {
  it('FAILS a fake module whose exported mutation lost its emit', () => {
    const src = `
      export async function silentWriter(x: number) {
        await doWrite(x)
        return { ok: true }
      }
    `
    const symbol = findSymbol(src, 'silentWriter')
    expect(symbol).not.toBeNull()
    const result = emitsOnEveryNonErrorPath(symbol!)
    expect(result.ok).toBe(false)
  })

  it('registry-reality scan finds a real exported emitter (self-check on the scanner itself)', () => {
    const src = `
      export async function realWriter(x: number) {
        await doWrite(x)
        audit({ action: 'x' })
        return { ok: true }
      }
    `
    expect(exportedEmittingSymbols(src, 'fake.ts')).toEqual(['realWriter'])
  })

  it('registry-reality scan ignores a COMMENT mentioning audit()/auditWeb() (org-settings/route.ts false-positive class)', () => {
    const src = `
      // this route has no auditWeb() call on purpose
      export async function noOp(x: number) {
        return { ok: true, x }
      }
    `
    expect(exportedEmittingSymbols(src, 'fake.ts')).toEqual([])
  })
})
