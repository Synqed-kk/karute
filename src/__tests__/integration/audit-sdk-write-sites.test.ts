// CP3 (+ CP3b + CP3c) — SDK, raw-Supabase & auth/storage write-site coverage
// (contract §8, round-2 amendment A/C). Every write call the installed SDK
// exposes, every raw Supabase table-write chain, and every Supabase
// auth-admin/storage mutation found in src (non-test) must be lexically
// INSIDE one of its file's AUDITED_CORES `symbols` spans (symbol-level, not
// file-level — a write sitting in a different, unregistered function of an
// otherwise-audited file still needs its own entry) or carry an explicit
// allowlist entry (src/lib/audit-policy.ts) — the deny-default posture: an
// unknown write site fails loud with a template naming the exact fix.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import ts from 'typescript'
import { AUDITED_CORES, SDK_WRITE_ALLOWLIST, RAW_SUPABASE_WRITE_ALLOWLIST } from '@/lib/audit-policy'
import { findSymbol } from './helpers/audit-emission'
import { deriveSdkClasses, deriveWriteMethods, type WritePair } from './helpers/sdk-write-methods'

const ROOT = process.cwd()
const WRITE_VERBS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const STORAGE_WRITE_METHODS = new Set(['upload', 'remove', 'update', 'move', 'copy'])

// The three infrastructure emitters — their own plumbing writes (audit.ts's
// synqed.audit.log(...) durable-forward call) aren't "a silent business
// write" needing coverage, same exemption CP7 applies.
const INFRA_EXEMPT = new Set(['src/lib/audit.ts', 'src/lib/audit-web.ts', 'src/lib/app-api/handler.ts'])

const FIX_HINT =
  "if this site predates the PR, check whether @synqed-kk/client was bumped; fix surface = src/lib/audit-policy.ts"

function srcFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) srcFiles(full, out)
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

interface Site {
  line: number
  call: string
}

/** Registered symbol spans for `rel` (file path relative to ROOT), from
 *  AUDITED_CORES — a call site is "legal by registration" only if it falls
 *  lexically inside one of these. */
function symbolSpans(rel: string, source: string): [number, number][] {
  const entry = AUDITED_CORES.find((e) => e.file === rel)
  if (!entry) return []
  return entry.symbols
    .map((name) => findSymbol(source, name))
    .filter((n): n is NonNullable<typeof n> => !!n)
    .map((n) => [n.getStart(), n.getEnd()] as const)
}

function withinAnySpan(pos: number, spans: [number, number][]): boolean {
  return spans.some(([s, e]) => pos >= s && pos <= e)
}

// ── SynqedClient-aliasing detection (round-2 amendment C: bare-identifier
// receivers only count when destructured/assigned from a SynqedClient value
// in the same file — an unrelated same-named local must not false-positive) ──

function synqedClientAliasNames(sf: ts.SourceFile): Set<string> {
  const clientLikeVars = new Set<string>()
  const aliases = new Set<string>()

  function isClientConstructingInit(init: ts.Expression | undefined): boolean {
    if (!init) return false
    const text = init.getText()
    return /\b(getSynqedClient|newSynqedClient|new\s+SynqedClient)\s*\(/.test(text)
  }
  function hasClientTypeAnnotation(type: ts.TypeNode | undefined): boolean {
    return !!type && /SynqedClient/.test(type.getText())
  }

  // Pass 1: find identifiers holding a SynqedClient-typed/constructed value
  // (params typed `SynqedClient`/`Pick<SynqedClient,...>`, or `const x =
  // getSynqedClient()`/`new SynqedClient(...)`).
  function visitClientVars(node: ts.Node): void {
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && hasClientTypeAnnotation(node.type)) {
      clientLikeVars.add(node.name.text)
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (hasClientTypeAnnotation(node.type) || isClientConstructingInit(node.initializer)) {
        clientLikeVars.add(node.name.text)
      }
    }
    ts.forEachChild(node, visitClientVars)
  }
  visitClientVars(sf)

  // Pass 2: `const { prop } = clientVar` / `const prop = clientVar.prop`.
  function visitAliases(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (
        ts.isObjectBindingPattern(node.name) &&
        ts.isIdentifier(node.initializer) &&
        clientLikeVars.has(node.initializer.text)
      ) {
        for (const el of node.name.elements) {
          if (ts.isIdentifier(el.name)) aliases.add(el.name.text)
        }
      }
      if (
        ts.isIdentifier(node.name) &&
        ts.isPropertyAccessExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) &&
        clientLikeVars.has(node.initializer.expression.text)
      ) {
        aliases.add(node.name.text)
      }
    }
    ts.forEachChild(node, visitAliases)
  }
  visitAliases(sf)
  return aliases
}

