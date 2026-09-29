#!/usr/bin/env node
// Business shared-cores fence (⚖ 2026-09-28, PLAN-BUSINESS-LIVE v2.2 §2 S1 +
// §3 W0 (b), W0 PR (1)). SYNQED Business (the computer version of Karute) will
// write through the phone's OWN shared mutation cores — the same functions the
// phone's web actions and facade routes call, so every desk write lands the
// same audit row a phone write does. This guard is the promise that exactly
// ONE territory file can ever reach them, and only through calls a human has
// named row by row:
//
//   scripts/business/business-territory.json "sharedCores"
//     doorFile — the ONE territory file that may import the listed modules
//     modules  — the shared cores (+ src/lib/audit for the door's own rows)
//     never    — names that fail even with a row
//     calls    — one row per { module, call, symbol, class }: the door may make
//                `call` (an export of `module`) only from inside the exported
//                function `symbol`. A row may land before its site (the
//                "writers" convention); a site never lands before its row.
//
// Rules, in order (every rule reads the AST — typescript, the one dependency
// the audit-gates job installs, exact-pinned):
//   1. DENY SET = every exported VALUE of every listed module (functions,
//      consts, classes, enums — never types), read from the real files, ∪
//      every `symbols[]` name of every AUDITED_CORES entry (src/lib/
//      audit-policy.ts, read with CP8's own parser).
//   2. In every territory file (same walk + skips as the data-access guard):
//      `import * as` / `export … from` / import() / require() /
//      jest.requireActual|requireMock / `typeof import()` / `import x =
//      require()` of a listed module FAIL everywhere, the door included; any
//      other import of a listed module FAILS outside the door; an import()/
//      require() whose specifier is BUILT (not a literal) FAILS everywhere —
//      it cannot be judged.
//   3. THE STRICT POSITION RULE (Greptile G2). In the door, a binding imported
//      from a listed module may appear ONLY as the callee of a direct call —
//      `x(…)`, `await x(…)`, `x?.(…)`, `x<T>(…)` — and that call is a SITE;
//      its symbol is the enclosing top-level EXPORTED function (declaration,
//      or an exported const whose initializer is a function, directly or as a
//      call's function argument). A site with no exactly-matching row FAILS; a
//      `never` call FAILS even with a row. EVERY other value position — a
//      variable initializer, an assignment's right side, an argument (a
//      `.then` callback included), a property access on it (.bind / .call /
//      .apply …), an array or object member, a return value, a default
//      parameter, an export, `typeof` in a value, `(0, x)(…)`, `(x as T)(…)`,
//      `new x(…)`, a tagged template — FAILS `deny-set name in non-call
//      position`, and so does destructuring a deny-set name out of anything
//      (`const { updateAppointmentCore: u } = …`). Any local binding in the
//      door (const / let / var / param / destructuring / function / class /
//      catch) whose name is a deny-set name, or the local name of an imported
//      core, FAILS `shadowing a deny-set name` (the one exemption is (b)
//      below: the door's own row-symbol function itself). The door CALLS
//      cores; it never hands them around — so no alias tracking is needed:
//      with passing-as-value illegal, an alias cannot be made. An import alias
//      resolves to the exported name (`import { updateAppointmentCore as u }`:
//      `u(…)` is an updateAppointmentCore site). Property NAMES (`obj.x`) are
//      not judged: an object that could hold a core can only come from a
//      reference this rule already fails, or from an import the isolation
//      test's FILE_ALLOWED_TARGETS refuses. Type positions are not sites.
//   4. Every row must name a listed module, a real export of it, no `never`
//      call, and a class in {core-emits, caller-emits, trace, receipt} that
//      fits the call — a typo never passes (Greptile G3):
//        audit ⇔ trace · auditDurable ⇔ receipt ·
//        core-emits ⇔ the call is a PROVEN audited core of that module: a
//          `symbols[]` name of the module file's AUDITED_CORES entry and not
//          in its `unproven[]` — exactly the set CP7 (src/__tests__/
//          integration/audit-writer-emission.test.ts) proves "emits on every
//          non-error path"; anything else as core-emits FAILS `not an audited
//          core` (createCustomerWithClient / createPackWithClient write with
//          no audit row of their own — customers.core.ts leaves it to the
//          caller) ·
//        caller-emits ⇔ any other core: the door function emits the audit
//          itself, so the row needs, for the SAME symbol, a trace or receipt
//          row (else `unaudited write: <symbol> needs an audit row`), and in
//          the door the function holding the site must pass THE RETURN-PATH
//          CHECK below.
//      THE RETURN-PATH CHECK (Greptile P1 #4). The exact function node that
//      holds a caller-emits site — the one rule 3 resolved its symbol from
//      (the top-level exported function, or the function argument of an
//      exported const's call), never a lookup by name — must (i) itself
//      contain an approved audit() / auditDurable() site, and (ii) pass the
//      shared emission walker (scripts/audit/emission-walker.mjs, the one
//      CP2/CP7 prove the audited cores with — never a second copy): every
//      non-error return path lexically dominated by an emit. Else ONE
//      finding per function, `unaudited write: <symbol> needs an audit on
//      every return path`, the offenders one per line. The convention a door
//      function follows: a block body; the audit call INLINE on the success
//      path (before or after the core call, in a block every success return
//      sits inside), or ONE-level `return helper(…)` call-through to a helper
//      nested in the same function that does both. A side-effect helper call
//      (`emitAudit(); return r`) is NOT accepted — the walker's limitation, by
//      design, pinned by the selftest. An early return BEFORE the core call
//      is exempt only when error-shaped (`{ ok: false, … }`, `{ error: … }`,
//      a 4xx/5xx status) or bare / null / undefined; an early return with any
//      other value is flagged — emit first, or restructure. audit() /
//      auditDurable() are called by their own names (the walker knows emits
//      by name; an import alias is not one), and the walker's other emit
//      names (auditWeb, logFacadeAudit) FAIL anywhere in the door as `foreign
//      emit name` — a local stand-in would read as an audit. The walker gets
//      `writePairs: []`: the audit-gates job installs no SDK, and the door
//      reaches core only through the bound handles in core-reach.ts (data-access rule 1, CP3's "writers" rows), so it
//      never reads client.d.ts. Inherited from the walker unchanged (not this
//      fence's to widen): a return inside a catch, a bare / null return and
//      an error-shaped value are exempt WHEREVER they sit — a door function
//      never returns those shapes after a successful write.
//   5. A deny-set NAME bound or referenced in ANY territory file other than
//      through an import from its listed module (a local copy, a
//      re-implementation, a relay import from elsewhere) FAILS. Property
//      names, member keys, JSX attribute names and type positions are not
//      bindings. Three narrow exemptions, each pinned by the selftest:
//      (a) Next route-handler exports (GET/POST/…) in a territory route.ts —
//          AUDITED_CORES cites the phone's route handlers by those names, and
//          a Business route cannot be named anything else;
//      (b) the door's own exported functions named as a row's `symbol` (e.g.
//          createCustomer — also an AUDITED_CORES name in actions/customers.ts)
//          when the name is not an export of a listed module and the door
//          does not import it;
//      (c) ALLOW_NAMES below — exact path + name, owner-reviewed like the
//          data-access guard's ALLOW, for territory's own pre-existing locals.
//
// Output: the OK line, or one line per finding `<file>:<line> <label> —
// <name>` and exit 1. Run: node scripts/business/check-shared-cores.mjs
// (CI audit-gates job, after the data-access guard). Fixtures:
// check-shared-cores.selftest.mjs. The import half (which modules the door
// may import at all, and that only src/business/lib/data.ts may import the
// door) is src/__tests__/integration/business-isolation.test.ts —
// FILE_ALLOWED_TARGETS reads the same JSON.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, relative, dirname, sep, posix } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { loadTerritory } from './check-business-isolation.mjs'
import { parseAuditedCores } from '../audit/parse-audit-source.mjs'
import { emitsOnEveryNonErrorPath, EMIT_NAMES } from '../audit/emission-walker.mjs'

