import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { INTERNAL_DEBT, PUBLIC_ACTIONS } from './server-action-surface.data'

const ROOT = process.cwd()
// DEBT may only go DOWN. 2026-09-20 exception: #938 arrived before the ratchet;
// setStoreHoursCore adds one after bootstrap removal, and leaves in repair B.
const INTERNAL_DEBT_COUNT = 67 // may only go DOWN
const CLOSED_DOORS = ['memberEmailsForBusiness', 'writeOrgSettingsBlob']
const NEW_EXPORT_MESSAGE = "A new export in a 'use server' file is a browser-callable endpoint with no authentication of its own. If it is a real action, add it to PUBLIC_ACTIONS and make sure its FIRST lines check the session/capability. If it is an internal helper, put it in a server-only module instead. Read PKT-SEC-CORES-A."

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__tests__') return []
    const file = `${dir}/${entry.name}`
    return entry.isDirectory() ? sourceFiles(file) : /\.tsx?$/.test(file) ? [file] : []
  })
}

// Cheap lexical prefilter only: the AST below decides whether this is really
// a directive. Decode string escapes and skip comments, including a BOM/shebang,
// without parsing every client component and library in src.
function mayHaveServerDirective(source: string): boolean {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source)
  let token = scanner.scan()
  while (token === ts.SyntaxKind.StringLiteral) {
    if (scanner.getTokenValue() === 'use server') return true
    token = scanner.scan()
    if (token === ts.SyntaxKind.SemicolonToken) token = scanner.scan()
  }
  return false
}

function directives(ast: ts.SourceFile): string[] {
  const result: string[] = []
  for (const statement of ast.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break
    result.push(statement.expression.text)
  }
  return result
}

function bindingNames(name: ts.BindingName): string[] {
  return ts.isIdentifier(name)
    ? [name.text]
    : name.elements.flatMap((element) => ts.isOmittedExpression(element) ? [] : bindingNames(element.name))
}

function runtimeExports(ast: ts.SourceFile) {
  const names = new Set<string>()
  const references = new Set<string>()
  const wildcards: string[] = []
  const typeOnlyBindings = new Set<string>()
  for (const statement of ast.statements) {
    if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
      typeOnlyBindings.add(statement.name.text)
    } else if (ts.isImportDeclaration(statement) && statement.importClause) {
      const clause = statement.importClause
      if (clause.isTypeOnly && clause.name) typeOnlyBindings.add(clause.name.text)
      const bindings = clause.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (clause.isTypeOnly || element.isTypeOnly) typeOnlyBindings.add(element.name.text)
        }
      } else if (bindings && clause.isTypeOnly) typeOnlyBindings.add(bindings.name.text)
    }
  }
  for (const statement of ast.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue
      if (!statement.exportClause) {
        wildcards.push(statement.getText(ast))
      } else if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          const original = (element.propertyName ?? element.name).text
          if (element.isTypeOnly || (!statement.moduleSpecifier && typeOnlyBindings.has(original))) continue
          names.add(element.name.text)
          references.add(original)
        }
      } else {
        // export * as namespace from './module' is still a wildcard surface.
        wildcards.push(statement.getText(ast))
      }
      continue
    }
    if (ts.isExportAssignment(statement)) {
      names.add('default')
      if (ts.isIdentifier(statement.expression)) references.add(statement.expression.text)
      continue
    }
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined
    if (!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
    if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)) continue
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) continue
    if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
      names.add('default')
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
        references.add(statement.name.text)
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of bindingNames(declaration.name)) names.add(name)
      }
    } else if (
      ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement) ||
      ts.isImportEqualsDeclaration(statement)
    ) {
      if (statement.name) names.add(statement.name.text)
    } else {
      throw new Error(`Unrecognized runtime export in ${ast.fileName}: ${statement.getText(ast)}`)
    }
  }
  return { names: [...names].sort(), references: [...references], wildcards }
}

// Each candidate action module is parsed exactly once; all assertions reuse
// its inventory. No program/type checker or parse of the rest of the tree.
const actionFiles = sourceFiles('src').sort().flatMap((file) => {
  const source = readFileSync(join(ROOT, file), 'utf8')
  if (!mayHaveServerDirective(source)) return []
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  return directives(ast).includes('use server') ? [{ file, ...runtimeExports(ast) }] : []
})

console.info(`Surface inventory: ${actionFiles.length} files, ${actionFiles.reduce((sum, file) => sum + file.names.length, 0)} exports; PUBLIC ${Object.values(PUBLIC_ACTIONS).flat().length}; DEBT ${Object.values(INTERNAL_DEBT).flat().length}`)

