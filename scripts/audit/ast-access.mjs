// Shared property/element-access matching — used by the emission walker
// (write-anchor detection) AND the CP3 scanner (write-site scan + dispatch
// ban), so a string-literal ElementAccess (`x['customers']`) reads IDENTICAL
// to PropertyAccess (`x.customers`) everywhere either is matched (contract
// §8 fix round 1 #2 — bracket-receiver writes were invisible to the scanner,
// the dispatch ban, AND the walker's write anchors before this).
//
// Plain ESM + JSDoc types (moved from src/__tests__/integration/helpers/
// ast-access.ts, 2026-09-28) so plain `node` can import it — the CI
// audit-gates job installs only `typescript` — alongside jest (CP3).
import ts from 'typescript'

/** The literal key of a string-literal ElementAccess (`x['k']`/`x[\`k\`]`),
 *  or undefined if the key isn't a literal (computed — `x[k]`).
 *  @param {ts.ElementAccessExpression} node
 *  @returns {string | undefined} */
export function elementAccessLiteralKey(node) {
  const key = node.argumentExpression
  if (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) return key.text
  return undefined
}

/** The static name of an access node — `.prop` or a string-literal
 *  `['prop']` read identically; undefined for anything else (including a
 *  computed `[expr]`).
 *  @param {ts.Node} node
 *  @returns {string | undefined} */
export function staticAccessName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node)) return elementAccessLiteralKey(node)
  return undefined
}

/** True iff `node` is an ElementAccessExpression with a NON-literal
 *  (computed) key — the unscannable-by-name case.
 *  @param {ts.Node} node
 *  @returns {boolean} */
export function isComputedAccess(node) {
  return ts.isElementAccessExpression(node) && elementAccessLiteralKey(node) === undefined
}

/** The static name of the object a call's callee reads a method off —
 *  handles both `<obj>.method(` and `<obj>['method'](`.
 *  @param {ts.Expression} callee
 *  @returns {ts.Expression | undefined} */
export function calleeObject(callee) {
  if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) return callee.expression
  return undefined
}

/** The leftmost identifier of a property/element-access chain (`a.b['c']`
 *  → `a`), or undefined if the chain doesn't bottom out on a bare
 *  identifier.
 *  @param {ts.Expression} expr
 *  @returns {string | undefined} */
export function rootIdentifierName(expr) {
  /** @type {ts.Expression} */
  let cur = expr
  while (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur)) {
    cur = cur.expression
  }
  return ts.isIdentifier(cur) ? cur.text : undefined
}

/** Every access node (PropertyAccess or ElementAccess, literal or computed)
 *  from `expr` down to its root, outermost first.
 *  @param {ts.Expression} expr
 *  @returns {(ts.PropertyAccessExpression | ts.ElementAccessExpression)[]} */
export function accessChain(expr) {
  /** @type {(ts.PropertyAccessExpression | ts.ElementAccessExpression)[]} */
  const chain = []
  /** @type {ts.Expression} */
  let cur = expr
  while (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur)) {
    chain.push(cur)
    cur = cur.expression
  }
  return chain
}
