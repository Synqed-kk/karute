#!/usr/bin/env node
// Business data-access guard (P1.5 foundation, ruling 3): inside Business
// territory, screens reach data ONLY through src/business/lib/ — the wrapper
// that is the one-file swap point when core actor-enforcement lands. Every
// other territory file is forbidden from opening its own door: no
// @synqed-kk/client import, no lib/supabase import (aliased OR relative), no
// `new SynqedClient(`, no createServiceClient()/createClient() call.
//
// Scope = the WHOLE territory (scripts/business/business-territory.json, the
// same source of truth the diff gate and the jest import-isolation suite read)
// — screens land under src/app/[locale]/(business)/ too, not just src/business/.
// Missing roots are a no-op: territory is empty today.
//
// Run: node scripts/business/check-business-data-access.mjs  (wired into CI's
// audit-gates job). No dependencies. Shape copied from
// scripts/audit/check-dark-interactive.mjs: walk, comment-strip, {re,label}
// patterns, exact-path ALLOW entries with occurrence budgets, exit 1 with a
// formatted list. Import specifiers are matched over the whole
// comment-stripped file (the jest suite's IMPORT_FORMS approach) so a
// line-split import or an `as` rename cannot evade.
//
// Notes:
//   - `import type` from @synqed-kk/client is flagged DELIBERATELY: types come
//     through the wrapper too, so the swap point stays one file.
//   - Ceiling (accepted): a text scan cannot see a dynamically built specifier
//     or an aliased re-export from outside territory, and a matching string
//     inside a string literal false-flags — ALLOW is the escape hatch.
//   - Comment state is computed with single-line string contents blanked, so a
//     '/*' inside a quoted string cannot blind the rest of the file (Greptile
//     P2). A MULTI-LINE template literal is the residual: its contents are not
//     blanked, so a '/*' inside one can still latch. Documented, not fixed —
//     the false-flag direction above is the safer failure of the two.
//   - A SYMLINKED directory inside territory is invisible to this walk
//     (readdirSync Dirent: isDirectory() is false for a link) — the jest
//     suite's "no symlinks in the scanned trees" assertion catches it in the
//     same CI run, so the pair is closed without a second lstat here.
//   - Territory is EMPTY today, so the live run is trivially green; the
//     selftest fixtures are the real red→green proof.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, relative, dirname, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadTerritory } from './check-business-isolation.mjs'

const WRAPPER = 'src/business/lib' // THE data door — exempt by design

