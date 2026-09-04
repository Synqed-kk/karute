#!/usr/bin/env node
// ⚖ AUDIO IS NEVER DELETED (capture pipeline PR4, design v2 item 10) — the
// machine behind the rule.
//
// A recording is the evidence behind a karute. Until this PR the app could
// destroy one from six different places (the worker after a successful job, the
// facade transcribe route's `finally`, the web port's cleanup leg, the discard
// janitor, a client-invokable `removeRecordingObject` server action, and the
// hour-old bucket sweep). Every one of them is gone. This guard is what keeps
// them gone: a reviewer can miss a re-added delete on a 300-line diff, a scan
// cannot.
//
// WHAT IT FLAGS: any call that removes an object from the `recordings` storage
// bucket, anywhere in src/ or thin/ — including the spellings a line-level
// regex cannot see:
//   supabase.storage.from('recordings').remove([key])          (direct)
//   const bucket = supabase.storage.from('recordings')
//   await bucket.remove([key])                                 (aliased)
//   client.storage.from(BUCKET).remove([key])                  (bucket in a var)
//   bucket['remove']([key])                                    (element access)
//   const { remove } = supabase.storage.from('recordings')
//   await remove([key])                                        (destructured)
//   const del = supabase.storage.from('recordings').remove
//   await del([key])                                           (property lift)
//   await supabase.storage.emptyBucket('recordings')           (the whole bucket)
// It parses with the TypeScript AST rather than matching text, so a comment, a
// string literal or a line break inside the chain changes nothing.
//
// WHAT IT DOES NOT FLAG (fix round 1, C2): a delete on a DIFFERENT bucket. The
// rule is about recordings; blaming a `photos` delete on it would teach people
// the guard is noise. The bucket is resolved from the `from(...)` argument —
// the literal, or a same-file `const` it reads through — and only a name this
// file cannot resolve at all still fails closed.
//
// THE ONE EXEMPTION: src/actions/voice.ts#revokeVoiceActionCore. Staff own
// their own voice (#401), so revoking an enrolment destroys the enrolment
// clips. It is exempt only while the call is POSITIVELY FENCED at runtime — the
// keys must be filtered against the `voice-enroll/<business>/<staff>` prefix
// the enrolment composed them with, so a settings blob carrying a recording key
// can never reach it. Lose the fence, lose the exemption: this script fails.
//
// Run: node scripts/audit/check-audio-never-deleted.mjs  (wired into CI's
// audit-gates job, beside its .selftest.mjs — the precedent is
// scripts/business/check-business-data-access.mjs + selftest). Its only
// dependency is `typescript`, which that job installs pinned.
//
// Ceilings, named:
//   - It reads THIS repo's source. A delete that lives in core, in an edge
//     function, or in a Supabase policy is out of its reach by construction.
//   - `.remove(` on a value this file never saw built (an argument, an import)
//     is invisible: the chain has to be traceable inside one file. That is the
//     same ceiling every scanner here carries, and the reason the code doctrine
//     (one upload door, one read door) is the primary defence and this is the
//     backstop.

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { basename, join, relative, dirname, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

/** The trees a recording delete could hide in. */
const ROOTS = ['src', 'thin']

/** The storage bucket this rule is about. */
const BUCKET = 'recordings'

/** The methods that DESTROY objects on a bucket handle (fix round 4). `remove`
 *  takes a list of keys; `emptyBucket` takes the whole bucket and needs no key
 *  at all — a spelling this guard used to walk straight past, which made the
 *  broadest possible delete the one shape it could not see. Both are treated
 *  identically everywhere below: the call, the destructure, and the property
 *  lift. */
const DELETE_METHODS = new Set(['remove', 'emptyBucket'])

/** The ONE exempt call site, and the fence that earns it the exemption. Both
 *  halves are checked: the file+symbol names WHO may delete, the fence proves
 *  WHAT they may delete. `voice-enroll/` is the prefix enrollVoiceActionCore
 *  composes its keys with; `startsWith` is the positive match that keeps any
 *  other key out. */
const EXEMPTION = {
  file: 'src/actions/voice.ts',
  symbol: 'revokeVoiceActionCore',
  reason:
    'staff own their own voice (#401): revoking an enrolment destroys the enrolment clips, and nothing else',
  fence: [`voice-enroll/`, 'startsWith'],
}

const SOURCE_EXT = /\.(tsx?|jsx?|mjs|cjs)$/
const SKIP_FILE = /\.(test|spec)\.[jt]sx?$|\.d\.ts$/
/** BUILD OUTPUT, never source (fix round 1, C3). `thin/dist` is a real,
 *  gitignored directory in this repo carrying the bundled vendor JS — minutes
 *  of parsing per run, and a delete found in there is a copy of a delete that
 *  already lives in src/. The git listing below skips them by itself (they are
 *  ignored); this list is what the fallback walk uses when there is no git. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage'])

/** THE source list, straight from git: tracked files plus the untracked ones
 *  that are not ignored — so a brand-new file is scanned the moment it exists,
 *  and nothing generated ever is. null when git cannot answer (no repo, no git
 *  binary, or the roots are empty here — the selftest's tmp fixtures), and the
 *  caller walks the directories instead. */
function gitFiles(rootDir) {
  try {
    const out = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...ROOTS],
      { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    const rels = out.split('\0').filter(Boolean)
    return rels.length ? rels.map((r) => join(rootDir, r)) : null
  } catch {
    return null
  }
}

function walk(dir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    // Tests are skipped like every sibling guard: a fixture names a delete to
    // assert it never happens.
    else if (SOURCE_EXT.test(e.name) && !SKIP_FILE.test(e.name)) out.push(p)
  }
}