// (c) Territory's own pre-existing names that collide with a deny-set name —
// NOT the core's binding (no import of a listed module in these files; rule 2
// still fails one if it ever appears). Exact path + name.
export const ALLOW_NAMES = [
  {
    path: 'src/business/lib/fixtures-settings.ts',
    name: 'AUDIT_CATEGORIES',
    reason: "Business 設定's own fixture table of the nine 監査ログ categories in plain Japanese — a label list, not src/lib/audit's const",
  },
  {
    path: 'src/app/[locale]/(business)/business/settings/settings-props.ts',
    name: 'AUDIT_CATEGORIES',
    reason: 'imports the fixture table above from territory (src/business/lib/fixtures-settings.ts)',
  },
  {
    path: 'src/app/[locale]/(business)/business/today/today-interactions.ts',
    name: 'warn',
    reason: "a local flag of the bed-packing search, not src/lib/packs/store's console helper",
  },
  {
    path: 'src/app/[locale]/(business)/business/reservations/ReservationsScreen.tsx',
    name: 'warn',
    reason: "the <Ev warn> prop (a tone flag), not src/lib/packs/store's console helper",
  },
]

const CLASSES = new Set(['core-emits', 'caller-emits', 'trace', 'receipt'])
// The class a call's row must carry: audit() is a trace, auditDurable() a
// receipt; every other call is core-emits when it is a proven audited core
// (provenAuditedCores below) and caller-emits otherwise.
const CLASS_OF_CALL = new Map([
  ['audit', 'trace'],
  ['auditDurable', 'receipt'],
])
// The walker's emit names the door may never use: it emits through audit() /
// auditDurable() from src/lib/audit only (THE RETURN-PATH CHECK).
const FOREIGN_EMIT_NAMES = new Set([...EMIT_NAMES].filter((n) => !CLASS_OF_CALL.has(n)))
const ROUTE_FILE = /(?:^|\/)route\.[cm]?[jt]sx?$/
const ROUTE_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