/** The ROOT identifier of a property-access chain (`a.b.c` → `a`), for
 *  matching a computed-call receiver against "also appears as the receiver
 *  of a recognized write chain elsewhere in this file". */
function rootIdentifier(expr: ts.Expression): string | undefined {
  let cur: ts.Expression = expr
  while (ts.isPropertyAccessExpression(cur) || ts.isCallExpression(cur)) {
    cur = ts.isPropertyAccessExpression(cur) ? cur.expression : cur.expression
  }
  return ts.isIdentifier(cur) ? cur.text : undefined
}

/** Root identifiers that appear as the receiver of a recognized SDK/
 *  raw-supabase/auth-admin/storage write chain ANYWHERE in `sf` — used to
 *  decide whether a one-level computed call `x[a](` is "SDK-client-adjacent"
 *  (round-2/v2: pattern-based, NOT import-based — several real writer files
 *  never mention the SynqedClient type name at all, structural typing). */
function writeChainReceiverRoots(sf: ts.SourceFile): Set<string> {
  const roots = new Set<string>()
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      (sdkWriteCallMatchLoose(node) ||
        rawSupabaseWriteMatchLoose(node) ||
        authAdminOrStorageWriteMatchLoose(node))
    ) {
      const root = rootIdentifier(node.expression.expression)
      if (root) roots.add(root)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return roots
}

// Loose shape checks (verb-name only, no derived-write-pair lookup needed —
// this is receiver-fingerprinting, not the legality scan) reused by
// writeChainReceiverRoots.
function sdkWriteCallMatchLoose(node: ts.CallExpression): boolean {
  return ts.isPropertyAccessExpression(node.expression) && ts.isPropertyAccessExpression(node.expression.expression)
}
function rawSupabaseWriteMatchLoose(node: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(node.expression)) return false
  const receiver = node.expression.expression
  return (
    SUPABASE_WRITE_VERBS.has(node.expression.name.text) &&
    ts.isCallExpression(receiver) &&
    ts.isPropertyAccessExpression(receiver.expression) &&
    receiver.expression.name.text === 'from'
  )
}
function authAdminOrStorageWriteMatchLoose(node: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(node.expression)) return false
  const receiver = node.expression.expression
  if (ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'admin') return true
  return (
    STORAGE_WRITE_METHODS.has(node.expression.name.text) &&
    ts.isCallExpression(receiver) &&
    ts.isPropertyAccessExpression(receiver.expression) &&
    receiver.expression.name.text === 'from'
  )
}

/** Computed-member dispatch ban (contract §8 v2 Deliverable 4 — pattern-
 *  based, NOT import-based): a two-level computed call `x[a][b](...)` fails
 *  unconditionally anywhere in non-test src; a one-level computed call
 *  `x[a](...)` fails only when `x` ALSO appears in the same file as the
 *  receiver of a recognized SDK/raw-supabase/auth-admin/storage write chain
 *  (dynamic dispatch on a value this scan otherwise proved writes). */
function findComputedDispatch(sf: ts.SourceFile): number[] {
  const lines: number[] = []
  const writeRoots = writeChainReceiverRoots(sf)
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isElementAccessExpression(node.expression)) {
      const outer = node.expression
      const isTwoLevel = ts.isElementAccessExpression(outer.expression)
      const root = isTwoLevel ? rootIdentifier(outer.expression) : rootIdentifier(outer.expression)
      const flagged = isTwoLevel || (root !== undefined && writeRoots.has(root))
      if (flagged) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
        lines.push(line + 1)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return lines
}

