// Shared AST-based extraction for src/lib/audit.ts + src/lib/audit-policy.ts —
// used by BOTH check-audit-weakening.mjs (CP8) and generate-audit-actions-doc.mjs
// (CP4 docs). Plain node .mjs; parses with the `typescript` package already in
// node_modules (no ts-node/tsx needed to run these as pre-build tooling/CI
// steps). Text-based extraction of literal values only — deliberately not a
// full type-checked compile, matching the CP8 script's own "reads HEAD's file
// from disk" contract (contract §8).
import ts from 'typescript'

// Fix round 1 #3 — spread-blindness: a SpreadElement/SpreadAssignment (or any
// other node shape none of the branches below recognize) inside one of the
// six parsed structures must fail the WHOLE parse loudly (null → CP8 exit 2),
// never be silently skipped. Silently skipping a spread would let a
// programmatically-assembled entry (`...someObject`) hide a write/action from
// every downstream scan while still compiling. Thrown internally, caught only
// at each exported function's boundary.
class AuditParseFailure extends Error {}

function sourceFileOf(text, fileName) {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function literalString(node) {
  if (!node) return undefined
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return undefined
}

function findTopLevelDeclaration(sf, name) {
  // Top-level statements ONLY (blind-round find, 2026-07-28): the old
  // recursive walk returned the FIRST same-named VariableDeclaration
  // anywhere in the file in document order — a decoy `const FACADE_AUDIT_MAP
  // = {…copy of main…}` inside an earlier function body would hijack the
  // parse and let the REAL map below be weakened unseen by CP8 AND CP4
  // (both read through this function). At top level a duplicate identifier
  // is a tsc error, so a first-match here is provably the only match.
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === name) return decl.initializer
    }
  }
  return undefined
}

function objectLiteralProps(objLit) {
  // Non-object input (an identifier referencing a shared const, a call
  // result) would yield a hollow {} — same laundering risk as a spread.
  if (!objLit || !ts.isObjectLiteralExpression(objLit)) throw new AuditParseFailure()
  const out = []
  for (const prop of objLit.properties) {
    // Anything but a plain `key: value` (spread, shorthand, method, getter)
    // fails the whole parse — silent drops are the exact hole this guards.
    if (!ts.isPropertyAssignment(prop)) throw new AuditParseFailure()
    const key = literalString(prop.name) ?? (ts.isIdentifier(prop.name) ? prop.name.text : undefined)
    if (key === undefined) throw new AuditParseFailure()
    out.push({ key, valueNode: prop.initializer })
  }
  return out
}

/** Runs `fn`, returning null instead of throwing if it hit a spread (or other
 *  non-conforming shape) anywhere in the structure it walked. */
function parseOrNull(fn) {
  try {
    return fn()
  } catch (e) {
    if (e instanceof AuditParseFailure) return null
    throw e
  }
}

// The six fields CP8 diffs row-to-row. Anything else on a row (a decision
// row's free-text `justification`/`dated`) is not compared and not parsed.
const COMPARED_FIELDS = ['kind', 'category', 'action', 'targetType', 'pendingWave', 'coveredBy']