// One regex per import form, specifier captured. `\s*` spans newlines, so
// `from\n  '@/lib/supabase/server'` matches; the specifier itself forbids
// newlines so a match can never span statements. Backticks included for the
// call forms, mirroring the jest suite.
const IMPORT_FORMS = [
  /\bfrom\s*['"]([^'"\n]+)['"]/g,
  /\bimport\s*['"]([^'"\n]+)['"]/g,
  /\bimport\s*\(\s*['"`]([^'"`\n]+)['"`]/g,
  /\brequire\s*\(\s*['"`]([^'"`\n]+)['"`]/g,
]

const FORBIDDEN_SPECIFIER = [
  [
    'core SDK import (@synqed-kk/client)',
    (s) => s === '@synqed-kk/client' || s.startsWith('@synqed-kk/client/'),
  ],
  [
    'supabase client import (lib/supabase/*)',
    // Aliased (@/lib/supabase/…) and relative (../../lib/supabase/…) both.
    (s) => /^(?:@\/|\.\.?\/(?:[^\n]*\/)?)lib\/supabase(?:\/|$)/.test(s),
  ],
]

const CALL_PATTERNS = [
  { re: /\bnew\s+SynqedClient\s*\(/g, label: 'new SynqedClient(' },
  { re: /\bcreateServiceClient\s*\(/g, label: 'createServiceClient(' },
  { re: /\bcreateClient\s*\(/g, label: 'createClient(' },
]

// Known-legal exceptions. Same contract as check-dark-interactive's ALLOW:
// exact path + label + a `match` substring the flagged line must contain + a
// `count` budget, so a pinned string copied onto a new line fails the whole
// entry closed. Empty today — every raw-client call lives in the wrapper.
const ALLOW = []

// allowJs is on (tsconfig), so .js/.mjs/.cjs/.jsx are real source here.
const SOURCE_EXT = /\.(tsx?|jsx?|mjs|cjs)$/
const SKIP_FILE = /\.(test|spec)\.[jt]sx?$|\.d\.ts$/

function walk(dir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    // Tests are skipped like the dark-interactive guard: a fixture may name a
    // client to mock it. Production files under territory are the rule.
    else if (SOURCE_EXT.test(e.name) && !SKIP_FILE.test(e.name)) out.push(p)
  }
}

/** Same-length copy of a line with single-line string CONTENTS blanked, so a
 *  comment marker inside a quote cannot toggle comment state (Greptile P2).
 *  Length is preserved, which keeps every index valid on the original line. */
function blankStrings(line) {
  return line.replace(/(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g, (m) => m[0] + '.'.repeat(m.length - 2) + m[0])
}

/** Comment-strip, line count AND line length preserved so match offsets still
 *  map to lines. Comment spans are blanked to spaces rather than removed;
 *  strings stay intact in the returned code because specifiers live in quotes.
 *  The `//` strip runs BEFORE the block-comment scan on purpose: a stray "/*"
 *  inside // prose must not blind the rest of the file. */
function stripComments(src) {
  let inBlockComment = false
  return src
    .split('\n')
    .map((line) => {
      let code = line
      let probe = blankStrings(line) // comment state is judged on THIS
      const blank = (from, to) => {
        code = code.slice(0, from) + ' '.repeat(to - from) + code.slice(to)
        probe = probe.slice(0, from) + ' '.repeat(to - from) + probe.slice(to)
      }
      if (inBlockComment) {
        const end = probe.indexOf('*/')
        if (end === -1) return ' '.repeat(line.length)
        blank(0, end + 2)
        inBlockComment = false
      }
      if (/^\s*\*/.test(probe)) return ' '.repeat(line.length) // jsdoc continuation
      const lineComment = /(^|\s)\/\/.*$/.exec(probe)
      if (lineComment) blank(lineComment.index + lineComment[1].length, line.length)
      for (let open = probe.indexOf('/*'); open !== -1; open = probe.indexOf('/*')) {
        const end = probe.indexOf('*/', open + 2)
        if (end === -1) {
          blank(open, line.length)
          inBlockComment = true
          break
        }
        blank(open, end + 2)
      }
      return code
    })
    .join('\n')
}

/** Pure core: scan one repo root, return findings. */
export function scanDataAccess(rootDir, allow = ALLOW) {
  const files = []
  for (const prefix of loadTerritory(rootDir)) {
    const dir = join(rootDir, prefix)
    if (existsSync(dir)) walk(dir, files)
  }

  const findings = []
  const exemptUses = new Map()
  for (const file of files) {
    const rel = relative(rootDir, file).split(sep).join('/')
    if (rel === WRAPPER || rel.startsWith(WRAPPER + '/')) continue
    const srcLines = readFileSync(file, 'utf8').split('\n')
    const code = stripComments(srcLines.join('\n'))
    // Territory files are small — counting newlines per match is cheap enough.
    const lineOf = (index) => code.slice(0, index).split('\n').length

    const hits = []
    for (const re of IMPORT_FORMS) {
      re.lastIndex = 0
      for (let m = re.exec(code); m; m = re.exec(code)) {
        const hit = FORBIDDEN_SPECIFIER.find(([, test]) => test(m[1]))
        if (hit) hits.push({ line: lineOf(m.index), label: hit[0] })
      }
    }
    for (const { re, label } of CALL_PATTERNS) {
      re.lastIndex = 0
      for (let m = re.exec(code); m; m = re.exec(code)) hits.push({ line: lineOf(m.index), label })
    }

    for (const { line, label } of hits) {
      const text = (srcLines[line - 1] ?? '').trim().slice(0, 120)
      const entry = allow.find(
        (a) => a.path === rel && a.label === label && a.match.some((m) => text.includes(m)),
      )
      if (!entry) {
        findings.push({ rel, line, label, text })
        continue
      }
      if (!exemptUses.has(entry)) exemptUses.set(entry, [])
      exemptUses.get(entry).push({ line, text })
    }
  }

  // Budget: a pinned substring on more lines than documented was copied onto
  // something new — fail the whole entry closed.
  for (const [entry, uses] of exemptUses) {
    if (uses.length > entry.count) {
      for (const u of uses) {
        findings.push({
          rel: entry.path,
          line: u.line,
          label: `allowlist over budget (${uses.length} > ${entry.count} pinned)`,
          text: u.text,
        })
      }
    }
  }
  return findings.sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
  const findings = scanDataAccess(root)
  if (findings.length) {
    console.error(`✗ business data-access guard: ${findings.length} violation(s)\n`)
    for (const f of findings) console.error(`  ${f.rel}:${f.line}  [${f.label}]\n    ${f.text}`)
    console.error(
      '\nBusiness screens import data ONLY from src/business/lib/ (the wrapper).' +
        '\nNeed a new query? Add it there — that file is the swap point for core' +
        '\nactor-enforcement. A genuinely legal exception needs an ALLOW entry' +
        '\nwith a reason and an exact-occurrence pin + count.',
    )
    process.exit(1)
  }
  console.log(`✓ business data-access guard: Business territory clean (wrapper: ${WRAPPER}/)`)
}
