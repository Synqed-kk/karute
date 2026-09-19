/**
 * bootstrapBusinessForNewUser writes the OWNER role (packet 03 MUST-FIX 2).
 *
 * The Supabase trigger seeds a new user's profile row with NO role, and bootstrap
 * previously only wrote full_name — so the FIRST owner resolved to `practitioner`
 * (synqedRoleToPreset's default) and was refused by capability gates, including
 * `settings.manage` on completeOnboarding's "Finish setup" (which blocked the
 * onboarding flow itself). The fix writes display_role + permission_role = 'owner'
 * on BOTH the trigger-created (update) path and the fallback insert path — the
 * same fields invites.ts sets for invited staff.
 *
 * The stamp is GATED on a role-less row: the action takes userId from the
 * (pre-session-sync) client and only verifies the user EXISTS, so it must never
 * change a role someone already holds — a call with an invited staffer's userId
 * keeps their invites.ts-written role.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { effectiveCapabilities, synqedRoleToPreset } from '@/lib/auth/permissions'

let updateError: { message: string } | null = null
const UPDATE = jest.fn((_vals: unknown) => ({ eq: async () => ({ error: updateError }) }))
const INSERT = jest.fn(async (_vals: unknown) => ({ error: null }))
let profileRow: { customer_id: string; full_name: string; permission_role?: string | null } | null = null

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    auth: {
      admin: {
        getUserById: async () => ({
          data: { user: { id: 'user-1', email: 'owner@example.com' } },
          error: null,
        }),
      },
    },
    from: () => {
      const builder: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) builder[m] = () => builder
      ;(builder as { maybeSingle: unknown }).maybeSingle = async () => ({ data: profileRow })
      ;(builder as { update: unknown }).update = (vals: unknown) => UPDATE(vals)
      ;(builder as { insert: unknown }).insert = (vals: unknown) => INSERT(vals)
      return builder
    },
  }),
}))

const staffList = jest.fn(async () => ({ staff: [] as unknown[] }))
const staffCreate = jest.fn(async () => ({}))
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: class {
    staff = { list: staffList, create: staffCreate }
  },
}))

import { bootstrapBusinessForNewUser } from '@/actions/bootstrap'

beforeEach(() => {
  jest.clearAllMocks()
  updateError = null
  profileRow = null
  process.env.SYNQED_CORE_URL = 'https://core.test'
  process.env.SYNQED_CORE_API_KEY = 'test-key'
})

describe('bootstrapBusinessForNewUser — owner role write', () => {
  it('trigger-created ROLE-LESS row: UPDATE carries display_role + permission_role = owner', async () => {
    profileRow = { customer_id: 'biz-1', full_name: 'owner@example.com', permission_role: null }
    const res = await bootstrapBusinessForNewUser('My Salon', 'user-1')
    expect(res).toEqual({ ok: true, businessId: 'biz-1' })
    expect(UPDATE).toHaveBeenCalledWith(
      expect.objectContaining({ display_role: 'owner', permission_role: 'owner' }),
    )
    expect(staffList).toHaveBeenCalledWith({ page_size: 200 })
    expect(staffCreate).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', role: 'OWNER' }),
    )
  })

  it('u1: a failed profile UPDATE returns its error before the core staff step', async () => {
    profileRow = { customer_id: 'biz-1', full_name: 'owner@example.com', permission_role: null }
    updateError = { message: 'boom' }
    const res = await bootstrapBusinessForNewUser('My Salon', 'user-1')
    expect(res).toEqual({ ok: false, error: 'Failed to update profile: boom' })
    expect(staffList).not.toHaveBeenCalled()
    expect(staffCreate).not.toHaveBeenCalled()
  })

  it('a row that ALREADY has a role keeps it — no owner stamp, full_name still updates', async () => {
    // e.g. an invited staffer's userId passed to this client-callable action:
    // their invites.ts-written role must not be escalated to owner.
    profileRow = { customer_id: 'biz-1', full_name: 'Staffer', permission_role: 'practitioner' }
    const res = await bootstrapBusinessForNewUser('My Salon', 'user-1')
    expect(res).toEqual({ ok: true, businessId: 'biz-1' })
    expect(UPDATE).toHaveBeenCalledWith({ full_name: 'My Salon' })
    expect(UPDATE).not.toHaveBeenCalledWith(
      expect.objectContaining({ permission_role: expect.anything() }),
    )
  })

  it('no existing row: INSERT carries display_role + permission_role = owner', async () => {
    profileRow = null
    const res = await bootstrapBusinessForNewUser('My Salon', 'user-1')
    expect(res).toMatchObject({ ok: true })
    expect(INSERT).toHaveBeenCalledWith(
      expect.objectContaining({ display_role: 'owner', permission_role: 'owner' }),
    )
  })

  it('the written role actually unblocks the gate: owner preset has settings.manage', () => {
    // Proves the fix addresses the ROOT bug — the capability the onboarding gate
    // (upsertOrgSettings) requires. Absent/practitioner would NOT have it.
    const caps = effectiveCapabilities(synqedRoleToPreset('OWNER'), null)
    expect(caps.has('settings.manage')).toBe(true)
    expect(effectiveCapabilities('practitioner', null).has('settings.manage')).toBe(false)
  })
})

describe('bootstrap server-only boundary — PKT-SEC-SIGNUP-BOOTSTRAP', () => {
  const root = process.cwd()
  const bootstrapPath = join(root, 'src/actions/bootstrap.ts')

  function hasUseServerDirective(sourceText: string): boolean {
    const source = ts.createSourceFile(bootstrapPath, sourceText, ts.ScriptTarget.Latest, true)
    // Checking every top-level statement covers the directive prologue and also
    // rejects a misplaced directive after an import, without matching comments.
    return source.statements.some((statement) =>
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression) &&
      statement.expression.text === 'use server',
    )
  }

  it('t1a: has no use server directive in the prologue or elsewhere at top level', () => {
    expect(hasUseServerDirective(readFileSync(bootstrapPath, 'utf8'))).toBe(false)
  })

  it.each([
    "'use server'\nimport 'server-only'\n",
    "/* Leading comment block */\n'use server'\nimport 'server-only'\n",
    "import 'server-only'\n'use server'\n",
    '"use server"\nimport "server-only"\n',
  ])('t1a directives: detects %s', (sourceText) => {
    expect(hasUseServerDirective(sourceText)).toBe(true)
  })

  it.each([
    "// A comment quoting 'use server'\nimport 'server-only'\n",
    '/* A comment quoting "use server" */\nimport "server-only"\n',
  ])('t1a comments: ignores quoted directive text in %s', (sourceText) => {
    expect(hasUseServerDirective(sourceText)).toBe(false)
  })

  it('t1b: starts with the server-only import', () => {
    expect(readFileSync(bootstrapPath, 'utf8')).toMatch(/^\s*import ['"]server-only['"]\s*(?:;|\r?\n)/)
  })

  function importsBootstrapFrom(filePath: string, sourceText: string): boolean {
    const source = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true)
    let found = false
    function visit(node: ts.Node) {
      if (ts.isImportDeclaration(node) && node.importClause) {
        const { isTypeOnly, name, namedBindings } = node.importClause
        if (isTypeOnly || (!name && namedBindings && ts.isNamedImports(namedBindings) &&
          namedBindings.elements.length > 0 &&
          namedBindings.elements.every((element) => element.isTypeOnly))) return
      }
      if (ts.isExportDeclaration(node)) {
        const { isTypeOnly, exportClause } = node
        if (isTypeOnly || (exportClause && ts.isNamedExports(exportClause) &&
          exportClause.elements.length > 0 &&
          exportClause.elements.every((element) => element.isTypeOnly))) return
      }
      const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isCallExpression(node) && (
          node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require')
        ) ? node.arguments[0] : undefined
      if (specifier && ts.isStringLiteralLike(specifier)) {
        const name = specifier.text
        const target = name.startsWith('@/')
          ? resolve(root, 'src', name.slice(2))
          : name.startsWith('.') ? resolve(dirname(filePath), name) : undefined
        // Match relative imports/re-exports as well as the alias, including
        // explicit source or emitted JS extensions.
        if (target?.replace(/\.(?:[cm]?[jt]sx?)$/, '') === bootstrapPath.slice(0, -3)) found = true
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    return found
  }

  function bootstrapImporters(): string[] {
    const importers: string[] = []
    function walk(directory: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === '__tests__') continue
        const path = join(directory, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(path) &&
          importsBootstrapFrom(path, readFileSync(path, 'utf8'))) {
          importers.push(relative(root, path))
        }
      }
    }
    walk(join(root, 'src'))
    walk(join(root, 'thin'))
    return importers.sort()
  }

  it.each([
    ["import type { BootstrapResult } from '@/actions/bootstrap'", false],
    ["export type { BootstrapResult } from '@/actions/bootstrap'", false],
    ["import { type A } from '@/actions/bootstrap'", false],
    ["import { type A, type B } from '@/actions/bootstrap'", false],
    ["import { type BootstrapResult, bootstrapBusinessForNewUser } from '@/actions/bootstrap'", true],
    ["import d, { type A } from '@/actions/bootstrap'", true],
    ["import * as bootstrap from '@/actions/bootstrap'", true],
    ["import '@/actions/bootstrap'", true],
    ["import {} from '@/actions/bootstrap'", true],
    ["import { bootstrapBusinessForNewUser } from '@/actions/bootstrap'", true],
    ["import { bootstrapBusinessForNewUser } from '../../src/actions/bootstrap'", true],
    ["export { bootstrapBusinessForNewUser } from '@/actions/bootstrap'", true],
    ["export { type A } from '@/actions/bootstrap'", false],
    ["export { type A, b } from '@/actions/bootstrap'", true],
    ["export * from '@/actions/bootstrap'", true],
    ["const bootstrap = import('@/actions/bootstrap')", true],
    ["const bootstrap = require('@/actions/bootstrap')", true],
    ["import { bootstrapBusinessForNewUser } from '@/actions/bootstrapper'", false],
  ])('t2 cases: census handles %s', (sourceText, counts) => {
    // A synthetic path resolves relative specifiers without creating a file.
    expect(importsBootstrapFrom(join(root, 'thin/x/y.ts'), sourceText)).toBe(counts)
  })

  it('t2: only the email-confirmation callback imports bootstrap', () => {
    const importers = bootstrapImporters()
    const expected = ['src/app/[locale]/auth/callback/route.ts']
    if (JSON.stringify(importers.sort()) !== JSON.stringify(expected)) {
      throw new Error(
        'a client importer would need the action back — read PKT-SEC-SIGNUP-BOOTSTRAP first\n' +
          `Expected ${JSON.stringify(expected)}; found ${JSON.stringify(importers)}`,
      )
    }
    expect(importers).toEqual(expected)
  })
})

export {}
