#!/usr/bin/env node
// Business play-phase fence (Liam's ruling, 2026-08-19): SYNQED Business runs
// on FIXTURE DATA ONLY until he gives the explicit reconnect order. This guard
// is the machine that enforces it, across ALL Business territory:
//
//   1. NO DIRECT core reach, anywhere — @synqed-kk/client, the app's
//      core-client factory (lib/synqed/client), `new SynqedClient(`,
//      `getSynqedClient(`. No file is exempt, src/business/lib/ included.
//   2. NO writes, anywhere — .insert( .update( .upsert( .delete( .rpc(.
//      Zero exemptions, the lock files included: nothing in Business can edit
//      anything, by construction.
//   3. Supabase / service-client READS are legal in EXACTLY two lock files,
//      src/business/lib/grants.ts and src/business/lib/admission.ts, so the
//      workspace-grant lock stays real config, not a fixture. Everywhere else
//      in territory — data.ts included — they are forbidden.
//
// Reconnection is a deliberate PR on Liam's word that has to amend this file,
// and scripts/business/ is CODEOWNER-gated, so that PR gets owner review by
// construction. That is the point.
//
// ⚠ WHAT THIS GUARD CANNOT SEE (2026-08-19 post-merge audit, the reason the
// pair exists): it reads DIRECT specifiers and call sites in territory files
// only. Territory once reached core INDIRECTLY — @/actions/stores,
// @/lib/auth/*, @/lib/staff all call core on Business's behalf — and every
// rule below stayed green, because none of those names is a client. The
// INDIRECT half is closed by the import ALLOWLIST in
// src/__tests__/integration/business-isolation.test.ts: territory may import
// only itself, react/next, node builtins and the two supabase modules, so a
// new helper-shaped path is an offender by default. Neither half is the
// machine on its own; the pair is.
//
// Scope = the WHOLE territory (scripts/business/business-territory.json, the
// same source of truth the diff gate and the jest import-isolation suite read).
// A missing root is a no-op; the roots that exist hold real files today
// (grants/admission/data/fixtures, the i18n loader, the shell layout) and
// every live run scans them.
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
//     through the fixture door too, so the swap point stays one file.
//   - Ceiling (accepted): a text scan cannot see a dynamically built specifier
//     or an aliased re-export from outside territory, and a matching string
//     inside a string literal false-flags. The write patterns are dot-anchored
//     names, so a Map/Set `.delete(` false-flags too — ALLOW is the escape
//     hatch for both, and it is owner-reviewed like everything else here.
//   - Comment state is computed with single-line string contents blanked, so a
//     '/*' inside a quoted string cannot blind the rest of the file (Greptile
//     P2). A MULTI-LINE template literal is the residual: its contents are not
//     blanked, so a '/*' inside one can still latch. Documented, not fixed —
//     the false-flag direction above is the safer failure of the two.
//   - A SYMLINKED directory inside territory is invisible to this walk
//     (readdirSync Dirent: isDirectory() is false for a link) — the jest
//     suite's "no symlinks in the scanned trees" assertion catches it in the
//     same CI run, so the pair is closed without a second lstat here.
//   - The live run scans real territory files, but only the ones that exist
//     — the selftest fixtures are what pin every rule in both directions,
//     including the ones no current file happens to exercise.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, relative, dirname, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadTerritory } from './check-business-isolation.mjs'

// The ONLY files allowed a supabase read — the workspace-grant lock itself.
const LOCK_FILES = ['src/business/lib/grants.ts', 'src/business/lib/admission.ts']

// Per-rule scope: does this rule apply to this file?
const EVERYWHERE = () => true
const OUTSIDE_LOCK_FILES = (rel) => !LOCK_FILES.includes(rel)

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

// Aliased (@/lib/x/…) and relative (../../lib/x/…) reach into the same module.
const reachesLib = (mod) => new RegExp(`^(?:@\\/|\\.\\.?\\/(?:[^\\n]*\\/)?)lib\\/${mod}(?:\\/|$)`)

const FORBIDDEN_SPECIFIER = [
  {
    label: 'core SDK import (@synqed-kk/client)',
    test: (s) => s === '@synqed-kk/client' || s.startsWith('@synqed-kk/client/'),
    scope: EVERYWHERE,
  },
  {
    label: 'core client factory import (lib/synqed/client)',
    test: (s) => reachesLib('synqed/client').test(s),
    scope: EVERYWHERE,
  },
  {
    label: 'supabase client import (lib/supabase/*)',
    test: (s) => reachesLib('supabase').test(s),
    scope: OUTSIDE_LOCK_FILES,
  },
]

const CALL_PATTERNS = [
  { re: /\bnew\s+SynqedClient\s*\(/g, label: 'new SynqedClient(', scope: EVERYWHERE },
  { re: /\bgetSynqedClient\s*\(/g, label: 'getSynqedClient(', scope: EVERYWHERE },
  { re: /\bcreateServiceClient\s*\(/g, label: 'createServiceClient(', scope: OUTSIDE_LOCK_FILES },
  { re: /\bcreateClient\s*\(/g, label: 'createClient(', scope: OUTSIDE_LOCK_FILES },
  // Writes: banned territory-wide, lock files included. Nothing in Business
  // edits anything during the play phase.
  { re: /\.insert\s*\(/g, label: 'write call .insert(', scope: EVERYWHERE },
  { re: /\.update\s*\(/g, label: 'write call .update(', scope: EVERYWHERE },
  { re: /\.upsert\s*\(/g, label: 'write call .upsert(', scope: EVERYWHERE },
  { re: /\.delete\s*\(/g, label: 'write call .delete(', scope: EVERYWHERE },
  { re: /\.rpc\s*\(/g, label: 'write call .rpc(', scope: EVERYWHERE },
]

// Known-legal exceptions. Same contract as check-dark-interactive's ALLOW:
// exact path + label + a `match` substring the flagged line must contain + a
// `count` budget, so a pinned string copied onto a new line fails the whole
// entry closed. Empty today.
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
    const srcLines = readFileSync(file, 'utf8').split('\n')
    const code = stripComments(srcLines.join('\n'))
    // Territory files are small — counting newlines per match is cheap enough.
    const lineOf = (index) => code.slice(0, index).split('\n').length

    const hits = []
    for (const re of IMPORT_FORMS) {
      re.lastIndex = 0
      for (let m = re.exec(code); m; m = re.exec(code)) {
        const rule = FORBIDDEN_SPECIFIER.find((r) => r.scope(rel) && r.test(m[1]))
        if (rule) hits.push({ line: lineOf(m.index), label: rule.label })
      }
    }
    for (const { re, label, scope } of CALL_PATTERNS) {
      if (!scope(rel)) continue
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
    console.error(`✗ business play-phase fence: ${findings.length} violation(s)\n`)
    for (const f of findings) console.error(`  ${f.rel}:${f.line}  [${f.label}]\n    ${f.text}`)
    console.error(
      '\nBusiness runs on FIXTURE DATA until Liam gives the reconnect order:' +
        '\nno core SDK or core-client reach anywhere in territory, no writes' +
        `\nanywhere, supabase READS only in ${LOCK_FILES.join(' / ')}.` +
        '\nReconnecting is a deliberate owner-reviewed PR that amends this guard.',
    )
    process.exit(1)
  }
  console.log('✓ business play-phase fence: territory clean (no core reach, no writes)')
}