// Same walk + skips as check-business-data-access.mjs (allowJs is on).
const SOURCE_EXT = /\.(tsx?|jsx?|mjs|cjs)$/
const SKIP_FILE = /\.(test|spec)\.[jt]sx?$|\.d\.ts$/

function walk(dir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (SOURCE_EXT.test(e.name) && !SKIP_FILE.test(e.name)) out.push(p)
  }
}

function sourceFileOf(rel, text) {
  const kind = /\.tsx$/.test(rel) ? ts.ScriptKind.TSX : /\.jsx$/.test(rel) ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(rel) ? ts.ScriptKind.JS : ts.ScriptKind.TS
  return ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind)
}

const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
const hasExport = (node) => (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false

/** The listed module a specifier reaches, or null — alias (`@/lib/…`) and
 *  relative spellings, an extension or a trailing /index stripped, judged on
 *  the RESOLVED path exactly like business-isolation.test.ts (a barrel or a
 *  sibling such as src/lib/audit-policy is a different module). */
export function listedModuleOf(spec, fromRel, modules) {
  let target
  if (spec.startsWith('@/')) target = posix.join('src', spec.slice(2))
  else if (/^\.\.?(\/|$)/.test(spec)) target = posix.join(posix.dirname(fromRel), spec)
  else return null
  target = target.replace(/\.[cm]?[jt]sx?$/, '').replace(/\/index$/, '')
  return modules.includes(target) ? target : null
}

function resolveModuleFile(root, mod) {
  for (const c of [`${mod}.ts`, `${mod}.tsx`, `${mod}/index.ts`, `${mod}/index.tsx`]) if (existsSync(join(root, c))) return c
  return null
}

/** Exported VALUE names of one module (types/interfaces excluded), plus
 *  whether an `export *` makes the set unreadable. */
function valueExports(sf) {
  const names = new Set()
  let star = false
  const localValues = new Set()
  const collectBinding = (name, into) => {
    if (ts.isIdentifier(name)) into.add(name.text)
    else for (const el of name.elements) if (!ts.isOmittedExpression(el)) collectBinding(el.name, into)
  }
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) {
      if (st.name) localValues.add(st.name.text)
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) collectBinding(d.name, localValues)
    }
  }
  for (const st of sf.statements) {
    if (hasExport(st)) {
      if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) {
        const isDefault = ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
        if (isDefault) names.add('default')
        else if (st.name) names.add(st.name.text)
      } else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) collectBinding(d.name, names)
      }
    } else if (ts.isExportAssignment(st)) {
      names.add('default')
    } else if (ts.isExportDeclaration(st) && !st.isTypeOnly) {
      if (!st.exportClause) star = true
      else if (ts.isNamespaceExport(st.exportClause)) names.add(st.exportClause.name.text)
      else
        for (const s of st.exportClause.elements) {
          if (s.isTypeOnly) continue
          const local = (s.propertyName ?? s.name).text
          // A local export list re-exports a local VALUE only; a re-export from
          // another module is taken at its word (types are `export type`).
          if (st.moduleSpecifier || localValues.has(local)) names.add(s.name.text)
        }
    }
  }
  return { names, star }
}

