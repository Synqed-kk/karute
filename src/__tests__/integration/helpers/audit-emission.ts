// Shared TypeScript-AST emission walker — used by BOTH CP2 (audit-coveredby)
// and CP7 (audit-writer-emission). ponytail: lexical dominance, not CFG —
// armor tiering covers deliberate evasion (contract §8 limits paragraph).
//
// THE FINAL RULE (contract §8 build packet v2, 2026-07-27 — one layer, no
// precedence games): every return path (explicit ReturnStatements + the
// implicit tail return) must be lexically dominated by an audit()/
// auditWeb()/logFacadeAudit() call (the emit ends before the return starts
// AND the emit's enclosing-block chain is a prefix of the return's), UNLESS
// the return matches ANY exemption below. Exemptions apply REGARDLESS of
// position relative to writes:
//   1. Return lexically BEFORE the symbol's first write call (SDK write /
//      raw-Supabase write / auth.admin / storage write) — nothing happened
//      yet. If NO write call is visible in the symbol, this exemption never
//      applies (all returns face rules 2-6 only).
//   2. Inside a CatchClause.
//   3. Bare `return` / `return null` / `return undefined`.
//   4. Contains `success: false` or `ok: false`.
//   5. Object literal with a property named `error` or `validationError`
//      whose value is NOT null/undefined/false.
//   6. Return expression text matches /status:\s*[45]\d\d/ (route-handler
//      guard responses, e.g. `NextResponse.json({...}, { status: 404 })`).
// Call-through, ONE level: `return localFn(...)` where localFn is declared
// anywhere in the same source file counts as emit-dominated IFF localFn's
// body passes this SAME algorithm recursively (not a mere "contains audit("
// scan) — the emitSave idiom, src/actions/karute.ts:114-135. Deeper nesting
// (a call-through target whose own unresolved return is itself another
// call-through) is flagged with a distinguishing offender message rather
// than silently recursing further.
import ts from 'typescript'
import { deriveWriteMethods, type WritePair } from './sdk-write-methods'

const EMIT_NAMES = new Set(['audit', 'auditWeb', 'logFacadeAudit'])
const SUPABASE_WRITE_VERBS = new Set(['insert', 'update', 'upsert', 'delete'])

type FnLike = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | ts.MethodDeclaration

function isFnLike(node: ts.Node): node is FnLike {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node)
  )
}

/** Unwrap to the function-like value itself, or — the facade-wrapped idiom
 *  `export const GET = facadeHandler('key', async (ctx) => {...})` — the
 *  LAST function-typed argument of the call (contract §8 v2 Deliverable 3). */
function unwrapFnLike(expr: ts.Expression | undefined): FnLike | null {
  if (!expr) return null
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) return expr
  if (ts.isCallExpression(expr)) {
    let last: FnLike | null = null
    for (const arg of expr.arguments) {
      if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) last = arg
    }
    return last
  }
  return null
}

/** Find `symbolName`'s function-like declaration — `export function X`,
 *  `export const X = (...) => {...}` (incl. the facade-wrapped idiom `export
 *  const GET = facadeHandler('key', async (ctx) => {...})` — unwraps to the
 *  last function-typed argument), or a class MethodDeclaration — regardless
 *  of the `export` modifier (a private choke-point helper is exactly as real
 *  a writer as an exported one). */
