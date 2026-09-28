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
//
// Plain ESM + JSDoc types (moved from src/__tests__/integration/helpers/
// audit-emission.ts, 2026-09-28, logic unchanged) so plain `node` can import
// it — the CI audit-gates job installs only `typescript`. Consumers: CP2
// (audit-coveredby), CP7 (audit-writer-emission), CP3 (audit-sdk-write-sites,
// findSymbol) and scripts/business/check-shared-cores.mjs.
import ts from 'typescript'
import { deriveWriteMethods } from './sdk-write-methods.mjs'
import { staticAccessName, calleeObject } from './ast-access.mjs'

/** @typedef {import('./sdk-write-methods.mjs').WritePair} WritePair */

// 'auditDurable' (recording-integrity A1) is the third emit primitive — the
// awaited/durable variant of audit() for rows that ARE the deliverable. Every
// scanner in this suite that recognizes an emit must know all three names, or
// a durable writer is invisible to the proof net (CP2/CP4/CP5/CP7 each carry
// the same widened set).
const EMIT_NAMES = new Set(['audit', 'auditWeb', 'auditDurable', 'logFacadeAudit'])
const SUPABASE_WRITE_VERBS = new Set(['insert', 'update', 'upsert', 'delete'])

/** @typedef {ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | ts.MethodDeclaration} FnLike */

/** @param {ts.Node} node
 *  @returns {node is FnLike} */
function isFnLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node)
  )
}

/** Unwrap to the function-like value itself, or — the facade-wrapped idiom
 *  `export const GET = facadeHandler('key', async (ctx) => {...})` — the
 *  LAST function-typed argument of the call (contract §8 v2 Deliverable 3).
 *  @param {ts.Expression | undefined} expr
 *  @returns {FnLike | null} */