describe('server action surface (PKT-SEC-CORES-A)', () => {
  it('r1: every runtime export is explicitly classified', () => {
    expect(actionFiles.length).toBeGreaterThan(0)
    const additions = actionFiles.flatMap(({ file, names }) => {
      const expected = new Set([...(PUBLIC_ACTIONS[file] ?? []), ...(INTERNAL_DEBT[file] ?? [])])
      return names.filter((name) => !expected.has(name)).map((name) => `${file}#${name}`)
    })
    if (additions.length) throw new Error(`${NEW_EXPORT_MESSAGE}\n${additions.join('\n')}`)
  })

  it('r2: removed exports and action files are removed from the data too', () => {
    const actual = new Map(actionFiles.map(({ file, names }) => [file, new Set(names)]))
    const stale = [PUBLIC_ACTIONS, INTERNAL_DEBT].flatMap((list) =>
      Object.entries(list).flatMap(([file, names]) => !actual.has(file)
        ? [`${file} (no longer an action file)`]
        : names.filter((name) => !actual.get(file)!.has(name)).map((name) => `${file}#${name}`)),
    )
    expect(stale).toEqual([])
  })

  it('the data partitions every action file without duplicate or overlapping names', () => {
    const files = actionFiles.map(({ file }) => file)
    expect(Object.keys(PUBLIC_ACTIONS).sort()).toEqual(files)
    expect(Object.keys(INTERNAL_DEBT).sort()).toEqual(files)
    for (const file of files) {
      const names = [...PUBLIC_ACTIONS[file], ...INTERNAL_DEBT[file]]
      expect({ file, names: names.sort() }).toEqual({ file, names: [...new Set(names)].sort() })
    }
  })

  it('wildcard re-exports are forbidden in action files', () => {
    expect(actionFiles.flatMap(({ file, wildcards }) => wildcards.map((value) => `${file}: ${value}`))).toEqual([])
  })

  it('r3: neither closed door is exported or allowlisted, including named re-exports', () => {
    const offenders: string[] = []
    for (const name of CLOSED_DOORS) {
      for (const { file, names, references } of actionFiles) {
        if (names.includes(name) || references.includes(name)) offenders.push(`${file}#${name}`)
      }
      for (const [label, list] of Object.entries({ PUBLIC_ACTIONS, INTERNAL_DEBT })) {
        for (const [file, names] of Object.entries(list)) {
          if (names.includes(name)) offenders.push(`${label}: ${file}#${name}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('r4: the member-email module starts with server-only and has no directive prologue', () => {
    const file = 'src/lib/invites/member-emails.ts'
    const source = readFileSync(join(ROOT, file), 'utf8')
    expect(source.split(/\r?\n/)[0]).toBe("import 'server-only'")
    expect(directives(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true))).toEqual([])
  })

  it('r6: no function-level use server directives outside inventoried action files', () => {
    const inventoried = new Set(actionFiles.map(({ file }) => file))
    const offenders: string[] = []
    for (const file of sourceFiles('src').sort()) {
      if (inventoried.has(file)) continue
      const source = readFileSync(join(ROOT, file), 'utf8')
      // Literal text or an escape is necessary; the AST decides whether it is
      // a directive, ignoring comments and ordinary strings. Parse candidates only.
      if (!source.includes('use server') && !source.includes('\\')) continue
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
      const visit = (node: ts.Node) => {
        if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
             ts.isArrowFunction(node) || ts.isMethodDeclaration(node) ||
             ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) ||
             ts.isConstructorDeclaration(node)) && node.body && ts.isBlock(node.body)) {
          const first = node.body.statements[0]
          if (first && ts.isExpressionStatement(first) &&
              ts.isStringLiteral(first.expression) && first.expression.text === 'use server') {
            const { line } = ast.getLineAndCharacterOfPosition(first.getStart(ast))
            offenders.push(`${file}:${line + 1}: function-level use server directive`)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(ast)
    }
    expect(offenders).toEqual([])
  })

  it('r5: the internal debt count is pinned and may only go down', () => {
    expect(Object.values(INTERNAL_DEBT).reduce((sum, names) => sum + names.length, 0)).toBe(INTERNAL_DEBT_COUNT)
  })
})

describe('surface parser syntax coverage', () => {
  const parse = (source: string) => ts.createSourceFile('fixture.tsx', source, ts.ScriptTarget.Latest, true)

  it('recognizes only directive prologues, including escaped literals and multiple directives', () => {
    for (const source of ["// comment\n'use server';", "'use strict'\n'use server'\nexport {}", "'use\\x20server'"]) {
      expect(mayHaveServerDirective(source)).toBe(true)
      expect(directives(parse(source))).toContain('use server')
    }
    for (const source of ["// 'use server'\nexport {}", "const x = 'use server'", "'use server' + suffix", "import 'server-only'\n'use server'", "function f() { 'use server' }"]) {
      expect(directives(parse(source))).not.toContain('use server')
    }
  })

  it('collects runtime declarations, destructuring, aliases, re-exports and defaults', () => {
    const result = runtimeExports(parse(`
      export async function action() {}
      export const value = 1, { nested: { leaf }, ...rest } = source
      export let [first, , ...tail] = source
      export class Example {}
      export enum Mode { One }
      const local = () => {}; export { local as renamed }
      export { remote as forwarded } from './remote'
      export default async function namedDefault() {}
    `))
    expect(result.names).toEqual(['Example', 'Mode', 'action', 'default', 'first', 'forwarded', 'leaf', 'renamed', 'rest', 'tail', 'value'])
    expect(runtimeExports(parse('const f = () => {}; export default f')).names).toEqual(['default'])
    expect(runtimeExports(parse('export default class {}')).names).toEqual(['default'])
  })

  it('ignores type-only declarations and both type-only re-export forms', () => {
    expect(runtimeExports(parse(`
      export type Foo = string
      export interface Bar { value: string }
      export type { Remote } from './remote'
      export type * from './types'
      export { type Other, live } from './mixed'
      import type { Imported } from './types'
      interface Local {}
      export { Imported, Local, type Foo }
      export default interface DefaultType {}
      export declare const erased: string
    `)).names).toEqual(['live'])
  })

  it('rejects wildcard re-exports and retains original names behind aliases', () => {
    expect(runtimeExports(parse("export * from './remote'; export * as all from './remote'")).wildcards).toHaveLength(2)
    expect(runtimeExports(parse("export { memberEmailsForBusiness as hidden } from './remote'")).references).toContain('memberEmailsForBusiness')
  })
})
