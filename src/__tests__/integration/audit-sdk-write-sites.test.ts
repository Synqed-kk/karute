// CP3 (+ CP3b + CP3c) — SDK, raw-Supabase & auth/storage write-site coverage
// (contract §8). Every write call the installed SDK exposes, every raw
// Supabase table-write chain, and every Supabase auth-admin/storage mutation
// found in src (non-test) must be lexically INSIDE one of its file's
// AUDITED_CORES `symbols` spans, OR inside a symbol listed in the matching
// allowlist entry's `symbols` (symbol-scoped allowlisting, fix round 1 #7 —
// a bare (file, call) match used to grant file-wide amnesty, contradicting
// the file's own symbol-level doctrine) — the deny-default posture: an
// unknown write site fails loud with a template naming the exact fix.
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import ts from 'typescript'
import { AUDITED_CORES, SDK_WRITE_ALLOWLIST, RAW_SUPABASE_WRITE_ALLOWLIST } from '@/lib/audit-policy'
import { findSymbol } from './helpers/audit-emission'
import { deriveSdkClasses, deriveWriteMethods, type WritePair } from './helpers/sdk-write-methods'
import { srcFiles } from './helpers/src-files'
import { staticAccessName, calleeObject, isComputedAccess, rootIdentifierName, accessChain } from './helpers/ast-access'

const ROOT = process.cwd()
const STORAGE_WRITE_METHODS = new Set(['upload', 'remove', 'update', 'move', 'copy'])
const SUPABASE_WRITE_VERBS = new Set(['insert', 'update', 'upsert', 'delete'])

// The three infrastructure emitters — their own plumbing writes (audit.ts's
// synqed.audit.log(...) durable-forward call) aren't "a silent business
// write" needing coverage, same exemption CP7 applies.
const INFRA_EXEMPT = new Set(['src/lib/audit.ts', 'src/lib/audit-web.ts', 'src/lib/app-api/handler.ts'])

const FIX_HINT =
  "if this site predates the PR, check whether @synqed-kk/client was bumped; fix surface = src/lib/audit-policy.ts"

interface Site {
  pos: number
  line: number
  call: string
}

// ── Named symbol spans (for BOTH AUDITED_CORES containment and the new
// symbol-scoped allowlist containment) ──────────────────────────────────

interface NamedSpan {
  name: string
  start: number
  end: number
}

/** Every named function-like declaration in `sf` with its full span —
 *  function declarations, const-arrow/function-expression declarations
 *  (at ANY nesting depth — a private helper like process-recording.ts's
 *  upsertKaruteRecord or regenerate-karute.ts's nested `rollback` is exactly
 *  as real a symbol as an exported one, same philosophy as findSymbol/CP7's
 *  processJob precedent), and method-shorthand declarations (both class
 *  methods AND object-literal methods, e.g. `export const webRecordingPort =
 *  { async prepareTranscription(blob) {...} }` — MethodDeclaration covers
 *  both node shapes identically). Export status is irrelevant — an allowlist
 *  entry can legally name a non-exported wrapper. */
function namedSymbolSpans(sf: ts.SourceFile): NamedSpan[] {
  const out: NamedSpan[] = []
  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      out.push({ name: node.name.text, start: node.getStart(), end: node.getEnd() })
    }
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.body) {
      out.push({ name: node.name.text, start: node.getStart(), end: node.getEnd() })
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      let init: ts.Expression = node.initializer
      if (ts.isCallExpression(init)) {
        const arrowArg = init.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a))
        if (arrowArg) init = arrowArg
      }
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        out.push({ name: node.name.text, start: node.getStart(), end: node.getEnd() })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

function symbolAt(pos: number, spans: NamedSpan[]): string | undefined {
  // Smallest enclosing span wins (an inner exported const inside an outer
  // one doesn't occur in this codebase, but narrowest-first is the honest
  // choice if it ever does).
  const enclosing = spans.filter((s) => pos >= s.start && pos <= s.end)
  enclosing.sort((a, b) => a.end - a.start - (b.end - b.start))
  return enclosing[0]?.name
}

/** Registered AUDITED_CORES symbol spans for `rel`, by findSymbol (only the
 *  file's own registered names — narrower than namedSymbolSpans, and the
 *  authority for "is this write covered by the registry"). */