function unwrapFnLike(expr) {
  if (!expr) return null
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) return expr
  if (ts.isCallExpression(expr)) {
    /** @type {FnLike | null} */
    let last = null
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
 *  a writer as an exported one). Skips a BODYLESS declaration (a TS overload
 *  SIGNATURE — `export function foo(x: string): void` with no `{...}`) and
 *  keeps scanning for the real implementation sharing that name (contract §8
 *  fix round 1 #9) — resolving to a signature would give the walker zero
 *  returns and zero emits, which reads as a vacuous PASS, not the loud
 *  failure a body-less symbol should be.
 *  @param {string} sourceText
 *  @param {string} symbolName
 *  @returns {FnLike | null} */
export function findSymbol(sourceText, symbolName) {
  const sf = ts.createSourceFile('__scan__.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  /** @type {FnLike | null} */
  let found = null
  /** @param {ts.Node} node */
  function visit(node) {
    if (found) return
    if (ts.isFunctionDeclaration(node) && node.name?.text === symbolName && node.body) {
      found = node
      return
    }
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === symbolName && node.body) {
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

/** @param {FnLike} fn
 *  @returns {ts.Block | null} */
function fnBody(fn) {
  return fn.body && ts.isBlock(fn.body) ? fn.body : null
}

/** @param {ts.Node} node
 *  @returns {boolean} */
function isEmitCall(node) {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && EMIT_NAMES.has(node.expression.text)
}

/** @param {FnLike} root
 *  @param {(n: ts.Node) => void} visitor */
function forEachOwn(root, visitor) {
  const body = fnBody(root)
  if (!body) return
  /** @param {ts.Node} node */
  function walk(node) {
    if (node !== root && isFnLike(node)) return // stop at nested closures
    visitor(node)
    ts.forEachChild(node, walk)
  }
  ts.forEachChild(body, walk)
}

/** @param {FnLike} root
 *  @returns {ts.CallExpression[]} */
function ownEmitCalls(root) {
  /** @type {ts.CallExpression[]} */
  const out = []
  forEachOwn(root, (n) => {
    if (isEmitCall(n)) out.push(/** @type {ts.CallExpression} */ (n))
  })
  return out
}

/** @param {FnLike} root
 *  @returns {ts.ReturnStatement[]} */
function ownReturns(root) {
  /** @type {ts.ReturnStatement[]} */
  const out = []
  forEachOwn(root, (n) => {
    if (ts.isReturnStatement(n)) out.push(n)
  })
  return out
}

/** Function/const-arrow declarations anywhere in `sf`, by name — the
 *  call-through rule's "declared in the same file" scope (covers both the
 *  nested-closure emitSave idiom and cross-declaration *Core/*WithClient
 *  helpers this codebase uses throughout). Last declaration wins on a name
 *  collision (none observed in this codebase).
 *  @param {ts.SourceFile} sf
 *  @returns {Map<string, FnLike>} */
function sameFileDeclarations(sf) {
  /** @type {Map<string, FnLike>} */
  const out = new Map()
  /** @param {ts.Node} node */
  function visit(node) {
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

/** @type {WritePair[] | null} */
let _writePairs = null
/** @returns {WritePair[]} */
function writePairs() {
  if (!_writePairs) _writePairs = deriveWriteMethods()
  return _writePairs
}

// Element-access parity (contract §8 fix round 1 #2): every matcher below
// reads a string-literal ElementAccess (`x['customers']`) IDENTICALLY to
// PropertyAccess (`x.customers`) via staticAccessName/calleeObject — a
// computed (non-literal) key never matches here (it falls through to "not a
// write", which is correct: an unscannable write site is the dispatch ban's
// job — see audit-sdk-write-sites.test.ts's findComputedDispatch — not a
// silent miss here).

/** @param {ts.CallExpression} node
 *  @param {WritePair[] | undefined} pairs — the caller's list (see
 *    emitsOnEveryNonErrorPath); undefined = derive from the installed SDK
 *  @returns {boolean} */
function sdkWriteCallMatch(node, pairs) {
  const method = staticAccessName(node.expression)
  const receiver = calleeObject(node.expression)
  if (!method || !receiver) return false
  const prop = staticAccessName(receiver) ?? (ts.isIdentifier(receiver) ? receiver.text : undefined)
  if (!prop) return false
  return (pairs ?? writePairs()).some((p) => p.prop === prop && p.method === method)
}

/** @param {ts.CallExpression} node
 *  @returns {boolean} */
function rawSupabaseWriteMatch(node) {
  const verb = staticAccessName(node.expression)
  const receiver = calleeObject(node.expression)
  if (!verb || !receiver) return false
  return (
    SUPABASE_WRITE_VERBS.has(verb) &&
    ts.isCallExpression(receiver) &&
    staticAccessName(receiver.expression) === 'from' &&
    receiver.arguments.length > 0
  )
}

const STORAGE_WRITE_METHODS = new Set(['upload', 'remove', 'update', 'move', 'copy'])

/** CP3c third surface: `.auth.admin.<method>(` (excluding obvious reads) and
 *  `.storage.from(bucket).<upload|remove|update|move|copy>(`.
 *  @param {ts.CallExpression} node
 *  @returns {boolean} */
function authAdminOrStorageWriteMatch(node) {
  const method = staticAccessName(node.expression)
  const receiver = calleeObject(node.expression)
  if (!method || !receiver) return false
  const receiverObj = calleeObject(receiver)
  if (staticAccessName(receiver) === 'admin' && receiverObj && staticAccessName(receiverObj) === 'auth' && !/^(get|list|verify)/i.test(method)) {
    return true
  }
  if (!STORAGE_WRITE_METHODS.has(method) || !ts.isCallExpression(receiver)) return false
  const storageReceiver = calleeObject(receiver.expression)
  return staticAccessName(receiver.expression) === 'from' && !!storageReceiver && staticAccessName(storageReceiver) === 'storage'
}

/** The object literal a return statement's value resolves to, for shape
 *  checks — either the literal itself, or (the route-handler idiom) the
 *  first ObjectLiteralExpression argument of a wrapping call like
 *  `NextResponse.json({ error: '...' }, { status: 400 })`.
 *  @param {ts.Expression | undefined} expr
 *  @returns {ts.ObjectLiteralExpression | null} */
function returnedObjectLiteral(expr) {
  if (!expr) return null
  if (ts.isObjectLiteralExpression(expr)) return expr
  if (ts.isCallExpression(expr)) {
    const first = expr.arguments[0]
    if (first && ts.isObjectLiteralExpression(first)) return first
  }
  return null
}

/** @param {ts.Expression | undefined} expr
 *  @returns {boolean} */
function shapeExempt(expr) {
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

/** @param {ts.Node} node
 *  @param {ts.Node} stopAt
 *  @returns {boolean} */
function isInsideCatchClause(node, stopAt) {
  /** @type {ts.Node | undefined} */
  let cur = node.parent
  while (cur && cur !== stopAt) {
    if (ts.isCatchClause(cur)) return true
    if (isFnLike(cur) && cur !== stopAt) return false
    cur = cur.parent
  }
  return false
}

/** @param {ts.Expression | undefined} expr
 *  @returns {boolean} */
function isBareNullish(expr) {
  if (!expr) return true
  return expr.kind === ts.SyntaxKind.NullKeyword || expr.getText().trim() === 'undefined'
}

/** @param {ts.Node} node
 *  @param {ts.Node} root
 *  @returns {ts.Node[]} */
function blockChain(node, root) {
  /** @type {ts.Node[]} */
  const chain = []
  /** @type {ts.Node | undefined} */
  let cur = node
  while (cur && cur !== root) {
    // CaseClause/DefaultClause are chain boundaries too (contract §8 fix
    // round 1 #5) — an emit in `case 1:` must not dominate a return in
    // `case 2:`; without this, both cases share the enclosing SwitchStatement
    // as their nearest ts.isBlock ancestor and falsely looked like the same
    // block.
    if (ts.isBlock(cur) || ts.isCaseClause(cur) || ts.isDefaultClause(cur)) chain.unshift(cur)
    cur = cur.parent
  }
  chain.unshift(root)
  return chain
}

/** @param {ts.Node[]} a
 *  @param {ts.Node[]} b
 *  @returns {boolean} */
function isPrefix(a, b) {
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
 *  only possible false positives that just mean one extra offender line).
 *  @param {ts.Statement} stmt
 *  @returns {boolean} */
function alwaysTerminates(stmt) {
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

/** @typedef {{ ok: boolean, offenders: string[], emitsUnconditionally: boolean }} WalkResult */

/** AST-based status exemption (contract §8 fix round 1 #6 — replaces a
 *  getText() regex, which matched inside STRING LITERALS too, e.g. a
 *  `{ message: "status: 404 ..." }` return with no real status field at
 *  all): a PropertyAssignment literally named `status` anywhere in the
 *  return expression's subtree whose initializer is or contains a numeric
 *  literal in the 4xx/5xx range.
 *  @param {ts.Expression} expr
 *  @returns {boolean} */
function hasStatusProperty4xx5xx(expr) {
  /** @param {ts.Node} n
   *  @returns {boolean} */
  function containsNumericCode(n) {
    if (ts.isNumericLiteral(n)) {
      const v = Number(n.text)
      if (v >= 400 && v < 600) return true
    }
    let hit = false
    ts.forEachChild(n, (c) => {
      if (!hit && containsNumericCode(c)) hit = true
    })
    return hit
  }
  let found = false
  /** @param {ts.Node} node */
  function visit(node) {
    if (found) return
    if (ts.isPropertyAssignment(node)) {
      const name = ts.isIdentifier(node.name) ? node.name.text : ts.isStringLiteral(node.name) ? node.name.text : null
      if (name === 'status' && containsNumericCode(node.initializer)) found = true
    }
    if (!found) ts.forEachChild(node, visit)
  }
  visit(expr)
  return found
}

/** @param {FnLike} fn
 *  @param {Set<FnLike>} seen
 *  @param {WritePair[] | undefined} [pairs]
 *  @returns {WalkResult} */
function walk(fn, seen, depth = 0, pairs) {
  const sf = fn.getSourceFile()
  // Defense in depth (contract §8 fix round 1 #9): findSymbol already skips
  // bodyless declarations, so this should be unreachable — but a body-less
  // resolved symbol must fail LOUD, never silently vacuous-pass (zero
  // returns + zero emits both read as "ok" by the checks below).
  if (!fnBody(fn)) {
    return { ok: false, offenders: ['bodyless symbol (no function body found — an overload signature?)'], emitsUnconditionally: false }
  }
  const helpers = sameFileDeclarations(sf)
  const emits = ownEmitCalls(fn)
  const returns = ownReturns(fn)

  /** Is `ret`'s expression itself a call-through-shaped reference to a
   *  same-file local helper (regardless of whether it resolved)? Used only
   *  to give the "flatten or emit inline" hint when depth capping is what
   *  blocked resolution.
   *  @param {ts.ReturnStatement} ret
   *  @returns {FnLike | undefined} */
  function callThroughTarget(ret) {
    const expr = ret.expression
    if (expr && ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
      return helpers.get(expr.expression.text)
    }
    return undefined
  }

  /** @param {ts.ReturnStatement} ret
   *  @returns {boolean} */
  function isDominated(ret) {
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
        const result = walk(helper, nextSeen, depth + 1, pairs)
        if (result.ok && result.emitsUnconditionally) return true
      }
    }
    return false
  }

  // Locate the first WRITE call in fn's own body (the before-anchor
  // exemption). A "write" is a direct SDK/raw-supabase/auth-admin/storage
  // call, or a call to a same-file helper that is itself (recursively) a
  // write or an unconditional emitter.
  /** @param {ts.CallExpression} node
   *  @param {Set<FnLike>} writeSeen
   *  @returns {boolean} */
  function isWriteCall(node, writeSeen) {
    if (sdkWriteCallMatch(node, pairs) || rawSupabaseWriteMatch(node) || authAdminOrStorageWriteMatch(node)) return true
    if (ts.isIdentifier(node.expression)) {
      const helper = helpers.get(node.expression.text)
      if (helper && !writeSeen.has(helper)) {
        const nextSeen = new Set(writeSeen)
        nextSeen.add(helper)
        if (containsWriteCall(helper, nextSeen)) return true
        if (walk(helper, nextSeen, 0, pairs).emitsUnconditionally) return true
      }
    }
    return false
  }
  /** @param {FnLike} target
   *  @param {Set<FnLike>} writeSeen
   *  @returns {boolean} */
  function containsWriteCall(target, writeSeen) {
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
  /** @type {number | null} */
  let anchorPos = null
  forEachOwn(fn, (n) => {
    if (anchorPos !== null) return
    if (ts.isCallExpression(n) && isWriteCall(n, new Set([fn]))) anchorPos = n.getStart()
  })

  /** @type {string[]} */
  const offenders = []
  for (const ret of returns) {
    if (isDominated(ret)) continue
    if (isInsideCatchClause(ret, fn)) continue
    if (isBareNullish(ret.expression)) continue
    if (anchorPos !== null && ret.getStart() < anchorPos) continue // before-anchor: exempt, any shape
    if (shapeExempt(ret.expression)) continue
    if (ret.expression && hasStatusProperty4xx5xx(ret.expression)) continue
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

/** @param {FnLike} fn
 *  @param {{ writePairs?: WritePair[] }} [options] — `writePairs`: the SDK
 *    write methods to treat as writes, used INSTEAD of reading the installed
 *    SDK (sdk-write-methods.mjs). Omitted = today's behaviour exactly (CP2 /
 *    CP7 / CP3). A plain-node caller in a job without the SDK passes its own
 *    list — scripts/business/check-shared-cores.mjs passes [] (the Business
 *    door holds no SDK client), so the walker never reaches client.d.ts.
 *  @returns {{ ok: boolean, offenders: string[] }} */
export function emitsOnEveryNonErrorPath(fn, { writePairs: pairs } = {}) {
  const { ok, offenders } = walk(fn, new Set([fn]), 0, pairs)
  return { ok, offenders }
}