/** Every file this guard reads, from git when git can answer and from the
 *  directory walk when it cannot. One filter either way. */
function sourceFiles(rootDir) {
  const listed = gitFiles(rootDir)
  if (listed) {
    return listed.filter((f) => SOURCE_EXT.test(basename(f)) && !SKIP_FILE.test(basename(f)))
  }
  const out = []
  for (const prefix of ROOTS) {
    const dir = join(rootDir, prefix)
    if (existsSync(dir)) walk(dir, out)
  }
  return out
}

function parse(rel, text) {
  return ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

/** The property/call chain under `node`, flattened to the names it touches:
 *  `supabase.storage.from('x').remove` → ['supabase', 'storage', 'from', 'remove'],
 *  with every string argument of every call in the chain collected too. */
function chainOf(node) {
  const names = []
  const args = []
  // The argument `from(...)` was called with — the bucket, before it is
  // resolved. Kept as a NODE: it may be a literal or an identifier, and only
  // bucketOf below (which can see the file's consts) can tell them apart.
  let fromArg = null
  let cur = node
  for (;;) {
    if (ts.isCallExpression(cur)) {
      if (calleeName(cur.expression) === 'from' && cur.arguments.length) fromArg = cur.arguments[0]
      for (const a of cur.arguments) {
        if (ts.isStringLiteralLike(a)) args.push(a.text)
      }
      cur = cur.expression
      continue
    }
    if (ts.isPropertyAccessExpression(cur)) {
      names.push(cur.name.text)
      cur = cur.expression
      continue
    }
    if (ts.isElementAccessExpression(cur)) {
      if (ts.isStringLiteralLike(cur.argumentExpression)) names.push(cur.argumentExpression.text)
      cur = cur.expression
      continue
    }
    if (ts.isParenthesizedExpression(cur) || ts.isNonNullExpression(cur) || ts.isAsExpression(cur)) {
      cur = cur.expression
      continue
    }
    if (ts.isIdentifier(cur)) names.push(cur.text)
    break
  }
  return { names, args, fromArg, root: ts.isIdentifier(cur) ? cur.text : null }
}

/** The method a call is calling, whichever way it is spelled: `x.remove(…)` and
 *  `x['remove'](…)` are the same call, and only one of them survives a text
 *  scan (fix round 1, C1/F2). */
function calleeName(expr) {
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text
  if (ts.isElementAccessExpression(expr) && ts.isStringLiteralLike(expr.argumentExpression)) {
    return expr.argumentExpression.text
  }
  return null
}

/** File-level `const NAME = 'literal'` — how a bucket name held in a variable
 *  gets resolved back to the string it is. */
function stringConsts(sf) {
  const consts = new Map()
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isStringLiteralLike(node.initializer)
    ) {
      consts.set(node.name.text, node.initializer.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return consts
}

/** WHICH bucket this chain names: the string, or 'unknown' when the name is
 *  not resolvable inside this file, or null when the chain never touches
 *  storage at all. */
function bucketOf(chain, consts) {
  const arg = chain.fromArg
  if (arg) {
    if (ts.isStringLiteralLike(arg)) return arg.text
    if (ts.isIdentifier(arg) && consts.has(arg.text)) return consts.get(arg.text)
    return 'unknown'
  }
  // No `from(…)` in the chain — a storage handle built somewhere this call
  // cannot see. Storage at all is enough to keep asking.
  return chain.names.includes('storage') ? 'unknown' : null
}

/** Does this chain reach the RECORDINGS bucket? (fix round 1, C2 — it used to
 *  answer "any .storage chain", so a `photos` delete was reported as a
 *  recording delete, at the exact file and line, in a guard whose whole value
 *  is that its findings are true.) A bucket that resolves to something else
 *  passes; a bucket this file cannot resolve still fails closed, because
 *  "I could not tell" has never been a reason to allow a delete here. */
function reachesBucket(chain, consts) {
  const bucket = bucketOf(chain, consts)
  return bucket === BUCKET || bucket === 'unknown'
}

/** The local names a recordings delete can wear in this file:
 *
 *  `aliases` — identifiers DECLARED from a storage chain
 *  (`const bucket = supabase.storage.from('recordings')`); a `.remove(` on one
 *  of them is the same delete under a local name.
 *
 *  `removes` — the delete FUNCTION itself, lifted off the handle, either by
 *  DESTRUCTURING (`const { remove } = supabase.storage.from('recordings')`,
 *  rename included) or by naming the property
 *  (`const del = supabase.storage.from('recordings').remove` — fix round 4,
 *  F4: that one used to register as a bucket ALIAS, so the bare `del([key])`
 *  that followed reported nothing at all). Called as a bare `remove([key])` it
 *  has no chain left to walk, which is how it slipped past both this guard and
 *  the census (fix round 1, C1/F3). */
function storageBindings(sf, consts) {
  const aliases = new Set()
  const removes = new Set()
  /** The chain this initializer is, when it reaches the recordings bucket —
   *  null otherwise. Returned rather than a boolean since fix round 4: WHICH
   *  name the chain ends on is what separates a bucket handle from the delete
   *  lifted off one. */
  const bucketChain = (init) => {
    let expr = init
    if (ts.isAwaitExpression(expr)) expr = expr.expression
    if (
      !ts.isCallExpression(expr) &&
      !ts.isPropertyAccessExpression(expr) &&
      !ts.isElementAccessExpression(expr)
    ) {
      return null
    }
    const chain = chainOf(expr)
    return reachesBucket(chain, consts) ? chain : null
  }
  const visit = (node) => {
    const chain =
      ts.isVariableDeclaration(node) && node.initializer ? bucketChain(node.initializer) : null
    if (chain) {
      if (ts.isIdentifier(node.name)) {
        // chainOf collects names outermost-first, so names[0] is the LAST
        // property the chain touched: `.remove` there is the delete function
        // itself under a local name, not a bucket handle (fix round 4, F4).
        if (DELETE_METHODS.has(chain.names[0])) removes.add(node.name.text)
        else aliases.add(node.name.text)
      } else if (ts.isObjectBindingPattern(node.name)) {
        for (const el of node.name.elements) {
          const key = el.propertyName ?? el.name
          const name =
            ts.isIdentifier(key) || ts.isStringLiteralLike(key) ? key.text : null
          if (name && DELETE_METHODS.has(name) && ts.isIdentifier(el.name)) {
            removes.add(el.name.text)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return { aliases, removes }
}

/** The named function-like declaration enclosing `pos`, smallest span first —
 *  the same "who owns this line" question the CP3 census asks. */
function symbolSpans(sf) {
  const out = []
  const visit = (node) => {
    const named =
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name && node.body
        ? node.name
        : null
    if (named && ts.isIdentifier(named)) {
      out.push({ name: named.text, start: node.getStart(), end: node.getEnd(), node })
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = node.initializer
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        out.push({ name: node.name.text, start: node.getStart(), end: node.getEnd(), node })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

function symbolAt(pos, spans) {
  const enclosing = spans.filter((s) => pos >= s.start && pos <= s.end)
  enclosing.sort((a, b) => a.end - a.start - (b.end - b.start))
  return enclosing[0]
}

/** The exempt symbol's CODE, comments excluded — every leaf token's own text,
 *  concatenated. Leading and trailing trivia is not part of a token's text, so
 *  a comment cannot contribute a single character here (fix round 1, B2/F1: a
 *  `// keys are filtered against voice-enroll/ with startsWith` left above an
 *  UNFENCED delete satisfied the old raw-text check — mutation-proven — which
 *  meant the one runtime fence in the repo could be deleted and described
 *  rather than kept). String and template literals ARE code and stay: the fence
 *  itself is a template literal. */
function codeTextOf(node, sf) {
  let out = ''
  const visit = (n) => {
    let leaf = true
    ts.forEachChild(n, (child) => {
      leaf = false
      visit(child)
    })
    if (leaf) out += `${n.getText(sf)}\n`
  }
  visit(node)
  return out
}

/** Is the exemption's runtime fence still there?
 *
 *  Text, deliberately: the question is "does the prefix filter still exist",
 *  and a shape check would break on any honest refactor of a fence that is
 *  still standing. Both halves must appear — the prefix AND the positive match.
 *
 *  Scoped to the exempt SYMBOL, never the file (2026-09-04, found by the
 *  mutation proof this guard's own PR ran on itself). voice.ts carries
 *  `voice-enroll/` in enrollVoiceActionCore and `startsWith('audio/')` in its
 *  MIME check, so a file-wide scan stayed green with the revoke fence deleted —
 *  a guard that cannot see its own exemption being removed is not a guard.
 *
 *  And it is the symbol's CODE, never its prose (see codeTextOf). */
function fenceIntact(symbolCode) {
  const [prefix, match] = EXEMPTION.fence
  return symbolCode.includes(prefix) && symbolCode.includes(match)
}

/** Pure core: scan one repo root, return findings. */
export function scanAudioDeletes(rootDir) {
  const files = sourceFiles(rootDir)

  const findings = []
  for (const file of files) {
    const rel = relative(rootDir, file).split(sep).join('/')
    const source = readFileSync(file, 'utf8')
    // Cheap pre-filter: a file that never names a delete method cannot hold one.
    if (![...DELETE_METHODS].some((m) => source.includes(m))) continue
    const sf = parse(rel, source)
    const consts = stringConsts(sf)
    const { aliases, removes } = storageBindings(sf, consts)
    const spans = symbolSpans(sf)

    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        // A destructured delete has no chain left — the name IS the finding.
        const bare = ts.isIdentifier(node.expression) && removes.has(node.expression.text)
        const called = calleeName(node.expression)
        const named = called !== null && DELETE_METHODS.has(called)
        const chain = named ? chainOf(node.expression) : null
        const hit =
          bare || (chain !== null && (reachesBucket(chain, consts) || (chain.root && aliases.has(chain.root))))
        if (hit) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1
          const span = symbolAt(node.getStart(), spans)
          const symbol = span?.name
          const atExemptSite = rel === EXEMPTION.file && symbol === EXEMPTION.symbol
          // The fence is read out of the exempt FUNCTION's own CODE. A remove at
          // the top level of the exempt file has no symbol and no fence — and is
          // therefore never exempt.
          const exempt =
            atExemptSite && span !== undefined && fenceIntact(codeTextOf(span.node, sf))
          if (!exempt) {
            findings.push({
              rel,
              line,
              symbol: symbol ?? '(top level)',
              // Why it is NOT exempt, when it is the exempt site — losing the
              // fence has to read as its own failure, not as a mystery.
              label: atExemptSite
                ? 'the voice-enrolment exemption lost its runtime fence'
                : 'deletes an object from the recordings bucket',
            })
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return findings.sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
  const findings = scanAudioDeletes(root)
  if (findings.length) {
    console.error(`✗ audio-never-deleted guard: ${findings.length} violation(s)\n`)
    for (const f of findings) console.error(`  ${f.rel}:${f.line}  ${f.symbol}\n    [${f.label}]`)
    console.error(
      '\n⚖ A recording is the evidence behind a karute — this app never deletes one.' +
        '\nThe pipeline reads the take’s FINALIZED object (secure-take.ts) and leaves it' +
        `\nwhere it is. The only exempt site is ${EXEMPTION.file}#${EXEMPTION.symbol}` +
        `\n(${EXEMPTION.reason}), and only while its runtime prefix fence stands.`,
    )
    process.exit(1)
  }
  console.log('✓ audio-never-deleted guard: no recording delete in src/ or thin/')
}
