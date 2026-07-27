// CP4 — action taxonomy set-equality (contract §8). AUDIT_ACTIONS (audit-
// policy.ts) must be EXACTLY the union of: every non-empty FACADE_AUDIT_MAP
// action, every structured API_ROUTE_DECISIONS action, and every literal
// `action: '...'` string emitted via audit()/auditWeb() in src (AST-matched
// inside the call expression itself — not a bare grep, so a DTO/zod schema
// with an `action` field never false-positives). Both directions fail loud:
// an orphan AUDIT_ACTIONS member (nobody maps or emits it) or a missing one
// (something emits a string this list doesn't have) — either is a tsc-enforced
// drift the moment audit.ts's AuditEvent['action'] typing rejects it too.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { AUDIT_ACTIONS } from '@/lib/audit-policy'
import { FACADE_AUDIT_MAP, API_ROUTE_DECISIONS, type ApiRouteDecision } from '@/lib/audit'
import { srcFiles } from './helpers/src-files'

const ROOT = process.cwd()

function isMethodKeyed(
  entry: ApiRouteDecision | Record<string, ApiRouteDecision>,
): entry is Record<string, ApiRouteDecision> {
  return !('kind' in entry)
}

function mapActions(): string[] {
  return Object.values(FACADE_AUDIT_MAP)
    .map((r) => r.action)
    .filter((a) => a !== '')
}

function decisionActions(): string[] {
  const out: string[] = []
  for (const entry of Object.values(API_ROUTE_DECISIONS)) {
    if (isMethodKeyed(entry)) {
      for (const decision of Object.values(entry)) if (decision.action) out.push(decision.action)
    } else if (entry.action) {
      out.push(entry.action)
    }
  }
  return out
}

// The facade hook is the ONE definitionally-exempt non-literal emission
// (contract §8 ground truth: "src/lib/app-api/handler.ts:132 forwards
// rule.action — the ONLY non-literal action emission in src" that isn't the
// literal-union idiom) — it forwards an ALREADY-typed AuditAction value from
// FACADE_AUDIT_MAP, not a freshly-authored literal, so it is not a taxonomy
// AUTHORING site and is excluded from the scan/ban entirely.
const NON_LITERAL_BAN_EXEMPT_FILES = new Set(['src/lib/app-api/handler.ts'])

/** String-literal members of a parameter's type annotation, when it's a
 *  union of string literals (round-2 amendment E: the ONE authorized
 *  exception to the non-literal-action ban — src/actions/customers.ts's
 *  emitDeletionAudit: `action: 'privacy.customer_delete_scheduled' |
 *  'privacy.customer_delete_canceled'`). Returns null if `type` isn't such a
 *  union (so the caller can tell "not this shape" from "empty union"). */
function literalUnionMembers(type: ts.TypeNode | undefined): string[] | null {
  if (!type) return null
  const memberOf = (t: ts.TypeNode): string | null =>
    ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal) ? t.literal.text : null
  if (ts.isUnionTypeNode(type)) {
    const members = type.types.map(memberOf)
    return members.every((m): m is string => m !== null) ? members : null
  }
  const single = memberOf(type)
  return single !== null ? [single] : null
}

interface LiteralScanResult {
  literals: string[]
  /** Non-literal, non-exempt `action:` values — a hard failure (round-2
   *  amendment E). */
  banned: string[]
}

/** Every literal `action: '...'` inside an audit()/auditWeb() call expression
 *  in `sourceText` — AST-matched (walks INTO the call's object-literal
 *  argument, not a bare grep over the whole file, so a DTO/zod schema with an
 *  unrelated `action` field never false-positives). A non-literal `action`
 *  value is BANNED (hard fail) UNLESS it is a bare identifier whose declared
 *  parameter type is a union of string literals (the emitDeletionAudit
 *  idiom) — those literals are collected directly from the type annotation,
 *  not traced through call sites (round-2 amendment E: kills the `as
 *  AuditAction` cast bypass too, since a cast expression is neither a string
 *  literal nor a literal-union-typed identifier). */
function scanLiteralActions(sourceText: string, filePath: string, exemptFromBan: boolean): LiteralScanResult {
  const sf = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const literals: string[] = []
  const banned: string[] = []

  function actionPropertyValue(call: ts.CallExpression): ts.Expression | undefined {
    const arg = call.arguments[0]
    if (!arg || !ts.isObjectLiteralExpression(arg)) return undefined
    for (const prop of arg.properties) {
      if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'action') {
        return prop.initializer
      }
      if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === 'action') {
        return prop.name
      }
    }
    return undefined
  }

  function enclosingParamType(node: ts.Node, paramName: string): ts.TypeNode | undefined {
    let cur: ts.Node | undefined = node
    while (cur) {
      const fnNode = ts.isFunctionDeclaration(cur) || ts.isArrowFunction(cur) || ts.isFunctionExpression(cur) ? cur : null
      if (fnNode) {
        const param = fnNode.parameters.find((p) => ts.isIdentifier(p.name) && p.name.text === paramName)
        if (param) return param.type
      }
      cur = cur.parent
    }
    return undefined
  }

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === 'audit' || node.expression.text === 'auditWeb')
    ) {
      const value = actionPropertyValue(node)
      if (value) {
        if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
          literals.push(value.text)
        } else if (ts.isIdentifier(value)) {
          const paramType = enclosingParamType(node, value.text)
          const union = literalUnionMembers(paramType)
          if (union) {
            literals.push(...union)
          } else if (!exemptFromBan) {
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
            banned.push(
              `${filePath}:${line + 1}: non-literal action '${value.getText()}' — not a string literal and not a ` +
                `parameter typed as a string-literal union. Either author a literal action string, or type the ` +
                `carrying parameter as a union of the exact literal(s) it can hold.`,
            )
          }
        } else if (!exemptFromBan) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
          banned.push(
            `${filePath}:${line + 1}: non-literal action '${value.getText()}' (e.g. an \`as AuditAction\` cast or ` +
              `computed expression) — banned; author a literal action string instead.`,
          )
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return { literals, banned }
}