function auditedCoresSpans(rel: string, source: string): NamedSpan[] {
  const entry = AUDITED_CORES.find((e) => e.file === rel)
  if (!entry) return []
  return entry.symbols
    .map((name) => {
      const n = findSymbol(source, name)
      return n ? { name, start: n.getStart(), end: n.getEnd() } : null
    })
    .filter((s): s is NamedSpan => !!s)
}

function withinAnySpan(pos: number, spans: NamedSpan[]): boolean {
  return spans.some((s) => pos >= s.start && pos <= s.end)
}

// ── SynqedClient-aliasing detection: bare-identifier receivers only count
// when destructured/assigned from a SynqedClient value in the same file —
// an unrelated same-named local must not false-positive. ──────────────────

function synqedClientAliasNames(sf: ts.SourceFile): Set<string> {
  return clientAliasing(sf).aliases
}

/** Delta-verify fix (7/27): every identifier DERIVED from a SynqedClient —
 *  the client-typed/constructed vars themselves AND props extracted off them
 *  (`const table = client.customers`) — for the dispatch ban's root check.
 *  Without this, `const table = client.customers; table[op](...)` had no
 *  literal surface name anywhere in its own chain and no prior literal call
 *  to fingerprint the root, so the ban never fired. */
function clientDerivedRootNames(sf: ts.SourceFile): Set<string> {
  const { clientLikeVars, aliases } = clientAliasing(sf)
  return new Set([...clientLikeVars, ...aliases])
}

function clientAliasing(sf: ts.SourceFile): { clientLikeVars: Set<string>; aliases: Set<string> } {
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
  return { clientLikeVars, aliases }
}

// ── Write-chain fingerprinting (for the dispatch ban) ───────────────────

const SDK_PROP_SURFACE = new Set(deriveWriteMethods().map((p) => p.prop))
const SURFACE_NAMES = new Set([...SDK_PROP_SURFACE, 'from', 'auth', 'admin', 'storage'])

/** Root identifiers that appear as the receiver of a recognized SDK/
 *  raw-supabase/auth-admin/storage write chain ANYWHERE in `sf` — pattern-
 *  based, NOT import-based (several real writer files never mention the
 *  SynqedClient type name at all — structural typing). Precise: the call's
 *  own access chain must contain a genuine SURFACE_NAMES member (an actual
 *  SDK client prop, or from/auth/admin/storage) — NOT "any 2+-level method
 *  chain" (that shape-only heuristic false-positived on ordinary code like
 *  `SCOPES[key].columns.filter(...)`, unrelated to any SDK client). */