/** Proven audited cores per file: each AUDITED_CORES entry's `symbols[]`
 *  minus its `unproven[].symbol` — the cores CP7 proves write their own audit
 *  row on every non-error path. `symbols` comes from CP8's parser (`cores`);
 *  `unproven` is read here by AST (that shared parser returns { file,
 *  symbols } only and three gates consume it — left untouched). A shape this
 *  reader cannot judge throws: it never reads as "nothing unproven". */
function provenAuditedCores(policyText, cores) {
  const unreadable = () => {
    throw new Error("src/lib/audit-policy.ts: AUDITED_CORES `unproven` unreadable — the audited-core set cannot be built")
  }
  const lit = (n) => (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : undefined)
  const keyOf = (p) => (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : unreadable())
  const sf = ts.createSourceFile('audit-policy.ts', policyText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let arr
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue
    for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === 'AUDITED_CORES') arr = d.initializer
  }
  if (!arr || !ts.isArrayLiteralExpression(arr)) unreadable()
  const proven = new Map()
  for (const e of cores) proven.set(e.file, new Set([...(proven.get(e.file) ?? []), ...e.symbols]))
  for (const el of arr.elements) {
    if (!ts.isObjectLiteralExpression(el)) unreadable()
    const file = lit(el.properties.find((p) => keyOf(p) === 'file')?.initializer)
    const un = el.properties.find((p) => keyOf(p) === 'unproven')
    if (!un) continue
    if (!file || !ts.isArrayLiteralExpression(un.initializer)) unreadable()
    for (const u of un.initializer.elements) {
      if (!ts.isObjectLiteralExpression(u)) unreadable()
      const symbol = lit(u.properties.find((p) => keyOf(p) === 'symbol')?.initializer)
      if (!symbol) unreadable()
      proven.get(file)?.delete(symbol)
    }
  }
  return proven
}

/** The whole sharedCores block, validated for shape (a malformed config
 *  throws — it never scans). */
export function loadSharedCores(root) {
  const text = readFileSync(join(root, 'scripts/business/business-territory.json'), 'utf8')
  const sc = JSON.parse(text).sharedCores
  const strs = (a) => Array.isArray(a) && a.every((x) => typeof x === 'string' && x.length > 0)
  if (!sc || typeof sc.doorFile !== 'string' || !strs(sc.modules) || sc.modules.length === 0 || !strs(sc.never) || !Array.isArray(sc.calls)) {
    throw new Error('business-territory.json: sharedCores must be { doorFile, modules[], never[], calls[] }')
  }
  for (const r of sc.calls) {
    if (!r || ['module', 'call', 'symbol', 'class'].some((k) => typeof r[k] !== 'string' || r[k].length === 0)) {
      throw new Error(`business-territory.json: sharedCores.calls row must be { module, call, symbol, class } strings: ${JSON.stringify(r)}`)
    }
  }
  return { ...sc, text }
}

/** Inside a type (a type annotation, `typeof x` in a type, an interface or a
 *  type alias, `implements X`)? Types are not values — `class A extends B` is. */
function inTypePosition(id) {
  for (let p = id.parent; p && !ts.isSourceFile(p); p = p.parent) {
    if (ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p) || ts.isTypeParameterDeclaration(p)) return true
    if (ts.isExpressionWithTypeArguments(p)) {
      const h = p.parent
      return !(h && ts.isHeritageClause(h) && h.token === ts.SyntaxKind.ExtendsKeyword && (ts.isClassDeclaration(h.parent) || ts.isClassExpression(h.parent)))
    }
    if (ts.isTypeNode(p)) return true
  }
  return false
}

/** Is this identifier a VALUE binding or reference (not a property name,
 *  member key, JSX attribute name, label, or anything in a type position)? */