export function findSymbol(sourceText: string, symbolName: string): FnLike | null {
  const sf = ts.createSourceFile('__scan__.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found: FnLike | null = null
  function visit(node: ts.Node): void {
    if (found) return
    if (ts.isFunctionDeclaration(node) && node.name?.text === symbolName) {
      found = node
      return
    }
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === symbolName) {
      found = node
      return
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === symbolName) {
      const fn = unwrapFnLike(node.initializer)
      if (fn) {
        found = fn
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

function fnBody(fn: FnLike): ts.Block | null {
  return fn.body && ts.isBlock(fn.body) ? fn.body : null
}

function isEmitCall(node: ts.Node): boolean {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && EMIT_NAMES.has(node.expression.text)
}

function forEachOwn(root: FnLike, visitor: (n: ts.Node) => void): void {
  const body = fnBody(root)
  if (!body) return
  function walk(node: ts.Node): void {
    if (node !== root && isFnLike(node)) return // stop at nested closures
    visitor(node)
    ts.forEachChild(node, walk)
  }
  ts.forEachChild(body, walk)
}

function ownEmitCalls(root: FnLike): ts.CallExpression[] {
  const out: ts.CallExpression[] = []
  forEachOwn(root, (n) => {
    if (isEmitCall(n)) out.push(n as ts.CallExpression)
  })
  return out
}

function ownReturns(root: FnLike): ts.ReturnStatement[] {
  const out: ts.ReturnStatement[] = []
  forEachOwn(root, (n) => {
    if (ts.isReturnStatement(n)) out.push(n)
  })
  return out
}

/** Function/const-arrow declarations anywhere in `sf`, by name — the
 *  call-through rule's "declared in the same file" scope (covers both the
 *  nested-closure emitSave idiom and cross-declaration *Core/*WithClient
 *  helpers this codebase uses throughout). Last declaration wins on a name
 *  collision (none observed in this codebase). */
function sameFileDeclarations(sf: ts.SourceFile): Map<string, FnLike> {
  const out = new Map<string, FnLike>()
  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name) {
      out.set(node.name.text, node)
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const fn = unwrapFnLike(node.initializer)
      if (fn) out.set(node.name.text, fn)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

let _writePairs: WritePair[] | null = null
function writePairs(): WritePair[] {
  if (!_writePairs) _writePairs = deriveWriteMethods()
  return _writePairs
}

function sdkWriteCallMatch(node: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(node.expression)) return false
  const method = node.expression.name.text
  const receiver = node.expression.expression
  let prop: string | null = null
  if (ts.isPropertyAccessExpression(receiver)) prop = receiver.name.text
  else if (ts.isIdentifier(receiver)) prop = receiver.text
  if (!prop) return false
  return writePairs().some((p) => p.prop === prop && p.method === method)
}

function rawSupabaseWriteMatch(node: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(node.expression)) return false
  const verb = node.expression.name.text
  const receiver = node.expression.expression
  return (
    SUPABASE_WRITE_VERBS.has(verb) &&
    ts.isCallExpression(receiver) &&
    ts.isPropertyAccessExpression(receiver.expression) &&
    receiver.expression.name.text === 'from' &&
    receiver.arguments.length > 0
  )
}

const STORAGE_WRITE_METHODS = new Set(['upload', 'remove', 'update', 'move', 'copy'])

/** CP3c third surface: `.auth.admin.<method>(` (excluding obvious reads) and
 *  `.storage.from(bucket).<upload|remove|update|move|copy>(`. */
function authAdminOrStorageWriteMatch(node: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(node.expression)) return false
  const method = node.expression.name.text
  const receiver = node.expression.expression
  if (
    ts.isPropertyAccessExpression(receiver) &&
    receiver.name.text === 'admin' &&
    ts.isPropertyAccessExpression(receiver.expression) &&
    receiver.expression.name.text === 'auth' &&
    !/^(get|list|verify)/i.test(method)
  ) {
    return true
  }
  return (
    STORAGE_WRITE_METHODS.has(method) &&
    ts.isCallExpression(receiver) &&
    ts.isPropertyAccessExpression(receiver.expression) &&
    receiver.expression.name.text === 'from' &&
    ts.isPropertyAccessExpression(receiver.expression.expression) &&
    receiver.expression.expression.name.text === 'storage'
  )
}

/** The object literal a return statement's value resolves to, for shape
 *  checks — either the literal itself, or (the route-handler idiom) the
 *  first ObjectLiteralExpression argument of a wrapping call like
 *  `NextResponse.json({ error: '...' }, { status: 400 })`. */
function returnedObjectLiteral(expr: ts.Expression | undefined): ts.ObjectLiteralExpression | null {
  if (!expr) return null
  if (ts.isObjectLiteralExpression(expr)) return expr
  if (ts.isCallExpression(expr)) {
    const first = expr.arguments[0]
    if (first && ts.isObjectLiteralExpression(first)) return first
  }
  return null
}

function shapeExempt(expr: ts.Expression | undefined): boolean {
  const obj = returnedObjectLiteral(expr)
  if (!obj) return false
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const name = ts.isIdentifier(prop.name) ? prop.name.text : ts.isStringLiteral(prop.name) ? prop.name.text : null
    if (!name) continue
    if (/^(error|validationError)$/.test(name)) {
      const v = prop.initializer
      const isNullish =
        v.kind === ts.SyntaxKind.NullKeyword || v.getText().trim() === 'undefined' || v.kind === ts.SyntaxKind.FalseKeyword
      if (!isNullish) return true
    }
    if ((name === 'success' || name === 'ok') && prop.initializer.kind === ts.SyntaxKind.FalseKeyword) {
      return true
    }
  }
  return false
}

function isInsideCatchClause(node: ts.Node, stopAt: ts.Node): boolean {
  let cur: ts.Node | undefined = node.parent
  while (cur && cur !== stopAt) {
    if (ts.isCatchClause(cur)) return true
    if (isFnLike(cur) && cur !== stopAt) return false
    cur = cur.parent
  }
  return false
}

function isBareNullish(expr: ts.Expression | undefined): boolean {
  if (!expr) return true
  return expr.kind === ts.SyntaxKind.NullKeyword || expr.getText().trim() === 'undefined'
}

function blockChain(node: ts.Node, root: ts.Node): ts.Node[] {
  const chain: ts.Node[] = []
  let cur: ts.Node | undefined = node
  while (cur && cur !== root) {
    if (ts.isBlock(cur)) chain.unshift(cur)
    cur = cur.parent
  }
  chain.unshift(root)
  return chain
}

function isPrefix(a: ts.Node[], b: ts.Node[]): boolean {
  if (a.length > b.length) return false
  return a.every((n, i) => n === b[i])
}

/** Does `stmt` (the LAST statement of some block) guarantee the enclosing
 *  function returns/throws on every path through it — so a "falls off the
 *  end" implicit-return check should NOT fire? Handles the try/catch-as-
 *  last-statement idiom this codebase uses everywhere (every branch of the
 *  try AND the catch ends in return, so there is no real fall-through, even
 *  though the TryStatement node itself isn't a ReturnStatement/
 *  ThrowStatement). Conservative elsewhere (switch, labeled, etc. → false,
 *  i.e. "check it" — never a false negative that hides a real fall-through,
 *  only possible false positives that just mean one extra offender line). */
function alwaysTerminates(stmt: ts.Statement): boolean {
  if (ts.isReturnStatement(stmt) || ts.isThrowStatement(stmt)) return true
  if (ts.isBlock(stmt)) {
    return stmt.statements.length > 0 && alwaysTerminates(stmt.statements[stmt.statements.length - 1])
  }
  if (ts.isIfStatement(stmt)) {
    if (!stmt.elseStatement) return false
    return alwaysTerminates(stmt.thenStatement) && alwaysTerminates(stmt.elseStatement)
  }
  if (ts.isTryStatement(stmt)) {
    const tryTerm = alwaysTerminates(stmt.tryBlock)
    if (stmt.catchClause) {
      return tryTerm && alwaysTerminates(stmt.catchClause.block)
    }
    return stmt.finallyBlock ? alwaysTerminates(stmt.finallyBlock) : tryTerm
  }
  return false
}

interface WalkResult {
  ok: boolean
  offenders: string[]
  emitsUnconditionally: boolean
}

const STATUS_4XX_5XX = /status:\s*[45]\d\d/

function walk(fn: FnLike, seen: Set<FnLike>, depth = 0): WalkResult {
  const sf = fn.getSourceFile()
  const helpers = sameFileDeclarations(sf)
  const emits = ownEmitCalls(fn)
  const returns = ownReturns(fn)

  /** Is `ret`'s expression itself a call-through-shaped reference to a
   *  same-file local helper (regardless of whether it resolved)? Used only
   *  to give the "flatten or emit inline" hint when depth capping is what
   *  blocked resolution. */
  function callThroughTarget(ret: ts.ReturnStatement): FnLike | undefined {
    const expr = ret.expression
    if (expr && ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
      return helpers.get(expr.expression.text)
    }
    return undefined
  }

  function isDominated(ret: ts.ReturnStatement): boolean {
    for (const emit of emits) {
      if (emit.getEnd() > ret.getStart()) continue
      if (isPrefix(blockChain(emit, fn), blockChain(ret, fn))) return true
    }
    // Call-through, ONE level only (contract §8 v2 Deliverable 3) — only
    // attempted from the top-level walk (depth 0); a helper's OWN
    // unresolved call-through-shaped return does not recurse further.
    if (depth === 0) {
      const helper = callThroughTarget(ret)
      if (helper && !seen.has(helper)) {
        const nextSeen = new Set(seen)
        nextSeen.add(helper)
        const result = walk(helper, nextSeen, depth + 1)
        if (result.ok && result.emitsUnconditionally) return true
      }
    }
    return false
  }

  // Locate the first WRITE call in fn's own body (the before-anchor
  // exemption). A "write" is a direct SDK/raw-supabase/auth-admin/storage
  // call, or a call to a same-file helper that is itself (recursively) a
  // write or an unconditional emitter.
  function isWriteCall(node: ts.CallExpression, writeSeen: Set<FnLike>): boolean {
    if (sdkWriteCallMatch(node) || rawSupabaseWriteMatch(node) || authAdminOrStorageWriteMatch(node)) return true
    if (ts.isIdentifier(node.expression)) {
      const helper = helpers.get(node.expression.text)
      if (helper && !writeSeen.has(helper)) {
        const nextSeen = new Set(writeSeen)
        nextSeen.add(helper)
        if (containsWriteCall(helper, nextSeen)) return true
        if (walk(helper, nextSeen).emitsUnconditionally) return true
      }
    }
    return false
  }
  function containsWriteCall(target: FnLike, writeSeen: Set<FnLike>): boolean {
    let found = false
    forEachOwn(target, (n) => {
      if (found) return
      if (ts.isCallExpression(n) && isWriteCall(n, writeSeen)) found = true
    })
    return found
  }
  // Tracked as a position, not the node itself — TS can't reliably narrow a
  // `ts.CallExpression | null` local reassigned inside the forEachOwn
  // closure back at the read site below.
  let anchorPos: number | null = null
  forEachOwn(fn, (n) => {
    if (anchorPos !== null) return
    if (ts.isCallExpression(n) && isWriteCall(n, new Set([fn]))) anchorPos = n.getStart()
  })

  const offenders: string[] = []
  for (const ret of returns) {
    if (isDominated(ret)) continue
    if (isInsideCatchClause(ret, fn)) continue
    if (isBareNullish(ret.expression)) continue
    if (anchorPos !== null && ret.getStart() < anchorPos) continue // before-anchor: exempt, any shape
    if (shapeExempt(ret.expression)) continue
    if (ret.expression && STATUS_4XX_5XX.test(ret.expression.getText())) continue
    const { line } = sf.getLineAndCharacterOfPosition(ret.getStart())
    const nestedHint =
      depth === 0 && callThroughTarget(ret)
        ? ' (call-through target itself needs a second hop — flatten or emit inline; call-through is one level only)'
        : ''
    offenders.push(`line ${line + 1}: ${ret.getText().replace(/\s+/g, ' ').slice(0, 140)}${nestedHint}`)
  }

  // Implicit tail return: body falls through with no explicit return/throw
  // on the path that reaches the end (alwaysTerminates handles try/catch and
  // if/else chains whose every branch already returns/throws).
  const body = fnBody(fn)
  let emitsUnconditionally = offenders.length === 0
  if (body && body.statements.length > 0) {
    const last = body.statements[body.statements.length - 1]
    if (!alwaysTerminates(last)) {
      const hasTopLevelEmit = emits.some((e) => isPrefix(blockChain(e, fn), [fn, body]))
      if (!hasTopLevelEmit) {
        const { line } = sf.getLineAndCharacterOfPosition(last.getEnd())
        offenders.push(`line ${line + 1}: implicit tail return (fall-through, no dominating top-level emit)`)
        emitsUnconditionally = false
      }
    }
  }
  emitsUnconditionally = emitsUnconditionally && emits.length > 0

  return { ok: offenders.length === 0, offenders, emitsUnconditionally }
}

export function emitsOnEveryNonErrorPath(fn: FnLike): { ok: boolean; offenders: string[] } {
  const { ok, offenders } = walk(fn, new Set([fn]))
  return { ok, offenders }
}
