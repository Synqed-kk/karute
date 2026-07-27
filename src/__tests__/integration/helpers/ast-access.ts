// Shared property/element-access matching — used by the emission walker
// (write-anchor detection) AND the CP3 scanner (write-site scan + dispatch
// ban), so a string-literal ElementAccess (`x['customers']`) reads IDENTICAL
// to PropertyAccess (`x.customers`) everywhere either is matched (contract
// §8 fix round 1 #2 — bracket-receiver writes were invisible to the scanner,
// the dispatch ban, AND the walker's write anchors before this).
import ts from 'typescript'

/** The literal key of a string-literal ElementAccess (`x['k']`/`x[\`k\`]`),
 *  or undefined if the key isn't a literal (computed — `x[k]`). */
export function elementAccessLiteralKey(node: ts.ElementAccessExpression): string | undefined {
  const key = node.argumentExpression
  if (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) return key.text
  return undefined
}

/** The static name of an access node — `.prop` or a string-literal
 *  `['prop']` read identically; undefined for anything else (including a
 *  computed `[expr]`). */
export function staticAccessName(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node)) return elementAccessLiteralKey(node)
  return undefined
}

/** True iff `node` is an ElementAccessExpression with a NON-literal
 *  (computed) key — the unscannable-by-name case. */
export function isComputedAccess(node: ts.Node): boolean {
  return ts.isElementAccessExpression(node) && elementAccessLiteralKey(node) === undefined
}

/** The static name of the object a call's callee reads a method off —
 *  handles both `<obj>.method(` and `<obj>['method'](`. */
export function calleeObject(callee: ts.Expression): ts.Expression | undefined {
  if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) return callee.expression
  return undefined
}

/** The leftmost identifier of a property/element-access chain (`a.b['c']`
 *  → `a`), or undefined if the chain doesn't bottom out on a bare
 *  identifier. */
export function rootIdentifierName(expr: ts.Expression): string | undefined {
  let cur: ts.Expression = expr
  while (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur)) {
    cur = cur.expression
  }
  return ts.isIdentifier(cur) ? cur.text : undefined
}

/** Every access node (PropertyAccess or ElementAccess, literal or computed)
 *  from `expr` down to its root, outermost first. */
export function accessChain(expr: ts.Expression): (ts.PropertyAccessExpression | ts.ElementAccessExpression)[] {
  const chain: (ts.PropertyAccessExpression | ts.ElementAccessExpression)[] = []
  let cur: ts.Expression = expr
  while (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur)) {
    chain.push(cur)
    cur = cur.expression
  }
  return chain
}