function isValueName(id) {
  if (inTypePosition(id)) return false
  const p = id.parent
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false
  if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p) || ts.isEnumMember(p)) && p.name === id) return false
  if (ts.isBindingElement(p) && p.propertyName === id) return false
  if (ts.isJsxAttribute(p) && p.name === id) return false
  if ((ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) && p.label === id) return false
  if (ts.isMetaProperty(p)) return false
  if ((ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p) || ts.isJsxClosingElement(p)) && p.tagName === id) {
    return !ts.isJsxClosingElement(p) && /^[A-Z]/.test(id.text) // intrinsic <div> is a string; a closing tag repeats its opener
  }
  return true
}

/** Is this identifier a DECLARATION name (vs. a reference)? */
function isDeclarationName(id) {
  const p = id.parent
  return (
    ((ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p) || ts.isFunctionExpression(p) ||
      ts.isClassExpression(p) || ts.isParameter(p) || ts.isBindingElement(p) || ts.isEnumDeclaration(p) ||
      ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isImportEqualsDeclaration(p)) && p.name === id) ||
    ts.isImportSpecifier(p)
  )
}

/** Is this identifier the name an import declaration binds (judged by rule 2
 *  or rule 5, never as a shadow)? */
function isImportName(id) {
  const p = id.parent
  return ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isImportEqualsDeclaration(p)
}

/** Is this identifier the name of a TOP-LEVEL exported function declaration
 *  or exported const (the door's own row-symbol functions)? */
function isTopLevelExportName(id, sf) {
  const p = id.parent
  if (ts.isFunctionDeclaration(p) && p.parent === sf && p.name === id) return hasExport(p)
  if (ts.isVariableDeclaration(p) && p.name === id) {
    const st = p.parent?.parent
    return !!st && ts.isVariableStatement(st) && st.parent === sf && hasExport(st)
  }
  return false
}

/** The key text of a destructuring property name (`{ key: local }`), or null. */
function bindingKeyText(pn) {
  if (ts.isIdentifier(pn) || ts.isStringLiteral(pn) || ts.isNoSubstitutionTemplateLiteral(pn)) return pn.text
  if (ts.isComputedPropertyName(pn) && (ts.isStringLiteral(pn.expression) || ts.isNoSubstitutionTemplateLiteral(pn.expression))) return pn.expression.text
  return null
}

/** The enclosing top-level EXPORTED function — its name and the function
 *  node itself (the node THE RETURN-PATH CHECK walks) — or undefined. */
function enclosingExportedFunction(node, sf, exportedLocals) {
  let top = node
  while (top.parent && top.parent !== sf) top = top.parent
  if (ts.isFunctionDeclaration(top) && top.name && (hasExport(top) || exportedLocals.has(top.name.text))) return { name: top.name.text, fn: top }
  if (ts.isVariableStatement(top)) {
    for (const d of top.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !(hasExport(top) || exportedLocals.has(d.name.text))) continue
      if (!(node.pos >= d.initializer?.pos && node.end <= d.initializer?.end)) continue
      let init = d.initializer
      while (init && (ts.isParenthesizedExpression(init) || ts.isAsExpression(init) || ts.isSatisfiesExpression?.(init))) init = init.expression
      if (init && ts.isCallExpression(init)) {
        const fnArg = init.arguments.find((a) => (ts.isArrowFunction(a) || ts.isFunctionExpression(a)) && node.pos >= a.pos && node.end <= a.end)
        if (fnArg) return { name: d.name.text, fn: fnArg }
      }
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) return { name: d.name.text, fn: init }
    }
  }
  return undefined
}

