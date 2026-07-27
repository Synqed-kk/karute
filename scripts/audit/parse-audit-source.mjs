// Shared AST-based extraction for src/lib/audit.ts + src/lib/audit-policy.ts —
// used by BOTH check-audit-weakening.mjs (CP8) and generate-audit-actions-doc.mjs
// (CP4 docs). Plain node .mjs; parses with the `typescript` package already in
// node_modules (no ts-node/tsx needed to run these as pre-build tooling/CI
// steps). Text-based extraction of literal values only — deliberately not a
// full type-checked compile, matching the CP8 script's own "reads HEAD's file
// from disk" contract (contract §8).
import ts from 'typescript'

function sourceFileOf(text, fileName) {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function literalString(node) {
  if (!node) return undefined
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return undefined
}

function findTopLevelDeclaration(sf, name) {
  let found
  function visit(node) {
    if (found) return
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      found = node.initializer
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

function objectLiteralProps(objLit) {
  const out = []
  if (!objLit || !ts.isObjectLiteralExpression(objLit)) return out
  for (const prop of objLit.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const key = literalString(prop.name) ?? (ts.isIdentifier(prop.name) ? prop.name.text : undefined)
    out.push({ key, valueNode: prop.initializer })
  }
  return out
}

function extractFacadeRule(objLit) {
  const rule = {}
  for (const { key, valueNode } of objectLiteralProps(objLit)) {
    if (key === 'kind') rule.kind = literalString(valueNode)
    if (key === 'category') rule.category = literalString(valueNode)
    if (key === 'action') rule.action = literalString(valueNode) ?? ''
    if (key === 'pendingWave') rule.pendingWave = literalString(valueNode)
    if (key === 'coveredBy') rule.coveredBy = literalString(valueNode)
  }
  return rule
}

/** Parses `export const FACADE_AUDIT_MAP: Record<...> = {...}` from
 *  src/lib/audit.ts. Returns null (never an empty object) if the declaration
 *  can't be found — callers MUST treat null as a parse failure, not "no
 *  rows" (contract §8 CP8 hardening, 2026-07-27: a parser bug reading
 *  everything as empty must fail loud, never pass green). */
export function parseFacadeAuditMap(sourceText) {
  const sf = sourceFileOf(sourceText, 'audit.ts')
  const objLit = findTopLevelDeclaration(sf, 'FACADE_AUDIT_MAP')
  if (!objLit || !ts.isObjectLiteralExpression(objLit)) return null
  const rows = {}
  for (const prop of objLit.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const key = literalString(prop.name) ?? (ts.isIdentifier(prop.name) ? prop.name.text : undefined)
    if (!key) continue
    rows[key] = extractFacadeRule(prop.initializer)
  }
  return rows
}

/** Parses `export const API_ROUTE_DECISIONS: Record<...> = {...}` — each
 *  value is either a flat decision object or a method-keyed
 *  Record<method, decision>. Flattens method-keyed rows to `key.METHOD`.
 *  Returns null on parse failure (same contract as parseFacadeAuditMap). */
export function parseApiRouteDecisions(sourceText) {
  const sf = sourceFileOf(sourceText, 'audit.ts')
  const objLit = findTopLevelDeclaration(sf, 'API_ROUTE_DECISIONS')
  if (!objLit || !ts.isObjectLiteralExpression(objLit)) return null
  const rows = {}
  for (const prop of objLit.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const key = literalString(prop.name) ?? (ts.isIdentifier(prop.name) ? prop.name.text : undefined)
    if (!key) continue
    const val = prop.initializer
    if (ts.isObjectLiteralExpression(val)) {
      const props = objectLiteralProps(val)
      const isFlat = props.some((p) => p.key === 'kind')
      if (isFlat) {
        rows[key] = extractFacadeRule(val)
      } else {
        // method-keyed: { GET: {...}, POST: {...} }
        for (const { key: method, valueNode } of props) {
          if (ts.isObjectLiteralExpression(valueNode)) {
            rows[`${key}.${method}`] = extractFacadeRule(valueNode)
          }
        }
      }
    }
  }
  return rows
}

/** Parses `export const AUDIT_ACTIONS = [...] as const` from
 *  src/lib/audit-policy.ts → string[]. Returns null on parse failure. */
export function parseAuditActions(policySourceText) {
  const sf = sourceFileOf(policySourceText, 'audit-policy.ts')
  const arr = findTopLevelDeclaration(sf, 'AUDIT_ACTIONS')
  if (!arr) return null
  // `[...] as const` wraps the ArrayLiteralExpression in an AsExpression.
  const arrayNode = ts.isAsExpression(arr) ? arr.expression : arr
  if (!ts.isArrayLiteralExpression(arrayNode)) return null
  const out = []
  for (const el of arrayNode.elements) {
    const s = literalString(el)
    if (s) out.push(s)
  }
  return out
}

/** Parses `export const AUDITED_CORES: ... = [...]` → [{file, symbols}].
 *  Returns null on parse failure. */
export function parseAuditedCores(policySourceText) {
  const sf = sourceFileOf(policySourceText, 'audit-policy.ts')
  const arr = findTopLevelDeclaration(sf, 'AUDITED_CORES')
  if (!arr || !ts.isArrayLiteralExpression(arr)) return null
  const out = []
  for (const el of arr.elements) {
    if (!ts.isObjectLiteralExpression(el)) continue
    let file
    let symbols = []
    for (const { key, valueNode } of objectLiteralProps(el)) {
      if (key === 'file') file = literalString(valueNode)
      if (key === 'symbols' && ts.isArrayLiteralExpression(valueNode)) {
        symbols = valueNode.elements.map(literalString).filter(Boolean)
      }
    }
    if (file) out.push({ file, symbols })
  }
  return out
}

/** Parses either SDK_WRITE_ALLOWLIST or RAW_SUPABASE_WRITE_ALLOWLIST →
 *  [{file, call}]. Returns null on parse failure. */
export function parseAllowlist(policySourceText, exportName) {
  const sf = sourceFileOf(policySourceText, 'audit-policy.ts')
  const arr = findTopLevelDeclaration(sf, exportName)
  if (!arr || !ts.isArrayLiteralExpression(arr)) return null
  const out = []
  for (const el of arr.elements) {
    if (!ts.isObjectLiteralExpression(el)) continue
    let file
    let call
    for (const { key, valueNode } of objectLiteralProps(el)) {
      if (key === 'file') file = literalString(valueNode)
      if (key === 'call') call = literalString(valueNode)
    }
    if (file && call) out.push({ file, call })
  }
  return out
}