function writeChainReceiverRoots(sf: ts.SourceFile): Set<string> {
  const roots = new Set<string>()
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression))) {
      const chain = accessChain(node.expression)
      const names = chain.map(staticAccessName).filter((n): n is string => n !== undefined)
      if (names.some((n) => SURFACE_NAMES.has(n))) {
        const root = rootIdentifierName(node.expression)
        if (root) roots.add(root)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return roots
}

/** Computed-member dispatch ban (contract §8, hardened fix round 1 #2): a
 *  chain containing a NON-LITERAL element access is banned when it is
 *  write-surface-adjacent —
 *   - two access links back-to-back are BOTH ElementAccess (x[a][b](...)),
 *   - the chain's root identifier is a known write-chain receiver elsewhere
 *     in the file (x[a](...) after x.customers.update(...) appears too), or
 *     is itself SynqedClient-derived — a client-typed/constructed var or a
 *     prop extracted off one (`const table = client.customers; table[op](`)
 *     — even with no literal surface name anywhere (delta-verify fix), or
 *   - any STATIC (literal) link in the chain names a known SDK client prop /
 *     `from` / `auth` / `admin` / `storage` — this fires even in ISOLATION,
 *     no root history needed (`client.customers[m](...)` — `customers`
 *     alone marks it, exactly as bracket-vs-dot parity requires).
 *  A fully-literal chain (`x['a']['b'](`) is never flagged — it reads
 *  exactly as `x.a.b(` and is scanned normally as a property write. */
function findComputedDispatch(sf: ts.SourceFile): number[] {
  const lines: number[] = []
  const writeRoots = writeChainReceiverRoots(sf)
  const clientRoots = clientDerivedRootNames(sf)
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression))) {
      const chain = accessChain(node.expression)
      const hasNonLiteral = chain.some(isComputedAccess)
      if (hasNonLiteral) {
        const twoAdjacentElementAccess = chain.some(
          (n, i) => ts.isElementAccessExpression(n) && i + 1 < chain.length && ts.isElementAccessExpression(chain[i + 1]),
        )
        const names = chain.map(staticAccessName).filter((n): n is string => n !== undefined)
        const root = rootIdentifierName(node.expression)
        const knownRoot = root !== undefined && (writeRoots.has(root) || clientRoots.has(root))
        const knownSurface = names.some((n) => SURFACE_NAMES.has(n))
        if (twoAdjacentElementAccess || knownRoot || knownSurface) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
          lines.push(line + 1)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return lines
}

// ── Write-site scanners (element-access parity: `x['prop']` reads exactly
// like `x.prop` everywhere, per staticAccessName/calleeObject) ───────────

function scanSdkWriteCalls(sf: ts.SourceFile, writePairs: WritePair[], aliasNames: Set<string>): Site[] {
  const propToMethods = new Map<string, Set<string>>()
  for (const { prop, method } of writePairs) {
    if (!propToMethods.has(prop)) propToMethods.set(prop, new Set())
    propToMethods.get(prop)!.add(method)
  }
  const out: Site[] = []
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const method = staticAccessName(node.expression)
      const receiver = calleeObject(node.expression)
      if (method && receiver) {
        let prop = staticAccessName(receiver)
        if (!prop && ts.isIdentifier(receiver) && aliasNames.has(receiver.text)) prop = receiver.text
        if (prop && propToMethods.get(prop)?.has(method)) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
          out.push({ pos: node.getStart(), line: line + 1, call: `${prop}.${method}` })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

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
    if (ts.isCallExpression(node)) {
      const verb = staticAccessName(node.expression)
      const receiver = calleeObject(node.expression)
      if (
        verb &&
        receiver &&
        SUPABASE_WRITE_VERBS.has(verb) &&
        ts.isCallExpression(receiver) &&
        staticAccessName(receiver.expression) === 'from' &&
        receiver.arguments.length > 0
      ) {
        const arg = receiver.arguments[0]
        let table: string | null = null
        if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) table = arg.text
        else if (ts.isIdentifier(arg)) table = consts.get(arg.text) ?? arg.text
        if (table) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
          out.push({ pos: node.getStart(), line: line + 1, call: `${table}.${verb}` })
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
    if (ts.isCallExpression(node)) {
      const method = staticAccessName(node.expression)
      const receiver = calleeObject(node.expression)
      if (method && receiver) {
        const receiverObj = calleeObject(receiver)
        if (staticAccessName(receiver) === 'admin' && receiverObj && staticAccessName(receiverObj) === 'auth' && !/^(get|list|verify)/i.test(method)) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
          out.push({ pos: node.getStart(), line: line + 1, call: `auth.admin.${method}` })
        }
        if (STORAGE_WRITE_METHODS.has(method) && ts.isCallExpression(receiver)) {
          const storageReceiver = calleeObject(receiver.expression)
          if (staticAccessName(receiver.expression) === 'from' && storageReceiver && staticAccessName(storageReceiver) === 'storage') {
            const bucketArg = receiver.arguments[0]
            const bucket =
              bucketArg && (ts.isStringLiteral(bucketArg) || ts.isNoSubstitutionTemplateLiteral(bucketArg)) ? bucketArg.text : '?'
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
            out.push({ pos: node.getStart(), line: line + 1, call: `storage.${bucket}.${method}` })
          }
        }
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
    const coreSpans = auditedCoresSpans(rel, source)
    const exportedSpans = namedSymbolSpans(sf)

    for (const line of findComputedDispatch(sf)) {
      computedDispatchOffenders.push(
        `${rel}:${line}: computed member call on an SDK-client-adjacent value — banned outright, dynamic dispatch is unscannable.`,
      )
    }

    const aliasNames = synqedClientAliasNames(sf)
    const allSites: { site: Site; kind: 'sdk' | 'raw' }[] = [
      ...scanSdkWriteCalls(sf, writePairs, aliasNames).map((site) => ({ site, kind: 'sdk' as const })),
      ...scanRawSupabaseWrites(sf).map((site) => ({ site, kind: 'raw' as const })),
      ...scanAuthAdminAndStorageWrites(sf).map((site) => ({ site, kind: 'sdk' as const })),
    ]

    for (const { site, kind } of allSites) {
      if (withinAnySpan(site.pos, coreSpans)) continue // covered by AUDITED_CORES
      const allowlist = kind === 'sdk' ? SDK_WRITE_ALLOWLIST : RAW_SUPABASE_WRITE_ALLOWLIST
      const enclosingSymbol = symbolAt(site.pos, exportedSpans)
      const covered = allowlist.some(
        (e) => e.file === rel && e.call === site.call && enclosingSymbol !== undefined && e.symbols.includes(enclosingSymbol),
      )
      if (!covered) {
        const listName = kind === 'sdk' ? 'SDK_WRITE_ALLOWLIST' : 'RAW_SUPABASE_WRITE_ALLOWLIST'
        const symbolNote = enclosingSymbol ? `enclosing exported symbol '${enclosingSymbol}'` : 'no enclosing exported symbol found'
        offenders.push(
          `${rel}:${site.line}: '${site.call}' (${symbolNote}) is not inside a registered AUDITED_CORES symbol span and has no matching ${listName} entry. ${FIX_HINT}\n` +
            `  Add to src/lib/audit-policy.ts ${listName}:\n` +
            `  { file: '${rel}', call: '${site.call}', symbols: ['${enclosingSymbol ?? '<enclosing exported symbol>'}'], justification: '<honest reason>', dated: '<ISO date>' }`,
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

describe('CP3/CP3b/CP3c dead-entry rule — every allowlist entry must still be real', () => {
  it('every SDK_WRITE_ALLOWLIST entry file exists, still contains the named call, and every listed symbol still contains it', () => {
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
      const sites = [...scanSdkWriteCalls(sf, writePairs, aliasNames), ...scanAuthAdminAndStorageWrites(sf)].filter(
        (s) => s.call === entry.call,
      )
      if (sites.length === 0) {
        offenders.push(`${entry.file}: '${entry.call}' no longer appears — prune this SDK_WRITE_ALLOWLIST entry. ${FIX_HINT}`)
        continue
      }
      const exportedSpans = namedSymbolSpans(sf)
      for (const symbolName of entry.symbols) {
        const span = exportedSpans.find((s) => s.name === symbolName)
        const stillThere = span && sites.some((s) => s.pos >= span.start && s.pos <= span.end)
        if (!stillThere) {
          offenders.push(`${entry.file}#${symbolName}: no longer contains '${entry.call}' — prune this symbol from the entry`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('every RAW_SUPABASE_WRITE_ALLOWLIST entry file exists, still contains the named call, and every listed symbol still contains it', () => {
    const offenders: string[] = []
    for (const entry of RAW_SUPABASE_WRITE_ALLOWLIST) {
      const abs = join(ROOT, entry.file)
      if (!existsSync(abs)) {
        offenders.push(`${entry.file}: file does not exist — prune this RAW_SUPABASE_WRITE_ALLOWLIST entry`)
        continue
      }
      const source = readFileSync(abs, 'utf8')
      const sf = ts.createSourceFile(abs, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const sites = scanRawSupabaseWrites(sf).filter((s) => s.call === entry.call)
      if (sites.length === 0) {
        offenders.push(`${entry.file}: '${entry.call}' no longer appears — prune this RAW_SUPABASE_WRITE_ALLOWLIST entry`)
        continue
      }
      const exportedSpans = namedSymbolSpans(sf)
      for (const symbolName of entry.symbols) {
        const span = exportedSpans.find((s) => s.name === symbolName)
        const stillThere = span && sites.some((s) => s.pos >= span.start && s.pos <= span.end)
        if (!stillThere) {
          offenders.push(`${entry.file}#${symbolName}: no longer contains '${entry.call}' — prune this symbol from the entry`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('dirname sanity + non-empty symbols: every allowlisted entry is under src/ and names >= 1 symbol', () => {
    for (const entry of [...SDK_WRITE_ALLOWLIST, ...RAW_SUPABASE_WRITE_ALLOWLIST]) {
      expect(dirname(entry.file).startsWith('src/')).toBe(true)
      expect(entry.symbols.length).toBeGreaterThan(0)
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

  it('treats a string-literal ElementAccess exactly as PropertyAccess (fix round 1 #2)', () => {
    const fakeSrc = `
      export async function evil(client: any) {
        await client['customers'].update('1', {})
      }
    `
    const sf = ts.createSourceFile('fake.ts', fakeSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    expect(scanSdkWriteCalls(sf, writePairs, new Set()).some((s) => s.call === 'customers.update')).toBe(true)
    // Not a dispatch-ban case — it's a literal key, scanned as a normal write site.
    expect(findComputedDispatch(sf)).toEqual([])
  })

  it('bans computed dispatch on a SynqedClient-DERIVED alias even with no literal surface name (delta-verify fix)', () => {
    const fakeSrc = `
      export async function evil(cond: boolean) {
        const client = getSynqedClient()
        const table = client.customers
        const op = cond ? 'delete' : 'update'
        await table[op]('123', {})
      }
    `
    const sf = ts.createSourceFile('fake.ts', fakeSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    expect(findComputedDispatch(sf).length).toBeGreaterThan(0)
    // Control: the same computed-call shape on a NON-client local stays legal.
    const benignSrc = `
      function fine(cond: boolean) {
        const handlers = { a: () => 1, b: () => 2 }
        const k = cond ? 'a' : 'b'
        return handlers[k]()
      }
    `
    const benignSf = ts.createSourceFile('fake.ts', benignSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    expect(findComputedDispatch(benignSf)).toEqual([])
  })

  it('matches a bare-identifier receiver ONLY when destructured/assigned from a proven SynqedClient value', () => {
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

  it('flags a two-level computed call unconditionally — no SynqedClient import/type needed', () => {
    const fakeSrc = `
      export async function evil(client: any, a: string, b: string) {
        await client[a][b]('x')
      }
    `
    const sf = ts.createSourceFile('fake.ts', fakeSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    expect(findComputedDispatch(sf).length).toBeGreaterThan(0)
  })

  it('does NOT flag a fully-literal two-level bracket chain — reads exactly as dotted access', () => {
    const fakeSrc = `
      export async function fine(client: any) {
        await client['customers']['update']('1', {})
      }
    `
    const sf = ts.createSourceFile('fake.ts', fakeSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    expect(findComputedDispatch(sf)).toEqual([])
  })

  it('flags a one-level computed call when the receiver also appears as a write-chain root in the same file', () => {
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

  it('flags a computed METHOD on a receiver whose last static property is a known SDK client prop, even isolated in its own file', () => {
    const fakeSrc = `
      export async function evil(client: any, m: string) {
        await client.customers[m]('1', {})
      }
    `
    const sf = ts.createSourceFile('fake.ts', fakeSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    expect(findComputedDispatch(sf).length).toBeGreaterThan(0)
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

  it('flags a new write site under an existing (file, call) pair but a DIFFERENT, unlisted symbol', () => {
    const fakeSrc = `
      export async function registeredWriter(client: any) {
        await client.customers.delete('1')
      }
      export async function newUnlistedWriter(client: any) {
        await client.customers.delete('2')
      }
    `
    const sf = ts.createSourceFile('fake.ts', fakeSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const sites = scanSdkWriteCalls(sf, writePairs, new Set())
    const spans = namedSymbolSpans(sf)
    const fakeAllowlist = [{ file: 'fake.ts', call: 'customers.delete', symbols: ['registeredWriter'] }]
    const uncovered = sites.filter((s) => s.call === 'customers.delete').filter((s) => {
      const symbol = symbolAt(s.pos, spans)
      return !fakeAllowlist.some((e) => e.call === s.call && symbol !== undefined && e.symbols.includes(symbol))
    })
    expect(uncovered.length).toBe(1) // newUnlistedWriter's site is NOT covered
  })
})