function extractFacadeRule(objLit) {
  const rule = {}
  for (const { key, valueNode } of objectLiteralProps(objLit)) {
    if (!COMPARED_FIELDS.includes(key)) continue
    // Fresh-eyes fix (Fable direct audit, 2026-07-28): a compared field that
    // is PRESENT but not a string literal (an identifier referencing a const,
    // a call, a template with substitutions) used to parse as `undefined`.
    // That is silent evasion, not a parse: CP8's recategorization check only
    // fires when BOTH sides are truthy, so an undefined head-side `category`
    // skipped it and a live row could be recategorized unflagged. Same
    // non-conforming-shape class as a spread — fail the WHOLE parse loudly.
    // (A literal empty action, `action: ''`, is a real value and still parses.)
    const value = literalString(valueNode)
    if (value === undefined) throw new AuditParseFailure()
    rule[key] = value
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
  return parseOrNull(() => {
    const rows = {}
    for (const prop of objLit.properties) {
      if (!ts.isPropertyAssignment(prop)) throw new AuditParseFailure()
      const key = literalString(prop.name) ?? (ts.isIdentifier(prop.name) ? prop.name.text : undefined)
      if (!key) throw new AuditParseFailure()
      rows[key] = extractFacadeRule(prop.initializer)
    }
    return rows
  })
}

/** Parses `export const API_ROUTE_DECISIONS: Record<...> = {...}` — each
 *  value is either a flat decision object or a method-keyed
 *  Record<method, decision>. Flattens method-keyed rows to `key.METHOD`.
 *  Returns null on parse failure (same contract as parseFacadeAuditMap). */
export function parseApiRouteDecisions(sourceText) {
  const sf = sourceFileOf(sourceText, 'audit.ts')
  const objLit = findTopLevelDeclaration(sf, 'API_ROUTE_DECISIONS')
  if (!objLit || !ts.isObjectLiteralExpression(objLit)) return null
  return parseOrNull(() => {
    const rows = {}
    for (const prop of objLit.properties) {
      if (!ts.isPropertyAssignment(prop)) throw new AuditParseFailure()
      const key = literalString(prop.name) ?? (ts.isIdentifier(prop.name) ? prop.name.text : undefined)
      if (!key) throw new AuditParseFailure()
      const val = prop.initializer
      // A row value that isn't an inline object literal (an identifier
      // reference, a call) would hide its decision — fail loud.
      if (!ts.isObjectLiteralExpression(val)) throw new AuditParseFailure()
      const props = objectLiteralProps(val)
      const isFlat = props.some((p) => p.key === 'kind')
      if (isFlat) {
        rows[key] = extractFacadeRule(val)
      } else {
        // method-keyed: { GET: {...}, POST: {...} }
        for (const { key: method, valueNode } of props) {
          if (!ts.isObjectLiteralExpression(valueNode)) throw new AuditParseFailure()
          rows[`${key}.${method}`] = extractFacadeRule(valueNode)
        }
      }
    }
    return rows
  })
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
  return parseOrNull(() => {
    const out = []
    for (const el of arrayNode.elements) {
      if (ts.isSpreadElement(el)) throw new AuditParseFailure()
      const s = literalString(el)
      if (s === undefined) throw new AuditParseFailure()
      out.push(s)
    }
    return out
  })
}

/** Parses `export const AUDITED_CORES: ... = [...]` → [{file, symbols}].
 *  Returns null on parse failure. */
export function parseAuditedCores(policySourceText) {
  const sf = sourceFileOf(policySourceText, 'audit-policy.ts')
  const arr = findTopLevelDeclaration(sf, 'AUDITED_CORES')
  if (!arr || !ts.isArrayLiteralExpression(arr)) return null
  return parseOrNull(() => {
    const out = []
    for (const el of arr.elements) {
      if (ts.isSpreadElement(el)) throw new AuditParseFailure()
      if (!ts.isObjectLiteralExpression(el)) throw new AuditParseFailure()
      let file
      let symbols = []
      for (const { key, valueNode } of objectLiteralProps(el)) {
        if (key === 'file') file = literalString(valueNode)
        if (key === 'symbols') {
          if (!ts.isArrayLiteralExpression(valueNode)) throw new AuditParseFailure()
          symbols = valueNode.elements.map((s) => {
            if (ts.isSpreadElement(s)) throw new AuditParseFailure()
            const str = literalString(s)
            if (str === undefined) throw new AuditParseFailure()
            return str
          })
        }
      }
      if (!file) throw new AuditParseFailure()
      out.push({ file, symbols })
    }
    return out
  })
}

/** Parses either SDK_WRITE_ALLOWLIST or RAW_SUPABASE_WRITE_ALLOWLIST →
 *  [{file, call, symbols}]. Returns null on parse failure. */
export function parseAllowlist(policySourceText, exportName) {
  const sf = sourceFileOf(policySourceText, 'audit-policy.ts')
  const arr = findTopLevelDeclaration(sf, exportName)
  if (!arr || !ts.isArrayLiteralExpression(arr)) return null
  return parseOrNull(() => {
    const out = []
    for (const el of arr.elements) {
      if (ts.isSpreadElement(el)) throw new AuditParseFailure()
      if (!ts.isObjectLiteralExpression(el)) throw new AuditParseFailure()
      let file
      let call
      let symbols = []
      for (const { key, valueNode } of objectLiteralProps(el)) {
        if (key === 'file') file = literalString(valueNode)
        if (key === 'call') call = literalString(valueNode)
        if (key === 'symbols') {
          if (!ts.isArrayLiteralExpression(valueNode)) throw new AuditParseFailure()
          symbols = valueNode.elements.map((s) => {
            if (ts.isSpreadElement(s)) throw new AuditParseFailure()
            const str = literalString(s)
            if (str === undefined) throw new AuditParseFailure()
            return str
          })
        }
      }
      if (!file || !call) throw new AuditParseFailure()
      out.push({ file, call, symbols })
    }
    return out
  })
}