function scanAllSrc(): { literals: Set<string>; banned: string[] } {
  const literals = new Set<string>()
  const banned: string[] = []
  for (const file of srcFiles(join(ROOT, 'src'))) {
    const rel = file.replace(ROOT + '/', '')
    const source = readFileSync(file, 'utf8')
    const result = scanLiteralActions(source, file, NON_LITERAL_BAN_EXEMPT_FILES.has(rel))
    for (const a of result.literals) literals.add(a)
    banned.push(...result.banned)
  }
  return { literals, banned }
}

describe('CP4 — AUDIT_ACTIONS set-equality', () => {
  it('AUDIT_ACTIONS is sorted and unique', () => {
    const sorted = [...AUDIT_ACTIONS].sort()
    expect([...AUDIT_ACTIONS]).toEqual(sorted)
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length)
  })

  it('every AUDIT_ACTIONS member is mapped or emitted somewhere (no orphans)', () => {
    const { literals } = scanAllSrc()
    const emitted = new Set([...mapActions(), ...decisionActions(), ...literals])
    const orphans = AUDIT_ACTIONS.filter((a) => !emitted.has(a))
    if (orphans.length > 0) {
      throw new Error(
        `Orphan AUDIT_ACTIONS members (nobody maps or emits these) — remove from src/lib/audit-policy.ts AUDIT_ACTIONS:\n${orphans.join('\n')}`,
      )
    }
    expect(orphans).toEqual([])
  })

  it('every mapped/emitted action is a member of AUDIT_ACTIONS (no missing)', () => {
    const { literals } = scanAllSrc()
    const known = new Set<string>(AUDIT_ACTIONS)
    const emitted = new Set([...mapActions(), ...decisionActions(), ...literals])
    const missing = [...emitted].filter((a) => !known.has(a))
    if (missing.length > 0) {
      throw new Error(
        `Actions emitted/mapped but missing from AUDIT_ACTIONS — add to src/lib/audit-policy.ts AUDIT_ACTIONS:\n${missing.join('\n')}`,
      )
    }
    expect(missing).toEqual([])
  })

  it('no non-literal action arguments outside the one authorized literal-union idiom (round-2 amendment E)', () => {
    const { banned } = scanAllSrc()
    if (banned.length > 0) {
      throw new Error(`Banned non-literal audit()/auditWeb() action argument(s):\n${banned.join('\n')}`)
    }
    expect(banned).toEqual([])
  })
})

describe('CP4 self-check — literal-action scanner', () => {
  it('resolves the emitDeletionAudit literal-union-typed-parameter idiom', () => {
    const src = `
      async function emitHelper(action: 'a.one' | 'a.two', id: string) {
        audit({ action, targetId: id })
      }
      export async function caller1() { await emitHelper('a.one', 'x') }
      export async function caller2() { await emitHelper('a.two', 'y') }
    `
    const { literals, banned } = scanLiteralActions(src, 'fake.ts', false)
    expect(literals.sort()).toEqual(['a.one', 'a.two'])
    expect(banned).toEqual([])
  })

  it('does not false-positive on a DTO/zod object with an unrelated action field', () => {
    const src = `
      const Schema = z.object({ action: z.string() })
      const dto = { action: 'not-an-audit-call' }
    `
    const { literals, banned } = scanLiteralActions(src, 'fake.ts', false)
    expect(literals).toEqual([])
    expect(banned).toEqual([])
  })

  it('BANS a non-literal, non-union-typed action argument (e.g. an `as AuditAction` cast bypass)', () => {
    const src = `
      export async function evil(x: string) {
        audit({ action: x as AuditAction })
      }
    `
    const { banned } = scanLiteralActions(src, 'fake.ts', false)
    expect(banned.length).toBeGreaterThan(0)
  })

  it('BANS a plain (non-union-typed) identifier action argument', () => {
    const src = `
      export async function evil(action: string) {
        audit({ action })
      }
    `
    const { banned } = scanLiteralActions(src, 'fake.ts', false)
    expect(banned.length).toBeGreaterThan(0)
  })

  it('exempts the facade hook file from the ban (handler.ts forwards an already-typed AuditAction)', () => {
    const src = `
      export async function logFacadeAudit(rule: { action: string }) {
        audit({ action: rule.action })
      }
    `
    const { banned } = scanLiteralActions(src, 'fake.ts', true)
    expect(banned).toEqual([])
  })
})