function scanSdkWriteCalls(sf: ts.SourceFile, writePairs: WritePair[], aliasNames: Set<string>): Site[] {
  const propToMethods = new Map<string, Set<string>>()
  for (const { prop, method } of writePairs) {
    if (!propToMethods.has(prop)) propToMethods.set(prop, new Set())
    propToMethods.get(prop)!.add(method)
  }
  const out: Site[] = []
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const callee = node.expression
      const method = callee.name.text
      let prop: string | null = null
      if (ts.isPropertyAccessExpression(callee.expression)) {
        prop = callee.expression.name.text // x.prop.method(
      } else if (ts.isIdentifier(callee.expression) && aliasNames.has(callee.expression.text)) {
        prop = callee.expression.text // prop.method( — only when proven SynqedClient-aliased
      }
      if (prop && propToMethods.get(prop)?.has(method)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
        out.push({ line: line + 1, call: `${prop}.${method}` })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

const SUPABASE_WRITE_VERBS = new Set(['insert', 'update', 'upsert', 'delete'])

function tableConstNames(sf: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>()
  function visit(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    ) {
      out.set(node.name.text, node.initializer.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

function scanRawSupabaseWrites(sf: ts.SourceFile): Site[] {
  const consts = tableConstNames(sf)
  const out: Site[] = []
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const verb = node.expression.name.text
      const receiver = node.expression.expression
      if (
        SUPABASE_WRITE_VERBS.has(verb) &&
        ts.isCallExpression(receiver) &&
        ts.isPropertyAccessExpression(receiver.expression) &&
        receiver.expression.name.text === 'from' &&
        receiver.arguments.length > 0
      ) {
        const arg = receiver.arguments[0]
        let table: string | null = null
        if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) table = arg.text
        else if (ts.isIdentifier(arg)) table = consts.get(arg.text) ?? arg.text
        if (table) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
          out.push({ line: line + 1, call: `${table}.${verb}` })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** CP3c: `.auth.admin.<method>(` and `.storage.from(bucket).<upload|remove|
 *  update|move|copy>(` — call form `'auth.admin.createUser'` /
 *  `'storage.<bucket>.remove'`. */
function scanAuthAdminAndStorageWrites(sf: ts.SourceFile): Site[] {
  const out: Site[] = []
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      const receiver = node.expression.expression
      // .auth.admin.<method>( — excludes obvious reads (getUserById,
      // listUsers, ...); the Supabase Admin API's write surface is
      // createUser/deleteUser/updateUserById/inviteUserByEmail/generateLink.
      if (
        ts.isPropertyAccessExpression(receiver) &&
        receiver.name.text === 'admin' &&
        ts.isPropertyAccessExpression(receiver.expression) &&
        receiver.expression.name.text === 'auth' &&
        !/^(get|list|verify)/i.test(method)
      ) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
        out.push({ line: line + 1, call: `auth.admin.${method}` })
      }
      // .storage.from(bucket).<upload|remove|update|move|copy>(
      if (
        STORAGE_WRITE_METHODS.has(method) &&
        ts.isCallExpression(receiver) &&
        ts.isPropertyAccessExpression(receiver.expression) &&
        receiver.expression.name.text === 'from' &&
        ts.isPropertyAccessExpression(receiver.expression.expression) &&
        receiver.expression.expression.name.text === 'storage'
      ) {
        const bucketArg = receiver.arguments[0]
        const bucket =
          bucketArg && (ts.isStringLiteral(bucketArg) || ts.isNoSubstitutionTemplateLiteral(bucketArg))
            ? bucketArg.text
            : '?'
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
        out.push({ line: line + 1, call: `storage.${bucket}.${method}` })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

// ── Shared fixtures ──────────────────────────────────────────────────────

const writePairs = deriveWriteMethods()
const files = srcFiles(join(ROOT, 'src'))

describe('CP3 — SDK write-method derivation (from the installed SDK, not hardcoded)', () => {
  it('derives a non-empty write-method set including the sentinel customers.create, count >= 10', () => {
    expect(writePairs.length).toBeGreaterThanOrEqual(10)
    expect(writePairs.some((p) => p.prop === 'customers' && p.method === 'create')).toBe(true)
  })

  it('per-class parse floor: every client.d.ts property parses to >= 1 method (guards a codegen shrink)', () => {
    const classes = deriveSdkClasses()
    expect(classes.length).toBeGreaterThan(0)
    const empty = classes.filter((c) => c.methodCount === 0)
    expect(empty.map((c) => c.prop)).toEqual([])
  })
})

describe('CP3 — every SDK/raw-Supabase/auth-admin/storage write call site is covered', () => {
  const offenders: string[] = []
  const computedDispatchOffenders: string[] = []

  for (const file of files) {
    const rel = file.replace(ROOT + '/', '')
    if (INFRA_EXEMPT.has(rel)) continue
    const source = readFileSync(file, 'utf8')
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const spans = symbolSpans(rel, source)

    for (const line of findComputedDispatch(sf)) {
      computedDispatchOffenders.push(
        `${rel}:${line}: computed member call on an SDK-client-adjacent value (client[x][y](...)) — banned outright, dynamic dispatch is unscannable.`,
      )
    }

    const aliasNames = synqedClientAliasNames(sf)
    const allSites: { site: Site; kind: 'sdk' | 'raw' }[] = [
      ...scanSdkWriteCalls(sf, writePairs, aliasNames).map((site) => ({ site, kind: 'sdk' as const })),
      ...scanRawSupabaseWrites(sf).map((site) => ({ site, kind: 'raw' as const })),
      ...scanAuthAdminAndStorageWrites(sf).map((site) => ({ site, kind: 'sdk' as const })),
    ]

    for (const { site, kind } of allSites) {
      // Re-resolve the node's position for span containment (line-based here
      // is fine since we only need file:line for the message; containment
      // uses the node position captured during the scan via re-scan below).
      const allowlist = kind === 'sdk' ? SDK_WRITE_ALLOWLIST : RAW_SUPABASE_WRITE_ALLOWLIST
      const allowed = allowlist.some((e) => e.file === rel && e.call === site.call)
      if (allowed) continue
      // Symbol-span containment: re-find the exact node position for this
      // line+call (cheap re-derivation, avoids threading raw ts.Node through
      // the site record).
      const covered = spans.length > 0 && isLineWithinAnySpan(sf, site.line, spans)
      if (!covered) {
        const listName = kind === 'sdk' ? 'SDK_WRITE_ALLOWLIST' : 'RAW_SUPABASE_WRITE_ALLOWLIST'
        offenders.push(
          `${rel}:${site.line}: '${site.call}' is not inside a registered AUDITED_CORES symbol span and has no ${listName} entry. ${FIX_HINT}\n` +
            `  Add to src/lib/audit-policy.ts ${listName}:\n` +
            `  { file: '${rel}', call: '${site.call}', justification: '<honest reason>', dated: '<ISO date>' }`,
        )
      }
    }
  }

  it('no unallowlisted write sites', () => {
    expect(offenders).toEqual([])
  })

  it('no computed member dispatch on an SDK-client-adjacent value', () => {
    expect(computedDispatchOffenders).toEqual([])
  })
})

/** Line-based span containment: true if ANY node at `line` (searched via a
 *  fresh small AST walk bounded to that line's statements) falls inside one
 *  of `spans`. Simpler and just as correct as threading node references
 *  through the scan functions, since our spans are per-file and lines are
 *  unambiguous here. */
function isLineWithinAnySpan(sf: ts.SourceFile, line: number, spans: [number, number][]): boolean {
  let found = false
  function visit(node: ts.Node): void {
    if (found) return
    const start = node.getStart()
    const { line: nodeLine } = sf.getLineAndCharacterOfPosition(start)
    if (nodeLine + 1 === line && withinAnySpan(start, spans)) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

describe('CP3/CP3b/CP3c dead-entry rule — every allowlist entry must still be real', () => {
  it('every SDK_WRITE_ALLOWLIST entry file exists and still contains the named call', () => {
    const offenders: string[] = []
    for (const entry of SDK_WRITE_ALLOWLIST) {
      const abs = join(ROOT, entry.file)
      if (!existsSync(abs)) {
        offenders.push(`${entry.file}: file does not exist — prune this SDK_WRITE_ALLOWLIST entry`)
        continue
      }
      const source = readFileSync(abs, 'utf8')
      const sf = ts.createSourceFile(abs, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const aliasNames = synqedClientAliasNames(sf)
      const sites = [
        ...scanSdkWriteCalls(sf, writePairs, aliasNames),
        ...scanAuthAdminAndStorageWrites(sf),
      ]
      if (!sites.some((s) => s.call === entry.call)) {
        offenders.push(`${entry.file}: '${entry.call}' no longer appears — prune this SDK_WRITE_ALLOWLIST entry. ${FIX_HINT}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('every RAW_SUPABASE_WRITE_ALLOWLIST entry file exists and still contains the named call', () => {
    const offenders: string[] = []
    for (const entry of RAW_SUPABASE_WRITE_ALLOWLIST) {
      const abs = join(ROOT, entry.file)
      if (!existsSync(abs)) {
        offenders.push(`${entry.file}: file does not exist — prune this RAW_SUPABASE_WRITE_ALLOWLIST entry`)
        continue
      }
      const source = readFileSync(abs, 'utf8')
      const sf = ts.createSourceFile(abs, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const sites = scanRawSupabaseWrites(sf)
      if (!sites.some((s) => s.call === entry.call)) {
        offenders.push(`${entry.file}: '${entry.call}' no longer appears — prune this RAW_SUPABASE_WRITE_ALLOWLIST entry`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('dirname sanity: every allowlisted file path is under src/', () => {
    for (const entry of [...SDK_WRITE_ALLOWLIST, ...RAW_SUPABASE_WRITE_ALLOWLIST]) {
      expect(dirname(entry.file).startsWith('src/')).toBe(true)
    }
  })
})

describe('CP3 self-check — an unallowlisted seeded write FAILS', () => {
  it('flags a fake client.customers.delete( call in a non-allowlisted source', () => {
    const fakeSrc = `
      export async function evil(client: any) {
        await client.customers.delete('123')
      }
    `
    const sf = ts.createSourceFile('fake.ts', fakeSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const sites = scanSdkWriteCalls(sf, writePairs, new Set())
    expect(sites.some((s) => s.call === 'customers.delete')).toBe(true)
  })

  it('flags a fake raw .from("x").insert( call', () => {
    const fakeSrc = `
      export async function evil(sb: any) {
        await sb.from('x').insert({ y: 1 })
      }
    `
    const sf = ts.createSourceFile('fake.ts', fakeSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    expect(scanRawSupabaseWrites(sf).some((s) => s.call === 'x.insert')).toBe(true)
  })

  it('does not bare-grep-false-positive on a Map/Set .update(/.delete( call', () => {
    const fakeSrc = `
      const cache = new Map<string, number>()
      cache.delete('x')
    `
    const sf = ts.createSourceFile('fake.ts', fakeSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    expect(scanRawSupabaseWrites(sf)).toEqual([])
  })

  it('matches a bare-identifier receiver ONLY when destructured/assigned from a proven SynqedClient value (round-2 narrowing)', () => {
    const realSrc = `
      export async function evil(client: SynqedClient) {
        const { customers } = client
        await customers.delete('123')
      }
    `
    const realSf = ts.createSourceFile('fake.ts', realSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const realAliases = synqedClientAliasNames(realSf)
    expect(scanSdkWriteCalls(realSf, writePairs, realAliases).some((s) => s.call === 'customers.delete')).toBe(true)

    const unrelatedSrc = `
      function evil() {
        const customers = { delete: (x: string) => x }
        customers.delete('123')
      }
    `
    const unrelatedSf = ts.createSourceFile('fake.ts', unrelatedSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const unrelatedAliases = synqedClientAliasNames(unrelatedSf)
    expect(unrelatedAliases.size).toBe(0)
  })

  it('flags a two-level computed call unconditionally — no SynqedClient import/type needed (round-2/v2: pattern-based, not import-based)', () => {
    const fakeSrc = `
      export async function evil(client: any, a: string, b: string) {
        await client[a][b]('x')
      }
    `
    const sf = ts.createSourceFile('fake.ts', fakeSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    expect(findComputedDispatch(sf).length).toBeGreaterThan(0)
  })

  it('flags a one-level computed call only when the receiver also appears as a write-chain root in the same file', () => {
    const flaggedSrc = `
      export async function evil(client: any, a: string) {
        await client.customers.update('1', {})
        await client[a]('x')
      }
    `
    const flaggedSf = ts.createSourceFile('fake.ts', flaggedSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    expect(findComputedDispatch(flaggedSf).length).toBeGreaterThan(0)

    const unrelatedSrc = `
      export async function fine(map: any, a: string) {
        await map[a]('x')
      }
    `
    const unrelatedSf = ts.createSourceFile('fake.ts', unrelatedSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    expect(findComputedDispatch(unrelatedSf)).toEqual([])
  })

  it('flags auth.admin.createUser and storage.<bucket>.remove', () => {
    const fakeSrc = `
      export async function evil(service: any) {
        await service.auth.admin.createUser({})
        await service.storage.from('recordings').remove(['x'])
      }
    `
    const sf = ts.createSourceFile('fake.ts', fakeSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const sites = scanAuthAdminAndStorageWrites(sf)
    expect(sites.some((s) => s.call === 'auth.admin.createUser')).toBe(true)
    expect(sites.some((s) => s.call === 'storage.recordings.remove')).toBe(true)
  })
})