function scanFile(ctx, rel, text, findings, stats) {
  const { modules, doorFile, denyNames, exportsByModule } = ctx
  const sf = sourceFileOf(rel, text)
  const isDoor = rel === doorFile
  const add = (node, label, name) => findings.push({ rel, line: node ? lineOf(sf, node) : 0, label, name })

  // binding (local name) → { module, name (exported) } for listed-module imports
  const bindings = new Map()
  const importedNames = new Set() // every local name any import binds
  const exportedLocals = new Set() // `export { a }` local re-export lists
  const specOf = (lit) => (lit && (ts.isStringLiteral(lit) || ts.isNoSubstitutionTemplateLiteral(lit)) ? lit.text : null)

  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st)) {
      const spec = specOf(st.moduleSpecifier)
      const mod = spec && listedModuleOf(spec, rel, modules)
      const clause = st.importClause
      if (clause?.name) importedNames.add(clause.name.text)
      const nb = clause?.namedBindings
      if (nb && ts.isNamespaceImport(nb)) importedNames.add(nb.name.text)
      if (nb && ts.isNamedImports(nb)) for (const s of nb.elements) importedNames.add(s.name.text)
      if (!mod) continue
      if (nb && ts.isNamespaceImport(nb)) {
        add(st, 'namespace import', mod)
        continue
      }
      if (!isDoor) {
        add(st, 'import outside doorFile', mod)
        continue
      }
      if (clause?.isTypeOnly) continue
      if (clause?.name) bindings.set(clause.name.text, { module: mod, name: 'default' })
      if (nb && ts.isNamedImports(nb)) {
        for (const s of nb.elements) {
          if (s.isTypeOnly) continue
          bindings.set(s.name.text, { module: mod, name: (s.propertyName ?? s.name).text })
        }
      }
    } else if (ts.isExportDeclaration(st)) {
      const spec = specOf(st.moduleSpecifier)
      const mod = spec && listedModuleOf(spec, rel, modules)
      if (mod) add(st, 're-export', mod)
      else if (!st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) {
        for (const s of st.exportClause.elements) exportedLocals.add((s.propertyName ?? s.name).text)
      }
    } else if (ts.isImportEqualsDeclaration(st)) {
      importedNames.add(st.name.text)
      const ref = st.moduleReference
      const spec = ts.isExternalModuleReference(ref) ? specOf(ref.expression) : null
      const mod = spec && listedModuleOf(spec, rel, modules)
      if (mod) add(st, 'dynamic import', mod)
    }
  }

  // (b) the door's own exported functions named as a row's symbol.
  const doorOwn = new Set()
  if (isDoor) {
    const listedExports = new Set([...exportsByModule.values()].flatMap((s) => [...s]))
    const topFns = new Set()
    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st) && st.name && hasExport(st)) topFns.add(st.name.text)
      if (ts.isVariableStatement(st) && hasExport(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) topFns.add(d.name.text)
    }
    for (const r of ctx.calls) if (topFns.has(r.symbol) && !listedExports.has(r.symbol) && !importedNames.has(r.symbol)) doorOwn.add(r.symbol)
  }
  const allowed = new Set(ctx.allowNames.filter((a) => a.path === rel).map((a) => a.name))
  const isRoute = ROUTE_FILE.test(rel)

  const visit = (node) => {
    // Dynamic reach: import(), require(), jest.requireActual/requireMock, `typeof import()`.
    if (ts.isCallExpression(node)) {
      const c = node.expression
      const dyn =
        c.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(c) && c.text === 'require') ||
        (ts.isPropertyAccessExpression(c) && ['requireActual', 'requireMock'].includes(c.name.text))
      const spec = dyn ? specOf(node.arguments[0]) : null
      const mod = spec && listedModuleOf(spec, rel, modules)
      if (mod) add(node, 'dynamic import', mod)
      // A built specifier cannot be judged — so it is refused outright.
      else if (dyn && spec === null) add(node, 'dynamic import', '<non-literal specifier>')
    }
    if (ts.isImportTypeNode(node)) {
      const lit = ts.isLiteralTypeNode(node.argument) ? node.argument.literal : null
      const spec = specOf(lit)
      const mod = spec && listedModuleOf(spec, rel, modules)
      if (mod) add(node, 'dynamic import', mod)
    }
    // Rule 3 — destructuring a deny-set name out of anything, in the door.
    if (isDoor && ts.isBindingElement(node) && node.propertyName) {
      const key = bindingKeyText(node.propertyName)
      if (key !== null && denyNames.has(key)) add(node.propertyName, 'deny-set name in non-call position', key)
    }
    if (ts.isIdentifier(node) && isValueName(node)) {
      const text = node.text
      const bound = bindings.get(text)
      // THE RETURN-PATH CHECK — a walker emit name other than audit /
      // auditDurable, anywhere in the door (a local stand-in would read as
      // an audit to the walker).
      if (isDoor && FOREIGN_EMIT_NAMES.has(text)) add(node, 'foreign emit name', `${text} (the door emits through audit() / auditDurable() only)`)
      // A name inside an import/export declaration OF a listed module: rule 2
      // already judged that declaration.
      let decl = node.parent
      while (decl && !ts.isImportDeclaration(decl) && !ts.isExportDeclaration(decl) && !ts.isSourceFile(decl)) decl = decl.parent
      const inListedDecl = !!(decl && !ts.isSourceFile(decl) && decl.moduleSpecifier && listedModuleOf(specOf(decl.moduleSpecifier) ?? '', rel, modules))
      if (inListedDecl) {
        // judged by rule 2
      } else if (isDoor && isDeclarationName(node) && !isImportName(node) && (denyNames.has(text) || bindings.has(text))) {
        // Rule 3 — a local binding named like a core (or like an imported
        // core's local alias) shadows it; only the door's own row-symbol
        // function itself is exempt (rule 5 (b)).
        if (!(doorOwn.has(text) && isTopLevelExportName(node, sf))) add(node, 'shadowing a deny-set name', text)
      } else if (bound && isDoor && !isDeclarationName(node) && !(ts.isCallExpression(node.parent) && node.parent.expression === node)) {
        // Rule 3 — the core handed around instead of called.
        add(node, 'deny-set name in non-call position', text === bound.name ? text : `${text} → ${bound.name}`)
      } else if (bound && isDoor && !isDeclarationName(node)) {
        // A SITE (rule 3): the callee of a direct call.
        stats.sites++
        const enclosing = enclosingExportedFunction(node, sf, exportedLocals)
        const symbol = enclosing?.name
        const row = symbol === undefined ? undefined : ctx.calls.find((r) => r.module === bound.module && r.call === bound.name && r.symbol === symbol)
        if (ctx.never.includes(bound.name)) add(node, 'never', bound.name)
        else if (!row) add(node, 'no calls row', `${bound.name} in ${symbol ?? '<no exported function>'}`)
        else {
          const site = { module: row.module, call: row.call, symbol: row.symbol, class: row.class, line: lineOf(sf, node) }
          stats.approved.push(site)
          ctx.doorSites.push({ ...site, fn: enclosing.fn })
        }
      } else if (!bound && denyNames.has(text)) {
        // Rule 5 — the name without its import, minus the three exemptions.
        const exempt = allowed.has(text) || doorOwn.has(text) || (isRoute && ROUTE_METHODS.has(text) && !importedNames.has(text))
        if (!exempt) add(node, 'deny-set name without import', text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

/** Pure core: scan one repo root, return { findings, stats }. */
export function scanSharedCores(root, { allowNames = ALLOW_NAMES } = {}) {
  const sc = loadSharedCores(root)
  const findings = []
  const configRel = 'scripts/business/business-territory.json'
  const configLines = sc.text.split('\n')
  // A row's line: the one holding both its call and its symbol (the file keeps a
  // row on one line), else the first after "calls" naming its call, else "calls".
  const configLineOf = (needles) => {
    const calls = Math.max(0, configLines.findIndex((l) => l.includes('"calls"')))
    let i = configLines.findIndex((l) => needles.every((n) => l.includes(n)))
    if (i === -1) i = configLines.findIndex((l, j) => j > calls && l.includes(needles[0]))
    return (i === -1 ? calls : i) + 1
  }

  // Rule 1 — the deny set, from the real files.
  const exportsByModule = new Map()
  const fileOfModule = new Map()
  for (const mod of sc.modules) {
    const file = resolveModuleFile(root, mod)
    if (!file) {
      findings.push({ rel: configRel, line: configLineOf([`"${mod}"`]), label: 'module not found', name: mod })
      continue
    }
    const { names, star } = valueExports(sourceFileOf(file, readFileSync(join(root, file), 'utf8')))
    if (star) findings.push({ rel: file, line: 0, label: 'module has export * (deny set unreadable)', name: mod })
    exportsByModule.set(mod, names)
    fileOfModule.set(mod, file)
  }
  const policyText = readFileSync(join(root, 'src/lib/audit-policy.ts'), 'utf8')
  const cores = parseAuditedCores(policyText)
  if (cores === null) throw new Error("src/lib/audit-policy.ts: AUDITED_CORES unreadable by CP8's parser — the deny set cannot be built")
  const proven = provenAuditedCores(policyText, cores)
  const denyNames = new Set([...[...exportsByModule.values()].flatMap((s) => [...s]), ...cores.flatMap((e) => e.symbols)])

  // Rule 4 — every row names something real.
  for (const r of sc.calls) {
    const at = configLineOf([`"${r.call}"`, `"${r.symbol}"`])
    const bad = (why) => findings.push({ rel: configRel, line: at, label: `bad calls row (${why})`, name: `${r.module}#${r.call} in ${r.symbol}` })
    if (!sc.modules.includes(r.module)) bad('module not in modules')
    else if (!exportsByModule.get(r.module)?.has(r.call)) bad('call is not an export of its module')
    else if (sc.never.includes(r.call)) bad('call is in never')
    else if (!CLASSES.has(r.class)) bad('class is not core-emits | caller-emits | trace | receipt')
    else {
      const fits = CLASS_OF_CALL.get(r.call) ?? (proven.get(fileOfModule.get(r.module))?.has(r.call) ? 'core-emits' : 'caller-emits')
      if (r.class === 'core-emits' && fits === 'caller-emits') bad('not an audited core')
      else if (r.class !== fits) bad('class does not fit the call')
      else if (r.class === 'caller-emits' && !sc.calls.some((a) => a.symbol === r.symbol && (a.class === 'trace' || a.class === 'receipt'))) {
        findings.push({ rel: configRel, line: at, label: `unaudited write: ${r.symbol} needs an audit row`, name: `${r.module}#${r.call}` })
      }
    }
  }

  // Rules 2, 3, 5 — every territory file.
  const files = []
  for (const prefix of loadTerritory(root)) {
    const dir = join(root, prefix)
    if (existsSync(dir)) walk(dir, files)
  }
  // doorSites = every approved site with the function node that holds it
  // (THE RETURN-PATH CHECK reads them).
  const ctx = { modules: sc.modules, doorFile: sc.doorFile, never: sc.never, calls: sc.calls, denyNames, exportsByModule, allowNames, doorSites: [] }
  // sites = every site met (approved or not); approved = one entry per site that
  // matched its row (the selftest's real-tree check reads it — CI stays green
  // when the door lands with approved sites).
  const stats = { files: files.length, modules: sc.modules.length, denyNames: denyNames.size, sites: 0, approved: [] }
  for (const file of files) {
    const rel = relative(root, file).split(sep).join('/')
    scanFile(ctx, rel, readFileSync(file, 'utf8'), findings, stats)
  }
  // Rule 4, in the door — THE RETURN-PATH CHECK: each function holding a
  // caller-emits site holds an audit()/auditDurable() site of its own AND
  // passes the shared emission walker (no SDK: writePairs []). One finding per
  // function, at its first caller-emits site.
  const emitFns = new Set(ctx.doorSites.filter((s) => s.class === 'trace' || s.class === 'receipt').map((s) => s.fn))
  const judged = new Set()
  for (const s of ctx.doorSites) {
    if (s.class !== 'caller-emits' || judged.has(s.fn)) continue
    judged.add(s.fn)
    const offenders = emitFns.has(s.fn) ? [] : [`no audit()/auditDurable() call in ${s.symbol}`]
    offenders.push(...emitsOnEveryNonErrorPath(s.fn, { writePairs: [] }).offenders)
    if (offenders.length) {
      findings.push({
        rel: sc.doorFile,
        line: s.line,
        label: `unaudited write: ${s.symbol} needs an audit on every return path`,
        name: `${s.module}#${s.call}${offenders.map((o) => `\n    ${o}`).join('')}`,
      })
    }
  }
  findings.sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line || a.label.localeCompare(b.label))
  return { findings, stats }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
  const { findings, stats } = scanSharedCores(root)
  if (findings.length) {
    for (const f of findings) console.error(`${f.rel}:${f.line} ${f.label} — ${f.name}`)
    process.exit(1)
  }
  console.log(
    `OK shared-cores fence: ${stats.files} territory files, ${stats.modules} modules, ${stats.denyNames} deny-set names, ${stats.sites} sites`,
  )
}
